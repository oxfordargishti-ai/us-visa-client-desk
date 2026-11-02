// DS-160 questionnaires sent by the form site (usvisawithargishti-ds160) become client profiles automatically.
// The form site POSTs the submitted answers to /api/intake/ds160 with `Authorization: Bearer <INTAKE_SECRET>`.
import { z } from "zod";
import { withSystem, withUser, type Q } from "./db";
import { createClient, CaseInput } from "./repo/clients";
import { createTask, TaskInput } from "./repo/tasks";
import { logActivity } from "./audit";
import { normalizePhone } from "./client-messages";

/** Reads a value from the first key that exists, looking through nested objects too (forms differ in shape). */
function pick(obj: unknown, keys: string[]): string | null {
  const seen = new Set<unknown>();
  const want = new Set(keys.map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const walk = (o: unknown, depth: number): string | null => {
    if (!o || typeof o !== "object" || seen.has(o) || depth > 4) return null;
    seen.add(o);
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (want.has(k.toLowerCase().replace(/[^a-z0-9]/g, "")) && (typeof v === "string" || typeof v === "number") && String(v).trim()) return String(v).trim();
    }
    for (const v of Object.values(o as Record<string, unknown>)) {
      const r = walk(v, depth + 1);
      if (r) return r;
    }
    return null;
  };
  return walk(obj, 0);
}

export const IntakeEnvelope = z.object({
  id: z.union([z.string(), z.number()]).transform(String).optional(), // the form's own submission id
  language: z.enum(["hy", "ru", "en"]).optional(),
  data: z.record(z.string(), z.unknown()).optional(), // the answers; if absent the whole body is treated as the answers
}).passthrough();

export interface IntakeContact {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  language: "hy" | "ru" | "en";
}

/** Extracts what a client profile needs from a DS-160 submission. */
export function contactFromIntake(body: z.infer<typeof IntakeEnvelope>): IntakeContact {
  const d = (body.data ?? body) as Record<string, unknown>;
  const first = pick(d, ["firstName", "first_name", "givenName", "given_names", "name_first"]);
  const last = pick(d, ["lastName", "last_name", "surname", "familyName", "name_last"]);
  const full = pick(d, ["fullName", "full_name", "applicantName", "applicant_name", "name"]) ?? ([first, last].filter(Boolean).join(" ") || null);
  const email = pick(d, ["email", "emailAddress", "email_address", "applicantEmail"]);
  const phone = pick(d, ["phone", "mobile", "mobilePhone", "phoneNumber", "phone_number", "cellPhone", "primaryPhone"]);
  const whatsapp = pick(d, ["whatsapp", "whatsApp", "whatsapp_number"]);
  return {
    full_name: full,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null,
    phone: phone ? normalizePhone(phone) ?? phone : null,
    whatsapp: whatsapp ? normalizePhone(whatsapp) ?? whatsapp : null,
    language: body.language ?? "hy",
  };
}

async function ownerId(): Promise<string> {
  const [u] = await withSystem((q) => q.query<{ id: string }>("SELECT id FROM users WHERE deleted_at IS NULL ORDER BY (role = 'owner') DESC, created_at LIMIT 1"));
  if (!u) throw new Error("No account exists yet");
  return u.id;
}

/** Creates the client (or updates the one with the same email/phone), stores the answers and adds a review task. */
export async function receiveIntake(body: z.infer<typeof IntakeEnvelope>) {
  const userId = await ownerId();
  const c = contactFromIntake(body);
  const externalId = body.id ?? null;
  return withUser(userId, async (q) => {
    if (externalId) {
      const [dup] = await q.query<{ id: string; client_id: string | null }>("SELECT id, client_id FROM client_intakes WHERE user_id=$1 AND source='ds160' AND external_id=$2", [userId, externalId]);
      if (dup) return { duplicate: true, clientId: dup.client_id, intakeId: dup.id, matched: "existing" as const };
    }
    const existing = await findMatch(q, userId, c);
    let clientId: string;
    let matched: "created" | "updated";
    if (existing) {
      clientId = existing.id;
      matched = "updated";
      // Fill in only what's missing — never overwrite what the owner already typed.
      await q.query(
        `UPDATE clients SET email = COALESCE(email, $3), phone = COALESCE(phone, $4), whatsapp = COALESCE(whatsapp, $5),
                preferred_language = COALESCE(preferred_language, $6), updated_at = now() WHERE id=$1 AND user_id=$2`,
        [clientId, userId, c.email, c.phone, c.whatsapp, c.language],
      );
    } else {
      const { client } = await createClient(q, userId, {
        full_name: c.full_name || c.email || c.phone || "DS-160 applicant",
        email: c.email,
        phone: c.phone,
        whatsapp: c.whatsapp,
        preferred_language: c.language,
        case: CaseInput.parse({ application_status: "DS-160 In Progress" }),
      }, "ds160");
      clientId = client.id;
      matched = "created";
    }
    const [intake] = await q.query<{ id: string }>(
      "INSERT INTO client_intakes (user_id, client_id, source, external_id, payload, matched) VALUES ($1,$2,'ds160',$3,$4,$5) RETURNING id",
      [userId, clientId, externalId, JSON.stringify(body.data ?? body), matched],
    );
    const name = c.full_name || c.email || "client";
    await createTask(q, userId, TaskInput.parse({
      title: `Review DS-160 answers — ${name}`,
      client_id: clientId,
      category: "DS-160 Application",
      priority: "High",
      due_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      reminder_offsets: [0],
    }));
    await q.query(
      `INSERT INTO notification_deliveries (user_id, channel, status, title, body, url, idempotency_key, sent_at) VALUES ($1,'inapp','sent',$2,$3,$4,$5,now())`,
      [userId, matched === "created" ? "New client from DS-160" : "DS-160 received", name, `/clients/${clientId}`, `intake:${intake.id}`],
    );
    await logActivity(q, { userId, clientId, entityType: "client", entityId: clientId, action: "intake.ds160", summary: `DS-160 questionnaire received (${matched === "created" ? "new client" : "matched existing client"})` });
    return { duplicate: false, clientId, intakeId: intake.id, matched };
  });
}

async function findMatch(q: Q, userId: string, c: IntakeContact) {
  if (c.email) {
    const [m] = await q.query<{ id: string }>("SELECT id FROM clients WHERE user_id=$1 AND deleted_at IS NULL AND lower(email)=lower($2) LIMIT 1", [userId, c.email]);
    if (m) return m;
  }
  if (c.phone) {
    const digits = c.phone.replace(/\D/g, "").slice(-8);
    if (digits.length === 8) {
      const [m] = await q.query<{ id: string }>("SELECT id FROM clients WHERE user_id=$1 AND deleted_at IS NULL AND right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 8) = $2 LIMIT 1", [userId, digits]);
      if (m) return m;
    }
  }
  return null;
}

export async function listIntakes(q: Q, userId: string, clientId: string) {
  return q.query<{ id: string; payload: Record<string, unknown>; matched: string; received_at: string }>(
    "SELECT id, payload, matched, received_at FROM client_intakes WHERE user_id=$1 AND client_id=$2 ORDER BY received_at DESC LIMIT 10",
    [userId, clientId],
  );
}
