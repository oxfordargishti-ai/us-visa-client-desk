import { handler } from "@/lib/api";
import { runCron } from "@/lib/housekeeping";

// Call this every minute (Vercel Cron on Pro, or any external pinger such as cron-job.org / GitHub Actions) with:
//   Authorization: Bearer <CRON_SECRET>
// Overlapping calls are safe: reminders are claimed with FOR UPDATE SKIP LOCKED and every send has an idempotency key.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const run = handler({ auth: "cron" }, async () => ({ ok: true, at: new Date().toISOString(), ...(await runCron()) }));
export const GET = run;
export const POST = run;
