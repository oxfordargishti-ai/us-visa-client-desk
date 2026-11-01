import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import webpush from "web-push";
import { freshDb, makeUser, withUser, withSystem, closeDriver } from "./helpers";
import { createTask, TaskInput } from "@/lib/repo/tasks";
import { dispatchDueReminders, saveSubscription } from "@/lib/notifications";

// Exercises the REAL web-push library (VAPID signing + RFC 8291 payload encryption + HTTP delivery) against a local HTTPS
// stand-in for a browser push service, using genuine P-256 subscription keys like a browser would create.
let server: https.Server;
let port = 0;
const hits: { path: string; headers: Record<string, string | string[] | undefined>; bytes: number }[] = [];
let uid: string;
const tlsPrev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

function browserKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uva-tls-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${dir}/k.pem`, "-out", `${dir}/c.pem`, "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
  server = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      hits.push({ path: req.url!, headers: req.headers, bytes: Buffer.concat(chunks).length });
      res.writeHead(req.url === "/gone" ? 410 : 201);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // test-only: the stand-in uses a self-signed certificate
  const vapid = webpush.generateVAPIDKeys();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", vapid.publicKey);
  vi.stubEnv("VAPID_PRIVATE_KEY", vapid.privateKey);
  await freshDb();
  uid = await makeUser("owner@example.com");
});
afterAll(async () => {
  if (tlsPrev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = tlsPrev;
  await new Promise((r) => server.close(r));
  await closeDriver();
});

describe("real web-push delivery", () => {
  const DUE = "2026-11-03T11:00:00.000Z";
  const NOW = new Date("2026-11-03T06:00:30Z");

  it("signs with VAPID, encrypts the payload and the push service accepts it (HTTP 201 → delivery 'sent')", async () => {
    await withUser(uid, (q) => saveSubscription(q, uid, { endpoint: `https://127.0.0.1:${port}/ok`, keys: browserKeys() }, "UA", "Test phone"));
    await withUser(uid, (q) => createTask(q, uid, TaskInput.parse({ title: "Call Karen", due_at: DUE, reminder_offsets: [300] }), new Date("2026-11-02T08:00:00Z")));
    const res = await dispatchDueReminders({ now: NOW, pushEnabled: true, emailEnabled: false });
    expect(res).toMatchObject({ claimed: 1, sent: 1, pushSent: 1, failed: 0, retrying: 0 });
    const h = hits.find((x) => x.path === "/ok")!;
    expect(h).toBeTruthy();
    expect(String(h.headers.authorization)).toMatch(/^vapid t=.+, k=.+/);
    expect(h.headers["content-encoding"]).toBe("aes128gcm");
    expect(h.headers.urgency).toBe("high");
    expect(Number(h.headers.ttl)).toBeGreaterThan(0);
    expect(h.bytes).toBeGreaterThan(150); // an encrypted JSON payload, not plaintext
    const [d] = await withSystem((q) => q.query<{ status: string }>("SELECT status FROM notification_deliveries WHERE channel='push'"));
    expect(d.status).toBe("sent");
  });

  it("a push service answering 410 Gone marks the subscription expired", async () => {
    await withSystem(async (q) => {
      for (const t of ["notification_deliveries", "task_reminders", "push_subscriptions", "tasks"]) await q.query(`DELETE FROM ${t}`);
    });
    await withUser(uid, (q) => saveSubscription(q, uid, { endpoint: `https://127.0.0.1:${port}/gone`, keys: browserKeys() }, "UA", "Old phone"));
    await withUser(uid, (q) => createTask(q, uid, TaskInput.parse({ title: "Call Karen", due_at: DUE, reminder_offsets: [300] }), new Date("2026-11-02T08:00:00Z")));
    const res = await dispatchDueReminders({ now: NOW, pushEnabled: true, emailEnabled: false });
    expect(res.expiredSubscriptions).toBe(1);
    const [s] = await withSystem((q) => q.query<{ status: string }>("SELECT status FROM push_subscriptions"));
    expect(s.status).toBe("expired");
  });
});
