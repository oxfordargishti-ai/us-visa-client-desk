import type { Q } from "./db";

const SECRET_KEY = /token|secret|password|passport|authorization|cookie|key/i;

/** Strips anything that looks like a secret from audit metadata. Audit logs must never hold credentials or document contents. */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 3 || value == null) return value ?? null;
  if (typeof value === "string") return value.length > 300 ? value.slice(0, 300) + "…" : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : sanitize(v, depth + 1);
    return out;
  }
  return value;
}

export interface ActivityInput {
  userId: string | null;
  clientId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function logActivity(q: Q, a: ActivityInput) {
  await q.query(
    `INSERT INTO activity_logs (user_id, client_id, entity_type, entity_id, action, summary, metadata, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [a.userId, a.clientId ?? null, a.entityType, a.entityId ?? null, a.action, a.summary.slice(0, 500), JSON.stringify(sanitize(a.metadata ?? {})), a.ip ?? null],
  );
}
