import fs from "node:fs";
import path from "node:path";
import { getDriver, withSystem, readAsSystem } from "./index";
import { EMBEDDED_MIGRATIONS } from "./migrations.generated";

/** Applies every migration exactly once, in filename order. Uses the copies bundled into the build unless a directory is given. */
export async function runMigrations(dir?: string): Promise<string[]> {
  const driver = await getDriver();
  const migrations = dir
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }))
    : EMBEDDED_MIGRATIONS;
  // Fast path for every server start: one read tells us whether anything is pending.
  try {
    const done = new Set((await readAsSystem<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
    if (migrations.every((m) => done.has(m.name))) return [];
  } catch {
    /* table doesn't exist yet — fall through and create it */
  }
  await driver.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied: string[] = [];
  for (const { name, sql } of migrations) {
    const pending = await driver.transaction(async (q) => (await q.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name])).length === 0);
    if (!pending) continue;
    // One simple-protocol multi-statement string = one implicit transaction: either everything (including the
    // schema_migrations row) is applied, or nothing is. A second server booting at the same moment fails harmlessly.
    try {
      await driver.exec(`${sql}\n;INSERT INTO schema_migrations (name) VALUES ('${name.replace(/'/g, "''")}');`);
    } catch (e) {
      const already = await driver.transaction(async (q) => (await q.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name])).length > 0);
      if (already) continue; // someone else applied it first
      throw new Error(`Migration ${name} failed: ${(e as Error).message}`);
    }
    applied.push(name);
  }
  return applied;
}

export async function tableCount(): Promise<number> {
  return withSystem(async (q) => {
    const r = await q.query<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
    return r[0].n;
  });
}
