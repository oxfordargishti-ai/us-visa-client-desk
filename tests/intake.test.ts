import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, makeUser, withUser, closeDriver } from "./helpers";
import { contactFromIntake, receiveIntake, IntakeEnvelope } from "@/lib/intake";
import { createClient } from "@/lib/repo/clients";

let owner: string;
beforeAll(async () => {
  await freshDb();
  owner = await makeUser();
});
afterAll(closeDriver);

// Shape similar to the form site's DS-160 data (sections with nested answers).
const sample = {
  id: "sub-001",
  language: "hy",
  data: {
    personal: { firstName: "Arman", lastName: "Simonyan", dateOfBirth: "2003-04-12" },
    family: { fatherName: "Վահե Սիմոնյան", motherName: "Աստղիկ Սիմոնյան", maritalStatus: "Միայնակ" },
    contact: { mobilePhone: "+37498948290", email: "Arman.2003.Simonyan@Example.com", facebook: "Arman Simonyan" },
    travel: { arrivalDate: "2027-01-07", duration: "10 օր" },
  },
};

describe("reading a DS-160 submission", () => {
  it("finds name, email and phone wherever the form puts them", () => {
    const c = contactFromIntake(IntakeEnvelope.parse(sample));
    expect(c).toEqual({ full_name: "Arman Simonyan", email: "arman.2003.simonyan@example.com", phone: "+37498948290", whatsapp: null, language: "hy" });
    expect(contactFromIntake(IntakeEnvelope.parse({ full_name: "Ani P", phone: "098 11 22 33" })).phone).toBe("+37498112233");
    expect(contactFromIntake(IntakeEnvelope.parse({ data: { email: "not-an-email" } })).email).toBeNull();
  });
});

describe("receiving a DS-160", () => {
  it("creates a new client with the answers, a review task and an in-app alert", async () => {
    const r = await receiveIntake(IntakeEnvelope.parse(sample));
    expect(r.matched).toBe("created");
    const [c] = await withUser(owner, (q) => q.query<{ full_name: string; email: string; phone: string; preferred_language: string; source: string }>("SELECT * FROM clients WHERE id=$1", [r.clientId]));
    expect(c).toMatchObject({ full_name: "Arman Simonyan", email: "arman.2003.simonyan@example.com", phone: "+37498948290", preferred_language: "hy", source: "ds160" });
    const tasks = await withUser(owner, (q) => q.query<{ title: string }>("SELECT title FROM tasks WHERE client_id=$1", [r.clientId]));
    expect(tasks.map((t) => t.title)).toContain("Review DS-160 answers — Arman Simonyan");
    const alerts = await withUser(owner, (q) => q.query("SELECT 1 FROM notification_deliveries WHERE user_id=$1 AND title='New client from DS-160'", [owner]));
    expect(alerts).toHaveLength(1);
    const [i] = await withUser(owner, (q) => q.query<{ payload: { family: { fatherName: string } } }>("SELECT payload FROM client_intakes WHERE id=$1", [r.intakeId]));
    expect(i.payload.family.fatherName).toBe("Վահե Սիմոնյան");
  });

  it("ignores the same submission sent twice", async () => {
    const r = await receiveIntake(IntakeEnvelope.parse(sample));
    expect(r.duplicate).toBe(true);
    const n = await withUser(owner, (q) => q.query("SELECT 1 FROM clients WHERE lower(email)='arman.2003.simonyan@example.com'"));
    expect(n).toHaveLength(1);
  });

  it("attaches to an existing client found by phone, without overwriting what the owner typed", async () => {
    const { client } = await withUser(owner, (q) => createClient(q, owner, { full_name: "Karen Sargsyan (VIP)", phone: "+374 99 55 44 33", email: "karen@owner-typed.am" }));
    const r = await receiveIntake(IntakeEnvelope.parse({ id: "sub-002", data: { fullName: "Karen Sargsyan", phone: "099554433", email: "other@example.com" } }));
    expect(r.matched).toBe("updated");
    expect(r.clientId).toBe(client.id);
    const [c] = await withUser(owner, (q) => q.query<{ full_name: string; email: string }>("SELECT full_name, email FROM clients WHERE id=$1", [client.id]));
    expect(c).toEqual({ full_name: "Karen Sargsyan (VIP)", email: "karen@owner-typed.am" });
  });
});

describe("the intake endpoint", () => {
  it("only accepts calls carrying the shared secret", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/intake/ds160/route");
    process.env.INTAKE_SECRET = "intake-secret-0123456789abcdef";
    const call = (auth?: string) =>
      POST(new NextRequest("http://localhost/api/intake/ds160", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ id: "sub-api", data: { fullName: "Lilit Hakobyan", email: "lilit@example.com" } }) }));
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-secret-0123456789abcdef")).status).toBe(401);
    const ok = await call("Bearer intake-secret-0123456789abcdef");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, matched: "created" });
    delete process.env.INTAKE_SECRET;
    expect((await call("Bearer ")).status).toBe(401); // never open when no secret is configured
  });
});
