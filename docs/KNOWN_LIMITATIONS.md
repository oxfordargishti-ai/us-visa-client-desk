# Known limitations & unresolved issues

Honest list, most important first.

## Not yet proven against the real services
These were exercised against local stand-ins (and unit tests) but **not** against the real thing, because they need your accounts or physical devices:

1. **Anthropic API.** The request/response path (tool-use, forced tool choice, parsing) runs through the real SDK against a local stand-in. Unverified: that your API key and the default model name `claude-sonnet-5-5` are accepted. If the model name isn't available on your account, the app says so and you can set `ANTHROPIC_MODEL`.
2. **Google OAuth / Gmail / Calendar.** Full flows run against a local stand-in that mimics Google's documented endpoints. Unverified: Google's consent screen, scope approval and real message formats (e.g. unusual MIME structures).
3. **Push delivery to a real phone/PC.** Verified: VAPID signing + payload encryption + HTTP delivery with the real `web-push` library against a local HTTPS service; the service worker displaying a notification with buttons; dispatcher retries/expiry handling. Unverified: FCM / Apple / Mozilla push services accepting your subscriptions, and iOS behaviour on your device. Use **Notifications → Send test notification** on each device.
4. **Email (SMTP), S3/R2 storage, Vercel deployment, `scripts/backup.sh`.** Written, not run against live infrastructure.

## Platform limits you can't code around
* **Google refresh tokens expire after 7 days** while the OAuth consent screen is in *Testing* (External). Use an **Internal** consent screen (Workspace) or publish the app — see the README.
* **Gmail `gmail.readonly` is a "restricted" scope.** Fine for yourself; serving other users would require Google's verification.
* **iOS push** needs iOS/iPadOS 16.4+ and the app added to the Home Screen. Web apps cannot set a custom background notification sound on any platform; the app plays a chime only while open.
* **Vercel Hobby** allows only daily cron jobs. Use cron-job.org (free, every minute), GitHub Actions (≈5 min, can lag) or Vercel Pro.
* **Voice dictation** uses the browser's speech recognition (Chrome/Edge/Safari). Armenian (`hy-AM`) works only where the browser supports it.

## Design decisions / simplifications
* **Single-owner product.** The schema has `owner`/`staff` roles and every row is user-scoped, but there is no UI for inviting staff or sharing a client between users.
* **Recurring tasks roll forward** (complete one → the next is created) instead of materialising future occurrences, so the calendar shows only the next occurrence of a repeating task.
* **Custom absolute-time reminders** are kept (not moved) when a task is rescheduled; offset-based reminders ("5 hours before") are rebuilt.
* **Email HTML is shown as plain text** (safer). The inbox shows the newest 25 messages per search — no infinite scroll yet.
* **Search** uses `ILIKE`, ideal for a practice-sized dataset; very large datasets would want `pg_trgm`/full-text indexes.
* **Row-level security is only enforced when the app connects as a non-superuser role without `BYPASSRLS`** (hosted databases often give you a bypassing owner role). `scripts/sql/app-role.sql` sets this up; without it the app still scopes every query by user in code.
* **Content-Security-Policy** allows inline scripts (required by Next.js bootstrap). A nonce-based policy is a future hardening step.
* **Network calls happen inside the dispatcher's database transaction** per reminder. Fine at this scale; a high-volume system would use an outbox.
* **Scheduler heartbeat** assumes one deployment; if you run several environments against one database, each shows the same "last run".
* The auto-generated demo data and the local `.data/` database are for development only.

## Things deliberately not built
* No automated legal conclusions, eligibility checks or approval predictions (per the brief).
* No sending, deleting, archiving or modifying Gmail (read-only by design).
* No fake "success" paths: when a service isn't configured the UI says so and offers the manual alternative.

## Upload size on Vercel
Vercel rejects request bodies larger than 4.5 MB before they reach the app, so on Vercel uploads are capped at **4 MB** per file (15 MB elsewhere). The app checks this in the browser and explains it. Lifting it requires uploading straight from the browser to the storage bucket with a signed upload link (plus a CORS rule on the bucket) — not implemented yet.
