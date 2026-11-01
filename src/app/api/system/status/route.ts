import { handler } from "@/lib/api";
import { withSystem } from "@/lib/db";
import { capabilities, env } from "@/lib/env";

/** What still needs configuring, and whether the scheduler is actually running. */
export const GET = handler({}, async ({ user }) => {
  const caps = capabilities();
  const { lastRun, overdue } = await withSystem(async (q) => {
    const [r] = await q.query<{ value: string }>("SELECT value FROM system_state WHERE key='cron:last_run'");
    const [o] = await q.query<{ n: number }>("SELECT count(*)::int AS n FROM task_reminders WHERE user_id=$1 AND status='pending' AND remind_at < now() - interval '5 minutes' AND (next_attempt_at IS NULL OR next_attempt_at < now() - interval '5 minutes')", [user.id]);
    return { lastRun: r?.value ?? null, overdue: o.n };
  });
  const ageMin = lastRun ? Math.round((Date.now() - new Date(lastRun).getTime()) / 60000) : null;
  return {
    items: [
      { key: "database", label: "Database", ok: true, detail: env.databaseUrl ? "PostgreSQL connected" : "Local development database (set DATABASE_URL for production)" , warn: !env.databaseUrl && env.isProd },
      { key: "cron", label: "Reminder scheduler", ok: ageMin !== null && ageMin <= 5, detail: ageMin === null ? "Has never run — set up the every-minute cron job (README step 6)" : ageMin <= 5 ? `Last ran ${ageMin <= 0 ? "just now" : `${ageMin} min ago`}` : `Last ran ${ageMin} minutes ago — check the cron job`, extra: overdue > 0 ? `${overdue} reminder(s) are overdue and waiting` : undefined },
      { key: "ai", label: "Claude AI", ok: caps.ai, detail: caps.ai ? `Model ${env.anthropicModel}` : "Add ANTHROPIC_API_KEY to enable AI task capture" },
      { key: "push", label: "Push notifications", ok: caps.push, detail: caps.push ? "VAPID keys configured" : "Add VAPID keys (npm run vapid) to enable background alerts" },
      { key: "email", label: "Email fallback", ok: caps.email, detail: caps.email ? "SMTP configured" : "Add SMTP_* settings so reminders can fall back to email" },
      { key: "google", label: "Google (Gmail / Calendar)", ok: caps.google, detail: caps.google ? "OAuth client configured" : "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" },
      { key: "storage", label: "Document storage", ok: caps.storage === "s3" || !env.isProd, detail: caps.storage === "s3" ? "S3-compatible private bucket" : env.isProd ? "Local disk is not durable on serverless hosting — switch to S3/R2" : "Local folder (development)" },
    ],
  };
});
