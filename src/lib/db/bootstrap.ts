import { withSystem } from "./index";
import { createUser, passwordPolicyError } from "../auth";
import { env } from "../env";

export type BootstrapResult = "created" | "exists" | "skipped";

/**
 * Creates the first (owner) account from OWNER_EMAIL / OWNER_INITIAL_PASSWORD — but only while the users table is empty,
 * so it can never overwrite or add accounts later. Safe to call on every boot.
 */
export async function bootstrapOwner(): Promise<BootstrapResult> {
  const [{ n }] = await withSystem((q) => q.query<{ n: number }>("SELECT count(*)::int AS n FROM users"));
  if (n > 0) return "exists";
  if (!env.ownerEmail || !env.ownerPassword) return "skipped";
  const problem = passwordPolicyError(env.ownerPassword, env.ownerEmail);
  if (problem) throw new Error(`OWNER_INITIAL_PASSWORD rejected: ${problem}`);
  try {
    await createUser({ email: env.ownerEmail, name: env.ownerName, password: env.ownerPassword, role: "owner" });
  } catch (e) {
    // Two servers starting together: the other one won the race (unique email index). That's fine.
    if ((await withSystem((q) => q.query("SELECT 1 FROM users LIMIT 1"))).length) return "exists";
    throw e;
  }
  return "created";
}
