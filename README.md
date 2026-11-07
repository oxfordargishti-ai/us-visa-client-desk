# US VISA WITH ARGISHTI — AI Client Desk

A private, installable web app (PWA) for running an independent U.S. visa-support practice: a command-center dashboard, AI task capture with mandatory approval, an interactive calendar, interview tracking with live countdowns, client files, private documents, read-only Gmail, and **server-side reminders that fire even when the app is closed**.

> *Your Legal Bridge to the U.S.* · Independent service — not affiliated with the U.S. government. The app never gives legal conclusions or approval predictions.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Motion for React · FullCalendar 6 · PostgreSQL (`node-postgres` in production, PGlite for zero-setup local dev) · Web Push (VAPID) · Anthropic Claude API · Gmail/Calendar over Google OAuth 2.0 · S3-compatible private storage.

Contents: [What's inside](#whats-inside) · [Run it locally](#run-it-locally-5-minutes) · [What you must provide](#what-you-must-provide) · [Deploy to production](#deploy-to-production) · [Reminder scheduler](#reminder-scheduler-do-not-skip) · [Google setup](#google-gmail--calendar-setup) · [Phones & iOS](#phones-ios-and-notifications) · [Security](#security--privacy) · [Testing](#testing) · [Project map](#project-map) · [Known limitations](docs/KNOWN_LIMITATIONS.md) · [Owner guide](docs/OWNER_GUIDE.md)

---

## What's inside

| Area | What it does |
|---|---|
| **My Command Center** | Next task, today's progress ring, overdue, interviews (7 days, live countdowns), pending applications, clients awaiting documents, clients needing follow-up, important deadlines, unread Gmail, recently completed, weekly productivity. One-click complete / reschedule / call / WhatsApp. |
| **AI task generator** | "Call Karen tomorrow at 3 PM … remind me five hours before" → Claude extracts a *draft* → you see a preview with every field editable and uncertain ones flagged → **nothing is saved until you press Confirm**. Dates like "tomorrow" are recomputed server-side in Asia/Yerevan, never trusted from the model. Missing time, ambiguous or unknown client, duplicates and past times are all flagged. |
| **Daily planner** | Morning priorities, calls, applications, interview prep, documents, emails needing attention, deadlines, completed today. Complete / snooze / reschedule / move unfinished to another day. Optional AI "suggest an order" (advice only). |
| **Calendar** | Day · Week · Month · Agenda · Interviews. Drag-and-drop and resize (reminders rebuild automatically), colour-coded categories with filters, click for details, overdue markers, timezone-aware, optional one-way Google Calendar sync. |
| **Interviews** | Client, visa category, embassy, date/time, preparation status, documents status, checklist, notes, outcome, follow-up task, countdown cards. |
| **Clients** | Profiles, cases, 12-step status pipeline, DS-160 confirmation, payment status, notes (voice dictation where the browser supports it), activity timeline, linked emails, tasks, documents. |
| **Documents** | Private storage with signed access, per-case checklists, preview, retention policy, Gmail attachment → client file (after you confirm the client). |
| **Gmail** | Real inbox via Google OAuth, **read-only**. Unread, search by client, suggested (never automatic) client links, "may need action" highlights, opt-in AI summaries. |
| **Reminders** | 1 or more per task: at time, 15 m, 30 m, 1 h, 5 h, 1 d, 2 d, 1 w, or custom. Web Push to every subscribed device, email fallback, in-app notification centre, snooze (also from the notification), delivery log with actionable errors, retries with back-off, duplicate-proof. |
| **Search** | ⌘K / Ctrl+K across clients, tasks, calendar, notes, documents and linked emails. |

---

## Run it locally (5 minutes)

Requires Node.js 20.9+.

```bash
npm install
cp .env.example .env.local        # then edit: set OWNER_EMAIL and OWNER_INITIAL_PASSWORD (letters + numbers, 10+ chars)
npm run db:migrate                # creates the schema and your owner account
npm run dev                       # http://localhost:3000
```

No database server is needed locally — a real Postgres engine (PGlite) is stored in `.data/`. Optional: `npm run db:seed-demo` fills it with **fictional** clients so you can look around (refuses to run in production).

Everything works without any keys except the features that need them (see below); Settings → **Setup status** always tells you what is and isn't configured.

---

**Online payments (Paynet, sandbox).** Set what a client owes on their page (*Online payment*); they pay it from the portal's «Վճարման տվյալներ» section through Paynet's hosted checkout. The amount always comes from your request here, and a payment counts only after Paynet's API confirms it. Setup, variables and endpoints: [docs/ONLINE_PAYMENTS.md](docs/ONLINE_PAYMENTS.md).

## What you must provide

The app cannot invent these — each is a credential or account only you can create.

| # | Item | Needed for | Where to get it | Env var(s) |
|---|---|---|---|---|
| 1 | **PostgreSQL database** | Everything (production) | [Neon](https://neon.tech) (free tier is fine), Supabase, Vercel Postgres, RDS… | `DATABASE_URL` |
| 2 | **Encryption key + cron secret + VAPID keys** | Encrypted tokens, scheduler auth, push | `npm run vapid` prints all four | `ENCRYPTION_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| 3 | **Owner login** | Signing in the first time | You choose | `OWNER_EMAIL`, `OWNER_INITIAL_PASSWORD` (remove after first sign-in) |
| 4 | **Public HTTPS URL** | OAuth, push, installable app | Your Vercel domain or custom domain | `APP_URL` |
| 5 | **Anthropic API key** | AI task capture, day suggestions, email summaries | [console.anthropic.com](https://console.anthropic.com) | `ANTHROPIC_API_KEY` (`ANTHROPIC_MODEL` optional, default `claude-sonnet-5-5`) |
| 6 | **Scheduler** (every minute) | Reminders when the app is closed | See [Reminder scheduler](#reminder-scheduler-do-not-skip) | uses `CRON_SECRET` |
| 7 | **Google OAuth client** | Gmail, Calendar sync, optional Google sign-in | See [Google setup](#google-gmail--calendar-setup) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_ACCOUNT` |
| 8 | **SMTP account** | Email fallback for reminders | Resend, Postmark, Brevo, Gmail SMTP… | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| 9 | **S3-compatible bucket** (private) | Client documents in production | Cloudflare R2 (generous free tier), AWS S3, Backblaze B2 | `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| 10 | **Paynet test key + webhook secret** (optional) | «Վճարել առցանց» on the client portal (sandbox only) | [paynet.am](https://paynet.am) → Developers. See [docs/ONLINE_PAYMENTS.md](docs/ONLINE_PAYMENTS.md) | `PAYNET_TEST_API_KEY`, `PAYNET_WEBHOOK_SECRET` |
| 11 | **Your logo** | Already included | `assets/logo-original.png` is your file, untouched; `npm run icons` regenerates cropped/resized copies | — |

All variables are documented in [`.env.example`](.env.example). Never commit real values.

---

## Deploy to production

Example: **Vercel + Neon + Cloudflare R2 + Resend** (any equivalents work).

1. **Database.** Create a Neon project → copy the connection string → `DATABASE_URL`.
   *Recommended:* run the app as a least-privilege role so row-level security is enforced (hosted "owner" roles often bypass it):
   ```bash
   psql "$ADMIN_DATABASE_URL" -v app_password="'a-long-random-password'" -f scripts/sql/app-role.sql
   ```
   Then use the admin URL only for `npm run db:migrate`, and `postgresql://uva_app:…` as the app's `DATABASE_URL`.
2. **Secrets.** `npm run vapid` → copy the four values into Vercel (Project → Settings → Environment Variables).
3. **Storage.** Create a **private** R2/S3 bucket and an access key limited to it. Set `STORAGE_DRIVER=s3` and the `S3_*` variables. (Local-disk storage is refused in production because serverless disks are not durable.) Turn on bucket versioning for file backups.
4. **Push the code** to a private Git repository and import it in Vercel (framework preset: Next.js; `vercel.json` is included). Add the environment variables from the table above, including `APP_URL`.
5. **Create the schema + owner.** From your computer, with the production variables exported:
   ```bash
   DATABASE_URL="<admin url>" OWNER_EMAIL=… OWNER_INITIAL_PASSWORD=… npm run db:migrate
   ```
   (or set `AUTO_MIGRATE=true` on the server: at boot it applies pending migrations and, only while no account exists, creates the owner from `OWNER_EMAIL` / `OWNER_INITIAL_PASSWORD` — no terminal needed). Sign in, **change the password in Settings**, then delete `OWNER_INITIAL_PASSWORD`.
6. **Scheduler** — next section.
7. Open **Settings → Setup status**: every row should be green. Open **Notifications → Turn on alerts → Send test notification** on each device.

### Reminder scheduler (do not skip)

Reminders are stored in the database; something must call `POST /api/cron/dispatch` with `Authorization: Bearer <CRON_SECRET>` every minute. The endpoint is safe to call as often and as concurrently as you like (rows are claimed with `FOR UPDATE SKIP LOCKED`; every delivery has an idempotency key).

| Option | Cost | Precision | How |
|---|---|---|---|
| **Vercel Cron** (Pro plan) | Pro | 1 minute | Add `"crons": [{ "path": "/api/cron/dispatch", "schedule": "* * * * *" }]` to `vercel.json`. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set. *(Vercel's free Hobby plan only allows daily cron jobs — a per-minute schedule makes the deployment fail, which is why it is not enabled by default.)* |
| **cron-job.org** | Free | 1 minute | New cron job → URL `https://<APP_URL>/api/cron/dispatch`, method POST, schedule every minute, header `Authorization: Bearer <CRON_SECRET>`. |
| **GitHub Actions** | Free | ≈5 minutes, can lag | `.github/workflows/reminder-cron.yml` is included; add repository secrets `APP_URL` and `CRON_SECRET`. |

Settings → Setup status shows when the scheduler last ran and warns if it has never run or reminders are overdue.

### Backups

* **Database:** managed Postgres usually has point-in-time recovery (enable it). Additionally `scripts/backup.sh` writes encrypted dumps; `.github/workflows/backup.yml` runs it nightly (secrets `DATABASE_URL`, `BACKUP_PASSPHRASE`). Use a `pg_dump` at least as new as your server. **This script has not been run against a live server by the author — do a test restore before relying on it.**
* **Files:** bucket versioning (R2/S3) — files are not in the database.
* **Data export:** Settings → *Download JSON* any time.

---

## Google (Gmail + Calendar) setup

You need one OAuth client; it powers Gmail, optional Calendar sync and optional Google sign-in. About ten minutes.

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project (e.g. "US Visa Desk").
2. **APIs & Services → Library**: enable **Gmail API** and **Google Calendar API**.
3. **OAuth consent screen**
   * If `info@usvisawithargishti.com` is a **Google Workspace** account: choose user type **Internal** — no verification, tokens don't expire. *(Best option.)*
   * Otherwise choose **External**. While the app is in **Testing**, Google expires refresh tokens after **7 days**, so Gmail would disconnect weekly. For a one-person tool, click **Publish app** (it shows an "unverified app" warning that you click through once). Full verification of the restricted Gmail scope is only required if you add other users.
   * Add scopes: `…/auth/gmail.readonly`, `…/auth/calendar.events`, `openid`, `email`, `profile`. Add yourself as a test user.
4. **Credentials → Create credentials → OAuth client ID → Web application.** Authorised redirect URIs (exact):
   * `https://<your-domain>/api/gmail/callback`
   * `https://<your-domain>/api/auth/google/callback` *(only if you enable Google sign-in)*
5. Copy the client ID/secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Optionally `GOOGLE_LOGIN_ENABLED=true` for "Continue with Google" (existing users only — no self sign-up).
6. In the app: **Gmail → Connect with Google**, choose `info@usvisawithargishti.com`. Calendar sync: **Settings → Connect Google Calendar**.

The app requests **read-only** Gmail access. It cannot send, delete, archive or label mail. Disconnecting deletes the stored token and revokes it at Google.

---

## Languages, client reminders and DS-160 intake

**Languages.** The whole interface is available in English, Armenian (Հայերեն) and Russian (Русский) — the 🌐 button in the top bar, the pills in the sidebar/menu, Settings, or the sign-in screen. Menus, dates and the calendar switch together; the choice is kept in a cookie and in your preferences. Translations live in `src/lib/i18n/{hy,ru}.ts`, keyed by the English text (anything untranslated simply shows in English).

**Reminders to clients (email + SMS).** Each client has two consent switches (Email / SMS) on their profile — nothing is ever sent to a client unless you turn on the channel they agreed to. Interview reminders then go out automatically (default 1 day and 2 hours before; change it in Settings → Reminders to clients) in the client's own language, from the same every-minute scheduler. From the client page you can also send a "missing documents" request (built from their checklist) or your own text, by email or SMS, after reviewing it.
* Email uses the same SMTP settings as your own fallback emails. To reach any client address, verify your domain (e.g. `usvisawithargishti.com`) with your email provider (Resend → Domains) and set `SMTP_FROM` to an address on it.
* SMS uses Twilio: set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. Armenian/Russian SMS use 70 characters per part, so a reminder is usually 2–3 parts.
* Every message is logged on the client page with its outcome; each automatic reminder is sent at most once (idempotency key), and after a scheduler outage only the closest reminder is sent.

**DS-160 intake.** The form site can create clients automatically: it POSTs each submission to `/api/intake/ds160` with `Authorization: Bearer <INTAKE_SECRET>` and a body like `{ "id": "<submission id>", "language": "hy", "data": { …answers… } }`. The desk finds the name, email and phone wherever they are in the answers, creates the client (or attaches to the existing one with the same email/phone, without overwriting what you typed), stores all answers (shown on the client page under **DS-160 answers**), adds a "Review DS-160 answers" task and an in-app alert. Re-sending the same submission id does nothing. Send answers only — not passport scans (Vercel limits request bodies to 4.5 MB).

## Phones, iOS and notifications

* **Android / desktop Chrome & Edge:** use the browser's *Install app* (or the button in the sidebar/Notifications page) → Notifications → **Turn on alerts**. Alerts also work in a normal tab.
* **iPhone / iPad (iOS/iPadOS 16.4 or newer):** Apple only allows web push for apps added to the Home Screen.
  1. Open the site in **Safari** → Share → **Add to Home Screen** → Add.
  2. Open **Visa Desk** from the Home Screen (not Safari).
  3. Notifications → **Turn on alerts** → Allow.
  4. Press **Send test notification**.
  The same steps are shown inside the app (Notifications → *Install on your phone*).
* **Sound:** background notifications use the device's own notification sound — browsers/phones don't let a web app choose one. While the app is open it plays a soft chime (Settings → Reminders).
* **If push can't reach a device** the reminder falls back to email (if SMTP is configured) and is always stored in the in-app notification centre. The delivery log shows exactly what happened and why.

---

## Security & privacy

Implemented (and covered by tests unless noted):

* Email + password sign-in: scrypt hashing, 5-attempt lockout, server-side sessions (only a hash of the token is stored), `HttpOnly`/`SameSite=Lax`/`Secure` cookies, 14-day idle / 30-day max, password change signs out other devices. Optional Google sign-in with signed `state` + cookie nonce.
* Every API route checks the session and, for state-changing requests, the request **Origin** (CSRF). A `proxy.ts` gate stops signed-out visitors from reaching app pages.
* Zod validation on every input; parameterised SQL everywhere (no string-built queries from user input); email HTML is never rendered (plain text only); uploads verified by file signature, 15 MB limit, random object keys, forced-download for e-mail attachments, sandboxed CSP on document responses.
* **Row-level security** on all 15 data tables (policy: `user_id = current setting`) — effective when the app runs as a non-superuser role (see `scripts/sql/app-role.sql`; verified end-to-end).
* Google refresh tokens and push keys are **AES-256-GCM encrypted**; tokens never reach the browser (verified by scanning every response in the browser tests).
* Documents: private bucket; only reachable through authenticated routes (60-second signed URLs on S3/R2); each access is audit-logged without filenames or contents.
* Audit log of sensitive actions; secret-looking keys are redacted from audit metadata; passport images are never logged or sent to AI.
* Privacy controls: AI features individually switchable; client names can be withheld from Claude; email analysis is opt-in and redacts ID/phone-like numbers, addresses and quoted history first; one-click JSON export; per-client permanent erase (files, notes, tasks, history); optional automatic retention for closed cases.
* Security headers + CSP (note: script CSP allows `'unsafe-inline'` because Next.js inlines bootstrap scripts; a nonce-based CSP is a future hardening step).

---

## Testing

```bash
npm test                 # 137 unit/integration tests on an in-memory real Postgres engine (PGlite)
npm run test:pg          # the same suite on a real PostgreSQL server (set TEST_DATABASE_URL to a throwaway DB)
npm run typecheck && npm run build
npm run test:e2e         # 36 + 15 browser checks (Playwright) with local stand-ins for Anthropic & Google
```

What the author ran while building this (Nov 2026):

| Check | Result |
|---|---|
| Unit/integration (`npm test`) on PGlite | all passing |
| Same suite on **PostgreSQL 18.6 via node-postgres** | all passing |
| Browser E2E on a **production build + real PostgreSQL, app running as a non-superuser (RLS enforced)** | 36/36 + 15/15 |
| TypeScript, production build | clean |

The suite covers: schema & RLS, timezone maths, reminder offsets (5 h, 1 d, …), rescheduling cancelling and rebuilding reminders, recurring tasks, snooze, calendar sync, interviews → calendar/list/dashboard, the AI parser's safeguards (with the model mocked), approval workflow over HTTP, the dispatcher (idempotency, overlapping runs, retries/back-off, expired subscriptions, email fallback, completed/rescheduled tasks), the real `web-push` library against a local HTTPS push service, auth/lockout/sessions, CSRF, uploads, document isolation, retention, export and erasure — and in the browser: AI preview → confirm, drag-and-drop, uploads, Gmail OAuth → inbox → link → attachment (against a local Google stand-in), Calendar sync calls, server-side reminder dispatch, service-worker notification display, phone layouts.

**Not verified here (needs your credentials/devices — see [Known limitations](docs/KNOWN_LIMITATIONS.md)):** the live Anthropic API, the real Google OAuth/Gmail/Calendar servers, real push services (FCM/Apple/Mozilla) delivering to a physical phone or PC, SMTP delivery, a real S3/R2 bucket, `scripts/backup.sh`, and deployment on Vercel itself. Each of these code paths is exercised against local stand-ins, but only a first run with your real accounts proves them — the **Setup status** and **Send test notification** buttons are there for exactly that.

---

## Project map

```
db/migrations/        001_init.sql (16 required tables + sessions, auth_attempts, RLS) · 002_system_state.sql
scripts/              migrate · seed-demo (fictional, dev only) · generate-vapid · make-icons · backup.sh · sql/app-role.sql
src/proxy.ts          signed-out gate          src/instrumentation.ts  auto-migrate in dev
src/lib/              db · auth · crypto · time · notifications (dispatcher) · google · storage · oauth · api (route wrapper)
src/lib/repo/         tasks · clients · interviews · calendar · notes · documents · dashboard · search · prefs · export
src/lib/ai/           claude (API call) · task-parser · assist (planner + email analysis)
src/app/api/…         ~50 route handlers      src/app/(app)/…  pages      src/app/login
src/components/       UI kit (ui.tsx) · app shell · quick-add · task form/rows · calendar · dashboard · clients · …
public/sw.js          service worker (push, snooze/open actions, offline shell — never caches client data)
tests/                vitest suites · e2e/ (Playwright + local Anthropic/Google stand-ins)
assets/logo-original.png   your logo, unaltered
```

Design notes: all times are stored in UTC and shown in Asia/Yerevan (changeable in Settings); recurring tasks are "rolling" (completing one creates the next); every task with a date has exactly one calendar event, so calendar, reminders and interviews can never disagree.
