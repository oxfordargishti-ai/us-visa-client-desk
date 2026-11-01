import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, makeUser, withUser, closeDriver } from "./helpers";
import { createTask, updateTask, completeTask, reopenTask, snoozeTask, deleteTask, listReminders, listTasks, TaskInput } from "@/lib/repo/tasks";
import { createClient, ClientInput } from "@/lib/repo/clients";
import { listEvents } from "@/lib/repo/calendar";
import { moveEvent } from "@/lib/repo/calendar";

const NOW = new Date("2026-11-02T08:00:00Z"); // Monday 12:00 in Yerevan
let uid: string;
let karen: string;

const input = (o: Record<string, unknown>) => TaskInput.parse({ title: "Call Karen — Visa Interview Preparation", ...o });

beforeAll(async () => {
  await freshDb();
  uid = await makeUser();
  karen = await withUser(uid, async (q) => (await createClient(q, uid, ClientInput.parse({ full_name: "Karen Sargsyan" }))).client.id);
});
afterAll(closeDriver);

describe("acceptance: calendar synchronisation", () => {
  it("an approved task with a due date appears immediately in the calendar", async () => {
    const { task } = await withUser(uid, (q) => createTask(q, uid, input({ due_at: "2026-11-03T11:00:00.000Z", client_id: karen, category: "Interview Preparation" }), NOW));
    const events = await withUser(uid, (q) => listEvents(q, uid, { start: "2026-11-03T00:00:00Z", end: "2026-11-04T00:00:00Z" }));
    const ev = events.find((e) => e.task_id === task.id);
    expect(ev).toBeTruthy();
    expect(ev!.starts_at).toBe("2026-11-03T11:00:00.000Z");
    expect(ev!.ends_at).toBe("2026-11-03T11:30:00.000Z");
    expect(ev!.client_name).toBe("Karen Sargsyan");
    expect(ev!.category).toBe("Interview Preparation");
  });

  it("a task without a date creates no calendar event", async () => {
    const { task } = await withUser(uid, (q) => createTask(q, uid, input({ title: "Someday task" }), NOW));
    const events = await withUser(uid, (q) => listEvents(q, uid, { start: "2020-01-01T00:00:00Z", end: "2040-01-01T00:00:00Z" }));
    expect(events.find((e) => e.task_id === task.id)).toBeUndefined();
  });
});

describe("acceptance: five-hour and one-day reminders", () => {
  it("stores a reminder exactly five hours before the due time", async () => {
    const { task, reminders } = await withUser(uid, (q) => createTask(q, uid, input({ due_at: "2026-11-03T11:00:00.000Z", client_id: karen, reminder_offsets: [300] }), NOW));
    expect(reminders).toHaveLength(1);
    expect(reminders[0].remind_at).toBe("2026-11-03T06:00:00.000Z");
    expect(reminders[0].status).toBe("pending");
    const stored = await withUser(uid, (q) => listReminders(q, uid, task.id));
    expect(stored.map((r) => r.remind_at)).toEqual(["2026-11-03T06:00:00.000Z"]);
  });

  it("calculates and records a one-day-before reminder", async () => {
    const { task } = await withUser(uid, (q) => createTask(q, uid, input({ due_at: "2026-11-05T11:00:00.000Z", reminder_offsets: [1440] }), NOW));
    const [r] = await withUser(uid, (q) => listReminders(q, uid, task.id));
    expect(r.remind_at).toBe("2026-11-04T11:00:00.000Z");
    expect(r.offset_minutes).toBe(1440);
  });

  it("supports several reminders per task and skips ones already in the past (and reports them)", async () => {
    const res = await withUser(uid, (q) => createTask(q, uid, input({ due_at: "2026-11-02T10:00:00.000Z", reminder_offsets: [1440, 300, 30, 0] }), NOW)); // due in 2h
    expect(res.reminders.map((r) => r.offset_minutes).sort((a, b) => a! - b!)).toEqual([0, 30]);
    expect(res.skipped_reminders.map((s) => s.label)).toEqual(expect.arrayContaining(["1 day before", "5 hours before"]));
  });

  it("falls back to the owner's default reminder when none are specified", async () => {
    const { reminders } = await withUser(uid, (q) => createTask(q, uid, input({ due_at: "2026-11-04T11:00:00.000Z" }), NOW));
    expect(reminders.map((r) => r.offset_minutes)).toEqual([15]);
  });
});

