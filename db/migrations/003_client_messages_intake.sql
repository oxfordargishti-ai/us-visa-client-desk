-- Migration 003: reminders sent TO clients (email / SMS), DS-160 intake from the form site, and a saved UI language.

-- Consent per channel: nothing is ever sent to a client unless the owner ticks that the client agreed.
ALTER TABLE clients ADD COLUMN notify_email boolean NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN notify_sms   boolean NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN source       text;        -- 'manual' | 'ds160' …

ALTER TABLE user_preferences ADD COLUMN language                 text  NOT NULL DEFAULT 'en' CHECK (language IN ('en','hy','ru'));
ALTER TABLE user_preferences ADD COLUMN client_reminders_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE user_preferences ADD COLUMN client_reminder_offsets  int[] NOT NULL DEFAULT '{1440,120}';  -- minutes before the interview
ALTER TABLE user_preferences ADD COLUMN business_phone           text;

-- Every message sent (or deliberately skipped) to a client. The unique key makes each reminder go out at most once,
-- even if the scheduler runs twice at the same moment.
CREATE TABLE client_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  interview_id     uuid REFERENCES interviews(id) ON DELETE SET NULL,
  channel          text NOT NULL CHECK (channel IN ('email','sms')),
  kind             text NOT NULL CHECK (kind IN ('interview_reminder','documents_request','custom','test')),
  to_address       text,
  subject          text,
  body             text NOT NULL,
  status           text NOT NULL CHECK (status IN ('sending','sent','failed','skipped')),
  error            text,
  provider_id      text,
  idempotency_key  text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);
CREATE INDEX client_messages_client_idx ON client_messages (client_id, created_at DESC);

-- DS-160 submissions received from the form site, kept with the client they created or matched.
CREATE TABLE client_intakes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id     uuid REFERENCES clients(id) ON DELETE SET NULL,
  source        text NOT NULL DEFAULT 'ds160',
  external_id   text,                         -- the form site's own submission id, for de-duplication
  payload       jsonb NOT NULL,
  matched       text NOT NULL CHECK (matched IN ('created','updated')),
  received_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, external_id)
);
CREATE INDEX client_intakes_client_idx ON client_intakes (client_id, received_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_messages','client_intakes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      $p$CREATE POLICY %I ON %I
         USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')
         WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')$p$,
      t || '_isolation', t);
  END LOOP;
END $$;
