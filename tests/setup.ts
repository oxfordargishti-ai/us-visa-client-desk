import { vi } from "vitest";
import crypto from "node:crypto";

vi.stubEnv("NODE_ENV", "test");
vi.stubEnv("ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
vi.stubEnv("CRON_SECRET", "test-cron-secret-0123456789");
vi.stubEnv("APP_URL", "http://localhost:3000");
// Default: in-memory PGlite (a real Postgres engine compiled to WASM). Set TEST_DATABASE_URL to run the identical suite on a real PostgreSQL server via node-postgres.
vi.stubEnv("DATABASE_URL", process.env.TEST_DATABASE_URL ?? "");
vi.stubEnv("PGLITE_DIR", ""); // in-memory Postgres per test file
vi.stubEnv("STORAGE_DRIVER", "local");
vi.stubEnv("STORAGE_LOCAL_DIR", `/tmp/uva-test-storage-${process.pid}`);
