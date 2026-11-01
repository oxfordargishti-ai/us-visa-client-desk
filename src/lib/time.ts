import { DateTime } from "luxon";
import type { Recurrence } from "./constants";
import { REMINDER_PRESETS } from "./constants";

export const DEFAULT_TZ = "Asia/Yerevan";

export function isValidTz(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

/** "2026-11-02" + "15:00" in Asia/Yerevan → UTC ISO string. Returns null for impossible dates/times. */
export function zonedToUtcISO(date: string, time: string, tz = DEFAULT_TZ): string | null {
  const dt = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", { zone: tz });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

export function utcToZonedParts(iso: string, tz = DEFAULT_TZ) {
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(tz);
  return { date: dt.toFormat("yyyy-MM-dd"), time: dt.toFormat("HH:mm"), weekday: dt.weekdayLong ?? "", iso: dt.toISO() ?? iso };
}

export function formatInTz(iso: string | null | undefined, tz = DEFAULT_TZ, fmt = "EEE d MMM, HH:mm"): string {
  if (!iso) return "—";
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(tz);
  return dt.isValid ? dt.toFormat(fmt) : "—";
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** UTC instants bounding "today" (or the day containing `ref`) in the user's timezone. */
export function dayBoundsUtc(tz = DEFAULT_TZ, ref: Date | string = new Date()) {
  const dt = (typeof ref === "string" ? DateTime.fromISO(ref, { zone: "utc" }) : DateTime.fromJSDate(ref)).setZone(tz);
  return { start: dt.startOf("day").toUTC().toISO()!, end: dt.endOf("day").toUTC().toISO()!, date: dt.toFormat("yyyy-MM-dd") };
}

export function addDaysUtc(iso: string, days: number, tz = DEFAULT_TZ): string {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).plus({ days }).toUTC().toISO()!;
}

export function reminderLabel(minutes: number | null): string {
  if (minutes === null) return "Custom time";
  const preset = REMINDER_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes / 10080 > 1 ? "s" : ""} before`;
  if (minutes % 1440 === 0) return `${minutes / 1440} days before`;
  if (minutes % 60 === 0) return `${minutes / 60} hours before`;
  return `${minutes} minutes before`;
}

export interface PlannedReminder {
  offset_minutes: number;
  remind_at: string;
  label: string;
  in_past: boolean;
}

/** Turns "5 hours before" style offsets into concrete UTC instants. De-duplicates identical offsets. */
export function planReminders(dueIso: string, offsets: number[], now: Date = new Date()): PlannedReminder[] {
  const due = DateTime.fromISO(dueIso, { zone: "utc" });
  const seen = new Set<number>();
  const out: PlannedReminder[] = [];
  for (const m of offsets) {
    if (!Number.isFinite(m) || m < 0 || m > 60 * 24 * 90 || seen.has(m)) continue;
    seen.add(m);
    const at = due.minus({ minutes: m });
    out.push({ offset_minutes: m, remind_at: at.toUTC().toISO()!, label: reminderLabel(m), in_past: at.toMillis() <= now.getTime() });
  }
  return out.sort((a, b) => a.remind_at.localeCompare(b.remind_at));
}

/** Next occurrence of a recurring task, preserving the local wall-clock time across DST changes. */
export function nextOccurrence(dueIso: string, recurrence: Recurrence, tz = DEFAULT_TZ): string {
  const dt = DateTime.fromISO(dueIso, { zone: "utc" }).setZone(tz);
  let next = dt;
  switch (recurrence) {
    case "daily":
      next = dt.plus({ days: 1 });
      break;
    case "weekly":
      next = dt.plus({ weeks: 1 });
      break;
    case "monthly":
      next = dt.plus({ months: 1 });
      break;
    case "weekdays": {
      next = dt.plus({ days: 1 });
      while (next.weekday > 5) next = next.plus({ days: 1 });
      break;
    }
  }
  return next.toUTC().toISO()!;
}

export function humanCountdown(targetIso: string, now: Date = new Date()) {
  const ms = new Date(targetIso).getTime() - now.getTime();
  const past = ms < 0;
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  return { past, days, hours, minutes, totalMs: ms };
}

/** Preset targets for one-click rescheduling (all evaluated in the user's timezone). */
export function reschedulePresets(tz = DEFAULT_TZ, now: Date = new Date()) {
  const n = DateTime.fromJSDate(now).setZone(tz);
  const tomorrow9 = n.plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  let monday = n.plus({ days: 1 });
  while (monday.weekday !== 1) monday = monday.plus({ days: 1 });
  monday = monday.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  return [
    { key: "plus1h", label: "In 1 hour", iso: n.plus({ hours: 1 }).startOf("minute").toUTC().toISO()! },
    { key: "tonight", label: "Tonight 18:00", iso: n.set({ hour: 18, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO()! },
    { key: "tomorrow", label: "Tomorrow 09:00", iso: tomorrow9.toUTC().toISO()! },
    { key: "monday", label: "Next Monday 09:00", iso: monday.toUTC().toISO()! },
  ];
}
