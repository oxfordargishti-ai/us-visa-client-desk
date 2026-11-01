"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, Plus, X, BellRing, Repeat, AlertTriangle } from "lucide-react";
import { Chip, Field, Input, Select, Textarea, cn } from "./ui";
import { PRIORITIES, REMINDER_PRESETS, TASK_CATEGORIES, CATEGORY_COLORS, type Priority } from "@/lib/constants";
import { planReminders, reminderLabel } from "@/lib/time";
import { draftDue, quickDates, type Draft } from "@/lib/client/task-draft";
import { fmt } from "@/lib/client/format";
import { tr } from "@/lib/i18n";

export type Flag = "title" | "client" | "date" | "time";
export interface ClientOption {
  id: string;
  full_name: string;
}

export function TaskForm({ draft, onChange, clients, tz, flags = [], candidates = [], idPrefix = "tf" }: { draft: Draft; onChange: (d: Draft) => void; clients: ClientOption[]; tz: string; flags?: Flag[]; candidates?: ClientOption[]; idPrefix?: string }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v });
  const due = draftDue(draft, tz);
  const [custom, setCustom] = React.useState({ n: "", unit: "60" });
  const [details, setDetails] = React.useState(Boolean(draft.description));
  const planned = due ? planReminders(due, draft.reminder_offsets) : [];
  const q = quickDates(tz);

  const toggleOffset = (m: number) => set("reminder_offsets", draft.reminder_offsets.includes(m) ? draft.reminder_offsets.filter((x) => x !== m) : [...draft.reminder_offsets, m].sort((a, b) => a - b));
  const addCustom = () => {
    const m = Math.round(Number(custom.n) * Number(custom.unit));
    if (!Number.isFinite(m) || m < 0 || m > 129_600) return;
    if (!draft.reminder_offsets.includes(m)) set("reminder_offsets", [...draft.reminder_offsets, m].sort((a, b) => a - b));
    setCustom({ ...custom, n: "" });
  };
  const presetMinutes = new Set(REMINDER_PRESETS.map((p) => p.minutes));

  return (
    <div className="space-y-5">
      <Field label={tr("Task")} flag={flags.includes("title")}>
        <Input id={`${idPrefix}-title`} value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder={tr("e.g. Call Karen — Visa Interview Preparation")} maxLength={200} data-autofocus />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Category")}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 size-2.5 -translate-y-1/2 rounded-full" style={{ background: CATEGORY_COLORS[draft.category] }} />
            <Select value={tr(draft.category)} onChange={(e) => set("category", e.target.value as Draft["category"])} className="pl-9">
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>{tr(c)}</option>
              ))}
            </Select>
          </div>
        </Field>
        <Field label={tr("Priority")}>
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface2 p-1" role="radiogroup" aria-label={tr("Priority")}>
            {PRIORITIES.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={draft.priority === p} onClick={() => set("priority", p as Priority)} className={cn("relative h-9 rounded-lg text-[13px] font-medium transition-colors", draft.priority === p ? "text-navy" : "text-muted hover:text-ink")}>
                {draft.priority === p && <motion.span layoutId={`${idPrefix}-prio`} className={cn("absolute inset-0 rounded-lg shadow", p === "Urgent" ? "bg-danger/90" : p === "High" ? "bg-warning" : "bg-white dark:bg-gold")} transition={{ type: "spring", stiffness: 500, damping: 34 }} />}
                <span className={cn("relative", draft.priority === p && p === "Urgent" && "text-white")}>{tr(p)}</span>
              </button>
            ))}
          </div>
        </Field>
      </div>

      <Field label={tr("Client")} flag={flags.includes("client")} hint={tr("Optional — link the task to a client record.")}>
        {candidates.length > 1 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {candidates.map((c) => (
              <button key={c.id} type="button" onClick={() => set("client_id", c.id)} className={cn("rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition", draft.client_id === c.id ? "bg-gold text-navy ring-gold" : "bg-surface2 ring-line hover:ring-gold/60")}>
                {c.full_name}
              </button>
            ))}
          </div>
        )}
        <Select value={draft.client_id ?? ""} onChange={(e) => set("client_id", e.target.value || null)}>
          <option value="">{tr("No client (personal / admin)")}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </Select>
      </Field>

      <div className={cn("rounded-2xl border p-4 transition-colors", flags.includes("date") || flags.includes("time") ? "border-warning/50 bg-warning/5" : "border-line bg-surface2/50")}>
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <CalendarClock className="size-4 text-goldink" />{" "}{tr("When")}
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" checked={draft.noDate} onChange={(e) => set("noDate", e.target.checked)} className="size-4 accent-[#c9a86a]" />{" "}{tr("No due date")}
          </label>
        </div>
        <AnimatePresence initial={false}>
          {!draft.noDate && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="grid grid-cols-[1.4fr_1fr] gap-3">
                <Field label={tr("Date")} flag={flags.includes("date")}>
                  <Input type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} />
                </Field>
                <Field label={tr("Time")} flag={flags.includes("time")}>
                  <Input type="time" value={draft.time} onChange={(e) => set("time", e.target.value)} />
                </Field>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {q.map((d) => (
                  <button key={d.label} type="button" onClick={() => set("date", d.date)} className={cn("rounded-full px-3 py-1 text-xs font-medium ring-1 transition", draft.date === d.date ? "bg-navy text-white ring-navy dark:bg-gold dark:text-navy dark:ring-gold" : "bg-surface ring-line hover:ring-gold/60")}>
                    {tr(d.label)}
                  </button>
                ))}
                {[9, 12, 15, 17].map((h) => (
                  <button key={h} type="button" onClick={() => set("time", `${String(h).padStart(2, "0")}:00`)} className={cn("rounded-full px-3 py-1 text-xs font-medium tabular ring-1 transition", draft.time === `${String(h).padStart(2, "0")}:00` ? "bg-navy text-white ring-navy dark:bg-gold dark:text-navy dark:ring-gold" : "bg-surface ring-line hover:ring-gold/60")}>
                    {String(h).padStart(2, "0")}:00
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted" aria-live="polite">
                {due ? (
                  <>
                    <span className="font-semibold text-ink">{fmt(due, tz, "cccc, d MMMM · HH:mm")}</span> · {tz}
                  </>
                ) : (
                  tr("Pick a date and a time to add this to the calendar.")
                )}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Duration")}>
          <Select value={draft.duration} onChange={(e) => set("duration", Number(e.target.value))}>
            {[15, 30, 45, 60, 90, 120, 180].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? tr("{n} minutes", { n: m }) : tr("{n} h", { n: m / 60 })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Repeat")}>
          <div className="relative">
            <Repeat className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Select value={tr(draft.recurrence)} onChange={(e) => set("recurrence", e.target.value as Draft["recurrence"])} className="pl-10" disabled={draft.noDate}>
              <option value="">{tr("Doesn't repeat")}</option>
              <option value="daily">{tr("Every day")}</option>
              <option value="weekdays">{tr("Every weekday")}</option>
              <option value="weekly">{tr("Every week")}</option>
              <option value="monthly">{tr("Every month")}</option>
            </Select>
          </div>
        </Field>
      </div>
      {draft.recurrence && (
        <Field label={tr("Repeat until (optional)")}>
          <Input type="date" value={draft.recurrence_until} onChange={(e) => set("recurrence_until", e.target.value)} />
        </Field>
      )}

      <div>
        <span className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
          <BellRing className="size-4 text-goldink" />{" "}{tr("Remind me")}
        </span>
        <div className="flex flex-wrap gap-2">
          {REMINDER_PRESETS.map((p) => {
            const on = draft.reminder_offsets.includes(p.minutes);
            return (
              <button key={p.minutes} type="button" onClick={() => toggleOffset(p.minutes)} disabled={draft.noDate} aria-pressed={on} className={cn("rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 transition disabled:opacity-40", on ? "bg-gold/25 text-[#6b5019] ring-gold dark:text-gold2" : "bg-surface ring-line text-muted hover:ring-gold/60")}>
                {on && <span className="mr-1">✓</span>}
                {tr(p.label)}
              </button>
            );
          })}
          {draft.reminder_offsets
            .filter((m) => !presetMinutes.has(m))
            .map((m) => (
              <button key={m} type="button" onClick={() => toggleOffset(m)} className="rounded-full bg-gold/25 px-3 py-1.5 text-[13px] font-medium text-[#6b5019] ring-1 ring-gold dark:text-gold2">
                ✓ {reminderLabel(m)} <X className="ml-1 inline size-3" />
              </button>
            ))}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <Input type="number" min={1} inputMode="numeric" value={custom.n} onChange={(e) => setCustom({ ...custom, n: e.target.value })} placeholder={tr("Custom")} className="h-10 w-24" aria-label={tr("Custom reminder amount")} />
          <Select value={custom.unit} onChange={(e) => setCustom({ ...custom, unit: e.target.value })} className="h-10 w-32" aria-label={tr("Unit")}>
            <option value="1">{tr("minutes")}</option>
            <option value="60">{tr("hours")}</option>
            <option value="1440">{tr("days")}</option>
          </Select>
          <span className="text-sm text-muted">{tr("before")}</span>
          <button type="button" onClick={addCustom} className="grid size-10 place-items-center rounded-xl bg-surface2 hover:bg-surface3" aria-label={tr("Add custom reminder")}>
            <Plus className="size-4" />
          </button>
        </div>
        {due && planned.length > 0 && (
          <ul className="mt-3 space-y-1.5 rounded-xl bg-surface2/60 p-3 text-[13px]">
            {planned.map((r) => (
              <li key={r.offset_minutes} className={cn("flex items-center justify-between gap-3", r.in_past && "text-muted line-through")}>
                <span>{tr(r.label)}</span>
                <span className="tabular text-muted">{r.in_past ? tr("already passed — skipped") : fmt(r.remind_at, tz, "EEE d MMM · HH:mm")}</span>
              </li>
            ))}
          </ul>
        )}
        {!due && !draft.noDate && <p className="mt-2 text-xs text-muted">{tr("Reminders are scheduled once the date and time are set.")}</p>}
      </div>

      {details ? (
        <Field label={tr("Details")}>
          <Textarea value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder={tr("Anything you want to remember…")} maxLength={5000} />
        </Field>
      ) : (
        <button type="button" onClick={() => setDetails(true)} className="text-sm font-medium text-goldink hover:underline">
          {tr("+ Add details")}
        </button>
      )}
    </div>
  );
}

export function WarningList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-2" aria-label={tr("Things to check")}>
      {items.map((w) => (
        <motion.li key={w} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2.5 rounded-xl bg-warning/10 px-3.5 py-2.5 text-[13px] text-[#7a520c] ring-1 ring-warning/30 dark:text-[#f0c36d]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{w}</span>
        </motion.li>
      ))}
    </ul>
  );
}

export { Chip };
