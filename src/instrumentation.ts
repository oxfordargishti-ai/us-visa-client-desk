// Runs once when the server starts.
// • Local development (no DATABASE_URL): the built-in database is migrated automatically so `npm run dev` just works.
// • Production: set AUTO_MIGRATE=true to apply pending migrations at boot and create the owner account from
//   OWNER_EMAIL / OWNER_INITIAL_PASSWORD when no account exists yet (so no terminal is needed). Or run `npm run db:migrate` yourself.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const local = !(await import("./lib/env")).env.databaseUrl && process.env.NODE_ENV !== "production";
  if (local || process.env.AUTO_MIGRATE === "true") {
    try {
      const { runMigrations } = await import("./lib/db/migrate");
      const applied = await runMigrations();
      if (applied.length) console.log(`[db] applied migrations: ${applied.join(", ")}`);
      const { bootstrapOwner } = await import("./lib/db/bootstrap");
      const r = await bootstrapOwner();
      if (r === "created") console.log("[db] owner account created from OWNER_EMAIL — sign in and change the password in Settings");
    } catch (e) {
      console.error("[db] startup setup failed:", (e as Error).message);
    }
  }
}
