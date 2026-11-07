// Online payments from the client portal (Paynet hosted checkout, sandbox only).
//
//  owner (Desk)            portal (browser)                      Desk server                         Paynet
//  ───────────            ────────────────                      ───────────                         ──────
//  sets amount ─────────▶ payment_requests
//                         clicks «Վճարել առցանց» ──────────────▶ checks Wix member + application
//                                                               reuses the unfinished attempt, or ─▶ POST /v1/payments (Idempotency-Key)
//                         ◀──────────────────────────────────── checkout_url
//                         pays on Paynet's page ──────────────────────────────────────────────────▶
//                         returns to the portal ───────────────▶ GET /v1/orders/{order}/payment ───▶ (never trusts the redirect)
//                                                 webhook ◀──── HMAC check, dedupe, then the same read-back ──▶
//  sees "Paid" ◀───────── only after Paynet's API confirms: completed, sandbox, same amount, same order.
import crypto from "node:crypto";
import { z } from "zod";
import { one, withUser, type Q } from "../db";
import { HttpError, notFound, conflict, zId } from "../errors";
import { logActivity } from "../audit";
import { env } from "../env";
import {
  createPayment, getOrderPayment, PaynetError, paynetConfig, paynetProblem, safeCheckoutUrl, verifyWebhookSignature, PAYNET_STATUSES,
  type PaynetPayment,
} from "../paynet";
import type { PortalMember } from "../portal-auth";

export const RequestInput = z.object({
  amount_amd: z.coerce.number().int("Whole drams only").min(100, "At least 100 AMD").max(10_000_000, "At most 10,000,000 AMD"),
  description: z.string().trim().min(2, "Describe what the payment is for").max(200),
  case_id: zId.nullish(),
});
export const RequestAction = z.object({ action: z.enum(["cancel", "verify"]) });

export type RequestStatus = "open" | "paid" | "cancelled" | "refunded";
export type AttemptStatus = "creating" | "pending" | "processing" | "completed" | "failed" | "expired" | "refunded" | "error";

