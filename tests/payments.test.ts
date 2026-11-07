import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { freshDb, makeUser, withUser, closeDriver } from "./helpers";
import { createClient } from "@/lib/repo/clients";
import {
  createPaymentRequest, cancelPaymentRequest, listPaymentRequests, portalSummary, startCheckout, handlePaynetWebhook, RequestInput,
} from "@/lib/repo/payments";
import { paynetProblem, verifyWebhookSignature, signWebhookBody, safeCheckoutUrl } from "@/lib/paynet";
import { verifyPortalMember, assertApplicationOwner } from "@/lib/portal-auth";
import { GET as summaryRoute, OPTIONS as summaryOptions } from "@/app/api/portal/payment/route";
import { POST as checkoutRoute } from "@/app/api/portal/payment/checkout/route";
import { GET as configRoute } from "@/app/api/portal/payment/config/route";
import { POST as webhookRoute } from "@/app/api/paynet/webhook/route";

// ───────────── In-memory stand-ins for Paynet's API and the two Wix calls the Desk makes ─────────────
const SECRET = "whsec_test_0123456789abcdef0123";
const PORTAL = "https://portal.usvisawithargishti.com";
const APP_A = "1f0c7d9e-1111-4a5b-9c3d-aaaaaaaaaaaa";
const APP_B = "2f0c7d9e-2222-4a5b-9c3d-bbbbbbbbbbbb";
const members: Record<string, { id: string; loginEmail: string; status?: string }> = {
  "tok-member-a-0123456789": { id: "mem-a", loginEmail: "Client.A@gmail.com", status: "APPROVED" },
  "tok-member-b-0123456789": { id: "mem-b", loginEmail: "client.b@gmail.com", status: "APPROVED" },
};
const apps: Record<string, string> = { [APP_A]: "mem-a", [APP_B]: "mem-b" };

type FakePayment = { uuid: string; order_id: string; amount: number; currency: string; status: string; failure_code: string | null; checkout_url: string; livemode: boolean };
const paynet = {
  byOrder: new Map<string, FakePayment>(),
  byKey: new Map<string, FakePayment>(),
  creates: 0,
  reads: 0,
  failNextCreate: null as null | "network" | 422 | 409,
  liveMode: false,
  amountOverride: null as number | null,
  lastCreateBody: null as Record<string, unknown> | null,
  lastKeyHeader: "",
  reset() {
    this.byOrder.clear(); this.byKey.clear(); this.creates = 0; this.reads = 0; this.failNextCreate = null; this.liveMode = false; this.amountOverride = null;
  },
  set(orderId: string, patch: Partial<FakePayment>) {
    Object.assign(this.byOrder.get(orderId)!, patch);
  },
};
const realFetch = globalThis.fetch;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const h = new Headers(init?.headers);
  if (url.host === "wix.test") {
    const m = members[h.get("authorization") || ""];
    if (!m) return json(401, { message: "unauthorized" });
    if (url.pathname === "/members/v1/members/my") return json(200, { member: m });
    if (url.pathname === "/wix-data/v2/items/query") {
      const id = JSON.parse(String(init?.body)).query.filter._id.$eq as string;
      // Wix enforces "site member author": another member's item is simply not returned.
      return json(200, { dataItems: apps[id] === m.id ? [{ id, data: { _id: id, _owner: m.id } }] : [] });
    }
    return json(404, {});
  }
  if (url.host === "paynet.test") {
    paynet.lastKeyHeader = h.get("x-paynet-key") || "";
    if (url.pathname === "/api/v1/payments" && init?.method === "POST") {
      paynet.creates++;
      const key = h.get("idempotency-key") || "";
      const body = JSON.parse(String(init.body));
      paynet.lastCreateBody = body;
      const f = paynet.failNextCreate;
      paynet.failNextCreate = null;
      if (f === "network") throw new TypeError("fetch failed");
      if (f === 409) return json(409, { error: "conflict" });
      if (f === 422) return json(422, { error: "validation_failed" });
      const seen = paynet.byKey.get(key);
      if (seen) return json(200, seen);
      const uuid = crypto.randomUUID();
      const p: FakePayment = { uuid, order_id: body.order_id, amount: paynet.amountOverride ?? body.amount, currency: body.currency, status: "pending", failure_code: null, checkout_url: `https://paynet.am/checkout/${uuid}`, livemode: paynet.liveMode };
      paynet.byKey.set(key, p);
      paynet.byOrder.set(p.order_id, p);
      return json(201, p);
    }
    const m = url.pathname.match(/^\/api\/v1\/orders\/(.+)\/payment$/);
    if (m && (init?.method ?? "GET") === "GET") {
      paynet.reads++;
      const p = paynet.byOrder.get(decodeURIComponent(m[1]));
      return p ? json(200, p) : json(404, { error: "not_found" });
    }
    return json(404, {});
  }
  return realFetch(input as RequestInfo, init);
}

