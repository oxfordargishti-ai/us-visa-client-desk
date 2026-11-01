import { NextResponse } from "next/server";
import { env, findDatabaseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Hides anything that could be a secret (connection strings, hostnames with credentials) from error text. */
function clean(msg: string) {
  return msg.replace(/postgres(ql)?:\/\/\S+/gi, "[database address]").replace(/[\w.-]+\.neon\.tech/gi, "[database host]").slice(0, 300);
}

/**
 * Public, read-mostly setup check for a freshly hosted app: shows which setup step is missing, without exposing any data.
 * When AUTO_MIGRATE=true it also (re)runs the idempotent first-start setup, so opening this page can fix a failed first start.
 */
export async function GET() {
  const steps: { step: string; ok: boolean; detail: string }[] = [];
  const add = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail });

  const found = findDatabaseUrl().name;
  const dbVars = found ? [found] : [];
  const related = Object.keys(process.env).filter((k) => /DATABASE|POSTGRES|^PG|NEON/.test(k)).sort();
  add("Database address set", dbVars.length > 0, dbVars.length ? `Found ${found}` : `No database address found — connect a Neon database to this project, then redeploy. Related settings present: ${related.join(", ") || "none"}`);
  add("Encryption key set", env.encryptionKey.length > 0, env.encryptionKey ? "OK" : "ENCRYPTION_KEY is missing");

  if (dbVars.length) {
    try {
      const { withSystem } = await import("@/lib/db");
      await withSystem((q) => q.query("SELECT 1"));
      add("Database reachable", true, "Connected");
      if (process.env.AUTO_MIGRATE === "true") {
        const { runMigrations } = await import("@/lib/db/migrate");
        const applied = await runMigrations();
        add("Tables created", true, applied.length ? `Just applied ${applied.join(", ")}` : "Up to date");
        const { bootstrapOwner } = await import("@/lib/db/bootstrap");
        const r = await bootstrapOwner();
        add("Owner account", r !== "skipped", r === "created" ? "Just created — you can sign in now" : r === "exists" ? "Exists" : "Missing — set OWNER_EMAIL and OWNER_INITIAL_PASSWORD, then redeploy");
      } else {
        add("Automatic setup", false, "AUTO_MIGRATE is not set to true");
      }
    } catch (e) {
      add("Database setup", false, clean(e instanceof Error ? e.message : String(e)));
    }
  }
  const ok = steps.every((s) => s.ok);
  return NextResponse.json({ ok, steps }, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
