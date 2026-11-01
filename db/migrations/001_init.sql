-- US VISA WITH ARGISHTI — AI Client Desk
-- Migration 001: complete schema. Plain PostgreSQL (tested on PGlite = real Postgres engine, and node-postgres).
-- All timestamps are timestamptz stored in UTC. Display conversion to Asia/Yerevan happens in the app.

-- ───────────────────────── Identity & sessions ─────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text,
  role          text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
  google_sub    text,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE sessions (
  id           text PRIMARY KEY,                       -- sha256(token); the raw token only lives in the cookie
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE auth_attempts (
  key                text PRIMARY KEY,                 -- "login:<email>:<ip>"
  attempts           int NOT NULL DEFAULT 0,
  window_started_at  timestamptz NOT NULL DEFAULT now(),
  locked_until       timestamptz
);

CREATE TABLE user_preferences (
  user_id                     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone                    text NOT NULL DEFAULT 'Asia/Yerevan',
  theme                       text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  default_task_reminders      int[] NOT NULL DEFAULT '{15}',            -- minutes before due time
  default_interview_reminders int[] NOT NULL DEFAULT '{2880,1440,300,60}',
  notif_push                  boolean NOT NULL DEFAULT true,
  notif_email_fallback        boolean NOT NULL DEFAULT true,
  notification_email          text,
  sound_enabled               boolean NOT NULL DEFAULT true,
  ai_task_parsing             boolean NOT NULL DEFAULT true,
  ai_share_client_names       boolean NOT NULL DEFAULT true,            -- lets Claude match "Karen" to a client record
  ai_email_analysis           boolean NOT NULL DEFAULT false,           -- opt-in
  ai_planner_suggestions      boolean NOT NULL DEFAULT true,
  document_retention_days     int CHECK (document_retention_days IS NULL OR document_retention_days >= 30),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Clients & cases ─────────────────────────
CREATE SEQUENCE client_code_seq START 1;

CREATE TABLE clients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_code        text NOT NULL DEFAULT ('UVA-' || lpad(nextval('client_code_seq')::text, 4, '0')),
  full_name          text NOT NULL,
  email              text,
  phone              text,
  whatsapp           text,
  preferred_language text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  UNIQUE (user_id, client_code)
);
CREATE INDEX clients_name_idx ON clients (user_id, lower(full_name)) WHERE deleted_at IS NULL;
CREATE INDEX clients_email_idx ON clients (user_id, lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE client_cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id             uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  visa_category         text NOT NULL DEFAULT 'B1/B2 Visitor',
  application_status    text NOT NULL DEFAULT 'New Client' CHECK (application_status IN (
    'New Client','Documents Pending','DS-160 In Progress','DS-160 Completed','Appointment Pending',
    'Interview Scheduled','Interview Preparation','Interview Completed','Administrative Processing',
    'Visa Issued','Visa Refused','Case Closed')),
  embassy               text,
  ds160_confirmation    text,
  payment_status        text NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid','Partial','Paid','Refunded')),
  interview_prep_status text NOT NULL DEFAULT 'Not Started' CHECK (interview_prep_status IN ('Not Started','In Progress','Ready')),
  opened_at             timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX client_cases_client_idx ON client_cases (client_id) WHERE deleted_at IS NULL;
CREATE INDEX client_cases_status_idx ON client_cases (user_id, application_status) WHERE deleted_at IS NULL;

-- ───────────────────────── Tasks, reminders, calendar, interviews ─────────────────────────
CREATE TABLE tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id        uuid REFERENCES clients(id) ON DELETE SET NULL,
  case_id          uuid REFERENCES client_cases(id) ON DELETE SET NULL,
  title            text NOT NULL,
  description      text,
  category         text NOT NULL DEFAULT 'Administrative Work' CHECK (category IN (
    'Visa Interview','Interview Preparation','DS-160 Application','Client Phone Call','Document Collection',
    'Embassy Appointment','Payment Follow-Up','Administrative Work','Urgent Task','Personal Reminder')),
  priority         text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low','Normal','High','Urgent')),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  due_at           timestamptz,
  duration_minutes int NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 1440),
  recurrence       text CHECK (recurrence IS NULL OR recurrence IN ('daily','weekdays','weekly','monthly')),
  recurrence_until date,
  series_id        uuid,
  reminder_offsets int[] NOT NULL DEFAULT '{}',           -- chosen "N minutes before" offsets; reminders are re-derived from these on reschedule
  source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai','gmail','note')),
  source_ref       text,
  ai_original_text text,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX tasks_due_idx ON tasks (user_id, status, due_at) WHERE deleted_at IS NULL;
CREATE INDEX tasks_client_idx ON tasks (client_id) WHERE deleted_at IS NULL;
CREATE INDEX tasks_completed_idx ON tasks (user_id, completed_at) WHERE status = 'completed';

CREATE TABLE task_reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  remind_at       timestamptz NOT NULL,
  offset_minutes  int,                                     -- minutes before due_at; NULL for custom / snooze
  kind            text NOT NULL DEFAULT 'scheduled' CHECK (kind IN ('scheduled','custom','snooze')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed','canceled')),
  attempt_count   int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  locked_at       timestamptz,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_reminders_due_idx ON task_reminders (remind_at) WHERE status IN ('pending','processing');
CREATE INDEX task_reminders_task_idx ON task_reminders (task_id);
-- Prevents the same task from getting two live reminders for the same instant.
CREATE UNIQUE INDEX task_reminders_live_uq ON task_reminders (task_id, remind_at, kind) WHERE status IN ('pending','processing');

CREATE TABLE calendar_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id          uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  client_id        uuid REFERENCES clients(id) ON DELETE SET NULL,
  title            text NOT NULL,
  category         text NOT NULL,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  location         text,
  notes            text,
  google_event_id  text,
  google_synced_at timestamptz,
  google_dirty     boolean NOT NULL DEFAULT false,
  google_error     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX calendar_events_range_idx ON calendar_events (user_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX calendar_events_dirty_idx ON calendar_events (user_id) WHERE google_dirty;

CREATE TABLE interviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  case_id       uuid REFERENCES client_cases(id) ON DELETE SET NULL,
  task_id       uuid UNIQUE REFERENCES tasks(id) ON DELETE SET NULL,
  visa_category text,
  embassy       text,
  interview_at  timestamptz NOT NULL,
  prep_status   text NOT NULL DEFAULT 'Not Started' CHECK (prep_status IN ('Not Started','In Progress','Ready')),
  docs_status   text NOT NULL DEFAULT 'Missing' CHECK (docs_status IN ('Missing','Partial','Complete')),
  outcome       text NOT NULL DEFAULT 'Pending' CHECK (outcome IN ('Pending','Approved','Refused','Administrative Processing','Rescheduled','Cancelled')),
  prep_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX interviews_time_idx ON interviews (user_id, interview_at) WHERE deleted_at IS NULL;
CREATE INDEX interviews_client_idx ON interviews (client_id) WHERE deleted_at IS NULL;

-- ───────────────────────── Notes ─────────────────────────
CREATE TABLE notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id  uuid REFERENCES clients(id) ON DELETE CASCADE,
  case_id    uuid REFERENCES client_cases(id) ON DELETE SET NULL,
  body       text NOT NULL,
  kind       text NOT NULL DEFAULT 'note' CHECK (kind IN ('note','call','whatsapp','email','meeting')),
  pinned     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX notes_client_idx ON notes (client_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX notes_user_idx ON notes (user_id, created_at DESC) WHERE deleted_at IS NULL;

-- ───────────────────────── Documents ─────────────────────────
CREATE TABLE documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  case_id         uuid REFERENCES client_cases(id) ON DELETE SET NULL,
  category        text NOT NULL DEFAULT 'Other' CHECK (category IN (
    'Passport','National ID','DS-160 Confirmation','Appointment Confirmation','Employment Documents',
    'Financial Documents','Travel History','Supporting Documents','Client Correspondence','Other')),
  filename        text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL,
  storage_key     text NOT NULL,
  checksum_sha256 text,
  notes           text,
  source          text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','gmail')),
  source_ref      text,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX documents_client_idx ON documents (client_id) WHERE deleted_at IS NULL;

CREATE TABLE document_checklists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  case_id     uuid NOT NULL REFERENCES client_cases(id) ON DELETE CASCADE,
  label       text NOT NULL,
  category    text NOT NULL DEFAULT 'Other',
  required    boolean NOT NULL DEFAULT true,
  status      text NOT NULL DEFAULT 'missing' CHECK (status IN ('missing','received','waived')),
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_checklists_case_idx ON document_checklists (case_id, sort_order);

-- ───────────────────────── Google (Gmail + Calendar) ─────────────────────────
CREATE TABLE gmail_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  google_email          text NOT NULL,
  refresh_token_enc     text NOT NULL,                     -- AES-256-GCM; never sent to the browser
  scopes                text[] NOT NULL DEFAULT '{}',
  calendar_sync_enabled boolean NOT NULL DEFAULT false,
  calendar_id           text NOT NULL DEFAULT 'primary',
  unread_cache          int,
  unread_cached_at      timestamptz,
  last_error            text,
  connected_at          timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gmail_thread_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  thread_id       text NOT NULL,
  subject         text,
  snippet         text,
  from_addr       text,
  last_message_at timestamptz,
  status          text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','confirmed','dismissed')),
  origin          text NOT NULL DEFAULT 'manual' CHECK (origin IN ('email_match','ai','manual')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, thread_id, client_id)
);
CREATE INDEX gmail_thread_links_client_idx ON gmail_thread_links (client_id, status);

-- ───────────────────────── Notifications ─────────────────────────
CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh_enc      text NOT NULL,
  auth_enc        text NOT NULL,
  user_agent      text,
  device_label    text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  last_success_at timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id, status);

CREATE TABLE notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_id     uuid REFERENCES task_reminders(id) ON DELETE SET NULL,
  task_id         uuid REFERENCES tasks(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  channel         text NOT NULL CHECK (channel IN ('push','email','inapp')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','expired','skipped')),
  title           text NOT NULL,
  body            text NOT NULL,
  url             text,
  priority        text,
  error           text,
  idempotency_key text NOT NULL UNIQUE,                    -- "<reminder>:<channel>:<subscription|->" — the duplicate-send guard
  sent_at         timestamptz,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_deliveries_user_idx ON notification_deliveries (user_id, created_at DESC);
CREATE INDEX notification_deliveries_inapp_idx ON notification_deliveries (user_id, created_at DESC) WHERE channel = 'inapp';

-- ───────────────────────── Audit trail ─────────────────────────
CREATE TABLE activity_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  client_id   uuid REFERENCES clients(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id   text,
  action      text NOT NULL,
  summary     text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_logs_client_idx ON activity_logs (client_id, created_at DESC);
CREATE INDEX activity_logs_user_idx ON activity_logs (user_id, created_at DESC);

-- ───────────────────────── Row-level security (defence in depth) ─────────────────────────
-- Every data table is restricted to rows whose user_id matches the transaction-local setting app.user_id.
-- The app sets it for each request (see src/lib/db). Background jobs set app.bypass_rls = 'on'.
-- NOTE: Postgres superusers / roles with BYPASSRLS ignore RLS. See README ("Database roles") for the production role setup.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_preferences','clients','client_cases','tasks','task_reminders','calendar_events','interviews','notes',
    'documents','document_checklists','gmail_connections','gmail_thread_links','push_subscriptions',
    'notification_deliveries','activity_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      $p$CREATE POLICY %I ON %I
         USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')
         WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')$p$,
      t || '_isolation', t);
  END LOOP;
END $$;