let owner: string;
let clientA: string;
let caseA: string;
const memberA = { memberId: "mem-a", email: "client.a@gmail.com" };
const memberB = { memberId: "mem-b", email: "client.b@gmail.com" };

function configure(on = true) {
  vi.stubEnv("PAYNET_API_BASE", "https://paynet.test/api");
  vi.stubEnv("WIX_API_BASE", "https://wix.test");
  vi.stubEnv("PAYNET_TEST_API_KEY", on ? "sk_test_abcdefghijklmnop" : "");
  vi.stubEnv("PAYNET_WEBHOOK_SECRET", on ? SECRET : "");
  vi.stubEnv("PAYNET_WEBHOOK_SECRET_NEXT", "");
  vi.stubEnv("PORTAL_URL", `${PORTAL}/`);
}

beforeAll(async () => {
  vi.stubGlobal("fetch", fakeFetch);
  configure();
  await freshDb();
  owner = await makeUser("info@usvisawithargishti.com", "Argishti");
  const made = await withUser(owner, (q) => createClient(q, owner, { full_name: "Ani Petrosyan", email: "client.a@gmail.com" }));
  clientA = made.client.id;
  caseA = made.case.id;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDriver();
});
beforeEach(() => {
  configure();
  paynet.reset();
});

async function openRequest(amount = 50000) {
  // close whatever is open from the previous test, then set a fresh amount
  await withUser(owner, async (q) => {
    const open = await q.query<{ id: string }>("SELECT id FROM payment_requests WHERE client_id=$1 AND status='open'", [clientA]);
    for (const o of open) await cancelPaymentRequest(q, owner, o.id);
    await q.query("UPDATE payment_requests SET wix_application_id=NULL WHERE client_id=$1 AND status='cancelled'", [clientA]);
  });
  return withUser(owner, (q) => createPaymentRequest(q, owner, clientA, RequestInput.parse({ amount_amd: amount, description: "DS-160 service fee" })));
}
const orderOf = async (attemptId: string) => (await withUser(owner, (q) => q.query<{ order_id: string }>("SELECT order_id FROM online_payments WHERE id=$1", [attemptId])))[0].order_id;
const secondsPass = (attemptId: string) => withUser(owner, (q) => q.query("UPDATE online_payments SET verified_at = now() - interval '10 seconds' WHERE id=$1", [attemptId]));
const signed = (payload: unknown) => {
  const raw = JSON.stringify(payload);
  return { raw, sig: signWebhookBody(raw, SECRET) };
};
const webhookFor = (orderId: string, status: string, deliveryId: string = crypto.randomUUID()) => ({
  delivery_id: deliveryId, event: "transaction.status.updated", livemode: false, timestamp: new Date().toISOString(),
  transaction: { uuid: "x", order_id: orderId, status, amount: 50000, currency: "AMD" }, refund: null, receipt: null,
});

