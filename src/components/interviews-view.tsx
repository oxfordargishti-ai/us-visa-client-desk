"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, Check, ChevronDown, ClipboardCheck, ExternalLink, FileCheck2, ListPlus, MapPin, MessageCircle, Phone, Plus, Trash2, Landmark } from "lucide-react";
import { Avatar, Button, Card, Chip, EmptyState, Field, Input, Modal, ProgressRing, Rise, Segmented, Select, Stagger, Textarea, cn, useToast } from "./ui";
import { useApp } from "./app-context";
import { countdownLabel } from "./interview-card";
import { api, ApiError } from "@/lib/client/api";
import { fmt, fromLocalInput, phoneHref, toLocalInput, whatsappHref } from "@/lib/client/format";
import { INTERVIEW_OUTCOMES, PREP_STATUSES, REMINDER_PRESETS, VISA_CATEGORIES } from "@/lib/constants";
import { useNow, useCreateIntent } from "@/lib/client/hooks";
import type { InterviewRow } from "@/lib/types";
import { DateTime } from "luxon";
import { tr } from "@/lib/i18n";

interface ClientOpt {
  id: string;
  full_name: string;
  embassy: string | null;
  visa_category: string | null;
}

export function InterviewsView({ upcoming, past, clients, defaults, scope }: { upcoming: InterviewRow[]; past: InterviewRow[]; clients: ClientOpt[]; defaults: number[]; scope: "upcoming" | "past" }) {
  const app = useApp();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  useCreateIntent("interview", () => setOpen(true));
  const list = scope === "upcoming" ? upcoming : past;
  return (
    <Stagger className="space-y-6">
      <Rise className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-goldink">{tr("Visa interviews")}</p>
          <h1 className="mt-1 font-display text-4xl font-semibold sm:text-5xl">{tr("Interviews")}</h1>
        </div>
        <Button variant="gold" size="lg" onClick={() => setOpen(true)} className="self-start">
          <Plus className="size-4" />{" "}{tr("Schedule interview")}
        </Button>
      </Rise>
      <Rise>
        <Segmented<"upcoming" | "past"> id="iv-scope" value={scope} onChange={(v) => router.replace(`/interviews?scope=${v}`, { scroll: false })} options={[{ value: "upcoming", label: <>{tr("Upcoming")}{" "}<span className="ml-1 text-xs opacity-70">{upcoming.length}</span></> }, { value: "past", label: "Past" }]} />
      </Rise>
      {list.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon={<Landmark className="size-6" />} title={scope === "upcoming" ? tr("No upcoming interviews") : tr("No past interviews yet")} body={tr("Schedule an interview and it appears here, on the calendar and on your dashboard — with reminders.")} action={<Button variant="gold" size="sm" onClick={() => setOpen(true)}><Plus className="size-4" />{" "}{tr("Schedule interview")}</Button>} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {list.map((iv, i) => (
            <Rise key={iv.id}>
              <InterviewPanel iv={iv} index={i} />
            </Rise>
          ))}
        </div>
      )}
      <ScheduleModal open={open} onClose={() => setOpen(false)} clients={clients} defaults={defaults} tz={app.tz} />
    </Stagger>
  );
}

