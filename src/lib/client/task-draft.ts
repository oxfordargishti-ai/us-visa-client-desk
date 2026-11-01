import { DateTime } from "luxon";
import type { Recurrence, TaskCategory, Priority } from "@/lib/constants";
import { zonedToUtcISO, utcToZonedParts } from "@/lib/time";
import type { Task } from "@/lib/types";

export interface Draft {
  title: string;
  description: string;
  category: TaskCategory;
  priority: Priority;
  client_id: string | null;
  date: string; // yyyy-MM-dd (local)
  time: string; // HH:mm (local)
  noDate: boolean;
  duration: number;
  recurrence: Recurrence | "";
  recurrence_until: string;
  reminder_offsets: number[];
}

export const emptyDraft = (reminders: number[] = [15]): Draft => ({
  title: "",
  description: "",
  category: "Administrative Work",
  priority: "Normal",
  client_id: null,
  date: "",
  time: "",
  noDate: false,
  duration: 30,
  recurrence: "",
  recurrence_until: "",
  reminder_offsets: reminders,
});

export function draftFromTask(t: Task, tz: string): Draft {
  const p = t.due_at ? utcToZonedParts(t.due_at, tz) : null;
  return {
    title: t.title,
    description: t.description ?? "",
    category: t.category,
    priority: t.priority,
    client_id: t.client_id,
    date: p?.date ?? "",
    time: p?.time ?? "",
    noDate: !t.due_at,
    duration: t.duration_minutes,
    recurrence: t.recurrence ?? "",
    recurrence_until: t.recurrence_until ?? "",
    reminder_offsets: t.reminder_offsets,
  };
}

export function draftDue(d: Draft, tz: string): string | null {
  return !d.noDate && d.date && d.time ? zonedToUtcISO(d.date, d.time, tz) : null;
}

export function draftProblems(d: Draft, tz: string): string[] {
  const out: string[] = [];
  if (!d.title.trim()) out.push("Give the task a title.");
  if (!d.noDate) {
    if (!d.date) out.push("Choose a date, or tick “No due date”.");
    else if (!d.time) out.push("Choose a time, or tick “No due date”.");
    else if (!draftDue(d, tz)) out.push("That date and time don't exist in your timezone.");
  }
  if (d.recurrence && d.noDate) out.push("Repeating tasks need a date and time.");
  return out;
}

export function draftToPayload(d: Draft, tz: string) {
  const due = draftDue(d, tz);
  return {
    title: d.title.trim(),
    description: d.description.trim() || null,
    category: d.category,
    priority: d.priority,
    client_id: d.client_id,
    due_at: due,
    duration_minutes: d.duration,
    recurrence: d.recurrence || null,
    recurrence_until: d.recurrence && d.recurrence_until ? d.recurrence_until : null,
    reminder_offsets: due ? d.reminder_offsets : [],
  };
}

export function quickDates(tz: string, now = new Date()) {
  const n = DateTime.fromJSDate(now).setZone(tz);
  let monday = n.plus({ days: 1 });
  while (monday.weekday !== 1) monday = monday.plus({ days: 1 });
  return [
    { label: "Today", date: n.toFormat("yyyy-MM-dd") },
    { label: "Tomorrow", date: n.plus({ days: 1 }).toFormat("yyyy-MM-dd") },
    { label: "Next Monday", date: monday.toFormat("yyyy-MM-dd") },
  ];
}
