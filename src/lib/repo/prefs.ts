import { z } from "zod";
import { one, type Q } from "../db";
import type { Prefs } from "../types";
import { isValidTz } from "../time";

export async function getPrefs(q: Q, userId: string): Promise<Prefs> {
  let row = await one<Prefs>(q, "SELECT * FROM user_preferences WHERE user_id = $1", [userId]);
  if (!row) {
    await q.query("INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    row = (await one<Prefs>(q, "SELECT * FROM user_preferences WHERE user_id = $1", [userId]))!;
  }
  return row;
}

const offsets = z.array(z.number().int().min(0).max(129_600)).max(8);

export const PrefsPatch = z.object({
  timezone: z.string().refine(isValidTz, "Unknown timezone").optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  default_task_reminders: offsets.optional(),
  default_interview_reminders: offsets.optional(),
  notif_push: z.boolean().optional(),
  notif_email_fallback: z.boolean().optional(),
  notification_email: z.string().email().nullable().optional(),
  sound_enabled: z.boolean().optional(),
  ai_task_parsing: z.boolean().optional(),
  ai_share_client_names: z.boolean().optional(),
  ai_email_analysis: z.boolean().optional(),
  ai_planner_suggestions: z.boolean().optional(),
  document_retention_days: z.number().int().min(30).max(3650).nullable().optional(),
  language: z.enum(["en", "hy", "ru"]).optional(),
  client_reminders_enabled: z.boolean().optional(),
  client_reminder_offsets: z.array(z.number().int().min(15).max(20_160)).max(4).optional(),
  business_phone: z.string().trim().max(40).nullable().optional(),
});

export async function updatePrefs(q: Q, userId: string, patch: z.infer<typeof PrefsPatch>): Promise<Prefs> {
  await getPrefs(q, userId);
  const allowed = new Set(Object.keys(PrefsPatch.shape));
  const keys = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => allowed.has(k) && patch[k] !== undefined); // column names come only from this whitelist
  if (keys.length) {
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    await q.query(`UPDATE user_preferences SET ${sets.join(", ")}, updated_at = now() WHERE user_id = $1`, [userId, ...keys.map((k) => patch[k])]);
  }
  return getPrefs(q, userId);
}
