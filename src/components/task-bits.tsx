"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { AlarmClockPlus, CalendarClock, Check, Clock, MessageCircle, Phone, Repeat, Trash2, Undo2, ExternalLink } from "lucide-react";
import { Button, Chip, CompleteCheck, Drawer, Input, PriorityDot, cn, useToast, Skeleton } from "./ui";
import { useApp } from "./app-context";
import { api, ApiError } from "@/lib/client/api";
import { CATEGORY_COLORS } from "@/lib/constants";
import { fmt, fromLocalInput, phoneHref, relativeDay, toLocalInput, whatsappHref } from "@/lib/client/format";
import { reschedulePresets, reminderLabel } from "@/lib/time";
import type { Reminder, Task } from "@/lib/types";
import { TaskForm, WarningList, type ClientOption } from "./task-form";
import { draftFromTask, draftProblems, draftToPayload, type Draft } from "@/lib/client/task-draft";
import { tr } from "@/lib/i18n";

/* ───────────────────────── actions ───────────────────────── */
export function useTaskActions() {
  const app = useApp();
  const toast = useToast();
  const fail = (e: unknown) => toast({ tone: "error", title: tr("That didn't work"), body: e instanceof ApiError ? e.message : tr("Please try again.") });

  const undo = React.useCallback(
    async (id: string) => {
      try {
        await api(`/api/tasks/${id}/complete`, { body: { undo: true } });
        app.bumpData();
      } catch (e) {
        fail(e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app],
  );

  return {
    async complete(t: Pick<Task, "id" | "title">) {
      try {
        const r = await api<{ next: Task | null }>(`/api/tasks/${t.id}/complete`, { body: {} });
        toast({ tone: "success", title: tr("Done — nicely handled"), body: r.next ? tr("Next one scheduled for {date}", { date: fmt(r.next.due_at, app.tz, "EEE d MMM, HH:mm") }) : t.title, action: { label: tr("Undo"), run: () => undo(t.id) } });
        window.setTimeout(app.bumpData, 380);
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    undo,
    async reopen(id: string) {
      await undo(id);
    },
    async reschedule(t: Pick<Task, "id" | "title">, iso: string) {
      try {
        const r = await api<{ reminders: unknown[]; skipped_reminders: unknown[] }>(`/api/tasks/${t.id}/reschedule`, { body: { due_at: iso } });
        toast({ tone: "success", title: tr("Rescheduled"), body: `${fmt(iso, app.tz, "EEE d MMM · HH:mm")} — ${tr("{n} reminders updated", { n: r.reminders.length })}` });
        app.bumpData();
      } catch (e) {
        fail(e);
      }
    },
    async snooze(t: Pick<Task, "id" | "title">, minutes: number) {
      try {
        await api(`/api/tasks/${t.id}/snooze`, { body: { minutes } });
        toast({ tone: "info", title: `Snoozed ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}`, body: tr("I'll remind you again then.") });
      } catch (e) {
        fail(e);
      }
    },
    async remove(t: Pick<Task, "id" | "title">) {
      try {
        await api(`/api/tasks/${t.id}`, { method: "DELETE" });
        toast({ tone: "info", title: tr("Task deleted"), body: t.title });
        app.bumpData();
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
  };
}

/* ───────────────────────── reschedule popover ───────────────────────── */
export function RescheduleMenu({ task, children, align = "right" }: { task: Pick<Task, "id" | "title" | "due_at">; children: React.ReactNode; align?: "left" | "right" }) {
  const app = useApp();
  const actions = useTaskActions();
  const [open, setOpen] = React.useState(false);
  const [custom, setCustom] = React.useState(toLocalInput(task.due_at ?? new Date().toISOString(), app.tz));
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", off), document.removeEventListener("keydown", esc));
  }, [open]);
  const presets = reschedulePresets(app.tz);
  const run = async (iso: string) => {
    setOpen(false);
    await actions.reschedule(task, iso);
  };
  return (
    <div ref={ref} className="relative">
      <span onClick={() => setOpen((o) => !o)}>{children}</span>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.96 }} transition={{ type: "spring", stiffness: 500, damping: 34 }} className={cn("absolute z-30 mt-2 w-72 origin-top rounded-2xl bg-surface p-3 shadow-2xl ring-1 ring-gold/30", align === "right" ? "right-0" : "left-0")} role="menu">
            <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{tr("Move to")}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {presets.map((p) => (
                <button key={p.key} role="menuitem" onClick={() => run(p.iso)} className="rounded-xl bg-surface2 px-3 py-2.5 text-left text-[13px] font-medium transition hover:bg-gold/20">
                  {tr(p.label)}
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              <Input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-10" aria-label={tr("Pick a date and time")} />
              <Button size="sm" variant="primary" className="w-full" onClick={() => fromLocalInput(custom, app.tz) && run(fromLocalInput(custom, app.tz)!)}>
                <CalendarClock className="size-4" />{" "}{tr("Move here")}
              </Button>
            </div>
            <div className="mt-3 border-t border-line pt-3">
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{tr("Snooze reminder")}</p>
              <div className="flex gap-1.5">
                {[15, 60, 180].map((m) => (
                  <button key={m} onClick={() => (setOpen(false), actions.snooze(task, m))} className="flex-1 rounded-xl bg-surface2 py-2 text-[13px] font-medium hover:bg-gold/20">
                    {m < 60 ? `${m} min` : `${m / 60} h`}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────── task row ───────────────────────── */
export function TaskRow({ task, compact = false, showClient = true, order }: { task: Task; compact?: boolean; showClient?: boolean; order?: number }) {
  const app = useApp();
  const actions = useTaskActions();
  const [optimistic, setOptimistic] = React.useState<boolean | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const done = optimistic ?? task.status === "completed";
  const overdue = !done && task.due_at && new Date(task.due_at).getTime() < Date.now();
  const open = () => router.push(`${pathname}?open=${task.id}`, { scroll: false });

  React.useEffect(() => setOptimistic(null), [task.status]);

  return (
    <motion.li layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40, height: 0, marginBottom: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }} className={cn("group relative flex items-center gap-3 rounded-2xl px-3 transition-colors hover:bg-surface2", compact ? "py-2" : "py-3")}>
      {order && <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gold text-xs font-bold text-navy">{order}</span>}
      <CompleteCheck
        checked={done}
        label={done ? tr("Mark “{title}” as not done", { title: task.title }) : tr("Complete “{title}”", { title: task.title })}
        onToggle={async () => {
          const next = !done;
          setOptimistic(next);
          const ok = next ? await actions.complete(task) : (await actions.reopen(task.id), true);
          if (!ok) setOptimistic(null);
        }}
      />
      <button onClick={open} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <PriorityDot p={tr(task.priority)} />
          <span className={cn("line-clamp-2 text-[15px] font-medium leading-snug transition-colors sm:line-clamp-1", done && "text-muted line-through")}>{tr(task.title)}</span>
          {task.recurrence && <Repeat className="size-3.5 shrink-0 text-muted" aria-label={`Repeats ${tr(task.recurrence)}`} />}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted">
          {task.due_at && (
            <span className={cn("flex items-center gap-1 tabular", overdue && "font-semibold text-danger")}>
              <Clock className="size-3" /> {relativeDay(task.due_at, app.tz)} · {fmt(task.due_at, app.tz, "HH:mm")}
              {overdue && tr(" · overdue")}
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: CATEGORY_COLORS[task.category] }} />
            {tr(task.category)}
          </span>
          {showClient && task.client_name && task.client_id && (
            <Link href={`/clients/${task.client_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-goldink hover:underline">
              {task.client_name}
            </Link>
          )}
        </span>
      </button>
      {!done && (
        <div className="flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {task.client_phone && (
            <a href={phoneHref(task.client_phone)} aria-label={`Call ${task.client_name}`} className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface3 hover:text-ink">
              <Phone className="size-4" />
            </a>
          )}
          {task.client_whatsapp && (
            <a href={whatsappHref(task.client_whatsapp)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${task.client_name}`} className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface3 hover:text-ink">
              <MessageCircle className="size-4" />
            </a>
          )}
          <RescheduleMenu task={task}>
            <button aria-label={tr("Reschedule or snooze")} className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface3 hover:text-ink">
              <AlarmClockPlus className="size-4" />
            </button>
          </RescheduleMenu>
        </div>
      )}
    </motion.li>
  );
}

/* ───────────────────────── task drawer (open from anywhere with ?open=<id>) ───────────────────────── */
export function TaskDrawerHost() {
  return (
    <React.Suspense fallback={null}>
      <TaskDrawerInner />
    </React.Suspense>
  );
}

function TaskDrawerInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const app = useApp();
  const toast = useToast();
  const actions = useTaskActions();
  const id = sp.get("open");
  const [task, setTask] = React.useState<Task | null>(null);
  const [reminders, setReminders] = React.useState<Reminder[]>([]);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [clients, setClients] = React.useState<ClientOption[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const close = React.useCallback(() => {
    const p = new URLSearchParams(sp.toString());
    p.delete("open");
    router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  React.useEffect(() => {
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      setTask(null);
      return;
    }
    let live = true;
    setLoading(true);
    setErr(null);
    Promise.all([api<{ task: Task; reminders: Reminder[] }>(`/api/tasks/${id}`), api<{ clients: ClientOption[] }>("/api/clients?limit=500")])
      .then(([t, c]) => {
        if (!live) return;
        setTask(t.task);
        setReminders(t.reminders);
        setDraft(draftFromTask(t.task, app.tz));
        setClients(c.clients);
      })
      .catch((e) => live && (setErr(e instanceof ApiError ? e.message : tr("Couldn't load this task.")), setTask(null)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [id, app.tz, app.dataVersion]);

  const problems = draft ? draftProblems(draft, app.tz) : [];
  async function save() {
    if (!draft || !task) return;
    setBusy(true);
    setErr(null);
    try {
      const p = draftToPayload(draft, app.tz);
      const r = await api<{ reminders: unknown[]; skipped_reminders: { label: string }[] }>(`/api/tasks/${task.id}`, { method: "PATCH", body: p });
      toast({ tone: "success", title: tr("Changes saved"), body: r.skipped_reminders.length ? tr("{n} reminders skipped — already in the past", { n: r.skipped_reminders.length }) : undefined });
      app.bumpData();
      close();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tr("Couldn't save."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={Boolean(id)}
      onClose={close}
      title={task?.title ?? tr("Task")}
      subtitle={task ? `${task.status === "completed" ? "Completed" : "Open"} · ${tr(task.category)}` : undefined}
      footer={
        task && draft ? (
          <>
            <Button variant="ghost" size="sm" onClick={async () => confirm(tr("Delete this task? Its reminders and calendar entry will be removed.")) && (await actions.remove(task)) && close()} className="text-danger">
              <Trash2 className="size-4" />{" "}{tr("Delete")}
            </Button>
            {task.status === "pending" ? (
              <Button variant="soft" size="sm" onClick={async () => (await actions.complete(task)) && close()}>
                <Check className="size-4" />{" "}{tr("Complete")}
              </Button>
            ) : (
              <Button variant="soft" size="sm" onClick={async () => (await actions.reopen(task.id), close())}>
                <Undo2 className="size-4" />{" "}{tr("Reopen")}
              </Button>
            )}
            <Button variant="gold" size="md" className="ml-auto" onClick={save} loading={busy} disabled={problems.length > 0}>
              {tr("Save changes")}
            </Button>
          </>
        ) : undefined
      }
    >
      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-40" />
        </div>
      )}
      {err && !loading && <p className="rounded-xl bg-danger/10 p-3 text-sm font-medium text-danger">{err}</p>}
      {task && draft && !loading && (
        <div className="space-y-6">
          {task.client_id && (
            <Link href={`/clients/${task.client_id}`} className="flex items-center justify-between rounded-2xl bg-surface2 px-4 py-3 text-sm font-medium transition hover:bg-gold/15">
              <span>
                {tr("Client ·")}{" "}<span className="text-goldink">{task.client_name}</span>
              </span>
              <ExternalLink className="size-4 text-muted" />
            </Link>
          )}
          <TaskForm draft={draft} onChange={setDraft} clients={clients} tz={app.tz} idPrefix="td" />
          {problems.length > 0 && <WarningList items={problems} />}
          <div>
            <h3 className="mb-2 text-[13px] font-semibold">{tr("Reminder schedule")}</h3>
            {reminders.length === 0 ? (
              <p className="text-sm text-muted">{tr("No reminders for this task.")}</p>
            ) : (
              <ul className="space-y-1.5">
                {reminders.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface2 px-3.5 py-2.5 text-[13px]">
                    <span>
                      {r.kind === "snooze" ? tr("Snoozed reminder") : r.offset_minutes !== null ? reminderLabel(r.offset_minutes) : tr("Custom time")}
                      <span className="ml-2 tabular text-muted">{fmt(r.remind_at, app.tz, "EEE d MMM · HH:mm")}</span>
                    </span>
                    <Chip tone={r.status === "sent" ? "success" : r.status === "failed" ? "danger" : r.status === "canceled" ? "neutral" : "gold"}>{r.status === "pending" ? tr("scheduled") : r.status}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-muted">
            {tr("Created")}{" "}{fmt(task.created_at, app.tz, "d MMM yyyy, HH:mm")}
            {task.source === "ai" && tr(" · captured with AI and approved by you")}
          </p>
        </div>
      )}
    </Drawer>
  );
}