// ───────────── configuration & signatures ─────────────
describe("configuration", () => {
  it("is off until a TEST key and a webhook secret are set, and refuses live keys", () => {
    configure(false);
    expect(paynetProblem()).toMatch(/PAYNET_TEST_API_KEY is not set/);
    vi.stubEnv("PAYNET_TEST_API_KEY", "sk_live_realmoney123456");
    vi.stubEnv("PAYNET_WEBHOOK_SECRET", SECRET);
    expect(paynetProblem()).toMatch(/must be a Paynet TEST key/);
    configure(true);
    expect(paynetProblem()).toBeNull();
  });

  it("only sends clients to https checkout pages on Paynet's host", () => {
    expect(safeCheckoutUrl("https://paynet.am/checkout/abc")).toBe("https://paynet.am/checkout/abc");
    expect(safeCheckoutUrl("https://pay.paynet.am/c/1")).toBe("https://pay.paynet.am/c/1");
    expect(safeCheckoutUrl("http://paynet.am/checkout/abc")).toBeNull();
    expect(safeCheckoutUrl("https://paynet.am.evil.example/checkout")).toBeNull();
    expect(safeCheckoutUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("webhook signature", () => {
  const body = '{"delivery_id":"d1","event":"transaction.status.updated"}';
  it("accepts the HMAC-SHA256 of the raw body and nothing else", () => {
    const good = signWebhookBody(body, SECRET);
    expect(verifyWebhookSignature(body, { signature: good })).toBe(true);
    expect(verifyWebhookSignature(body, { signature: good.toUpperCase() })).toBe(true);
    expect(verifyWebhookSignature(body + " ", { signature: good })).toBe(false); // one changed byte
    expect(verifyWebhookSignature(body, { signature: signWebhookBody(body, "another-secret-000000") })).toBe(false);
    expect(verifyWebhookSignature(body, { signature: "" })).toBe(false);
    expect(verifyWebhookSignature(body, { signature: "sha256=" + good })).toBe(false);
  });
  it("accepts X-Paynet-Signature-Next during a secret rotation", () => {
    const next = "whsec_next_secret_ffffffffffff";
    vi.stubEnv("PAYNET_WEBHOOK_SECRET", next);
    expect(verifyWebhookSignature(body, { signature: signWebhookBody(body, SECRET), signatureNext: signWebhookBody(body, next) })).toBe(true);
  });
});

// ───────────── who may see and pay ─────────────
describe("portal authorization", () => {
  it("knows the member only from Wix, and only the member's own application", async () => {
    await expect(verifyPortalMember(null)).rejects.toMatchObject({ status: 401 });
    await expect(verifyPortalMember("tok-forged-0000000000000")).rejects.toMatchObject({ status: 401 });
    const m = await verifyPortalMember("tok-member-a-0123456789");
    expect(m).toEqual(memberA); // e-mail lower-cased
    await expect(assertApplicationOwner("tok-member-a-0123456789", APP_A, m)).resolves.toBeUndefined();
    await expect(assertApplicationOwner("tok-member-a-0123456789", APP_B, m)).rejects.toMatchObject({ status: 404 });
  });

  it("never shows another client's payment request", async () => {
    await openRequest();
    const b = await portalSummary(memberB, APP_B);
    expect(b.request).toBeNull();
    const a = await portalSummary(memberA, APP_A);
    expect(a.request).toMatchObject({ amountAmd: 50000, currency: "AMD", status: "open" });
  });

  it("routes: CORS only for the portal; no token → 401; another member's application → 404", async () => {
    const pre = await summaryOptions(new NextRequest("http://localhost:3000/api/portal/payment", { method: "OPTIONS", headers: { origin: PORTAL } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(PORTAL);
    const evil = await summaryOptions(new NextRequest("http://localhost:3000/api/portal/payment", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();

    const noTok = await summaryRoute(new NextRequest(`http://localhost:3000/api/portal/payment?applicationId=${APP_A}`, { headers: { origin: PORTAL } }));
    expect(noTok.status).toBe(401);
    const cross = await summaryRoute(new NextRequest(`http://localhost:3000/api/portal/payment?applicationId=${APP_B}`, { headers: { origin: PORTAL, authorization: "Bearer tok-member-a-0123456789" } }));
    expect(cross.status).toBe(404);
    const other = await summaryRoute(new NextRequest(`http://localhost:3000/api/portal/payment?applicationId=${APP_A}`, { headers: { origin: "https://evil.example", authorization: "Bearer tok-member-a-0123456789" } }));
    expect(other.status).toBe(403);
    const cfg = await (await configRoute(new NextRequest("http://localhost:3000/api/portal/payment/config", { headers: { origin: PORTAL } }))).json();
    expect(cfg).toEqual({ enabled: true, mode: "sandbox", visibility: "test-link" });
  });

  it("checkout ignores nothing silently: an amount from the browser is refused", async () => {
    await openRequest();
    const r = await checkoutRoute(new NextRequest("http://localhost:3000/api/portal/payment/checkout", {
      method: "POST", headers: { origin: PORTAL, authorization: "Bearer tok-member-a-0123456789", "content-type": "application/json" },
      body: JSON.stringify({ applicationId: APP_A, amount: 1 }),
    }));
    expect(r.status).toBe(400);
    expect(paynet.creates).toBe(0);
  });
});

// ───────────── the scenarios ─────────────
describe("successful payment", () => {
  it("charges the owner's amount, and is 'paid' only after Paynet's API confirms it", async () => {
    await openRequest(50000);
    const r = await startCheckout(memberA, APP_A);
    expect(r.checkoutUrl).toMatch(/^https:\/\/paynet\.am\/checkout\//);
    expect(paynet.lastKeyHeader).toBe("sk_test_abcdefghijklmnop");
    expect(paynet.lastCreateBody).toMatchObject({ amount: 50000, currency: "AMD", processor: "sandbox", domain: "portal.usvisawithargishti.com" });
    const order = paynet.lastCreateBody!.order_id as string;
    expect(order.startsWith(`${APP_A}-`)).toBe(true); // application id + unique attempt code
    expect(paynet.lastCreateBody!.return_url).toBe(`${PORTAL}/?lxpay=return&attempt=${r.attemptId}#lxpay`);
    expect(paynet.lastCreateBody!.callback_url).toBe("http://localhost:3000/api/paynet/webhook");

    // The client comes back from Paynet before the payment has settled: the redirect alone proves nothing.
    let v = await portalSummary(memberA, APP_A, r.attemptId);
    expect(v.payment?.status).toBe("pending");
    expect(v.request?.status).toBe("open");

    paynet.set(order, { status: "completed" });
    await secondsPass(r.attemptId!); // the page polls every few seconds; status reads are throttled to one per 3 s
    v = await portalSummary(memberA, APP_A, r.attemptId);
    expect(v.payment?.status).toBe("completed");
    expect(v.request?.status).toBe("paid");

    const [kase] = await withUser(owner, (q) => q.query<{ payment_status: string }>("SELECT payment_status FROM client_cases WHERE id=$1", [caseA]));
    expect(kase.payment_status).toBe("Paid");
    const alerts = await withUser(owner, (q) => q.query("SELECT 1 FROM notification_deliveries WHERE title='Online payment received (test mode)'"));
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const [req] = await withUser(owner, (q) => listPaymentRequests(q, owner, clientA));
    expect(req).toMatchObject({ status: "paid", wix_application_id: APP_A });
    expect(req.attempts[0]).toMatchObject({ status: "completed", provider_payment_id: expect.any(String), livemode: false });

    // Paid: another click starts nothing new.
    const again = await startCheckout(memberA, APP_A);
    expect(again.view?.request?.status).toBe("paid");
    expect(paynet.creates).toBe(1);
  });
});

describe("repeated clicks", () => {
  it("one checkout for many clicks, in sequence and all at once", async () => {
    await openRequest(30000);
    const first = await startCheckout(memberA, APP_A);
    const seq = [await startCheckout(memberA, APP_A), await startCheckout(memberA, APP_A)];
    const par = await Promise.all(Array.from({ length: 6 }, () => startCheckout(memberA, APP_A)));
    for (const r of [...seq, ...par]) {
      expect(r.checkoutUrl).toBe(first.checkoutUrl);
      expect(r.attemptId).toBe(first.attemptId);
      expect(r.reused).toBe(true);
    }
    expect(paynet.creates).toBe(1);
    const n = await withUser(owner, (q) => q.query("SELECT 1 FROM online_payments WHERE request_id=(SELECT id FROM payment_requests WHERE client_id=$1 AND status='open')", [clientA]));
    expect(n).toHaveLength(1);
  });

  it("a create that got no answer is retried with the SAME Idempotency-Key (never two payments)", async () => {
    await openRequest(30000);
    paynet.failNextCreate = "network";
    await expect(startCheckout(memberA, APP_A)).rejects.toMatchObject({ status: 503, code: "payments_busy" });
    const [row] = await withUser(owner, (q) => q.query<{ status: string; idempotency_key: string }>("SELECT status, idempotency_key FROM online_payments ORDER BY created_at DESC LIMIT 1"));
    expect(row.status).toBe("creating");
    const ok = await startCheckout(memberA, APP_A);
    expect(ok.checkoutUrl).toBeTruthy();
    expect(paynet.byKey.has(row.idempotency_key)).toBe(true);
    expect(paynet.byOrder.size).toBe(1);
  });
});

describe("declined payment", () => {
  it("shows the failure, keeps the request open, and a retry starts a new attempt", async () => {
    await openRequest(40000);
    const r = await startCheckout(memberA, APP_A);
    paynet.set(await orderOf(r.attemptId!), { status: "failed", failure_code: "card_declined" });
    const v = await portalSummary(memberA, APP_A, r.attemptId);
    expect(v.payment).toMatchObject({ status: "failed", failureCode: "card_declined" });
    expect(v.request?.status).toBe("open");
    const retry = await startCheckout(memberA, APP_A);
    expect(retry.attemptId).not.toBe(r.attemptId);
    expect(retry.reused).toBe(false);
    expect(paynet.creates).toBe(2);
    expect(await orderOf(retry.attemptId!)).not.toBe(await orderOf(r.attemptId!));
  });
});

describe("expired payment", () => {
  it("shows 'expired' and lets the client start again", async () => {
    await openRequest(40000);
    const r = await startCheckout(memberA, APP_A);
    paynet.set(await orderOf(r.attemptId!), { status: "expired" });
    const v = await portalSummary(memberA, APP_A, r.attemptId);
    expect(v.payment?.status).toBe("expired");
    expect(v.request?.status).toBe("open");
    const retry = await startCheckout(memberA, APP_A);
    expect(retry.attemptId).not.toBe(r.attemptId);
  });
});

describe("webhooks", () => {
  it("a bad signature changes nothing", async () => {
    await openRequest(20000);
    const r = await startCheckout(memberA, APP_A);
    const order = await orderOf(r.attemptId!);
    paynet.set(order, { status: "completed" });
    const { raw } = signed(webhookFor(order, "completed"));
    const res = await webhookRoute(new NextRequest("http://localhost:3000/api/paynet/webhook", { method: "POST", body: raw, headers: { "x-paynet-signature": signWebhookBody(raw, "wrong-secret-0000000000") } }));
    expect(res.status).toBe(401);
    const missing = await webhookRoute(new NextRequest("http://localhost:3000/api/paynet/webhook", { method: "POST", body: raw }));
    expect(missing.status).toBe(401);
    expect(paynet.reads).toBe(0);
    const [row] = await withUser(owner, (q) => q.query<{ status: string }>("SELECT status FROM online_payments WHERE id=$1", [r.attemptId]));
    expect(row.status).toBe("pending");
  });

  it("never trusts the webhook's own status — Paynet's API decides", async () => {
    await openRequest(20000);
    const r = await startCheckout(memberA, APP_A);
    const order = await orderOf(r.attemptId!);
    // The (validly signed) webhook claims "completed", but Paynet's API still says pending.
    const { raw, sig } = signed(webhookFor(order, "completed"));
    const res = await webhookRoute(new NextRequest("http://localhost:3000/api/paynet/webhook", { method: "POST", body: raw, headers: { "x-paynet-signature": sig } }));
    expect(res.status).toBe(200);
    expect(paynet.reads).toBe(1);
    const [row] = await withUser(owner, (q) => q.query<{ status: string }>("SELECT status FROM online_payments WHERE id=$1", [r.attemptId]));
    expect(row.status).toBe("pending");
  });

  it("a repeated delivery is processed once, even when copies arrive together", async () => {
    await openRequest(20000);
    const r = await startCheckout(memberA, APP_A);
    const order = await orderOf(r.attemptId!);
    paynet.set(order, { status: "completed" });
    const { raw, sig } = signed(webhookFor(order, "completed", "dlv-dup-1"));
    const send = () => handlePaynetWebhook(raw, { signature: sig, signatureNext: null });
    const results = await Promise.all([send(), send(), send()]);
    expect(results.map((x) => x.status)).toEqual([200, 200, 200]);
    expect(results.filter((x) => x.body.duplicate).length).toBe(2);
    const later = await send();
    expect(later.body.duplicate).toBe(true);
    expect(paynet.reads).toBe(1);
    const [req] = await withUser(owner, (q) => q.query<{ status: string }>("SELECT status FROM payment_requests WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1", [clientA]));
    expect(req.status).toBe("paid");
    const [d] = await withUser(owner, (q) => q.query<{ attempts: number; outcome: string }>("SELECT attempts, outcome FROM paynet_webhook_deliveries WHERE delivery_id='dlv-dup-1'"));
    expect(d).toEqual({ attempts: 4, outcome: "processed" });
  });

  it("when Paynet can't be reached for the read-back, the delivery fails so Paynet retries it", async () => {
    await openRequest(20000);
    const r = await startCheckout(memberA, APP_A);
    const order = await orderOf(r.attemptId!);
    const { raw, sig } = signed(webhookFor(order, "completed", "dlv-retry-1"));
    vi.stubEnv("PAYNET_API_BASE", "https://paynet-down.test/api");
    vi.stubGlobal("fetch", async (i: RequestInfo | URL, init?: RequestInit) => {
      if (String(i).includes("paynet-down.test")) throw new TypeError("fetch failed");
      return fakeFetch(i, init);
    });
    const first = await handlePaynetWebhook(raw, { signature: sig, signatureNext: null });
    expect(first.status).toBe(503);
    vi.stubGlobal("fetch", fakeFetch);
    vi.stubEnv("PAYNET_API_BASE", "https://paynet.test/api");
    paynet.set(order, { status: "completed" });
    const retry = await handlePaynetWebhook(raw, { signature: sig, signatureNext: null });
    expect(retry).toMatchObject({ status: 200, body: { status: "completed" } });
  });
});

describe("safety checks", () => {
  it("a different amount at Paynet is never accepted as payment", async () => {
    await openRequest(50000);
    paynet.amountOverride = 500;
    const r = await startCheckout(memberA, APP_A);
    paynet.set(await orderOf(r.attemptId!), { status: "completed" });
    const v = await portalSummary(memberA, APP_A, r.attemptId);
    expect(v.payment?.status).toBe("error");
    expect(v.request?.status).toBe("open");
  });

  it("a live-mode payment is refused (sandbox only)", async () => {
    await openRequest(50000);
    paynet.liveMode = true;
    await expect(startCheckout(memberA, APP_A)).rejects.toMatchObject({ code: "payment_create_failed" });
    const [row] = await withUser(owner, (q) => q.query<{ status: string; failure_code: string }>("SELECT status, failure_code FROM online_payments ORDER BY created_at DESC LIMIT 1"));
    expect(row).toEqual({ status: "error", failure_code: "livemode_refused" });
  });

  it("a payment completed after the owner cancelled the request is flagged for a refund, not counted as paid", async () => {
    await openRequest(15000);
    const r = await startCheckout(memberA, APP_A);
    const [open] = await withUser(owner, (q) => q.query<{ id: string }>("SELECT id FROM payment_requests WHERE client_id=$1 AND status='open'", [clientA]));
    await withUser(owner, (q) => cancelPaymentRequest(q, owner, open.id));
    const order = await orderOf(r.attemptId!);
    paynet.set(order, { status: "completed" });
    const { raw, sig } = signed(webhookFor(order, "completed"));
    await handlePaynetWebhook(raw, { signature: sig, signatureNext: null });
    const [row] = await withUser(owner, (q) => q.query<{ status: string; duplicate: boolean }>("SELECT status, duplicate FROM online_payments WHERE id=$1", [r.attemptId]));
    expect(row).toEqual({ status: "completed", duplicate: true });
    const [req] = await withUser(owner, (q) => q.query<{ status: string }>("SELECT status FROM payment_requests WHERE id=$1", [open.id]));
    expect(req.status).toBe("cancelled");
  });

  it("without configuration the Pay button can't start anything", async () => {
    configure(false);
    await expect(startCheckout(memberA, APP_A)).rejects.toMatchObject({ status: 503, code: "payments_unavailable" });
    expect(paynet.creates).toBe(0);
  });

  it("owner rules: one open request per client; the client needs an email", async () => {
    await openRequest(10000);
    await expect(withUser(owner, (q) => createPaymentRequest(q, owner, clientA, RequestInput.parse({ amount_amd: 20000, description: "Second" })))).rejects.toMatchObject({ status: 409 });
    const { client } = await withUser(owner, (q) => createClient(q, owner, { full_name: "No Email" }));
    await expect(withUser(owner, (q) => createPaymentRequest(q, owner, client.id, RequestInput.parse({ amount_amd: 20000, description: "Fee" })))).rejects.toMatchObject({ status: 400 });
    expect(() => RequestInput.parse({ amount_amd: 10.5, description: "x fee" })).toThrow();
  });
});
