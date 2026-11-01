// DEVELOPMENT ONLY: fills a local database with FICTIONAL clients so you can look around the app.
// Never run against your real database. Refuses to run when NODE_ENV=production.
import "./_env";
import { DateTime } from "luxon";
import { withSystem, withUser, closeDriver } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrate";
import { createUser } from "../src/lib/auth";
import { createClient } from "../src/lib/repo/clients";
import { createTask, completeTask } from "../src/lib/repo/tasks";
import { createInterview } from "../src/lib/repo/interviews";
import { createNote } from "../src/lib/repo/notes";
import { updatePrefs } from "../src/lib/repo/prefs";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const TZ = "Asia/Yerevan";
const at = (days: number, hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return DateTime.now().setZone(TZ).plus({ days }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).toUTC().toISO()!;
};

async function main() {
  await runMigrations();
  const email = process.env.DEMO_EMAIL || "demo@example.com";
  const password = process.env.DEMO_PASSWORD || "DemoPass2026!";
  let uid = (await withSystem((q) => q.query<{ id: string }>("SELECT id FROM users WHERE lower(email)=$1", [email])))[0]?.id;
  if (!uid) uid = await createUser({ email, name: "Argishti", password });
  const U = uid;

  await withUser(U, async (q) => {
    await updatePrefs(q, U, { default_task_reminders: [15], default_interview_reminders: [1440, 300, 60] });
    const mk = async (full_name: string, o: { email?: string; phone?: string; wa?: string; visa: string; status: string; embassy: string; pay?: string }) =>
      (await createClient(q, U, {
        full_name, email: o.email ?? null, phone: o.phone ?? null, whatsapp: o.wa ?? null, preferred_language: "hy",
        case: { visa_category: o.visa, application_status: o.status as never, embassy: o.embassy, payment_status: (o.pay ?? "Unpaid") as never, interview_prep_status: "Not Started", ds160_confirmation: null },
      })).client;

    const karen = await mk("Karen Sargsyan", { email: "karen.demo@example.com", phone: "+37499000001", wa: "+37499000001", visa: "B1/B2 Visitor", status: "Interview Preparation", embassy: "U.S. Embassy Yerevan", pay: "Paid" });
    const anahit = await mk("Anahit Melkonyan", { email: "anahit.demo@example.com", phone: "+37499000002", visa: "F-1 Student", status: "Documents Pending", embassy: "U.S. Embassy Yerevan", pay: "Partial" });
    const vahe = await mk("Vahe Manukyan", { phone: "+37499000003", visa: "B1/B2 Visitor", status: "DS-160 In Progress", embassy: "U.S. Embassy Yerevan" });
    const sona = await mk("Sona Khachatryan", { email: "sona.demo@example.com", phone: "+37499000004", visa: "K-1 Fiancé(e)", status: "Appointment Pending", embassy: "U.S. Embassy Yerevan", pay: "Paid" });
    const hayk = await mk("Hayk Danielyan", { phone: "+37499000005", visa: "H-1B Work", status: "Interview Scheduled", embassy: "U.S. Embassy Yerevan", pay: "Paid" });
    const mane = await mk("Mane Gevorgyan", { email: "mane.demo@example.com", visa: "B1/B2 Visitor", status: "New Client", embassy: "U.S. Embassy Yerevan" });
    await mk("Gor Hovhannisyan", { phone: "+37499000006", visa: "J-1 Exchange", status: "Visa Issued", embassy: "U.S. Embassy Yerevan", pay: "Paid" });

    await createInterview(q, U, { client_id: karen.id, interview_at: at(3, "10:30"), embassy: "U.S. Embassy Yerevan", prep_status: "In Progress" });
    await createInterview(q, U, { client_id: hayk.id, interview_at: at(1, "09:15"), embassy: "U.S. Embassy Yerevan", prep_status: "Ready" });
    await createInterview(q, U, { client_id: sona.id, interview_at: at(6, "14:00"), embassy: "U.S. Embassy Yerevan" });

    const t = (title: string, due: string, o: Partial<Parameters<typeof createTask>[2]> = {}) => createTask(q, U, { title, due_at: due, category: "Administrative Work", priority: "Normal", duration_minutes: 30, custom_reminders: [], source: "manual", ...o } as never);
    await t("Call Karen — Visa Interview Preparation", at(0, "15:00"), { category: "Interview Preparation", client_id: karen.id, reminder_offsets: [300, 60], priority: "High" });
    await t("Review Anahit's I-20 and financial documents", at(0, "11:00"), { category: "Document Collection", client_id: anahit.id, reminder_offsets: [30] });
    await t("Complete Vahe's DS-160 (sections 1–4)", at(0, "17:30"), { category: "DS-160 Application", client_id: vahe.id, reminder_offsets: [60] });
    await t("Follow up on Anahit's remaining tuition payment", at(-1, "16:00"), { category: "Payment Follow-Up", client_id: anahit.id, priority: "High" });
    await t("Send embassy appointment reminder to Sona", at(1, "12:00"), { category: "Embassy Appointment", client_id: sona.id });
    await t("Mock interview with Hayk", at(0, "09:00"), { category: "Interview Preparation", client_id: hayk.id, priority: "Urgent", reminder_offsets: [0] });
    await t("Update weekly client report", at(2, "10:00"), { recurrence: "weekly", reminder_offsets: [15] });
    await t("Welcome call with Mane", at(1, "16:30"), { category: "Client Phone Call", client_id: mane.id });

    for (const [title, d] of [["Collected Karen's passport copy", -1], ["Booked Hayk's biometrics slot", -2], ["Sent DS-160 checklist to Vahe", -1]] as const) {
      const r = await t(title, at(d, "10:00"), { reminder_offsets: [] });
      await completeTask(q, U, r.task.id);
    }
    await createNote(q, U, { client_id: karen.id, kind: "call", pinned: true, body: "Karen asked to move prep to afternoon. Worried about the 'ties to Armenia' question — go over employment letter and family situation." });
    await createNote(q, U, { client_id: anahit.id, kind: "whatsapp", pinned: false, body: "Sent list of missing financial documents. She will upload the sponsor's bank statement by Thursday." });
    await createNote(q, U, { client_id: hayk.id, kind: "note", pinned: false, body: "Employer support letter received. Check job title matches the petition exactly." });
  });

  console.log(`✔ Demo data ready (fictional people).\n  Sign in at /login with:\n    email:    ${email}\n    password: ${password}`);
  await closeDriver();
}

main().catch((e) => {
  console.error("✘", e);
  process.exit(1);
});
