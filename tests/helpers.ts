import { runMigrations } from "@/lib/db/migrate";
import { withSystem, withUser, closeDriver, type Q } from "@/lib/db";

export async function freshDb() {
  await closeDriver();
  if (process.env.TEST_DATABASE_URL) {
    // Real PostgreSQL: wipe the schema so every test file starts from nothing.
    const { getDriver } = await import("@/lib/db");
    await (await getDriver()).exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
  }
  await runMigrations();
}

export async function makeUser(email = "owner@example.com", name = "Owner") {
  return withSystem(async (q) => {
    const [u] = await q.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, 'x') RETURNING id",
      [email, name],
    );
    await q.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [u.id]);
    return u.id;
  });
}

export { withUser, withSystem, closeDriver };
export type { Q };