describe("acceptance: rescheduling", () => {
  it("cancels old pending reminders and saves a new schedule", async () => {
    const { task } = await withUser(uid, (q) => createTask(q, uid, input({ due_at: "2026-11-03T11:00:00.000Z", reminder_offsets: [300, 1440] }), NOW));
    const before = await withUser(uid, (q) => listReminders(q, uid, task.id));
    expect(before.filter((r) => r.status === "pending")).toHaveLength(2);

    const res = await withUser(uid, (q) => updateTask(q, uid, task.id, { due_at: "2026-11-10T11:00:00.000Z" }, NOW));
    const after = await withUser(uid, (q) => listReminders(q, uid, task.id));
    const pending = after.filter((r) => r.status === "pending").map((r) => r.remind_at).sort();
    expect(pending).toEqual(["2026-11-09T11:00:00.000Z", "2026-11-10T06:00:00.000Z"]);
    expect(after.filter((r) => r.status === "canceled")).toHaveLength(2);
    expect(res.task.due_at).toBe("2026-11-10T11:00:00.000Z");

    const events = await withUser(uid, (q) => listEvents(q, uid, { start: "2026-11-10T00:00:00Z", end: "2026-11-11T00:00:00Z" }));
    expect(events.some((e) => e.task_id === task.id)).toBe(true);
    const old = await withUser(uid, (q) => listEvents(q, uid, { start: "2026-11-03T00:00:00Z", end: "2026-11-04T00:00:00Z" }));
    expect(old.some((e) => e.task_id === task.id)).toBe(false);
  });

  it("drag-and-drop on the calendar reschedules the task and its reminders", async () => {
    const { task } = await withUser(uid, (q) => createTask(q, uid, input({ title: "Drag me", due_at: "2026-11-04T11:00:00.000Z", reminder_offsets: [60] }), NOW));
    const [ev] = (await withUser(uid, (q) => listEvents(q, uid, { start: "2026-11-04T00:00:00Z", end: "2026-11-05T00:00:00Z" }))).filter((e) => e.task_id === task.id);
    await withUser(uid, (q) => moveEvent(q, uid, ev.id, { starts_at: "2026-11-06T07:00:00.000Z", ends_at: "2026-11-06T08:00:00.000Z" }));
    const t = (await withUser(uid, (q) => listTasks(q, uid, { view: "all", limit: 500 }))).find((x) => x.id === task.id)!;
    expect(t.due_at).toBe("2026-11-06T07:00:00.000Z");
    expect(t.duration_minutes).toBe(60);
    const pend = (await withUser(uid, (q) => listReminders(q, uid, task.id))).filter((r) => r.status === "pending");
    expect(pend.map((r) => r.remind_at)).toEqual(["2026-11-06T06:00:00.000Z"]);
  });

  it("does not touch reminders when only the title changes", async () => {
    const { task } = await withUser(uid, (q) => createTask(q, uid, input({ due_at: "2026-11-08T11:00:00.000Z", reminder_offsets: [60] }), NOW));
    const [before] = await withUser(uid, (q) => listReminders(q, uid, task.id));
    await withUser(uid, (q) => updateTask(q, uid, task.id, { title: "Renamed" }, NOW));
    const after = await withUser(uid, (q) => listReminders(q, uid, task.id));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
  });
});

