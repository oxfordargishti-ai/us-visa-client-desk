"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import luxon3Plugin from "@fullcalendar/luxon3";
import type { CalendarApi, EventContentArg, EventInput, DatesSetArg } from "@fullcalendar/core";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, Landmark, Plus, Sparkles } from "lucide-react";
import { Button, Card, IconButton, Segmented, cn, useToast } from "./ui";
import { useApp } from "./app-context";
import { useTaskActions } from "./task-bits";
import { api, ApiError } from "@/lib/client/api";
import { CATEGORY_COLORS, TASK_CATEGORIES, type TaskCategory } from "@/lib/constants";
import type { CalendarEventRow } from "@/lib/types";
import { DateTime } from "luxon";

type Mode = "day" | "week" | "month" | "agenda" | "interviews";
const VIEW: Record<Mode, string> = { day: "timeGridDay", week: "timeGridWeek", month: "dayGridMonth", agenda: "listWeek", interviews: "listMonth" };

export function CalendarView({ initialDate }: { initialDate?: string }) {
  const app = useApp();
  const toast = useToast();
  const router = useRouter();
  const actions = useTaskActions();
  const ref = React.useRef<FullCalendar>(null);
  const [mode, setMode] = React.useState<Mode | null>(null);
  const [title, setTitle] = React.useState("");
  const [hidden, setHidden] = React.useState<Set<TaskCategory>>(new Set());
  const hiddenRef = React.useRef(hidden);
  hiddenRef.current = hidden;
  const modeRef = React.useRef<Mode>("week");
  const [count, setCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    const m: Mode = window.matchMedia("(max-width: 767px)").matches ? "agenda" : "week";
    modeRef.current = m;
    setMode(m);
  }, []);
  const api_ = (): CalendarApi | undefined => ref.current?.getApi();

  const changeMode = (m: Mode) => {
    modeRef.current = m;
    setMode(m);
    api_()?.changeView(VIEW[m]);
    api_()?.refetchEvents();
  };

  // Refetch when data elsewhere changes (task completed, quick add, drawer save…).
  React.useEffect(() => {
    api_()?.refetchEvents();
  }, [app.dataVersion]);
  React.useEffect(() => {
    api_()?.refetchEvents();
  }, [hidden]);

  const fetchEvents = React.useCallback(
    async (info: { startStr: string; endStr: string }, ok: (e: EventInput[]) => void, fail: (e: Error) => void) => {
      try {
        const qs = new URLSearchParams({ start: new Date(info.startStr).toISOString(), end: new Date(info.endStr).toISOString() });
        if (modeRef.current === "interviews") qs.set("interviews_only", "true");
        const r = await api<{ events: CalendarEventRow[] }>(`/api/calendar/events?${qs}`);
        const now = Date.now();
        const evs = r.events
          .filter((e) => !hiddenRef.current.has(e.category))
          .map<EventInput>((e) => ({
            id: e.id,
            title: e.title,
            start: e.starts_at,
            end: e.ends_at,
            backgroundColor: CATEGORY_COLORS[e.category],
            borderColor: CATEGORY_COLORS[e.category],
            textColor: "#0b1426",
            classNames: [e.task_status === "completed" ? "uva-done" : "", e.task_status === "pending" && new Date(e.ends_at).getTime() < now ? "uva-overdue" : ""].filter(Boolean),
            extendedProps: { taskId: e.task_id, client: e.client_name, location: e.location, interview: e.is_interview, status: e.task_status, category: e.category, color: CATEGORY_COLORS[e.category] },
          }));
        setCount(evs.length);
        ok(evs);
      } catch (e) {
        fail(e as Error);
        toast({ tone: "error", title: "Couldn't load the calendar", body: e instanceof ApiError ? e.message : undefined });
      }
    },
    [toast],
  );

  const onDatesSet = (a: DatesSetArg) => setTitle(a.view.title);

  const move = async (info: { event: { id: string; startStr: string; endStr: string }; revert: () => void }) => {
    try {
      const r = await api<{ reminders: unknown[] }>(`/api/calendar/events/${info.event.id}`, { method: "PATCH", body: { starts_at: new Date(info.event.startStr).toISOString(), ends_at: info.event.endStr ? new Date(info.event.endStr).toISOString() : undefined } });
      toast({ tone: "success", title: "Rescheduled", body: `${DateTime.fromISO(info.event.startStr, { setZone: true }).setZone(app.tz).toFormat("EEE d MMM · HH:mm")} — ${r.reminders.length} reminder${r.reminders.length === 1 ? "" : "s"} updated` });
      app.bumpData();
    } catch (e) {
      info.revert();
      toast({ tone: "error", title: "Couldn't move it", body: e instanceof ApiError ? e.message : undefined });
    }
  };

  const toggleCat = (c: TaskCategory) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  const renderEvent = (arg: EventContentArg) => {
    const p = arg.event.extendedProps as { client?: string | null; interview?: boolean; status?: string; taskId: string; location?: string | null; color: string };
    const isMonth = arg.view.type === "dayGridMonth";
    const isList = arg.view.type.startsWith("list");
    if (isList) {
      return (
        <span className="flex flex-wrap items-center gap-x-2">
          {p.interview && <Landmark className="inline size-3.5 text-goldink" />}
          <b className="font-semibold">{arg.event.title}</b>
          {p.client && <span className="text-xs text-muted">{p.client}</span>}
          {p.location && <span className="text-xs text-muted">· {p.location}</span>}
        </span>
      );
    }
    return (
      <div className="flex min-w-0 items-start gap-1 overflow-hidden px-1 py-0.5 leading-tight">
        {!isMonth && p.status === "pending" && (
          <button
            aria-label="Mark complete"
            onClick={(e) => {
              e.stopPropagation();
              actions.complete({ id: p.taskId, title: arg.event.title });
            }}
            className="mt-px grid size-4 shrink-0 place-items-center rounded-full border border-navy/50 bg-white/30 hover:bg-white/80"
          >
            <Check className="size-2.5 opacity-0 hover:opacity-100" strokeWidth={4} />
          </button>
        )}
        <div className="min-w-0">
          <div className="truncate text-[11.5px] font-semibold">
            {p.interview && "★ "}
            {arg.timeText && <span className="mr-1 font-bold opacity-80">{arg.timeText}</span>}
            {arg.event.title}
          </div>
          {!isMonth && p.client && <div className="truncate text-[10.5px] opacity-75">{p.client}</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-goldink">Smart calendar</p>
          <h1 className="mt-1 font-display text-4xl font-semibold sm:text-5xl">Calendar</h1>
        </div>
        <div className="hidden sm:block">
          <Button variant="gold" size="lg" onClick={() => app.openQuickAdd()}>
            <Sparkles className="size-4" /> New task
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <IconButton label="Previous" onClick={() => api_()?.prev()}>
              <ChevronLeft className="size-5" />
            </IconButton>
            <IconButton label="Next" onClick={() => api_()?.next()}>
              <ChevronRight className="size-5" />
            </IconButton>
            <Button variant="soft" size="sm" onClick={() => api_()?.today()}>
              Today
            </Button>
            <div className="relative ml-2 h-9 min-w-[13rem] flex-1 overflow-hidden md:flex-none md:min-w-[17rem]">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.h2 key={title} initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -22, opacity: 0 }} transition={{ duration: 0.28 }} className="absolute inset-0 truncate font-display text-2xl font-semibold leading-9">
                  {title}
                </motion.h2>
              </AnimatePresence>
            </div>
          </div>
          <div className="-mx-1 overflow-x-auto px-1">
            {mode && (
              <Segmented<Mode>
                id="cal-mode"
                value={mode}
                onChange={changeMode}
                options={[
                  { value: "day", label: "Day" },
                  { value: "week", label: "Week" },
                  { value: "month", label: "Month" },
                  { value: "agenda", label: "Agenda" },
                  { value: "interviews", label: <span className="flex items-center gap-1.5"><Landmark className="size-3.5" /> Interviews</span> },
                ]}
              />
            )}
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto border-b border-line px-4 py-2.5" aria-label="Filter by category">
          {TASK_CATEGORIES.map((c) => {
            const off = hidden.has(c);
            return (
              <button key={c} onClick={() => toggleCat(c)} aria-pressed={!off} className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition", off ? "bg-transparent text-muted/60 ring-line line-through" : "bg-surface2 text-ink ring-line hover:ring-gold/60")}>
                <span className="size-2.5 rounded-full" style={{ background: off ? "transparent" : CATEGORY_COLORS[c], border: `1.5px solid ${CATEGORY_COLORS[c]}` }} />
                {c}
              </button>
            );
          })}
        </div>

        <div className="p-2 sm:p-4">
          {mode && (
            <FullCalendar
              ref={ref}
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxon3Plugin]}
              timeZone={app.tz}
              initialView={VIEW[mode]}
              initialDate={initialDate}
              headerToolbar={false}
              firstDay={1}
              nowIndicator
              editable
              eventStartEditable
              eventDurationEditable
              longPressDelay={350}
              eventLongPressDelay={350}
              selectLongPressDelay={350}
              dayMaxEvents={3}
              height="auto"
              slotMinTime="06:00:00"
              slotMaxTime="22:00:00"
              scrollTime={DateTime.now().setZone(app.tz).minus({ hours: 1 }).toFormat("HH:00:00")}
              slotDuration="00:30:00"
              allDaySlot={false}
              displayEventEnd={false}
              eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
              slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
              events={fetchEvents}
              datesSet={onDatesSet}
              eventContent={renderEvent}
              eventClick={(i) => {
                i.jsEvent.preventDefault();
                router.push(`/calendar?open=${i.event.extendedProps.taskId}`, { scroll: false });
              }}
              eventDrop={move}
              eventResize={move}
              dateClick={(i) => {
                const iso = i.allDay ? DateTime.fromISO(i.dateStr, { zone: app.tz }).set({ hour: 9 }).toUTC().toISO() : new Date(i.dateStr).toISOString();
                app.openQuickAdd({ mode: "manual", dueAt: iso });
              }}
              noEventsContent={() => (
                <div className="py-10 text-center text-sm text-muted">
                  Nothing scheduled here.{" "}
                  <button className="font-semibold text-goldink hover:underline" onClick={() => app.openQuickAdd()}>
                    Add a task
                  </button>
                </div>
              )}
            />
          )}
        </div>
      </Card>
      <p className="flex items-center gap-2 text-xs text-muted">
        <Plus className="size-3.5" /> Tap an empty slot to add a task · drag to reschedule (reminders follow automatically) · {count ?? "…"} item{count === 1 ? "" : "s"} in view · times shown in {app.tz}
      </p>
    </div>
  );
}
