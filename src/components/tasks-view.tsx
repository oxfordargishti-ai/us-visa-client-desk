"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CalendarClock, CheckCheck, Inbox, Mail, Plus, Search, Sparkles, Wand2, CircleCheck, Sun, Phone, FileText, GraduationCap, FolderOpen, Hourglass, AlertTriangle } from "lucide-react";
import { Button, Card, Chip, EmptyState, ProgressRing, SectionTitle, Segmented, Stagger, Rise, Modal, cn, useToast } from "./ui";
import { TaskRow } from "./task-bits";
import { useApp } from "./app-context";
import { api, ApiError } from "@/lib/client/api";
import { fmt, relativeDay } from "@/lib/client/format";
import { DateTime } from "luxon";
import type { Task } from "@/lib/types";
import type { PlanSuggestion } from "@/lib/ai/assist";
import { tr } from "@/lib/i18n";

type View = "today" | "upcoming" | "overdue" | "all" | "completed";

const SECTIONS = [
  { key: "morning", title: "Morning priorities", icon: Sun, hint: "Urgent, overdue and before noon" },
  { key: "calls", title: "Calls to make", icon: Phone, hint: "" },
  { key: "apps", title: "Applications to complete", icon: FileText, hint: "DS-160 and forms" },
  { key: "prep", title: "Interview preparation", icon: GraduationCap, hint: "" },
  { key: "docs", title: "Documents to review", icon: FolderOpen, hint: "" },
  { key: "other", title: "Other tasks", icon: Inbox, hint: "" },
] as const;

function sectionOf(t: Task, tz: string, now: Date): (typeof SECTIONS)[number]["key"] {
  const overdue = t.due_at && new Date(t.due_at).getTime() < now.getTime() - 60_000;
  const hour = t.due_at ? DateTime.fromISO(t.due_at, { zone: "utc" }).setZone(tz).hour : 12;
  if (overdue || t.priority === "High" || t.priority === "Urgent" || t.category === "Urgent Task" || hour < 12) return "morning";
  if (t.category === "Client Phone Call") return "calls";
  if (t.category === "DS-160 Application") return "apps";
  if (["Interview Preparation", "Visa Interview", "Embassy Appointment"].includes(t.category)) return "prep";
  if (t.category === "Document Collection") return "docs";
  return "other";
}

export function TasksView({ view, tasks, deadlines, tz, counts }: { view: View; tasks: Task[]; deadlines: Task[]; tz: string; counts: { overdue: number; today: number } }) {
  const app = useApp();
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const filtered = React.useMemo(() => (q ? tasks.filter((t) => `${t.title} ${t.client_name ?? ""} ${tr(t.category)}`.toLowerCase().includes(q.toLowerCase())) : tasks), [tasks, q]);

  return (
    <Stagger className="space-y-6">
      <Rise className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-goldink">{view === "today" ? tr("Daily planner") : tr("Task list")}</p>
          <h1 className="mt-1 font-display text-4xl font-semibold sm:text-5xl">{tr("My Tasks")}</h1>
        </div>
        <div className="hidden sm:block">
          <Button variant="gold" size="lg" onClick={() => app.openQuickAdd()}>
            <Sparkles className="size-4" />{" "}{tr("New task")}
          </Button>
        </div>
      </Rise>

      <Rise className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <Segmented<View>
            id="tasks-view"
            value={view}
            onChange={(v) => router.replace(`/tasks?view=${v}`, { scroll: false })}
            options={[
              { value: "today", label: <>{tr("Today")}{counts.today ? <span className="ml-1.5 rounded-full bg-navy/10 px-1.5 text-xs dark:bg-navy/20">{counts.today}</span> : null}</> },
              { value: "upcoming", label: "Upcoming" },
              { value: "overdue", label: <>{tr("Overdue")}{counts.overdue ? <span className="ml-1.5 rounded-full bg-danger px-1.5 text-xs text-white">{counts.overdue}</span> : null}</> },
              { value: "all", label: "All open" },
              { value: "completed", label: "Completed" },
            ]}
          />
        </div>
        <div className="relative md:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Filter this list…")} aria-label={tr("Filter tasks")} className="h-11 w-full rounded-xl border border-linestrong bg-surface pl-10 pr-3 text-[15px] focus:border-gold focus:outline-none focus:ring-4 focus:ring-gold/20" />
        </div>
      </Rise>

      {view === "today" ? (
        <Planner tasks={filtered} deadlines={deadlines} tz={tz} />
      ) : (
        <Rise>
          <GroupedList tasks={filtered} tz={tz} view={view} />
        </Rise>
      )}
    </Stagger>
  );
}

