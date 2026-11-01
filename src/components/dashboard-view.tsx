"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, CalendarClock, Check, CheckCheck, CircleCheck, FileWarning, Flag, Hourglass, Mail, MessageCircle, Phone, Plus, Sparkles, UserRoundCheck, ClipboardList, TrendingUp, Landmark, CheckSquare, PartyPopper } from "lucide-react";
import { AnimatedNumber, Avatar, Button, Card, Chip, EmptyState, Logo, ProgressRing, SectionTitle, Stagger, Rise, cn, EASE } from "./ui";
import { useApp } from "./app-context";
import { InterviewCard, countdownLabel } from "./interview-card";
import { RescheduleMenu, TaskRow, useTaskActions } from "./task-bits";
import { fmt, phoneHref, relativeDay, whatsappHref, STATUS_TONE } from "@/lib/client/format";
import { useNow } from "@/lib/client/hooks";
import { CATEGORY_COLORS } from "@/lib/constants";
import type { DashboardData } from "@/lib/repo/dashboard";
import { tr } from "@/lib/i18n";

export function DashboardView({ data, greeting, dateLine }: { data: DashboardData; greeting: string; dateLine: string }) {
  const app = useApp();
  const first = app.user.name.split(" ")[0];
  const doneToday = data.recently_completed.filter((t) => t.completed_at && fmt(t.completed_at, data.tz, "yyyy-MM-dd") === fmt(data.now, data.tz, "yyyy-MM-dd")).length;
  const todayTotal = data.today.length + data.overdue.length + doneToday; // everything that needed doing today, including what is already late
  const needs = data.today.length + data.overdue.length;

  return (
    <Stagger className="space-y-6">
      {/* greeting */}
      <Rise className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/dashboard" aria-label={tr("US VISA WITH ARGISHTI")} className="mb-5 block w-28 overflow-hidden rounded-3xl bg-white p-1 shadow-lg ring-1 ring-gold/50 lg:hidden">
            <Logo plate={false} className="w-full rounded-[18px]" />
          </Link>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-goldink">{tr("My Command Center")}</p>
          <h1 className="mt-1 font-display text-[2.4rem] font-semibold leading-[1.05] sm:text-5xl">
            {greeting}, <span className="gold-text animate-[goldpan_7s_linear_infinite]">{first}</span>
          </h1>
          <p className="mt-2 text-muted">
            {dateLine} · {needs === 0 ? tr("nothing urgent waiting") : tr("{n} things need you today", { n: needs })}
          </p>
        </div>
        <button onClick={() => app.openQuickAdd()} className="group flex h-14 w-full items-center gap-3 rounded-2xl border border-gold/40 bg-surface px-4 text-left shadow-soft transition hover:shadow-[var(--shadow-gold)] sm:w-[26rem]">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-gold2 to-gold3 text-navy">
            <Sparkles className="size-[18px]" />
          </span>
          <span className="truncate text-[15px] text-muted group-hover:text-ink">{tr("Tell me what needs doing…")}</span>
          <kbd className="ml-auto hidden rounded-md border border-line bg-surface2 px-1.5 py-0.5 text-[11px] text-muted sm:block">N</kbd>
        </button>
      </Rise>

      {/* hero row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Rise className="lg:col-span-7">
          <NextUp data={data} />
        </Rise>
        <Rise className="lg:col-span-5">
          <TodayCard data={data} done={doneToday} total={todayTotal} />
        </Rise>
      </div>

      {/* stat tiles */}
      <Rise>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Tile href="/tasks?view=today" icon={CheckSquare} label={tr("Today's tasks")} value={data.today.length} />
          <Tile href="/tasks?view=overdue" icon={AlertTriangle} label={tr("Overdue")} value={data.overdue.length} tone={data.overdue.length ? "danger" : "ok"} />
          <Tile href="/interviews" icon={Landmark} label={tr("Interviews · 7 days")} value={data.upcoming_interviews.length} tone="gold" />
          <Tile href="/clients" icon={ClipboardList} label={tr("Pending applications")} value={data.pending_applications.total} />
          <Tile href="/documents" icon={FileWarning} label={tr("Awaiting documents")} value={data.awaiting_documents.length} tone={data.awaiting_documents.length ? "warning" : "ok"} />
          <Tile href="/gmail" icon={Mail} label={tr("Unread Gmail")} value={data.unread_gmail} hint={data.unread_gmail === null ? tr("Connect Gmail") : undefined} />
        </div>
      </Rise>

      {/* main columns */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          {data.overdue.length > 0 && (
            <Rise>
              <Card className="overflow-hidden border-danger/30">
                <div className="h-1 bg-gradient-to-r from-danger via-[#e8788a] to-danger" />
                <div className="p-5">
                  <SectionTitle icon={<AlertTriangle className="size-4 text-danger" />} title={`Overdue · ${data.overdue.length}`} sub="Finish, move or snooze these first" action={<Link href="/tasks?view=overdue" className="text-sm font-medium text-goldink hover:underline">{tr("View all")}</Link>} />
                  <ul className="-mx-3">
                    <AnimatePresence initial={false}>
                      {data.overdue.slice(0, 4).map((t) => (
                        <TaskRow key={t.id} task={t} />
                      ))}
                    </AnimatePresence>
                  </ul>
                </div>
              </Card>
            </Rise>
          )}
          <Rise>
            <Card className="p-5">
              <SectionTitle icon={<CheckSquare className="size-4" />} title={tr("Today's tasks")} sub={tr("{n} still to do · due later today", { n: data.today.length })} action={<Link href="/tasks?view=today" className="text-sm font-medium text-goldink hover:underline">{tr("Open planner")}</Link>} />
              {data.today.length === 0 ? (
                <EmptyState icon={<PartyPopper className="size-6" />} title={data.overdue.length ? tr("Nothing else due today") : tr("Today is clear")} body={data.overdue.length ? tr("Only the overdue items above are waiting.") : tr("Nothing left on today's list. Add a task or follow up with a client.")} action={<Button variant="gold" size="sm" onClick={() => app.openQuickAdd()}><Plus className="size-4" />{" "}{tr("New task")}</Button>} />
              ) : (
                <ul className="-mx-3">
                  <AnimatePresence initial={false}>
                    {data.today.slice(0, 7).map((t) => (
                      <TaskRow key={t.id} task={t} />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </Card>
          </Rise>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Rise>
              <Card className="h-full p-5">
                <SectionTitle icon={<FileWarning className="size-4" />} title={tr("Awaiting documents")} sub="Required items still missing" />
                {data.awaiting_documents.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted">{tr("Every client's required documents are in. 🎉")}</p>
                ) : (
                  <ul className="space-y-1">
                    {data.awaiting_documents.slice(0, 5).map((c) => (
                      <li key={c.case_id}>
                        <Link href={`/clients/${c.client_id}?tab=documents`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface2">
                          <Avatar name={c.full_name} size={34} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.full_name}</span>
                          <Chip tone={c.missing > 2 ? "danger" : "warning"}>{c.missing}{" "}{tr("missing")}</Chip>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Rise>
            <Rise>
              <Card className="h-full p-5">
                <SectionTitle icon={<UserRoundCheck className="size-4" />} title={tr("Needs a follow-up")} sub="No contact for 7+ days" />
                {data.needs_follow_up.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted">{tr("You're on top of every active client.")}</p>
                ) : (
                  <ul className="space-y-1">
                    {data.needs_follow_up.slice(0, 5).map((c) => (
                      <li key={c.client_id}>
                        <Link href={`/clients/${c.client_id}`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface2">
                          <Avatar name={c.full_name} size={34} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{c.full_name}</span>
                            <span className="block truncate text-xs text-muted">{tr(c.application_status)}</span>
                          </span>
                          <Chip tone={c.days_since > 14 ? "danger" : "warning"}>{c.days_since} d</Chip>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Rise>
          </div>
        </div>

        <div className="space-y-5 lg:col-span-5">
          <Rise>
            <Card className="p-5">
              <SectionTitle icon={<Landmark className="size-4" />} title={tr("Upcoming interviews")} sub="Next 7 days" action={<Link href="/interviews" className="text-sm font-medium text-goldink hover:underline">{tr("All")}</Link>} />
              {data.upcoming_interviews.length === 0 ? (
                <EmptyState icon={<CalendarClock className="size-6" />} title={tr("No interviews this week")} body={tr("Interviews you schedule show up here with a live countdown.")} />
              ) : (
                <ul className="space-y-3">
                  {data.upcoming_interviews.slice(0, 4).map((iv, i) => (
                    <InterviewCard key={iv.id} iv={iv} compact index={i} />
                  ))}
                </ul>
              )}
            </Card>
          </Rise>
          <Rise>
            <Card className="p-5">
              <SectionTitle icon={<Flag className="size-4" />} title={tr("Important deadlines")} sub="High priority · next 14 days" />
              {data.important_deadlines.length === 0 ? (
                <p className="py-5 text-center text-sm text-muted">{tr("No high-priority deadlines coming up.")}</p>
              ) : (
                <ul className="space-y-2">
                  {data.important_deadlines.slice(0, 5).map((t) => (
                    <li key={t.id}>
                      <Link href={`/tasks?open=${t.id}`} className="flex items-center gap-3 rounded-xl p-2.5 ring-1 ring-line transition hover:bg-surface2">
                        <span className="grid w-12 shrink-0 place-items-center rounded-lg bg-navy py-1 text-white dark:bg-gold dark:text-navy">
                          <span className="text-[10px] font-semibold uppercase leading-none opacity-70">{fmt(t.due_at, data.tz, "MMM")}</span>
                          <span className="font-display text-xl font-bold leading-tight">{fmt(t.due_at, data.tz, "d")}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{tr(t.title)}</span>
                          <span className="block truncate text-xs text-muted">{fmt(t.due_at, data.tz, "EEE HH:mm")}{t.client_name ? ` · ${t.client_name}` : ""}</span>
                        </span>
                        {t.priority === "Urgent" && <Chip tone="danger">{tr("Urgent")}</Chip>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Rise>
          <Rise>
            <WeeklyCard data={data} />
          </Rise>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Rise>
          <Card className="h-full p-5">
            <SectionTitle icon={<ClipboardList className="size-4" />} title={tr("Pending visa applications")} sub={`${data.pending_applications.total} active`} action={<Link href="/clients" className="text-sm font-medium text-goldink hover:underline">{tr("Pipeline")}</Link>} />
            <ul className="space-y-1">
              {data.pending_applications.items.map((c) => (
                <li key={c.client_id}>
                  <Link href={`/clients/${c.client_id}`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface2">
                    <Avatar name={c.full_name} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.full_name}</span>
                      <span className="block truncate text-xs text-muted">{tr(c.visa_category)}</span>
                    </span>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", STATUS_TONE[c.application_status])}>{tr(c.application_status)}</span>
                  </Link>
                </li>
              ))}
              {data.pending_applications.items.length === 0 && <p className="py-5 text-center text-sm text-muted">{tr("No active applications.")}</p>}
            </ul>
          </Card>
        </Rise>
        <Rise>
          <Card className="h-full p-5">
            <SectionTitle icon={<CheckCheck className="size-4" />} title={tr("Recently completed")} sub="Your latest wins" />
            {data.recently_completed.length === 0 ? (
              <p className="py-5 text-center text-sm text-muted">{tr("Completed tasks will appear here.")}</p>
            ) : (
              <ul className="space-y-1">
                {data.recently_completed.map((t, i) => (
                  <motion.li key={t.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.06 * i }} className="flex items-center gap-3 rounded-xl p-2">
                    <span className="grid size-7 place-items-center rounded-full bg-success/15 text-success">
                      <Check className="size-4" strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{tr(t.title)}</span>
                      <span className="block text-xs text-muted">{relativeDay(t.completed_at!, data.tz)} · {fmt(t.completed_at, data.tz, "HH:mm")}</span>
                    </span>
                  </motion.li>
                ))}
              </ul>
            )}
          </Card>
        </Rise>
      </div>
    </Stagger>
  );
}

/* ───────────────────────── pieces ───────────────────────── */
function Tile({ href, icon: Icon, label, value, tone = "plain", hint }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; value: number | null; tone?: "plain" | "danger" | "warning" | "gold" | "ok"; hint?: string }) {
  const accents = { plain: "text-goldink bg-gold/15", danger: "text-danger bg-danger/12", warning: "text-warning bg-warning/15", gold: "text-goldink bg-gold/20", ok: "text-success bg-success/12" };
  return (
    <Link href={href} className="block">
      <Card hover className="h-full p-4">
        <div className="flex items-start justify-between">
          <span className={cn("grid size-9 place-items-center rounded-xl", accents[tone])}>
            <Icon className="size-[18px]" />
          </span>
          <ArrowRight className="size-4 text-muted/50" />
        </div>
        <div className="mt-3 font-display text-4xl font-semibold leading-none">{value === null ? <span className="text-2xl text-muted">—</span> : <AnimatedNumber value={value} />}</div>
        <p className="mt-1.5 text-[12.5px] font-medium text-muted">{hint ?? label}</p>
      </Card>
    </Link>
  );
}

function NextUp({ data }: { data: DashboardData }) {
  const app = useApp();
  const actions = useTaskActions();
  const now = useNow(30_000);
  const t = data.next_task;
  if (!t) {
    return (
      <div className="hero-navy noise relative flex h-full min-h-[260px] flex-col items-center justify-center overflow-hidden rounded-[28px] p-8 text-center shadow-[var(--shadow-lift)]">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.3 }} className="mb-4 grid size-16 place-items-center rounded-full bg-gold/20 text-gold2">
          <CircleCheck className="size-8" />
        </motion.div>
        <h2 className="font-display text-3xl font-semibold">{tr("You're all caught up")}</h2>
        <p className="mt-1 text-white/65">{tr("No upcoming tasks. Enjoy the calm — or plan ahead.")}</p>
        <Button variant="gold" className="mt-5" onClick={() => app.openQuickAdd()}>
          <Plus className="size-4" />{" "}{tr("Add a task")}
        </Button>
      </div>
    );
  }
  const cd = countdownLabel(t.due_at ?? data.now, now);
  const overdue = t.due_at && new Date(t.due_at).getTime() < new Date(data.now).getTime();
  const frac = t.due_at && now ? 1 - Math.min(1, Math.max(0, (new Date(t.due_at).getTime() - now.getTime()) / 86_400_000)) : 0;
  return (
    <motion.div whileHover={{ y: -2 }} className="hero-navy noise relative h-full overflow-hidden rounded-[28px] p-6 shadow-[var(--shadow-lift)] sm:p-8">
      <span aria-hidden className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/2 w-1/4 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.26em] text-gold2">
            <span className="relative flex size-2"><span className="animate-pulse-ring absolute inline-flex size-full rounded-full bg-gold" /><span className="relative inline-flex size-2 rounded-full bg-gold" /></span>
            {overdue ? tr("Overdue — do this first") : tr("Next up")}
          </p>
          <h2 className="mt-3 font-display text-[1.9rem] font-semibold leading-[1.1] sm:text-4xl">{tr(t.title)}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-white/75">
            {t.client_name && t.client_id && (
              <Link href={`/clients/${t.client_id}`} className="flex items-center gap-2 font-medium text-white hover:text-gold2">
                <Avatar name={t.client_name} size={24} /> {t.client_name}
              </Link>
            )}
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: CATEGORY_COLORS[t.category] }} /> {tr(t.category)}</span>
            {t.due_at && <span className="tabular">{relativeDay(t.due_at, data.tz)} · {fmt(t.due_at, data.tz, "HH:mm")}</span>}
          </div>
        </div>
        <ProgressRing value={frac} size={92} stroke={7} tone={overdue ? "danger" : "gold"} className="hidden shrink-0 text-white sm:grid">
          <div className="text-center leading-none">
            <div className="tabular font-display text-2xl font-bold">{overdue ? "!" : cd.big}</div>
            <div className="mt-0.5 text-[10px] text-white/60">{overdue ? tr("late") : cd.small}</div>
          </div>
        </ProgressRing>
      </div>
      <div className="relative mt-6 flex flex-wrap gap-2.5">
        <Button variant="gold" onClick={() => actions.complete(t)}>
          <Check className="size-4" strokeWidth={3} />{" "}{tr("Complete")}
        </Button>
        <RescheduleMenu task={t} align="left">
          <Button variant="outline" className="!border-white/25 !bg-white/10 !text-white hover:!bg-white/20">
            <CalendarClock className="size-4" />{" "}{tr("Reschedule")}
          </Button>
        </RescheduleMenu>
        {t.client_phone && (
          <a href={phoneHref(t.client_phone)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-[15px] font-semibold hover:bg-white/20">
            <Phone className="size-4" />{" "}{tr("Call")}
          </a>
        )}
        {t.client_whatsapp && (
          <a href={whatsappHref(t.client_whatsapp)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-[15px] font-semibold hover:bg-white/20">
            <MessageCircle className="size-4" />{" "}{tr("WhatsApp")}
          </a>
        )}
      </div>
    </motion.div>
  );
}

function TodayCard({ data, done, total }: { data: DashboardData; done: number; total: number }) {
  const frac = total ? done / total : 1;
  return (
    <Card className="flex h-full flex-col justify-between p-6">
      <div className="flex items-center gap-5">
        <ProgressRing value={frac} size={118} stroke={10} className="shrink-0 text-ink">
          <div className="text-center leading-none">
            <div className="font-display text-3xl font-bold"><AnimatedNumber value={Math.round(frac * 100)} />%</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{tr("of today")}</div>
          </div>
        </ProgressRing>
        <div>
          <p className="font-display text-2xl font-semibold leading-tight">{total === 0 ? tr("A clear day") : done === total ? tr("Everything done") : tr("{n} left today", { n: total - done })}</p>
          <p className="mt-1 text-sm text-muted">{done}{" "}{tr("of")}{" "}{total}{" "}{tr("completed")}</p>
          <Link href="/tasks?view=today" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-goldink hover:underline">
            {tr("Open daily planner")}{" "}<ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
        {[
          { l: "Overdue", v: data.overdue.length, c: data.overdue.length ? "text-danger" : "" },
          { l: "Interviews", v: data.upcoming_interviews.length, c: "" },
          { l: "This week", v: data.weekly.reduce((n, w) => n + w.completed, 0), c: "text-success" },
        ].map((s) => (
          <div key={s.l}>
            <div className={cn("font-display text-2xl font-semibold", s.c)}><AnimatedNumber value={s.v} /></div>
            <div className="text-[11px] font-medium text-muted">{tr(s.l)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function WeeklyCard({ data }: { data: DashboardData }) {
  const max = Math.max(1, ...data.weekly.map((w) => Math.max(w.completed, w.due)));
  const today = fmt(data.now, data.tz, "yyyy-MM-dd");
  return (
    <Card className="p-5">
      <SectionTitle icon={<TrendingUp className="size-4" />} title={tr("Weekly productivity")} sub="Tasks completed · last 7 days" action={<Chip tone="gold">{data.weekly_rate}{tr("% on track")}</Chip>} />
      <div className="mt-2 flex h-40 items-end gap-2.5" role="img" aria-label={`Completed tasks per day: ${data.weekly.map((w) => `${w.label} ${w.completed}`).join(", ")}`}>
        {data.weekly.map((w, i) => (
          <div key={w.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <span className="tabular text-[11px] font-semibold text-muted">{w.completed || ""}</span>
            <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-xl bg-surface2">
              {w.due > 0 && <div className="absolute inset-x-0 bottom-0 rounded-xl border border-dashed border-gold/60" style={{ height: `${(w.due / max) * 100}%` }} aria-hidden />}
              <motion.div initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.25 + i * 0.07, duration: 0.9, ease: EASE }} style={{ height: `${(w.completed / max) * 100}%`, transformOrigin: "bottom" }} className={cn("w-full rounded-xl bg-gradient-to-t from-gold3 via-gold to-gold2", w.date === today && "shadow-[0_0_18px_rgba(201,168,106,0.7)]")} />
            </div>
            <span className={cn("text-[11px] font-medium", w.date === today ? "text-ink" : "text-muted")}>{tr(w.label)}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
        <span className="inline-block h-2.5 w-4 rounded border border-dashed border-gold/70" />{" "}{tr("due that day")}
        <span className="ml-3 inline-block h-2.5 w-4 rounded bg-gold" />{" "}{tr("completed")}
      </p>
    </Card>
  );
}

export { Hourglass };
