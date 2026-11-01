import { describe, it, expect } from "vitest";
import { dayBoundsUtc, nextOccurrence, planReminders, reminderLabel, zonedToUtcISO, utcToZonedParts, reschedulePresets, isValidTz } from "@/lib/time";

describe("timezone handling (Asia/Yerevan = UTC+4)", () => {
  it("converts local wall-clock time to UTC", () => {
    expect(zonedToUtcISO("2026-11-02", "15:00", "Asia/Yerevan")).toBe("2026-11-02T11:00:00.000Z");
  });
  it("rejects impossible dates", () => {
    expect(zonedToUtcISO("2026-02-30", "10:00")).toBeNull();
    expect(zonedToUtcISO("2026-11-02", "25:00")).toBeNull();
  });
  it("round-trips back to local parts", () => {
    expect(utcToZonedParts("2026-11-02T11:00:00.000Z")).toMatchObject({ date: "2026-11-02", time: "15:00" });
  });
  it("finds today's UTC bounds for a user near midnight", () => {
    // 22:30 UTC on 1 Nov is already 02:30 on 2 Nov in Yerevan.
    const b = dayBoundsUtc("Asia/Yerevan", new Date("2026-11-01T22:30:00Z"));
    expect(b.date).toBe("2026-11-02");
    expect(b.start).toBe("2026-11-01T20:00:00.000Z");
  });
  it("validates timezone names", () => {
    expect(isValidTz("Asia/Yerevan")).toBe(true);
    expect(isValidTz("Mars/Olympus")).toBe(false);
  });
});

describe("reminder planning", () => {
  const due = "2026-11-03T11:00:00.000Z"; // 15:00 Yerevan
  const now = new Date("2026-11-02T08:00:00Z");
  it("computes 5 hours before", () => {
    const [r] = planReminders(due, [300], now);
    expect(r.remind_at).toBe("2026-11-03T06:00:00.000Z");
    expect(r.label).toBe("5 hours before");
    expect(r.in_past).toBe(false);
  });
  it("computes 1 day, 2 days and 1 week before", () => {
    const r = planReminders(due, [1440, 2880, 10080], now);
    expect(r.map((x) => x.remind_at)).toEqual(["2026-10-27T11:00:00.000Z", "2026-11-01T11:00:00.000Z", "2026-11-02T11:00:00.000Z"]);
  });
  it("flags reminders that are already in the past and de-duplicates offsets", () => {
    const r = planReminders("2026-11-02T09:00:00.000Z", [300, 300, 15], now);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.offset_minutes === 300)!.in_past).toBe(true);
    expect(r.find((x) => x.offset_minutes === 15)!.in_past).toBe(false);
  });
  it("labels custom offsets sensibly", () => {
    expect(reminderLabel(0)).toBe("At task time");
    expect(reminderLabel(90)).toBe("90 minutes before");
    expect(reminderLabel(180)).toBe("3 hours before");
    expect(reminderLabel(null)).toBe("Custom time");
  });
});

describe("recurrence", () => {
  it("daily / weekly / monthly keep the local time", () => {
    expect(nextOccurrence("2026-11-02T11:00:00.000Z", "daily")).toBe("2026-11-03T11:00:00.000Z");
    expect(nextOccurrence("2026-11-02T11:00:00.000Z", "weekly")).toBe("2026-11-09T11:00:00.000Z");
    expect(nextOccurrence("2026-11-02T11:00:00.000Z", "monthly")).toBe("2026-12-02T11:00:00.000Z");
  });
  it("weekdays skips the weekend", () => {
    // Friday 6 Nov 2026 → Monday 9 Nov
    expect(nextOccurrence("2026-11-06T11:00:00.000Z", "weekdays")).toBe("2026-11-09T11:00:00.000Z");
  });
  it("keeps wall-clock time across a DST change in a DST zone", () => {
    // 09:00 New York on Sat 31 Oct 2026 (EDT, UTC-4) → daily → Sun 1 Nov 09:00 (EST, UTC-5 after the clocks go back)
    const next = nextOccurrence("2026-10-31T13:00:00.000Z", "daily", "America/New_York");
    expect(next).toBe("2026-11-01T14:00:00.000Z");
  });
});

describe("reschedule presets", () => {
  it("offers sensible one-tap targets", () => {
    const p = reschedulePresets("Asia/Yerevan", new Date("2026-11-01T06:00:00Z")); // Sunday 10:00 Yerevan
    expect(p.find((x) => x.key === "tomorrow")!.iso).toBe("2026-11-02T05:00:00.000Z");
    expect(p.find((x) => x.key === "monday")!.iso).toBe("2026-11-02T05:00:00.000Z");
  });
});
