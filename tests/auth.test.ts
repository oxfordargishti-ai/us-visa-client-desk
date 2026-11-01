import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, withSystem, closeDriver } from "./helpers";
import { authenticate, createSession, createUser, destroySession, getSessionUser, hashPassword, passwordPolicyError, verifyPassword, destroyOtherSessions } from "@/lib/auth";
import { encrypt, decrypt, signPayload, verifyPayload, safeEqual } from "@/lib/crypto";

beforeAll(freshDb);
afterAll(closeDriver);

describe("passwords", () => {
  it("hashes with scrypt, salts every hash, and verifies", async () => {
    const a = await hashPassword("CorrectHorse42");
    const b = await hashPassword("CorrectHorse42");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("CorrectHorse42", a)).toBe(true);
    expect(await verifyPassword("correcthorse42", a)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
  });
  it("enforces a sensible policy", () => {
    expect(passwordPolicyError("short1")).toMatch(/10/);
    expect(passwordPolicyError("onlyletterslong")).toMatch(/number/);
    expect(passwordPolicyError("1234567890123")).toMatch(/letter/);
    expect(passwordPolicyError("info@x.com1", "info@x.com1")).toMatch(/email/);
    expect(passwordPolicyError("GoodPass2026")).toBeNull();
  });
});

describe("sign-in, lockout and sessions", () => {
  it("authenticates a real user and rejects wrong passwords with the same generic reason", async () => {
    await createUser({ email: "Info@UsVisaWithArgishti.com", name: "Argishti", password: "GoodPass2026" });
    const ok = await authenticate("info@usvisawithargishti.com", "GoodPass2026", "1.1.1.1");
    expect(ok.ok).toBe(true);
    const wrong = await authenticate("info@usvisawithargishti.com", "nope", "1.1.1.2");
    const unknown = await authenticate("ghost@example.com", "nope", "1.1.1.3");
    expect(wrong).toEqual({ ok: false, reason: "invalid" });
    expect(unknown).toEqual({ ok: false, reason: "invalid" }); // does not reveal which emails exist
  });

  it("locks the account after 5 failures, even for the correct password", async () => {
    for (let i = 0; i < 5; i++) await authenticate("info@usvisawithargishti.com", "bad" + i, "9.9.9.9");
    const locked = await authenticate("info@usvisawithargishti.com", "GoodPass2026", "9.9.9.9");
    expect(locked).toMatchObject({ ok: false, reason: "locked" });
    // a different network is not locked out of the (per-email+ip) counter
    const other = await authenticate("info@usvisawithargishti.com", "GoodPass2026", "8.8.8.8");
    expect(other.ok).toBe(true);
  });

  it("creates, reads and destroys sessions; only a hash of the token is stored", async () => {
    const [u] = await withSystem((q) => q.query<{ id: string }>("SELECT id FROM users LIMIT 1"));
    const { token } = await createSession(u.id, { ip: "1.2.3.4", userAgent: "UA" });
    const stored = await withSystem((q) => q.query<{ id: string }>("SELECT id FROM sessions"));
    expect(stored.every((s) => s.id !== token)).toBe(true);
    expect((await getSessionUser(token))?.email).toBe("info@usvisawithargishti.com");
    await destroySession(token);
    expect(await getSessionUser(token)).toBeNull();
    expect(await getSessionUser("x".repeat(40))).toBeNull();
  });

  it("expires idle sessions and sessions of deleted users", async () => {
    const [u] = await withSystem((q) => q.query<{ id: string }>("SELECT id FROM users LIMIT 1"));
    const { token } = await createSession(u.id);
    await withSystem((q) => q.query("UPDATE sessions SET last_seen_at = now() - interval '15 days'"));
    expect(await getSessionUser(token)).toBeNull();
    const t2 = (await createSession(u.id)).token;
    await withSystem((q) => q.query("UPDATE sessions SET expires_at = now() - interval '1 minute'"));
    expect(await getSessionUser(t2)).toBeNull();
    const t3 = (await createSession(u.id)).token;
    await withSystem((q) => q.query("UPDATE users SET deleted_at = now()"));
    expect(await getSessionUser(t3)).toBeNull();
    await withSystem((q) => q.query("UPDATE users SET deleted_at = NULL"));
  });

  it("can sign out every other device after a password change", async () => {
    const [u] = await withSystem((q) => q.query<{ id: string }>("SELECT id FROM users LIMIT 1"));
    const keep = (await createSession(u.id)).token;
    const other = (await createSession(u.id)).token;
    await destroyOtherSessions(u.id, keep);
    expect(await getSessionUser(keep)).not.toBeNull();
    expect(await getSessionUser(other)).toBeNull();
  });
});

describe("secrets at rest", () => {
  it("encrypts and decrypts with AES-256-GCM and detects tampering", () => {
    const c = encrypt("refresh-token-123");
    expect(c).not.toContain("refresh-token");
    expect(decrypt(c)).toBe("refresh-token-123");
    const [v, iv, tag, data] = c.split(".");
    const tampered = [v, iv, tag, Buffer.from("AAAA").toString("base64url") + data.slice(4)].join(".");
    expect(() => decrypt(tampered)).toThrow();
  });
  it("signs OAuth state and rejects forgery or expiry", () => {
    const s = signPayload({ purpose: "gmail", nonce: "n1" }, 60);
    expect(verifyPayload<{ nonce: string }>(s)?.nonce).toBe("n1");
    expect(verifyPayload(s.slice(0, -2) + "xx")).toBeNull();
    expect(verifyPayload(signPayload({ a: 1 }, -5))).toBeNull();
  });
  it("compares secrets in constant time", () => {
    expect(safeEqual("Bearer abc", "Bearer abc")).toBe(true);
    expect(safeEqual("Bearer abc", "Bearer abd")).toBe(false);
  });
});
