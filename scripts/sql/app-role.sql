-- Least-privilege database role for the running app (recommended for production).
--
-- Why: PostgreSQL row-level security (RLS) is ignored by superusers and by roles with BYPASSRLS — which is what many hosted
-- databases hand you by default. Running the app as this role makes the per-user RLS policies in 001_init.sql actually enforce.
-- Keep using your admin/owner connection string ONLY for `npm run db:migrate`.
--
-- Usage:  psql "$ADMIN_DATABASE_URL" -v app_password="'a-long-random-password'" -f scripts/sql/app-role.sql
-- Then set the app's DATABASE_URL to:  postgresql://uva_app:<password>@<host>/<db>?sslmode=require
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uva_app') THEN
    CREATE ROLE uva_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE uva_app PASSWORD :app_password;
GRANT USAGE ON SCHEMA public TO uva_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uva_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uva_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uva_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO uva_app;
