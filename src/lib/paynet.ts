// Paynet (paynet.am) hosted checkout — server side only. Nothing here is ever sent to a browser.
// API reference: https://paynet.am/docs/api  (base https://paynet.am/api, header X-Paynet-Key)
//
// SANDBOX ONLY for now: the key must be a test key (sk_test_…), every payment is pinned to the "sandbox" processor,
// and any payment Paynet reports with livemode=true is refused. Real payments cannot be taken by this build.
import crypto from "node:crypto";

export const PAYNET_STATUSES = ["pending", "processing", "completed", "failed", "expired", "refunded"] as const;
export type PaynetStatus = (typeof PAYNET_STATUSES)[number];

export interface PaynetPayment {
  uuid: string;
  order_id: string;
  amount: number | string;
  currency: string;
  status: string;
  failure_code?: string | null;
  checkout_url?: string | null;
  livemode?: boolean;
  rrn?: string | null;
  completed_at?: string | null;
}

export class PaynetError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "PaynetError";
  }
}

const trim = (v?: string) => (v || "").trim();

/** Everything payments need from the environment, read lazily so tests can change it. */
export const paynetConfig = {
  get apiBase() {
    return (trim(process.env.PAYNET_API_BASE) || "https://paynet.am/api").replace(/\/+$/, "");
  },
  get apiKey() {
    return trim(process.env.PAYNET_TEST_API_KEY);
  },
  get webhookSecrets() {
    // PAYNET_WEBHOOK_SECRET_NEXT is only for a secret rotation (Paynet signs with both for 24 hours).
    return [trim(process.env.PAYNET_WEBHOOK_SECRET), trim(process.env.PAYNET_WEBHOOK_SECRET_NEXT)].filter(Boolean);
  },
  get processor() {
    return trim(process.env.PAYNET_PROCESSOR) || "sandbox";
  },
  get storeDomain() {
    return trim(process.env.PAYNET_STORE_DOMAIN) || "portal.usvisawithargishti.com";
  },
  get portalUrl() {
    return trim(process.env.PORTAL_URL) || "https://portal.usvisawithargishti.com/";
  },
  get portalOrigins() {
    const raw = trim(process.env.PORTAL_ORIGINS) || "https://portal.usvisawithargishti.com,https://www.usvisawithargishti.com";
    return raw.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  },
  /** "test-link": the Pay button shows only when the portal is opened with ?paytest=1. "everyone": all signed-in clients. */
  get visibility(): "test-link" | "everyone" {
    return trim(process.env.PAYNET_PORTAL_VISIBILITY) === "everyone" ? "everyone" : "test-link";
  },
  /** Hosts a checkout_url may point to. Anything else is refused rather than sending a client there. */
  get checkoutHosts() {
    const raw = trim(process.env.PAYNET_CHECKOUT_HOSTS) || "paynet.am";
    return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  },
  get wixApiBase() {
    return (trim(process.env.WIX_API_BASE) || "https://www.wixapis.com").replace(/\/+$/, "");
  },
  get wixCollection() {
    return trim(process.env.WIX_APPLICATIONS_COLLECTION) || "ClientApplications";
  },
};

/** Why payments are off, in words for the owner — or null when they are ready. Never includes the secret values. */
export function paynetProblem(): string | null {
  const key = paynetConfig.apiKey;
  if (!key) return "PAYNET_TEST_API_KEY is not set";
  if (!key.startsWith("sk_test_")) return "PAYNET_TEST_API_KEY must be a Paynet TEST key (sk_test_…). Live keys are refused by this build.";
  if (paynetConfig.webhookSecrets.length === 0) return "PAYNET_WEBHOOK_SECRET is not set";
  if (paynetConfig.webhookSecrets.some((s) => s.length < 16)) return "PAYNET_WEBHOOK_SECRET looks too short";
  return null;
}
export const paynetEnabled = () => paynetProblem() === null;

/** Constant-time check of X-Paynet-Signature (lowercase hex HMAC-SHA256 of the RAW body). */
export function verifyWebhookSignature(rawBody: string | Buffer, headers: { signature?: string | null; signatureNext?: string | null }, secrets = paynetConfig.webhookSecrets): boolean {
  const given = [headers.signature, headers.signatureNext].map((s) => (s || "").trim().toLowerCase()).filter((s) => /^[0-9a-f]{64}$/.test(s));
  if (given.length === 0 || secrets.length === 0) return false;
  let ok = false;
  for (const secret of secrets) {
    const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
    for (const g of given) {
      const b = Buffer.from(g, "utf8");
      // Compare every combination (no early exit) so timing says nothing about which part matched.
      if (b.length === expected.length && crypto.timingSafeEqual(b, expected)) ok = true;
    }
  }
  return ok;
}

export function signWebhookBody(rawBody: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** A checkout URL we are willing to send a client to: https on Paynet's own host. */
export function safeCheckoutUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const allowed = paynetConfig.checkoutHosts.some((h) => host === h || host.endsWith("." + h));
    // Plain http only for a loopback host that was explicitly allowed (the local test stand-in); never in the default list.
    const loopback = host === "127.0.0.1" || host === "localhost";
    if (!allowed) return null;
    if (u.protocol !== "https:" && !(loopback && u.protocol === "http:")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const key = paynetConfig.apiKey;
  if (!key.startsWith("sk_test_")) throw new PaynetError(503, "not_configured", "Online payments are not configured");
  let res: Response;
  try {
    res = await fetch(`${paynetConfig.apiBase}${path}`, {
      method,
      headers: { Accept: "application/json", "X-Paynet-Key": key, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new PaynetError(502, "network", "Paynet could not be reached");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const d = (data || {}) as { error?: string; code?: string; message?: string };
    // Only Paynet's short code goes into errors/logs — never the request (it can hold client details) or the key.
    throw new PaynetError(res.status, String(d.code || d.error || `http_${res.status}`).slice(0, 60), `Paynet answered ${res.status}`);
  }
  return { status: res.status, data: data as T };
}

export interface CreatePaymentInput {
  amountAmd: number;
  orderId: string;
  idempotencyKey: string;
  returnUrl: string;
  callbackUrl: string;
  description: string;
}

/** POST /v1/payments. The same Idempotency-Key within 24 h returns the original payment (HTTP 200) instead of a new one. */
export async function createPayment(input: CreatePaymentInput): Promise<PaynetPayment> {
  const { data } = await call<PaynetPayment>(
    "POST",
    "/v1/payments",
    {
      amount: input.amountAmd,
      currency: "AMD",
      order_id: input.orderId,
      return_url: input.returnUrl,
      callback_url: input.callbackUrl,
      description: input.description.slice(0, 120),
      domain: paynetConfig.storeDomain,
      processor: paynetConfig.processor,
    },
    { "Idempotency-Key": input.idempotencyKey },
  );
  return data;
}

/** GET /v1/orders/{orderId}/payment — the authoritative current state, read before anything is marked paid. */
export async function getOrderPayment(orderId: string): Promise<PaynetPayment | null> {
  try {
    const { data } = await call<PaynetPayment | { data: PaynetPayment }>("GET", `/v1/orders/${encodeURIComponent(orderId)}/payment`);
    const p = (data && "data" in (data as object) ? (data as { data: PaynetPayment }).data : data) as PaynetPayment;
    return p && p.order_id ? p : null;
  } catch (e) {
    if (e instanceof PaynetError && e.status === 404) return null;
    throw e;
  }
}
