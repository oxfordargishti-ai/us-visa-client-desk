-- Migration 004: online payments from the client portal (portal.usvisawithargishti.com) through Paynet's hosted checkout.
-- Additive only: three new tables. Nothing existing is changed.

-- What a client owes, set by the owner in the Desk. This is the ONLY source of the amount charged:
-- the portal never sends an amount, it only asks to pay the open request of the signed-in client.
CREATE TABLE payment_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id          uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  case_id            uuid REFERENCES client_cases(id) ON DELETE SET NULL,
  amount_amd         integer NOT NULL CHECK (amount_amd BETWEEN 100 AND 10000000),
  description        text NOT NULL,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled','refunded')),
  wix_application_id text,                       -- the portal application it was paid from (set on the first attempt)
  paid_payment_id    uuid,
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- One open request per client, so the portal never has to guess which one to pay.
CREATE UNIQUE INDEX payment_requests_one_open ON payment_requests (client_id) WHERE status = 'open';
CREATE INDEX payment_requests_client_idx ON payment_requests (client_id, created_at DESC);

-- Every checkout attempt. A row is the attempt; Paynet's order_id is "<portal application id>-<attempt code>".
CREATE TABLE online_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  request_id          uuid NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  wix_application_id  text NOT NULL,
  wix_member_id       text NOT NULL,
  provider            text NOT NULL DEFAULT 'paynet',
  order_id            text NOT NULL UNIQUE,
  idempotency_key     text NOT NULL UNIQUE,
  amount_amd          integer NOT NULL,
  currency            text NOT NULL DEFAULT 'AMD',
  status              text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','pending','processing','completed','failed','expired','refunded','error')),
  provider_payment_id text,                       -- Paynet's payment uuid
  checkout_url        text,
  failure_code        text,
  livemode            boolean,
  rrn                 text,                       -- bank reference, when Paynet reports one
  duplicate           boolean NOT NULL DEFAULT false, -- completed after the request was already settled: refund it in Paynet
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  verified_at         timestamptz,                -- last time the status was read back from Paynet's API
  completed_at        timestamptz
);
-- At most one unfinished attempt per request: repeated clicks reuse it instead of opening a second checkout.
CREATE UNIQUE INDEX online_payments_one_active ON online_payments (request_id) WHERE status IN ('creating','pending','processing');
CREATE INDEX online_payments_client_idx ON online_payments (client_id, created_at DESC);
CREATE INDEX online_payments_application_idx ON online_payments (wix_application_id, created_at DESC);

-- Webhook deliveries already handled, keyed by Paynet's delivery_id, so a retried or repeated delivery is processed once.
CREATE TABLE paynet_webhook_deliveries (
  delivery_id   text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event         text,
  order_id      text,
  outcome       text NOT NULL DEFAULT 'received' CHECK (outcome IN ('received','processed','ignored','failed')),
  attempts      integer NOT NULL DEFAULT 1,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_requests','online_payments','paynet_webhook_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      $p$CREATE POLICY %I ON %I
         USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')
         WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')$p$,
      t || '_isolation', t);
  END LOOP;
END $$;
