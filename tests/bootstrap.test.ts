import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { freshDb, withSystem, closeDriver } from "./helpers";
import { bootstrapOwner } from "@/lib/db/bootstrap";
import { runMigrations } from "@/lib/db/migrate";
import { authenticate } from "@/lib/auth";

beforeAll(freshDb);
afterAll(closeDriver);
afterEach(() => {
  delete process.env.OWNER_EMAIL;
  delete process.env.OWNER_INITIAL_PASSWORD;
  delete process.env.OWNER_NAME;
});

const users = () => withSystem((q) => q.query<{ email: string; role: string }>("SELECT email, role FROM users"));

describe("startup owner bootstrap", () => {
  it("does nothing (and does not crash) when no owner variables are set", async () => {
    expect(await bootstrapOwner()).toBe("skipped");
    expect(await users()).toHaveLength(0);
  });

  it("refuses a weak initial password instead of creating an insecure account", async () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    process.env.OWNER_INITIAL_PASSWORD = "short";
    await expect(bootstrapOwner()).rejects.toThrow(/OWNER_INITIAL_PASSWORD/);
    expect(await users()).toHaveLength(0);
  });

  it("creates the owner once, who can then sign in", async () => {
    process.env.OWNER_EMAIL = "Owner@Example.com";
    process.env.OWNER_INITIAL_PASSWORD = "StrongStart2026";
    process.env.OWNER_NAME = "Argishti";
    expect(await bootstrapOwner()).toBe("created");
    const rows = await users();
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("owner");
    expect((await authenticate("owner@example.com", "StrongStart2026", "test")).ok).toBe(true);
    expect((await authenticate("owner@example.com", "WrongPassword1", "test")).ok).toBe(false);
  });

  it("never overwrites or adds accounts once a user exists, even if the variables change", async () => {
    process.env.OWNER_EMAIL = "someone-else@example.com";
    process.env.OWNER_INITIAL_PASSWORD = "AnotherStrong2026";
    expect(await bootstrapOwner()).toBe("exists");
    expect(await users()).toHaveLength(1);
  });
});

describe("bundled migrations", () => {
  it("are embedded in the build and re-running them is a no-op", async () => {
    const { EMBEDDED_MIGRATIONS } = await import("@/lib/db/migrations.generated");
    expect(EMBEDDED_MIGRATIONS.length).toBeGreaterThanOrEqual(2);
    expect(await runMigrations()).toEqual([]);
  });
});
