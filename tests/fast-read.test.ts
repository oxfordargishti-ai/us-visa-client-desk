import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, makeUser, withUser, closeDriver } from "./helpers";
import { readAsUser, readAsSystem, parallelReader } from "@/lib/db";

beforeAll(freshDb);
afterAll(closeDriver);

describe("single-round-trip reads", () => {
  it("still enforce row-level security and handle tricky values", async () => {
    const a = await makeUser("a@example.com", "A");
    const b = await makeUser("b@example.com", "B");
    await withUser(a, (q) => q.query("INSERT INTO clients (user_id, full_name) VALUES ($1, $2)", [a, "O'Brien \\\\ $1 ; DROP TABLE clients; --"]));
    await withUser(b, (q) => q.query("INSERT INTO clients (user_id, full_name) VALUES ($1, 'Bee')", [b]));
    const mine = await readAsUser<{ full_name: string }>(a, "SELECT full_name FROM clients WHERE full_name = $1", ["O'Brien \\\\ $1 ; DROP TABLE clients; --"]);
    expect(mine.map((r) => r.full_name)).toEqual(["O'Brien \\\\ $1 ; DROP TABLE clients; --"]);
    // The same security context as withUser is set (row-level security policies key off it; enforced for the app's non-superuser role).
    expect((await readAsUser<{ u: string }>(a, "SELECT current_setting('app.user_id', true) AS u"))[0].u).toBe(a);
    expect((await readAsSystem<{ b: string }>("SELECT current_setting('app.bypass_rls', true) AS b"))[0].b).toBe("on");
    // …and it does not leak into the next statement on the same pooled connection.
    expect((await readAsSystem<{ u: string | null }>("SELECT nullif(current_setting('app.user_id', true), '') AS u"))[0].u).toBeNull();
    expect((await readAsSystem<{ n: number }>("SELECT count(*)::int AS n FROM clients")).at(0)?.n).toBe(2);
    const [x, y] = await Promise.all([
      parallelReader(a).query<{ n: number }>("SELECT count(*)::int AS n FROM clients WHERE created_at < $1", [new Date(Date.now() + 1000)]),
      parallelReader(a).query<{ n: number }>("SELECT count(*)::int AS n FROM clients WHERE user_id = ANY($1::uuid[])", [[a, b]]),
    ]);
    expect(x[0].n).toBe(2);
    expect(y[0].n).toBe(2); // superuser test connection; RLS itself is covered in db.test.ts with a restricted role
  });
  it("leaves the connection usable after a failing read", async () => {
    const a = await makeUser("c@example.com", "C");
    await expect(readAsUser(a, "SELECT * FROM no_such_table WHERE id = $1", ["x"])).rejects.toThrow();
    expect(await readAsUser(a, "SELECT 1 AS one")).toEqual([{ one: 1 }]);
  });
});