export interface PaymentRequestRow {
  id: string;
  user_id: string;
  client_id: string;
  case_id: string | null;
  amount_amd: number;
  description: string;
  status: RequestStatus;
  wix_application_id: string | null;
  paid_payment_id: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OnlinePaymentRow {
  id: string;
  user_id: string;
  client_id: string;
  request_id: string;
  wix_application_id: string;
  wix_member_id: string;
  order_id: string;
  idempotency_key: string;
  amount_amd: number;
  currency: string;
  status: AttemptStatus;
  provider_payment_id: string | null;
  checkout_url: string | null;
  failure_code: string | null;
  livemode: boolean | null;
  rrn: string | null;
  duplicate: boolean;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  completed_at: string | null;
}

const ACTIVE: AttemptStatus[] = ["creating", "pending", "processing"];
const FINAL: AttemptStatus[] = ["completed", "failed", "expired", "refunded", "error"];
/** Attempts a client may start for one request in 24 hours (a declined card is retried; a script hammering the button is not). */
const MAX_ATTEMPTS_PER_DAY = 12;

async function ownerId(q?: Q): Promise<string> {
  const sql = "SELECT id FROM users WHERE deleted_at IS NULL ORDER BY (role = 'owner') DESC, created_at LIMIT 1";
  const rows = q ? await q.query<{ id: string }>(sql) : await (await import("../db")).withSystem((s) => s.query<{ id: string }>(sql));
  if (!rows[0]) throw new HttpError(503, "The practice account is not set up yet.", "no_owner");
  return rows[0].id;
}

async function notifyOwner(q: Q, userId: string, title: string, body: string, url: string, key: string) {
  await q.query(
    `INSERT INTO notification_deliveries (user_id, channel, status, title, body, url, idempotency_key, sent_at)
     VALUES ($1,'inapp','sent',$2,$3,$4,$5,now()) ON CONFLICT (idempotency_key) DO NOTHING`,
    [userId, title, body, url, key],
  );
}

const amd = (n: number) => `${n.toLocaleString("en-US")} AMD`;

// ───────────────────────── owner side (Desk) ─────────────────────────

export async function listPaymentRequests(q: Q, userId: string, clientId: string) {
  const requests = await q.query<PaymentRequestRow>(
    "SELECT * FROM payment_requests WHERE user_id=$1 AND client_id=$2 ORDER BY created_at DESC LIMIT 20",
    [userId, clientId],
  );
  const attempts = requests.length
    ? await q.query<OnlinePaymentRow>(
        `SELECT id, request_id, status, amount_amd, currency, provider_payment_id, failure_code, livemode, rrn, duplicate, order_id,
                wix_application_id, created_at, updated_at, verified_at, completed_at
           FROM online_payments WHERE user_id=$1 AND request_id = ANY($2::uuid[]) ORDER BY created_at DESC`,
        [userId, requests.map((r) => r.id)],
      )
    : [];
  return requests.map((r) => ({ ...r, attempts: attempts.filter((a) => a.request_id === r.id) }));
}

export async function createPaymentRequest(q: Q, userId: string, clientId: string, input: z.infer<typeof RequestInput>) {
  const client = await one<{ id: string; full_name: string; email: string | null }>(
    q, "SELECT id, full_name, email FROM clients WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [clientId, userId],
  );
  if (!client) throw notFound("Client not found");
  if (!client.email) throw new HttpError(400, "Add the client's email first — it must be the Gmail address they sign in to the portal with.", "no_email");
  const open = await one(q, "SELECT 1 FROM payment_requests WHERE client_id=$1 AND user_id=$2 AND status='open'", [clientId, userId]);
  if (open) throw conflict("This client already has an open payment request. Cancel it first to set a new amount.");
  let caseId = input.case_id ?? null;
  if (caseId) {
    const k = await one(q, "SELECT 1 FROM client_cases WHERE id=$1 AND client_id=$2 AND user_id=$3 AND deleted_at IS NULL", [caseId, clientId, userId]);
    if (!k) throw notFound("Case not found");
  } else {
    const k = await one<{ id: string }>(q, "SELECT id FROM client_cases WHERE client_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1", [clientId, userId]);
    caseId = k?.id ?? null;
  }
  const [row] = await q.query<PaymentRequestRow>(
    "INSERT INTO payment_requests (user_id, client_id, case_id, amount_amd, description) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [userId, clientId, caseId, input.amount_amd, input.description],
  );
  await logActivity(q, { userId, clientId, entityType: "payment_request", entityId: row.id, action: "payment.requested", summary: `Online payment requested: ${amd(row.amount_amd)} — ${row.description}` });
  return row;
}

export async function cancelPaymentRequest(q: Q, userId: string, id: string) {
  const r = await one<PaymentRequestRow>(q, "SELECT * FROM payment_requests WHERE id=$1 AND user_id=$2 FOR UPDATE", [id, userId]);
  if (!r) throw notFound("Payment request not found");
  if (r.status !== "open") throw conflict("Only an open request can be cancelled.");
  await q.query("UPDATE payment_requests SET status='cancelled', updated_at=now() WHERE id=$1", [id]);
  await logActivity(q, { userId, clientId: r.client_id, entityType: "payment_request", entityId: id, action: "payment.cancelled", summary: `Online payment request cancelled: ${amd(r.amount_amd)}` });
}

/** Owner's "check now": re-reads every unfinished attempt of the request from Paynet. */
export async function verifyRequestNow(q: Q, userId: string, id: string) {
  const r = await one<PaymentRequestRow>(q, "SELECT * FROM payment_requests WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!r) throw notFound("Payment request not found");
  const rows = await q.query<OnlinePaymentRow>("SELECT * FROM online_payments WHERE request_id=$1 AND user_id=$2 AND status = ANY($3::text[]) FOR UPDATE", [id, userId, ACTIVE]);
  for (const row of rows) await refreshAttempt(q, userId, row, { force: true });
  return { checked: rows.length };
}

// ───────────────────────── verification (the only path to "paid") ─────────────────────────

/** Reads the attempt's order back from Paynet and applies it. Throws PaynetError when Paynet can't be reached. */
export async function refreshAttempt(q: Q, userId: string, row: OnlinePaymentRow, opts: { force?: boolean } = {}): Promise<OnlinePaymentRow> {
  // refunded / error never change; failed / expired are re-read only when forced (a webhook can bring a late success).
  if (row.status === "refunded" || row.status === "error") return row;
  if ((row.status === "failed" || row.status === "expired") && !opts.force) return row;
  if (!opts.force && row.verified_at && Date.now() - Date.parse(row.verified_at) < 3000) return row;
  const p = await getOrderPayment(row.order_id);
  if (!p) {
    await q.query("UPDATE online_payments SET verified_at=now() WHERE id=$1", [row.id]);
    return { ...row, verified_at: new Date().toISOString() };
  }
  return applyVerified(q, userId, row, p);
}

function decide(row: OnlinePaymentRow, p: PaynetPayment): { status: AttemptStatus; failure: string | null } {
  if (p.livemode === true) return { status: "error", failure: "livemode_refused" };
  const s = String(p.status || "").toLowerCase() as (typeof PAYNET_STATUSES)[number];
  if (!PAYNET_STATUSES.includes(s)) return { status: row.status, failure: row.failure_code };
  if (s === "completed" || s === "refunded") {
    const amountOk = Math.round(Number(p.amount) * 100) === row.amount_amd * 100;
    const currencyOk = String(p.currency || "AMD").toUpperCase() === "AMD";
    if (!amountOk || !currencyOk) return { status: "error", failure: "amount_mismatch" };
  }
  return { status: s, failure: s === "failed" ? String(p.failure_code || "general_failure").slice(0, 60) : s === "expired" ? "expired" : null };
}

/** Moves only forward: unfinished → final, completed → refunded. A final state never goes back to pending. */
function allowed(from: AttemptStatus, to: AttemptStatus) {
  if (from === to) return false;
  if (from === "completed") return to === "refunded";
  if (from === "refunded" || from === "error") return false;
  if (from === "failed" || from === "expired") return to === "completed"; // Paynet's "most decisive" record wins
  return true; // creating / pending / processing → anything
}

export async function applyVerified(q: Q, userId: string, row: OnlinePaymentRow, p: PaynetPayment): Promise<OnlinePaymentRow> {
  if (p.order_id !== row.order_id) {
    console.warn("[paynet] read-back for a different order ignored");
    return row;
  }
  const { status, failure } = decide(row, p);
  const go = allowed(row.status, status);
  const [updated] = await q.query<OnlinePaymentRow>(
    `UPDATE online_payments SET
        status = $2, failure_code = $3,
        provider_payment_id = COALESCE($4, provider_payment_id), livemode = COALESCE($5, livemode), rrn = COALESCE($6, rrn),
        completed_at = CASE WHEN $2 = 'completed' AND completed_at IS NULL THEN now() ELSE completed_at END,
        verified_at = now(), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [row.id, go ? status : row.status, go ? failure : row.failure_code, p.uuid || null, typeof p.livemode === "boolean" ? p.livemode : null, p.rrn || null],
  );
  if (!go) return updated;

  const r = await one<PaymentRequestRow & { full_name: string }>(
    q, "SELECT pr.*, c.full_name FROM payment_requests pr JOIN clients c ON c.id = pr.client_id WHERE pr.id=$1 FOR UPDATE OF pr", [row.request_id],
  );
  if (!r) return updated;
  const url = `/clients/${r.client_id}`;

  if (status === "completed") {
    if (r.status === "open") {
      await q.query("UPDATE payment_requests SET status='paid', paid_payment_id=$2, paid_at=now(), wix_application_id=COALESCE(wix_application_id,$3), updated_at=now() WHERE id=$1", [r.id, row.id, row.wix_application_id]);
      const caseId = r.case_id ?? (await one<{ id: string }>(q, "SELECT id FROM client_cases WHERE client_id=$1 AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1", [r.client_id]))?.id;
      if (caseId) await q.query("UPDATE client_cases SET payment_status='Paid', updated_at=now() WHERE id=$1 AND user_id=$2", [caseId, userId]);
      await logActivity(q, { userId, clientId: r.client_id, entityType: "online_payment", entityId: row.id, action: "payment.completed", summary: `Online payment confirmed by Paynet (sandbox): ${amd(row.amount_amd)}`, metadata: { paynet_payment: p.uuid, order: row.order_id } });
      await notifyOwner(q, userId, "Online payment received (test mode)", `${r.full_name} · ${amd(row.amount_amd)}`, url, `payment:${row.id}:completed`);
    } else if (r.paid_payment_id !== row.id) {
      // The request was already settled by another attempt, or cancelled while this checkout was open: money the owner
      // didn't expect. Flag it for a refund instead of silently treating it as paid.
      await q.query("UPDATE online_payments SET duplicate=true WHERE id=$1", [row.id]);
      await logActivity(q, { userId, clientId: r.client_id, entityType: "online_payment", entityId: row.id, action: "payment.duplicate", summary: `Extra online payment of ${amd(row.amount_amd)} — refund it in the Paynet dashboard`, metadata: { paynet_payment: p.uuid } });
      await notifyOwner(q, userId, "Extra online payment — refund needed", `${r.full_name} · ${amd(row.amount_amd)}`, url, `payment:${row.id}:duplicate`);
      return { ...updated, duplicate: true };
    }
  } else if (status === "refunded") {
    if (r.paid_payment_id === row.id) {
      await q.query("UPDATE payment_requests SET status='refunded', updated_at=now() WHERE id=$1", [r.id]);
      if (r.case_id) await q.query("UPDATE client_cases SET payment_status='Refunded', updated_at=now() WHERE id=$1 AND user_id=$2", [r.case_id, userId]);
    }
    await logActivity(q, { userId, clientId: r.client_id, entityType: "online_payment", entityId: row.id, action: "payment.refunded", summary: `Online payment refunded: ${amd(row.amount_amd)}` });
  } else if (status === "error") {
    await logActivity(q, { userId, clientId: r.client_id, entityType: "online_payment", entityId: row.id, action: "payment.rejected", summary: `Online payment not accepted (${failure})`, metadata: { paynet_payment: p.uuid } });
    await notifyOwner(q, userId, "Online payment needs a look", `${r.full_name} · ${failure}`, url, `payment:${row.id}:error`);
  } else if (status === "failed" || status === "expired") {
    await logActivity(q, { userId, clientId: r.client_id, entityType: "online_payment", entityId: row.id, action: `payment.${status}`, summary: status === "failed" ? `Online payment declined (${failure})` : "Online payment expired" });
  }
  return updated;
}

// ───────────────────────── portal side ─────────────────────────

export interface PortalPaymentView {
  enabled: boolean;
  mode: "sandbox";
  visibility: "test-link" | "everyone";
  request: { id: string; amountAmd: number; currency: "AMD"; description: string; status: RequestStatus } | null;
  payment: { attemptId: string; status: AttemptStatus; failureCode: string | null; reference: string | null; updatedAt: string } | null;
}

export function portalConfig() {
  return { enabled: paynetProblem() === null, mode: "sandbox" as const, visibility: paynetConfig.visibility };
}

/** The member's payment request for this application: open (not bound elsewhere), or settled from this application. */
async function findRequest(q: Q, userId: string, member: PortalMember, applicationId: string, lock = false) {
  return one<PaymentRequestRow>(
    q,
    `SELECT pr.* FROM payment_requests pr JOIN clients c ON c.id = pr.client_id
      WHERE pr.user_id=$1 AND c.deleted_at IS NULL AND lower(c.email) = $2
        AND ((pr.status='open' AND (pr.wix_application_id IS NULL OR pr.wix_application_id=$3))
          OR (pr.status IN ('paid','refunded') AND pr.wix_application_id=$3))
      ORDER BY (pr.status='open') DESC, pr.created_at DESC LIMIT 1 ${lock ? "FOR UPDATE OF pr" : ""}`,
    [userId, member.email, applicationId],
  );
}

function view(r: PaymentRequestRow | null, a: OnlinePaymentRow | null): PortalPaymentView {
  return {
    ...portalConfig(),
    request: r ? { id: r.id, amountAmd: r.amount_amd, currency: "AMD", description: r.description, status: r.status } : null,
    payment: a ? { attemptId: a.id, status: a.status, failureCode: a.failure_code, reference: a.provider_payment_id, updatedAt: a.updated_at } : null,
  };
}

/**
 * What the portal shows. With an attempt id (the client just came back from Paynet), that attempt is read back from
 * Paynet's API first, so the page never reports a result Paynet hasn't confirmed.
 */
export async function portalSummary(member: PortalMember, applicationId: string, attemptId?: string | null): Promise<PortalPaymentView> {
  const userId = await ownerId();
  return withUser(userId, async (q) => {
    const r = await findRequest(q, userId, member, applicationId);
    let a: OnlinePaymentRow | null = null;
    if (attemptId) {
      a = await one<OnlinePaymentRow>(q, "SELECT * FROM online_payments WHERE id=$1 AND user_id=$2 AND wix_application_id=$3 AND wix_member_id=$4 FOR UPDATE", [attemptId, userId, applicationId, member.memberId]);
      if (!a) throw notFound("Payment not found");
    } else if (r) {
      a = await one<OnlinePaymentRow>(q, "SELECT * FROM online_payments WHERE request_id=$1 AND user_id=$2 AND wix_application_id=$3 ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [r.id, userId, applicationId]);
    }
    if (a && ACTIVE.includes(a.status) && a.status !== "creating") {
      try {
        a = await refreshAttempt(q, userId, a);
      } catch (e) {
        if (!(e instanceof PaynetError)) throw e; // Paynet unreachable: show the last known state, the client can check again
      }
    }
    const fresh = a ? await one<PaymentRequestRow>(q, "SELECT * FROM payment_requests WHERE id=$1", [a.request_id]) : r;
    return view(fresh && (fresh.wix_application_id === null || fresh.wix_application_id === applicationId) ? fresh : r, a);
  });
}

type CheckoutResult = { checkoutUrl: string; attemptId: string; reused: boolean } | { view: PortalPaymentView } | { error: HttpError };

/** «Վճարել առցանց». Returns the hosted checkout to send the client to. Never takes an amount from the browser. */
export async function startCheckout(member: PortalMember, applicationId: string): Promise<{ checkoutUrl?: string; attemptId?: string; reused?: boolean; view?: PortalPaymentView }> {
  const problem = paynetProblem();
  if (problem) throw new HttpError(503, "Online payment is not available right now.", "payments_unavailable");
  const userId = await ownerId();
  const res: CheckoutResult = await withUser(userId, async (q) => {
    // Locking the request row serialises double clicks and parallel tabs: the second waits, then reuses the first attempt.
    const r = await findRequest(q, userId, member, applicationId, true);
    if (!r) return { error: new HttpError(404, "There is no payment due on your account right now.", "no_request") };
    if (r.status !== "open") return { view: view(r, null) };
    if (!r.wix_application_id) await q.query("UPDATE payment_requests SET wix_application_id=$2, updated_at=now() WHERE id=$1", [r.id, applicationId]);

    let a = await one<OnlinePaymentRow>(q, "SELECT * FROM online_payments WHERE request_id=$1 AND status = ANY($2::text[]) FOR UPDATE", [r.id, ACTIVE]);
    if (a && a.status !== "creating") {
      try {
        a = await refreshAttempt(q, userId, a, { force: true });
      } catch (e) {
        if (!(e instanceof PaynetError)) throw e;
      }
      if (a.status === "completed") {
        const settled = await one<PaymentRequestRow>(q, "SELECT * FROM payment_requests WHERE id=$1", [r.id]);
        return { view: view(settled, a) };
      }
      if (a.status === "pending" && a.checkout_url) {
        return { checkoutUrl: a.checkout_url, attemptId: a.id, reused: true }; // same checkout, never a second one
      }
      if (a.status === "processing") return { view: view(r, a) }; // the bank is still deciding: wait, don't start another
      if (a.status === "pending") {
        // Pending without a usable checkout URL: close it so a fresh attempt can start.
        await q.query("UPDATE online_payments SET status='error', failure_code='no_checkout_url', updated_at=now() WHERE id=$1", [a.id]);
      }
      a = null; // failed / expired / closed: a new attempt below
    }

    if (!a) {
      const [{ n }] = await q.query<{ n: number }>("SELECT count(*)::int AS n FROM online_payments WHERE request_id=$1 AND created_at > now() - interval '24 hours'", [r.id]);
      if (n >= MAX_ATTEMPTS_PER_DAY) return { error: new HttpError(429, "Too many payment attempts today. Please contact us.", "too_many_attempts") };
      const id = crypto.randomUUID();
      const code = crypto.randomBytes(5).toString("hex"); // the unique attempt part of the order id
      [a] = await q.query<OnlinePaymentRow>(
        `INSERT INTO online_payments (id, user_id, client_id, request_id, wix_application_id, wix_member_id, order_id, idempotency_key, amount_amd)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [id, userId, r.client_id, r.id, applicationId, member.memberId, `${applicationId}-${code}`, `uva-pay-${id}`, r.amount_amd],
      );
    }

    // `a` is now a "creating" attempt: either new, or one whose earlier create call didn't get an answer (same key → same payment).
    let p: PaynetPayment;
    try {
      p = await createPayment({
        amountAmd: a.amount_amd,
        orderId: a.order_id,
        idempotencyKey: a.idempotency_key,
        returnUrl: returnUrl(a.id),
        callbackUrl: `${env.appUrl}/api/paynet/webhook`,
        description: `US VISA WITH ARGISHTI — ${r.description}`,
      });
    } catch (e) {
      if (!(e instanceof PaynetError)) throw e;
      const transient = e.code === "network" || e.status === 409 || e.status === 429 || e.status >= 500;
      if (transient) {
        // Keep "creating": the next click retries with the same Idempotency-Key, so Paynet can never make two payments.
        console.warn(`[paynet] create payment: transient failure (${e.status} ${e.code})`);
        return { error: new HttpError(503, "The payment service is busy. Please try again in a minute.", "payments_busy") };
      }
      console.warn(`[paynet] create payment refused (${e.status} ${e.code})`);
      await q.query("UPDATE online_payments SET status='error', failure_code=$2, updated_at=now() WHERE id=$1", [a.id, `create_${e.code}`.slice(0, 60)]);
      return { error: new HttpError(502, "The payment could not be started. Please try again later or contact us.", "payment_create_failed") };
    }

    const url = safeCheckoutUrl(p.checkout_url);
    if (p.livemode === true || !url || (p.order_id && p.order_id !== a.order_id)) {
      const why = p.livemode === true ? "livemode_refused" : !url ? "bad_checkout_url" : "order_mismatch";
      console.warn(`[paynet] create payment answer refused (${why})`);
      await q.query("UPDATE online_payments SET status='error', failure_code=$2, provider_payment_id=COALESCE($3, provider_payment_id), livemode=$4, updated_at=now() WHERE id=$1", [a.id, why, p.uuid || null, p.livemode ?? null]);
      return { error: new HttpError(502, "The payment could not be started. Please contact us.", "payment_create_failed") };
    }
    [a] = await q.query<OnlinePaymentRow>(
      "UPDATE online_payments SET status='pending', provider_payment_id=$2, checkout_url=$3, livemode=$4, updated_at=now() WHERE id=$1 RETURNING *",
      [a.id, p.uuid || null, url, p.livemode ?? false],
    );
    // An idempotent replay can come back already finished (e.g. the client paid in another tab): apply it from the API.
    if (String(p.status).toLowerCase() !== "pending") {
      try {
        a = await refreshAttempt(q, userId, a, { force: true });
      } catch (e) {
        if (!(e instanceof PaynetError)) throw e;
      }
      if (a.status !== "pending" && a.status !== "processing") {
        const settled = await one<PaymentRequestRow>(q, "SELECT * FROM payment_requests WHERE id=$1", [r.id]);
        return { view: view(settled, a) };
      }
    }
    return { checkoutUrl: url, attemptId: a.id, reused: false };
  });
  if ("error" in res) throw res.error;
  return res;
}

