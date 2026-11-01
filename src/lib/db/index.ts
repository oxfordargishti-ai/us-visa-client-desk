import path from "node:path";
import { env } from "../env";

// One tiny abstraction over two drivers that speak the SAME SQL:
//   • node-postgres  → production (DATABASE_URL: Neon, Supabase, Vercel Postgres, RDS, …)
//   • PGlite         → real Postgres compiled to WASM; used for local development without a server and in the automated tests.
// Every request runs inside a transaction that sets app.user_id so row-level security can protect each row.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export interface Q {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface Driver {
  kind: "pg" | "pglite";
  /** `init` is a parameter-free statement sent together with BEGIN in one round trip (saves a network hop per request). */
  transaction<T>(fn: (q: Q) => Promise<T>, init?: string): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  /**
   * Optional fast path for a single read: BEGIN, the security context, the query and COMMIT travel in ONE network round trip.
   * Returns undefined when the parameters can't be inlined safely; the caller then uses a normal transaction.
   */
  readOnce?<T>(init: string, sql: string, params?: unknown[]): Promise<T[] | undefined>;
}

/** "2026-11-01 10:00:00.123+00" → "2026-11-01T10:00:00.123Z" so every timestamp reaches the app as an ISO string. */
export function parseTimestamptz(v: string): string {
  let s = v.trim().replace(" ", "T");
  if (/[+-]\d\d$/.test(s)) s += ":00";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}


/** Queries issued concurrently (Promise.all) inside one transaction are queued so they run one at a time, in order. */
function serialize(run: (sql: string, params?: unknown[]) => Promise<Row[]>): Q {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    query<T = Row>(sql: string, params?: unknown[]) {
      const next = chain.then(() => run(sql, params));
      chain = next.catch(() => undefined);
      return next as Promise<T[]>;
    },
  };
}

const g = globalThis as unknown as { __uvaDriver?: Promise<Driver> };

async function createPgDriver(url: string): Promise<Driver> {
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(1184, parseTimestamptz); // timestamptz
  pg.types.setTypeParser(1082, (v: string) => v); // date → "YYYY-MM-DD"
  pg.types.setTypeParser(20, (v: string) => Number(v)); // int8
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 20_000 });
  return {
    kind: "pg",
    async transaction(fn, init) {
      const client = await pool.connect();
      try {
        await client.query(init ? `BEGIN;${init}` : "BEGIN");
        const result = await fn(serialize(async (sql, params) => (await client.query(sql, params as unknown[])).rows));
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      const client = await pool.connect();
      try {
        await client.query(sql);
      } finally {
        client.release();
      }
    },
    async readOnce(init, sql, params = []) {
      const client = await pool.connect();
      try {
        const lit = (v: unknown): string | null => {
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
          if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
          if (typeof v === "string") return client.escapeLiteral(v);
          if (v instanceof Date) return client.escapeLiteral(v.toISOString());
          return null; // arrays / objects → use the normal parameterised path
        };
        const values = params.map(lit);
        if (values.some((v) => v === null)) return undefined;
        const inlined = sql.replace(/\$(\d+)/g, (_, n: string) => values[Number(n) - 1] as string);
        try {
          const res = (await client.query(`BEGIN;${init};${inlined};COMMIT`)) as unknown as { rows: Row[] }[];
          return res[2].rows as never;
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          throw e;
        }
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPgliteDriver(dir: string): Promise<Driver> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  if (dir) (await import("node:fs")).mkdirSync(dir, { recursive: true }); // PGlite needs the parent folder to exist
  const db = new PGlite(dir || undefined);
  await db.waitReady;
  // PGlite applies custom parsers per query (not per instance), so we pass them on every call.
  const options = {
    parsers: {
      [types.TIMESTAMPTZ]: parseTimestamptz,
      [types.DATE]: (v: string) => v,
      [types.INT8]: (v: string) => Number(v),
    },
  };
  return {
    kind: "pglite",
    transaction: (fn, init) =>
      db.transaction(async (tx) => {
        if (init) await tx.exec(init);
        return fn(serialize(async (sql, params) => (await tx.query(sql, params as unknown[], options)).rows as Row[]));
      }),
    async exec(sql) {
      await db.exec(sql);
    },
    close: () => db.close(),
  };
}

export function getDriver(): Promise<Driver> {
  if (!g.__uvaDriver) {
    if (env.databaseUrl) {
      g.__uvaDriver = createPgDriver(env.databaseUrl);
    } else if (env.isProd) {
      throw new Error("DATABASE_URL is required in production");
    } else {
      const dir = process.env.NODE_ENV === "test" ? env.pgliteDir : env.pgliteDir || path.resolve(process.cwd(), ".data/pglite");
      g.__uvaDriver = createPgliteDriver(dir);
    }
  }
  return g.__uvaDriver;
}

export async function closeDriver() {
  if (g.__uvaDriver) {
    const d = await g.__uvaDriver;
    await d.close();
    g.__uvaDriver = undefined;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs several independent read-only pieces of work for one user at the same time, each in its own transaction on its own
 * connection. With a remote database this turns N sequential network round trips into roughly one.
 */
export async function withUserParallel<T extends readonly unknown[]>(userId: string, fns: { [K in keyof T]: (q: Q) => Promise<T[K]> }): Promise<T> {
  return Promise.all(fns.map((fn) => withUser(userId, fn as (q: Q) => Promise<unknown>))) as unknown as Promise<T>;
}

/** A read-only query handle where every query runs in its own transaction, so `Promise.all` over it really runs in parallel. */
export function parallelReader(userId: string): Q {
  return { query: (sql, params) => readAsUser(userId, sql, params) };
}

/** One read-only statement as a user, in a single network round trip when possible. */
export async function readAsUser<T = Row>(userId: string, sql: string, params?: unknown[]): Promise<T[]> {
  if (!UUID.test(userId)) throw new Error("readAsUser: invalid user id");
  const d = await getDriver();
  const fast = d.readOnce ? await d.readOnce<T>(`SELECT set_config('app.user_id', '${userId}', true)`, sql, params) : undefined;
  return fast ?? withUser(userId, (q) => q.query<T>(sql, params));
}

/** One read-only statement as the system (bypasses row-level security), in a single round trip when possible. */
export async function readAsSystem<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  const d = await getDriver();
  const fast = d.readOnce ? await d.readOnce<T>("SELECT set_config('app.bypass_rls', 'on', true)", sql, params) : undefined;
  return fast ?? withSystem((q) => q.query<T>(sql, params));
}

/** Run `fn` as a signed-in user. Row-level security restricts every statement to that user's rows. */
export async function withUser<T>(userId: string, fn: (q: Q) => Promise<T>): Promise<T> {
  const d = await getDriver();
  // The id is inlined (so it can travel with BEGIN in one round trip), therefore it must be a well-formed UUID.
  if (!UUID.test(userId)) throw new Error("withUser: invalid user id");
  return d.transaction(fn, `SELECT set_config('app.user_id', '${userId}', true)`);
}

/** Run `fn` as the system (cron dispatcher, session lookup, login). Bypasses row-level security — use sparingly. */
export async function withSystem<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const d = await getDriver();
  return d.transaction(fn, "SELECT set_config('app.bypass_rls', 'on', true)");
}

export async function one<T = Row>(q: Q, sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await q.query<T>(sql, params);
  return rows[0] ?? null;
}
