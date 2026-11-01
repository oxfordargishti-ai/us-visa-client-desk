import crypto from "node:crypto";
import { env } from "./env";

// AES-256-GCM for stored secrets (Google refresh tokens, push keys) + HMAC for short-lived signed values (OAuth state).

function masterKey(): Buffer {
  const raw = env.encryptionKey;
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 random bytes, base64-encoded (run: openssl rand -base64 32)");
    return buf;
  }
  if (env.isProd) throw new Error("ENCRYPTION_KEY is required in production");
  // Development / tests only: deterministic key so local data survives restarts. NEVER used in production.
  return crypto.createHash("sha256").update("uva-dev-only-encryption-key").digest();
}

function subkey(purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", masterKey(), Buffer.alloc(0), purpose, 32));
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", subkey("secrets"), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unsupported ciphertext");
  const decipher = crypto.createDecipheriv("aes-256-gcm", subkey("secrets"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

/** Sign a small JSON payload with an expiry. Used for OAuth `state`. */
export function signPayload(data: Record<string, unknown>, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = crypto.createHmac("sha256", subkey("signed-state")).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload<T = Record<string, unknown>>(token: string): T | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", subkey("signed-state")).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/** Constant-time comparison for secrets such as CRON_SECRET. */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