/* ───────────────────────── grouped list for the other views ───────────────────────── */
function GroupedList({ tasks, tz, view }: { tasks: Task[]; tz: string; view: View }) {
  const app = useApp();
  if (tasks.length === 0) {
    return (
      <Card className="p-4">
        <EmptyState
          icon={view === "completed" ? <CheckCheck className="size-6" /> : <CircleCheck className="size-6" />}
          title={view === "overdue" ? tr("Nothing overdue") : view === "completed" ? tr("No completed tasks yet") : tr("No tasks here")}
          body={view === "overdue" ? tr("You're fully caught up. Lovely.") : tr("Add a task and it will appear here.")}
          action={<Button variant="gold" size="sm" onClick={() => app.openQuickAdd()}><Plus className="size-4" />{" "}{tr("New task")}</Button>}
        />
      </Card>
    );
  }
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const iso = view === "completed" ? t.completed_at : t.due_at;
    const key = iso ? DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).toFormat("yyyy-MM-dd") : "none";
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([key, items]) => (
        <Card key={key} className="p-4 sm:p-5">
          <div className="mb-2 flex items-baseline justify-between px-2">
            <h2 className="font-display text-2xl font-semibold">{key === "none" ? tr("No date") : relativeDay(DateTime.fromFormat(key, "yyyy-MM-dd", { zone: tz }).toUTC().toISO()!, tz)}</h2>
            <span className="text-sm text-muted">{key === "none" ? "" : fmt(DateTime.fromFormat(key, "yyyy-MM-dd", { zone: tz }).toUTC().toISO(), tz, "EEEE d MMMM")} · {items.length}</span>
          </div>
          <ul>
            <AnimatePresence initial={false}>
              {items.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </AnimatePresence>
          </ul>
        </Card>
      ))}
    </div>
  );
}

