-- Migration 002: tiny key/value table for system health (e.g. when the reminder scheduler last ran).
-- Not user data, so no row-level security; only the server's system context touches it.
CREATE TABLE system_state (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
