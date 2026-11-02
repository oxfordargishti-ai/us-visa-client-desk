#!/usr/bin/env bash
# End-to-end browser tests (Playwright) against the REAL app, with local stand-ins for Anthropic and Google.
#
#   tests/e2e/run.sh dev      # built-in local Postgres (PGlite); wipes .data/ and storage-local/
#   tests/e2e/run.sh prod     # production build + a real PostgreSQL server you provide:
#                             #   E2E_DATABASE_URL=postgresql://... E2E_RESET_DB=yes tests/e2e/run.sh prod
#                             #   (E2E_RESET_DB=yes DROPS the public schema of that database — use a throwaway DB!)
#                             #   Optional: E2E_APP_DATABASE_URL=postgresql://uva_app:uva-test-pass@host/db  → app runs as a non-superuser, RLS enforced
#
# Needs: Node 20+, `npm install`, and Playwright with Chromium (npx playwright install chromium).
set -euo pipefail
cd "$(dirname "$0")/../.."
MODE="${1:-dev}"
OUT="${E2E_OUT:-e2e-output}"; mkdir -p "$OUT/shots"
export MOCK_LOG="$PWD/$OUT/mock-log.json" SHOTS="$PWD/$OUT/shots"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

KEYS=$(npx tsx scripts/generate-vapid.ts)
eval "$(echo "$KEYS" | grep -E '^(NEXT_PUBLIC_VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|ENCRYPTION_KEY)=' | sed 's/^/export /')"

node tests/e2e/mocks.cjs & PIDS+=($!)
sleep 1

export ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://127.0.0.1:4010
export GOOGLE_CLIENT_ID=cid GOOGLE_CLIENT_SECRET=csec GOOGLE_TEST_ORIGIN=http://127.0.0.1:4010 GOOGLE_LOGIN_ENABLED=true
export APP_URL=http://localhost:3000 CRON_SECRET=dev-cron-secret-123456 GMAIL_ACCOUNT=info@usvisawithargishti.com
export TWILIO_ACCOUNT_SID=ACe2e TWILIO_AUTH_TOKEN=e2e-token TWILIO_FROM=+15550001111 TWILIO_API_BASE=http://127.0.0.1:4010
export INTAKE_SECRET=e2e-intake-secret-0123456789abcdef
export OWNER_EMAIL=demo@example.com OWNER_INITIAL_PASSWORD='DemoPass2026!' OWNER_NAME=Argishti
rm -rf storage-local

if [ "$MODE" = "prod" ]; then
  : "${E2E_DATABASE_URL:?set E2E_DATABASE_URL to a THROWAWAY PostgreSQL database}"
  [ "${E2E_RESET_DB:-}" = "yes" ] || { echo "Refusing to continue: set E2E_RESET_DB=yes to allow wiping that database."; exit 1; }
  export DATABASE_URL="$E2E_DATABASE_URL"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;"
  [ -f .next/BUILD_ID ] || NODE_ENV=production npx next build
  npm run --silent db:migrate
  NODE_ENV=development npx tsx scripts/seed-demo.ts >/dev/null
  export ALLOW_LOCAL_STORAGE_IN_PRODUCTION=1
  if [ -n "${E2E_APP_DATABASE_URL:-}" ]; then
    # Run the app as the least-privilege role so row-level security is really enforced (see scripts/sql/app-role.sql).
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -v app_password="'${E2E_APP_ROLE_PASSWORD:-uva-test-pass}'" -f scripts/sql/app-role.sql
    export DATABASE_URL="$E2E_APP_DATABASE_URL"
    echo "Running the app as the restricted role (RLS enforced)"
  fi
  NODE_ENV=production npx next start -p 3000 > "$OUT/server.log" 2>&1 & PIDS+=($!)
else
  rm -rf .data .next/dev/lock
  NODE_ENV=development npx tsx scripts/seed-demo.ts >/dev/null
  NODE_ENV=development npx next dev -p 3000 > "$OUT/server.log" 2>&1 & PIDS+=($!)
fi
for i in $(seq 1 60); do curl -fs -o /dev/null http://localhost:3000/login && break; sleep 1; done
curl -s -o /dev/null http://localhost:3000/dashboard || true

node tests/e2e/e2e.cjs
node tests/e2e/e2e-mobile.cjs
node tests/e2e/e2e-new.cjs
echo "Screenshots: $SHOTS"