function returnUrl(attemptId: string) {
  const u = new URL(paynetConfig.portalUrl);
  u.searchParams.set("lxpay", "return");
  u.searchParams.set("attempt", attemptId);
  u.hash = "lxpay";
  return u.toString();
}

// ───────────────────────── webhook ─────────────────────────

const HANDLED_EVENTS = new Set(["transaction.status.updated", "payment.refunded"]);

/**
 * POST /api/paynet/webhook. The signature is checked on the raw bytes before anything else; a delivery is processed
 * once (by delivery_id); and the webhook's own status is never used — the payment is read back from Paynet's API.
 */
export async function handlePaynetWebhook(raw: string, headers: { signature: string | null; signatureNext: string | null }): Promise<{ status: number; body: Record<string, unknown> }> {
  if (paynetConfig.webhookSecrets.length === 0) return { status: 503, body: { error: "not_configured" } };
  if (!verifyWebhookSignature(raw, headers)) {
    console.warn("[paynet] webhook rejected: signature does not match");
    return { status: 401, body: { error: "invalid_signature" } };
  }
  let j: { delivery_id?: unknown; event?: unknown; livemode?: unknown; transaction?: { order_id?: unknown } | null };
  try {
    j = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  const deliveryId = typeof j.delivery_id === "string" || typeof j.delivery_id === "number" ? String(j.delivery_id).slice(0, 200) : "";
  if (!deliveryId) return { status: 400, body: { error: "missing_delivery_id" } };
  const event = typeof j.event === "string" ? j.event.slice(0, 80) : "";
  const orderId = typeof j.transaction?.order_id === "string" ? j.transaction.order_id.slice(0, 200) : null;

  const userId = await ownerId();
  return withUser(userId, async (q) => {
    // The upsert's row lock makes a second, simultaneous copy of the same delivery wait for this one to finish.
    const [d] = await q.query<{ outcome: string; attempts: number }>(
      `INSERT INTO paynet_webhook_deliveries (delivery_id, user_id, event, order_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (delivery_id) DO UPDATE SET attempts = paynet_webhook_deliveries.attempts + 1
       RETURNING outcome, attempts`,
      [deliveryId, userId, event, orderId],
    );
    if (d.outcome === "processed" || d.outcome === "ignored") return { status: 200, body: { ok: true, duplicate: true } };
    const finish = async (outcome: "processed" | "ignored" | "failed", body: Record<string, unknown>, status = 200) => {
      await q.query("UPDATE paynet_webhook_deliveries SET outcome=$2, processed_at=now() WHERE delivery_id=$1", [deliveryId, outcome]);
      return { status, body };
    };
    if (j.livemode === true) {
      console.warn("[paynet] live-mode webhook ignored (this build is sandbox only)");
      return finish("ignored", { ok: true, ignored: "livemode" });
    }
    if (!HANDLED_EVENTS.has(event) || !orderId) return finish("ignored", { ok: true, ignored: "event" });
    const row = await one<OnlinePaymentRow>(q, "SELECT * FROM online_payments WHERE order_id=$1 AND user_id=$2 FOR UPDATE", [orderId, userId]);
    if (!row) return finish("ignored", { ok: true, ignored: "unknown_order" });
    try {
      const after = await refreshAttempt(q, userId, row, { force: true });
      return finish("processed", { ok: true, status: after.status });
    } catch (e) {
      if (!(e instanceof PaynetError)) throw e;
      // Not confirmed yet: answer with an error so Paynet retries (1, 5 and 30 minutes later).
      console.warn(`[paynet] webhook read-back failed (${e.status} ${e.code}); Paynet will retry`);
      return finish("failed", { error: "verification_unavailable" }, 503);
    }
  });
}