/* ───────────────────────── the daily planner ───────────────────────── */
function Planner({ tasks, deadlines, tz }: { tasks: Task[]; deadlines: Task[]; tz: string }) {
  const app = useApp();
  const toast = useToast();
  const now = React.useMemo(() => new Date(), []);
  const pending = tasks.filter((t) => t.status === "pending");
  const done = tasks.filter((t) => t.status === "completed");
  const total = pending.length + done.length;
  const [plan, setPlan] = React.useState<PlanSuggestion | null>(null);
  const [planning, setPlanning] = React.useState(false);
  const [planErr, setPlanErr] = React.useState<string | null>(null);
  const [moveOpen, setMoveOpen] = React.useState(false);

  const grouped = SECTIONS.map((s) => ({ ...s, items: pending.filter((t) => sectionOf(t, tz, now) === s.key) }));
  const order = new Map(plan?.ordered.map((o, i) => [o.task_id, i + 1]));

  async function suggest() {
    setPlanning(true);
    setPlanErr(null);
    try {
      setPlan(await api<PlanSuggestion>("/api/planner/suggest", { body: {} }));
    } catch (e) {
      setPlanErr(e instanceof ApiError ? e.message : "Couldn't get suggestions.");
    } finally {
      setPlanning(false);
    }
  }

  async function moveAll(dateStr: string) {
    setMoveOpen(false);
    let ok = 0;
    for (const t of pending) {
      if (!t.due_at) continue;
      const cur = DateTime.fromISO(t.due_at, { zone: "utc" }).setZone(tz);
      const target = DateTime.fromFormat(dateStr, "yyyy-MM-dd", { zone: tz }).set({ hour: cur.hour, minute: cur.minute });
      try {
        await api(`/api/tasks/${t.id}/reschedule`, { body: { due_at: target.toUTC().toISO() } });
        ok++;
      } catch {
        /* continue with the rest */
      }
    }
    toast({ tone: "success", title: tr("Moved {n} tasks", { n: ok }), body: tr("to {date} — same times, reminders updated", { date: fmt(DateTime.fromFormat(dateStr, "yyyy-MM-dd", { zone: tz }).toUTC().toISO(), tz, "EEEE d MMMM") }) });
    app.bumpData();
  }

  const dayOpts = [1, 2, 3, 7].map((n) => {
    const d = DateTime.now().setZone(tz).plus({ days: n });
    return { date: d.toFormat("yyyy-MM-dd"), label: n === 1 ? tr("Tomorrow") : d.toFormat("cccc d MMM") };
  });

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-8">
        {pending.length === 0 && (
          <Rise>
            <Card className="p-4">
              <EmptyState icon={<CircleCheck className="size-6" />} title={done.length ? tr("Everything for today is done") : tr("A clear day")} body={done.length ? tr("Beautifully done. Anything new can wait until tomorrow.") : tr("Nothing scheduled. Add a task or get ahead on tomorrow.")} action={<Button variant="gold" size="sm" onClick={() => app.openQuickAdd()}><Plus className="size-4" />{" "}{tr("New task")}</Button>} />
            </Card>
          </Rise>
        )}
        {grouped
          .filter((g) => g.items.length)
          .map((g) => (
            <Rise key={g.key}>
              <Card className={cn("p-4 sm:p-5", g.key === "morning" && g.items.some((t) => t.due_at && new Date(t.due_at) < now) && "border-danger/25")}>
                <SectionTitle icon={<g.icon className="size-4" />} title={g.title} sub={g.hint || undefined} action={<Chip>{g.items.length}</Chip>} />
                <ul className="-mx-2">
                  <AnimatePresence initial={false}>
                    {g.items.map((t) => (
                      <TaskRow key={t.id} task={t} order={order.get(t.id)} />
                    ))}
                  </AnimatePresence>
                </ul>
              </Card>
            </Rise>
          ))}

        <Rise>
          <EmailsCard />
        </Rise>

        {deadlines.length > 0 && (
          <Rise>
            <Card className="p-4 sm:p-5">
              <SectionTitle icon={<Hourglass className="size-4" />} title={tr("Upcoming deadlines")} sub="High priority in the next 7 days" />
              <ul className="-mx-2">
                {deadlines.slice(0, 6).map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </ul>
            </Card>
          </Rise>
        )}

        {done.length > 0 && (
          <Rise>
            <Card className="p-4 sm:p-5">
              <SectionTitle icon={<CheckCheck className="size-4" />} title={tr("Completed today")} sub={`${done.length} done`} />
              <ul className="-mx-2">
                <AnimatePresence initial={false}>
                  {done.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </AnimatePresence>
              </ul>
            </Card>
          </Rise>
        )}
      </div>

      <aside className="space-y-5 lg:col-span-4">
        <div className="space-y-5 lg:sticky lg:top-24">
          <Rise>
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <ProgressRing value={total ? done.length / total : 1} size={96} stroke={9} className="shrink-0 text-ink">
                  <span className="font-display text-2xl font-bold">{total ? Math.round((done.length / total) * 100) : 100}%</span>
                </ProgressRing>
                <div>
                  <p className="font-display text-xl font-semibold">{tr("Daily summary")}</p>
                  <p className="text-sm text-muted">{done.length}{" "}{tr("done ·")}{" "}{pending.length}{" "}{tr("to go")}</p>
                  {pending.some((t) => t.due_at && new Date(t.due_at) < now) && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-danger"><AlertTriangle className="size-3" /> {pending.filter((t) => t.due_at && new Date(t.due_at) < now).length}{" "}{tr("overdue")}</p>
                  )}
                </div>
              </div>
              <div className="mt-5 grid gap-2.5">
                <Button variant="soft" onClick={() => setMoveOpen(true)} disabled={!pending.length}>
                  <CalendarClock className="size-4" />{" "}{tr("Move unfinished to…")}
                </Button>
              </div>
            </Card>
          </Rise>

          {app.caps.ai && (
            <Rise>
              <Card className="overflow-hidden">
                <div className="hero-navy p-5">
                  <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold2"><Sparkles className="size-3.5" />{" "}{tr("AI suggestion")}</p>
                  <p className="mt-2 font-display text-xl font-semibold leading-snug">{tr("Not sure where to start?")}</p>
                  <p className="mt-1 text-sm text-white/65">{tr("Claude suggests an order for today. Your tasks are never changed.")}</p>
                  <Button variant="gold" size="sm" className="mt-4" onClick={suggest} loading={planning} disabled={!pending.length}>
                    <Wand2 className="size-4" />{" "}{tr("Suggest priorities")}
                  </Button>
                </div>
                <AnimatePresence>
                  {(plan || planErr) && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="space-y-3 p-5">
                        {planErr && <p className="text-sm font-medium text-danger">{planErr}</p>}
                        {plan && (
                          <>
                            <p className="text-sm text-muted">{plan.focus_note}</p>
                            <ol className="space-y-2">
                              {plan.ordered.map((o, i) => {
                                const t = pending.find((x) => x.id === o.task_id);
                                if (!t) return null;
                                return (
                                  <motion.li key={o.task_id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }} className="flex gap-3">
                                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-gold text-xs font-bold text-navy">{i + 1}</span>
                                    <span className="min-w-0 text-sm">
                                      <span className="block truncate font-medium">{tr(t.title)}</span>
                                      <span className="block text-xs text-muted">{o.reason}</span>
                                    </span>
                                  </motion.li>
                                );
                              })}
                            </ol>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            </Rise>
          )}
        </div>
      </aside>

      <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title={tr("Move unfinished tasks")} subtitle={tr("{n} tasks keep their time of day; reminders are rebuilt.", { n: pending.filter((t) => t.due_at).length })} size="sm">
        <div className="grid gap-2">
          {dayOpts.map((d) => (
            <Button key={d.date} variant="outline" onClick={() => moveAll(d.date)} className="!justify-between">
              {tr(d.label)} <ArrowRight className="size-4" />
            </Button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/* ───────────────────────── emails needing attention ───────────────────────── */
function EmailsCard() {
  const app = useApp();
  const [state, setState] = React.useState<{ status: "loading" | "off" | "ready" | "error"; messages: { id: string; threadId: string; fromName: string; subject: string; needs_action: boolean; action_reasons: string[] }[]; note?: string }>({ status: "loading", messages: [] });
  React.useEffect(() => {
    let live = true;
    api<{ connected: boolean; gmail_scope: boolean }>("/api/gmail/status")
      .then(async (s) => {
        if (!s.connected || !s.gmail_scope) return live && setState({ status: "off", messages: [] });
        const r = await api<{ messages: { id: string; threadId: string; fromName: string; subject: string; needs_action: boolean; action_reasons: string[] }[] }>("/api/gmail/messages?unread=1");
        if (live) setState({ status: "ready", messages: r.messages });
      })
      .catch((e) => live && setState({ status: "error", messages: [], note: e instanceof ApiError ? e.message : undefined }));
    return () => {
      live = false;
    };
  }, [app.dataVersion]);
  const flagged = state.messages.filter((m) => m.needs_action);
  const shown = (flagged.length ? flagged : state.messages).slice(0, 3);
  return (
    <Card className="p-4 sm:p-5">
      <SectionTitle icon={<Mail className="size-4" />} title={tr("Emails requiring attention")} sub={state.status === "ready" ? tr("{n} unread · {m} look actionable", { n: state.messages.length, m: flagged.length }) : undefined} action={<Link href="/gmail" className="text-sm font-medium text-goldink hover:underline">{tr("Open Gmail")}</Link>} />
      {state.status === "loading" && <div className="skeleton h-16" />}
      {state.status === "off" && (
        <p className="rounded-xl bg-surface2 p-4 text-sm text-muted">
          {tr("Connect your business Gmail (read-only) to see unread client emails here.")}{" "}<Link href="/gmail" className="font-semibold text-goldink hover:underline">{tr("Connect Gmail")}</Link>
        </p>
      )}
      {state.status === "error" && <p className="rounded-xl bg-surface2 p-4 text-sm text-muted">{state.note ?? tr("Couldn't reach Gmail right now.")}</p>}
      {state.status === "ready" && shown.length === 0 && <p className="py-4 text-center text-sm text-muted">{tr("Inbox is clear — no unread emails.")}</p>}
      {state.status === "ready" && (
        <ul className="space-y-1">
          {shown.map((m) => (
            <li key={m.id}>
              <Link href={`/gmail?thread=${m.threadId}`} className="flex items-center gap-3 rounded-xl p-2.5 transition hover:bg-surface2">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-goldink"><Mail className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.subject}</span>
                  <span className="block truncate text-xs text-muted">{m.fromName}</span>
                </span>
                {m.needs_action && <Chip tone="warning">{tr("Action")}</Chip>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
