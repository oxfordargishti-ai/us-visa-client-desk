import "./_env";
import { runMigrations, tableCount } from "../src/lib/db/migrate";
import { closeDriver } from "../src/lib/db";
import { bootstrapOwner } from "../src/lib/db/bootstrap";
import { env } from "../src/lib/env";

async function main() {
  const applied = await runMigrations();
  console.log(applied.length ? `✔ Applied migrations: ${applied.join(", ")}` : "✔ Database is already up to date");
  console.log(`  ${await tableCount()} tables present.`);

  const result = await bootstrapOwner();
  if (result === "created") {
    console.log(`✔ Created the owner account for ${env.ownerEmail}. Sign in, then change the password in Settings.`);
    console.log("  You can now delete OWNER_INITIAL_PASSWORD from your environment variables.");
  } else if (result === "skipped") {
    console.log("ℹ No users yet. Set OWNER_EMAIL and OWNER_INITIAL_PASSWORD and run this again to create the owner account.");
  }
  await closeDriver();
}

main().catch((e) => {
  console.error("✘", e.message);
  process.exit(1);
});