describe("completion, recurrence, snooze, delete", () => {
  it("completing a task cancels its pending reminders", async () => {
    const { task } = await withUser(uid, (q) => createTask(q, uid, input({ due_at: "2026-11-08T11:00:00.000Z", reminder_offsets: [60, 300] }), NOW));
    await withUser(uid, (q) => completeTask(q, uid, task.id, NOW));
    const r = await withUser(uid, (q) => listReminders(q, uid, task.id));
    expect(r.every((x) => x.status === "canceled")).toBe(true);
  });

  it("a recurring task spawns the next occurrence with its own reminders, and undo removes it", async () => {
    const { task } = await withUser(uid, (q) => createTask(q, uid, input({ title: "Weekly report", due_at: "2026-11-02T11:00:00.000Z", recurrence: "weekly", reminder_offsets: [15] }), NOW));
    const done = await withUser(uid, (q) => completeTask(q, uid, task.id, NOW));
    expect(done.next).toBeTruthy();
    expect(done.next!.due_at).toBe("2026-11-09T11:00:00.000Z");
    expect(done.next!.series_id).toBe(done.task.series_id);
    const nextRem = await withUser(uid, (q) => listReminders(q, uid, done.next!.id));
    expect(nextRem.map((r) => r.remind_at)).toEqual(["2026-11-09T10:45:00.000Z"]);

    await withUser(uid, (q) => reopenTask(q, uid, task.id, NOW));
    const open = await withUser(uid, (q) => listTasks(q, uid, { view: "all", limit: 500 }));
    expect(open.filter((t) => t.title === "Weekly report")).toHaveLength(1);
  });

  it("recurrence stops after recurrence_until", async () => {
    const { task } = await withUser(uid, (q) => createTask(q, uid, input({ title: "Short series", due_at: "2026-11-02T11:00:00.000Z", recurrence: "daily", recurrence_until: "2026-11-02", reminder_offsets: [] }), NOW));
    const done = await withUser(uid, (q) => completeTask(q, uid, task.id, NOW));
    expect(done.next).toBeNull();
  });

  it("snooze creates a one-off reminder N minutes from now", async () => {
    const { task } = await withUser(uid, (q) => createTask(q, uid, input({ due_at: "2026-11-08T11:00:00.000Z", reminder_offsets: [] }), NOW));
    const r = await withUser(uid, (q) => snoozeTask(q, uid, task.id, 15, new Date("2026-11-02T08:03:27Z")));
    expect(r.kind).toBe("snooze");
    expect(r.remind_at).toBe("2026-11-02T08:18:00.000Z");
  });

  it("deleting a task removes it from the calendar and cancels reminders", async () => {
    const { task } = await withUser(uid, (q) => createTask(q, uid, input({ title: "Delete me", due_at: "2026-11-12T11:00:00.000Z", reminder_offsets: [60] }), NOW));
    await withUser(uid, (q) => deleteTask(q, uid, task.id));
    const events = await withUser(uid, (q) => listEvents(q, uid, { start: "2026-11-12T00:00:00Z", end: "2026-11-13T00:00:00Z" }));
    expect(events.some((e) => e.task_id === task.id)).toBe(false);
    const r = await withUser(uid, (q) => listReminders(q, uid, task.id));
    expect(r.every((x) => x.status === "canceled")).toBe(true);
  });
});

describe("validation & isolation", () => {
  it("refuses to attach a task to another user's client", async () => {
    const other = await makeUser("intruder@example.com");
    await expect(withUser(other, (q) => createTask(q, other, input({ client_id: karen }), NOW))).rejects.toThrow(/client/i);
  });
  it("recurring tasks require a date", async () => {
    await expect(withUser(uid, (q) => createTask(q, uid, input({ recurrence: "daily" }), NOW))).rejects.toThrow(/date/i);
  });
  it("lists today / overdue / upcoming correctly in the owner's timezone", async () => {
    const day = new Date("2026-11-20T08:00:00Z"); // Friday 12:00 Yerevan
    await withUser(uid, async (q) => {
      await createTask(q, uid, input({ title: "T-today", due_at: "2026-11-20T11:00:00.000Z", reminder_offsets: [] }), day);
      await createTask(q, uid, input({ title: "T-overdue", due_at: "2026-11-19T11:00:00.000Z", reminder_offsets: [] }), new Date("2026-11-19T00:00:00Z"));
      await createTask(q, uid, input({ title: "T-next", due_at: "2026-11-23T11:00:00.000Z", reminder_offsets: [] }), day);
    });
    const names = async (view: "today" | "overdue" | "upcoming") => (await withUser(uid, (q) => listTasks(q, uid, { view, limit: 500 }, "Asia/Yerevan", day))).map((t) => t.title).filter((t) => t.startsWith("T-"));
    expect(await names("today")).toContain("T-today");
    expect(await names("today")).toContain("T-overdue"); // overdue items stay on the planner until handled
    expect(await names("overdue")).toEqual(["T-overdue"]);
    expect(await names("upcoming")).toEqual(expect.arrayContaining(["T-today", "T-next"]));
  });
});
