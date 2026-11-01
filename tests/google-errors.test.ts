import { describe, it, expect } from "vitest";
import { explainGoogle403 } from "@/lib/google";

describe("Google 403 explanations", () => {
  it("spots a Gmail API that is not enabled in the Cloud project", () => {
    const r = explainGoogle403({ error: { status: "PERMISSION_DENIED", message: "Gmail API has not been used in project 1032078327036 before or it is disabled.", details: [{ reason: "SERVICE_DISABLED", metadata: { service: "gmail.googleapis.com" } }] } });
    expect(r.code).toBe("google_api_disabled");
    expect(r.message).toMatch(/enable the Gmail API/);
  });
  it("names the Calendar API when that one is off", () => {
    const r = explainGoogle403({ error: { status: "PERMISSION_DENIED", message: "Google Calendar API has not been used in project 1 before or it is disabled.", details: [{ reason: "SERVICE_DISABLED" }] } });
    expect(r.message).toMatch(/Google Calendar API/);
  });
  it("keeps the re-consent advice for a genuinely missing scope", () => {
    const r = explainGoogle403({ error: { status: "PERMISSION_DENIED", message: "Request had insufficient authentication scopes.", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } });
    expect(r.code).toBe("google_scope");
  });
  it("passes through anything else", () => {
    expect(explainGoogle403({ error: { message: "Something odd" } }).message).toMatch(/Something odd/);
  });
});