function InterviewPanel({ iv, index }: { iv: InterviewRow; index: number }) {
  const app = useApp();
  const toast = useToast();
  const now = useNow(30_000);
  const cd = countdownLabel(iv.interview_at, now);
  const [open, setOpen] = React.useState(index === 0);
  const [checklist, setChecklist] = React.useState(iv.prep_checklist);
  const [notes, setNotes] = React.useState(iv.notes ?? "");
  const [resched, setResched] = React.useState(false);
  const [when, setWhen] = React.useState(toLocalInput(iv.interview_at, app.tz));
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setChecklist(iv.prep_checklist), [iv.prep_checklist]);
  const done = checklist.filter((c) => c.done).length;

  const patch = async (body: Record<string, unknown>, msg?: string) => {
    try {
      await api(`/api/interviews/${iv.id}`, { method: "PATCH", body });
      if (msg) toast({ tone: "success", title: msg });
      app.bumpData();
    } catch (e) {
      toast({ tone: "error", title: tr("Couldn't save"), body: e instanceof ApiError ? e.message : undefined });
    }
  };
  const toggle = (id: string) => {
    const next = checklist.map((c) => (c.id === id ? { ...c, done: !c.done } : c));
    setChecklist(next);
    patch({ checklist: next });
  };
  const urgent = now ? new Date(iv.interview_at).getTime() - now.getTime() < 36 * 3600_000 && !cd.past : false;

  return (
    <Card className={cn("overflow-hidden", urgent && "ring-2 ring-gold/50")}>
      <div className={cn("flex items-center gap-5 p-5", urgent && "bg-gradient-to-r from-gold/15 to-transparent")}>
        <ProgressRing value={cd.frac} size={92} stroke={8} tone={urgent ? "gold" : "success"} className="shrink-0 text-ink">
          <div className="text-center leading-none">
            <div className="tabular font-display text-2xl font-bold">{cd.big}</div>
            {cd.small && <div className="mt-0.5 text-[10px] font-medium text-muted">{cd.small}</div>}
          </div>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <Avatar name={iv.client_name ?? "?"} size={32} />
            <Link href={`/clients/${iv.client_id}`} className="truncate font-display text-2xl font-semibold hover:text-goldink">
              {iv.client_name}
            </Link>
          </div>
          <p className="mt-1.5 font-medium tabular">{fmt(iv.interview_at, app.tz, "EEEE d MMMM · HH:mm")}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
            <MapPin className="size-3.5" /> {iv.embassy ?? tr("Embassy not set")} {iv.visa_category && <>· {tr(iv.visa_category)}</>}
          </p>
        </div>
        <div className="hidden flex-col gap-1.5 sm:flex">
          {iv.client_phone && (
            <a href={phoneHref(iv.client_phone)} aria-label={tr("Call")} className="grid size-10 place-items-center rounded-xl bg-surface2 text-muted ring-1 ring-line hover:text-ink">
              <Phone className="size-4" />
            </a>
          )}
          {iv.client_whatsapp && (
            <a href={whatsappHref(iv.client_whatsapp)} target="_blank" rel="noopener noreferrer" aria-label={tr("WhatsApp")} className="grid size-10 place-items-center rounded-xl bg-surface2 text-muted ring-1 ring-line hover:text-ink">
              <MessageCircle className="size-4" />
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <label className="flex items-center gap-2 text-xs font-medium text-muted">
          {tr("Preparation")}
          <Select value={tr(iv.prep_status)} onChange={(e) => patch({ prep_status: e.target.value }, "Preparation updated")} className="h-9 w-36 text-sm" aria-label={tr("Preparation status")}>
            {PREP_STATUSES.map((s) => <option key={s} value={s}>{tr(s)}</option>)}
          </Select>
        </label>
        <Link href={`/clients/${iv.client_id}?tab=documents`} className="ml-auto">
          <Chip tone={iv.docs_status === "Complete" ? "success" : iv.docs_status === "Partial" ? "warning" : "danger"}>
            <FileCheck2 className="size-3" />{" "}{tr("Documents:")}{" "}{tr(iv.docs_status)}
          </Chip>
        </Link>
      </div>

      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between border-t border-line px-5 py-3 text-left text-sm font-semibold hover:bg-surface2/60">
        <span className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-goldink" />{" "}{tr("Preparation checklist")}
          <span className="tabular text-xs font-medium text-muted">{done}/{checklist.length}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface3 sm:block"><motion.span className="block h-full rounded-full bg-gradient-to-r from-gold2 to-gold" initial={false} animate={{ width: `${checklist.length ? (done / checklist.length) * 100 : 0}%` }} /></span>
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <ul className="space-y-1 px-5 pb-3">
              {checklist.map((c) => (
                <li key={c.id}>
                  <button onClick={() => toggle(c.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-surface2">
                    <span className={cn("grid size-5 shrink-0 place-items-center rounded-md border-2 transition", c.done ? "border-transparent bg-gold" : "border-linestrong")}>
                      {c.done && <Check className="size-3.5 text-navy" strokeWidth={3.5} />}
                    </span>
                    <span className={cn(c.done && "text-muted line-through")}>{tr(c.label)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-5 pb-4">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (iv.notes ?? "") && patch({ notes })} placeholder={tr("Interview notes…")} className="min-h-20 text-sm" aria-label={tr("Interview notes")} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface2/50 px-5 py-3">
        <Button size="sm" variant="soft" onClick={() => setResched(true)}><CalendarClock className="size-4" />{" "}{tr("Reschedule")}</Button>
        <Button size="sm" variant="soft" onClick={() => app.openQuickAdd({ title: `Follow up with ${iv.client_name} after interview`, clientId: iv.client_id, category: "Client Phone Call", dueAt: DateTime.fromISO(iv.interview_at).plus({ days: 1 }).toUTC().toISO() })}><ListPlus className="size-4" />{" "}{tr("Follow-up task")}</Button>
        <Select value={tr(iv.outcome)} onChange={(e) => patch({ outcome: e.target.value }, `Outcome: ${e.target.value}`)} className="h-9 w-44 text-sm" aria-label={tr("Interview outcome")}>
          {INTERVIEW_OUTCOMES.map((o) => <option key={o} value={o}>{tr(o)}</option>)}
        </Select>
        <Link href={`/clients/${iv.client_id}`} className="ml-auto text-sm font-medium text-goldink hover:underline">
          {tr("Open client")}{" "}<ExternalLink className="ml-0.5 inline size-3.5" />
        </Link>
        <Button size="sm" variant="ghost" className="text-danger" onClick={async () => {
          if (!confirm(tr("Remove {name}'s interview? Its reminders and calendar entry will be deleted.", { name: iv.client_name ?? "" }))) return;
          await api(`/api/interviews/${iv.id}`, { method: "DELETE" });
          app.bumpData();
        }} aria-label={tr("Delete interview")}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      <Modal open={resched} onClose={() => setResched(false)} title={tr("Reschedule interview")} subtitle={tr("Old reminders are cancelled and a new schedule is created.")} size="sm" footer={<><Button variant="outline" onClick={() => setResched(false)}>{tr("Cancel")}</Button><Button variant="gold" loading={busy} onClick={async () => { const iso = fromLocalInput(when, app.tz); if (!iso) return; setBusy(true); await patch({ interview_at: iso }, "Interview rescheduled"); setBusy(false); setResched(false); }}>{tr("Save new time")}</Button></>}>
        <Field label={tr("New date & time ({tz})", { tz: app.tz })}>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
      </Modal>
    </Card>
  );
}

export function ScheduleModal({ open, onClose, clients, defaults, tz }: { open: boolean; onClose: () => void; clients: ClientOpt[]; defaults: number[]; tz: string }) {
  const app = useApp();
  const toast = useToast();
  const [clientId, setClientId] = React.useState("");
  const [when, setWhen] = React.useState("");
  const [embassy, setEmbassy] = React.useState("");
  const [visa, setVisa] = React.useState("");
  const [offsets, setOffsets] = React.useState<number[]>(defaults);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setClientId(""); setWhen(""); setEmbassy(""); setVisa(""); setOffsets(defaults); setErr(null);
    }
  }, [open, defaults]);
  const pick = (id: string) => {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c) {
      setEmbassy(c.embassy ?? "");
      setVisa(c.visa_category ?? "");
    }
  };
  const iso = fromLocalInput(when, tz);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/interviews", { body: { client_id: clientId, interview_at: iso, embassy: embassy || null, visa_category: visa || null, reminder_offsets: offsets } });
      toast({ tone: "success", title: tr("Interview scheduled"), body: tr("Added to the calendar with reminders.") });
      app.bumpData();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tr("Couldn't schedule."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={tr("Schedule an interview")} subtitle={tr("It will appear on the calendar, the dashboard and the interview list.")} footer={<><Button variant="outline" onClick={onClose}>{tr("Cancel")}</Button><Button variant="gold" loading={busy} disabled={!clientId || !iso} onClick={submit}><Check className="size-4" />{" "}{tr("Schedule")}</Button></>}>
      <div className="space-y-4">
        <Field label={tr("Client")}>
          <Select value={clientId} onChange={(e) => pick(e.target.value)} data-autofocus>
            <option value="">{tr("Choose a client…")}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </Select>
        </Field>
        <Field label={tr("Interview date & time ({tz})", { tz })}>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Embassy or consulate")}><Input value={embassy} onChange={(e) => setEmbassy(e.target.value)} placeholder={tr("U.S. Embassy Yerevan")} /></Field>
          <Field label={tr("Visa category")}>
            <Select value={visa} onChange={(e) => setVisa(e.target.value)}>
              <option value="">—</option>
              {VISA_CATEGORIES.map((v) => <option key={v} value={v}>{tr(v)}</option>)}
              {visa && !VISA_CATEGORIES.includes(visa as never) && <option value={visa}>{tr(visa)}</option>}
            </Select>
          </Field>
        </div>
        <div>
          <span className="mb-2 block text-[13px] font-medium">{tr("Reminders")}</span>
          <div className="flex flex-wrap gap-2">
            {REMINDER_PRESETS.map((p) => {
              const on = offsets.includes(p.minutes);
              return (
                <button key={p.minutes} type="button" aria-pressed={on} onClick={() => setOffsets(on ? offsets.filter((x) => x !== p.minutes) : [...offsets, p.minutes])} className={cn("rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 transition", on ? "bg-gold/25 text-[#6b5019] ring-gold dark:text-gold2" : "bg-surface text-muted ring-line hover:ring-gold/60")}>
                  {on && "✓ "}{tr(p.label)}
                </button>
              );
            })}
          </div>
        </div>
        {err && <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{err}</p>}
      </div>
    </Modal>
  );
}
