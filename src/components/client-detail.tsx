"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  Archive, Check, ChevronRight, Download, Eye, FileText, History, ListChecks, Mail, MessageCircle, Mic, MicOff, Paperclip, Pencil, Phone, Pin, PinOff, Plus, Skull, StickyNote, Trash2, Upload, Wand2, Landmark, ShieldAlert, Search, CalendarPlus, Image as ImageIcon, FileCheck2, Link2Off, ExternalLink,
} from "lucide-react";
import { Avatar, Button, Card, Chip, EmptyState, Field, IconButton, Input, Modal, Segmented, Select, Textarea, cn, useToast, EASE } from "./ui";
import { useApp } from "./app-context";
import { TaskRow } from "./task-bits";
import { ScheduleModal } from "./interviews-view";
import { InterviewCard } from "./interview-card";
import { api, ApiError, upload } from "@/lib/client/api";
import { APPLICATION_STATUSES, DOCUMENT_CATEGORIES, PAYMENT_STATUSES, PREP_STATUSES, VISA_CATEGORIES } from "@/lib/constants";
import { ago, bytes, fmt, phoneHref, STATUS_TONE, whatsappHref } from "@/lib/client/format";
import { SPEECH_LANGS, useSpeech } from "@/lib/client/hooks";
import type { getClientDetail } from "@/lib/repo/clients";
import { tr } from "@/lib/i18n";

type Detail = NonNullable<Awaited<ReturnType<typeof getClientDetail>>>;
const TABS = [
  { key: "overview", label: "Overview", icon: ListChecks },
  { key: "tasks", label: "Tasks", icon: Check },
  { key: "notes", label: "Notes", icon: StickyNote },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "emails", label: "Emails", icon: Mail },
  { key: "timeline", label: "Timeline", icon: History },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function ClientDetail({ detail, tz, defaults, initialTab }: { detail: Detail; tz: string; defaults: number[]; initialTab: string }) {
  const app = useApp();
  const router = useRouter();
  const { client, cases, interviews, tasks, notes, documents, links, activity, checklist } = detail;
  const [tab, setTab] = React.useState<TabKey>((TABS.find((t) => t.key === initialTab)?.key ?? "overview") as TabKey);
  const [caseId, setCaseId] = React.useState(cases[0]?.id ?? "");
  const [edit, setEdit] = React.useState(false);
  const [sched, setSched] = React.useState(false);
  const kase = cases.find((c) => c.id === caseId) ?? cases[0];
  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const nextInterview = interviews.filter((i) => i.outcome === "Pending" && new Date(i.interview_at) > new Date(Date.now() - 2 * 3600_000)).sort((a, b) => a.interview_at.localeCompare(b.interview_at))[0];
  const idx = kase ? APPLICATION_STATUSES.indexOf(kase.application_status) : 0;

  const changeTab = (k: TabKey) => {
    setTab(k);
    window.history.replaceState(null, "", `/clients/${client.id}${k === "overview" ? "" : `?tab=${k}`}`);
  };

  return (
    <div className="space-y-6">
      <nav aria-label={tr("Breadcrumb")} className="flex items-center gap-1.5 text-sm text-muted">
        <Link href="/clients" className="hover:text-ink">{tr("Clients")}</Link> <ChevronRight className="size-3.5" /> <span className="text-ink">{client.full_name}</span>
      </nav>

      {/* header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="hero-navy noise relative overflow-hidden rounded-[28px] p-6 shadow-[var(--shadow-lift)] sm:p-8">
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center">
          <Avatar name={client.full_name} size={84} className="shadow-xl ring-4 ring-white/10" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-4xl font-semibold leading-none sm:text-5xl">{client.full_name}</h1>
              <button onClick={() => setEdit(true)} aria-label={tr("Edit client details")} className="grid size-9 place-items-center rounded-xl bg-white/10 hover:bg-white/20"><Pencil className="size-4" /></button>
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/65">
              <span className="tabular">{client.client_code}</span>
              {kase && <span>{tr(kase.visa_category)}</span>}
              {kase?.embassy && <span>{kase.embassy}</span>}
              {client.preferred_language && <span className="uppercase">{client.preferred_language}</span>}
            </p>
            {kase && <span className={cn("mt-3 inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold ring-1 ring-inset", "text-navy ring-white/40")}>{tr(kase.application_status)}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {client.phone && <a href={phoneHref(client.phone)} className="inline-flex h-12 items-center gap-2 rounded-2xl bg-gradient-to-br from-gold2 to-gold3 px-5 font-semibold text-navy shadow-lg"><Phone className="size-4" />{" "}{tr("Call")}</a>}
            {client.whatsapp && <a href={whatsappHref(client.whatsapp)} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-5 font-semibold hover:bg-white/20"><MessageCircle className="size-4" />{" "}{tr("WhatsApp")}</a>}
            {client.email && <a href={`mailto:${client.email}`} className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-5 font-semibold hover:bg-white/20"><Mail className="size-4" />{" "}{tr("Email")}</a>}
          </div>
        </div>

        {kase && (
          <div className="relative mt-7 overflow-x-auto pb-1" aria-label={tr("Application progress")}>
            <ol className="flex min-w-[780px] items-center">
              {APPLICATION_STATUSES.map((s, i) => {
                const done = i < idx, now = i === idx;
                return (
                  <li key={s} className="flex flex-1 items-center last:flex-none">
                    <div className="flex flex-col items-center gap-1.5">
                      <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15 + i * 0.05 }} className={cn("relative grid size-7 place-items-center rounded-full text-[11px] font-bold", done ? "bg-gold text-navy" : now ? "bg-white text-navy ring-4 ring-gold/50" : "bg-white/10 text-white/50")}>
                        {done ? <Check className="size-3.5" strokeWidth={3.5} /> : i + 1}
                        {now && <span className="animate-pulse-ring absolute inset-0 rounded-full border-2 border-gold" />}
                      </motion.span>
                      <span className={cn("w-20 text-center text-[10px] font-medium leading-tight", now ? "text-white" : done ? "text-gold2" : "text-white/40")}>{tr(s)}</span>
                    </div>
                    {i < APPLICATION_STATUSES.length - 1 && (
                      <div className="relative -mt-5 mx-1 h-0.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: done ? 1 : 0 }} transition={{ delay: 0.3 + i * 0.07, duration: 0.5, ease: EASE }} style={{ transformOrigin: "left" }} className="h-full bg-gold" />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </motion.div>

      <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <div role="tablist" className="relative flex w-max gap-1 rounded-2xl bg-surface2 p-1">
          {TABS.map((t) => {
            const count = t.key === "tasks" ? pendingTasks.length : t.key === "notes" ? notes.length : t.key === "documents" ? documents.length : t.key === "emails" ? links.length : 0;
            return (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => changeTab(t.key)} className={cn("relative z-10 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors", tab === t.key ? "text-navy" : "text-muted hover:text-ink")}>
                {tab === t.key && <motion.span layoutId="client-tab" className="absolute inset-0 -z-10 rounded-xl bg-white shadow-md dark:bg-gold" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <t.icon className="size-4" /> {tr(t.label)}
                {count > 0 && <span className="rounded-full bg-navy/10 px-1.5 text-[11px] tabular">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
          {tab === "overview" && kase && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="space-y-5 lg:col-span-7">
                <CaseCard kase={kase} cases={cases} setCaseId={setCaseId} clientId={client.id} />
                <Card className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[15px] font-semibold">{tr("Outstanding actions")}</h2>
                    <Button size="sm" variant="soft" onClick={() => app.openQuickAdd({ clientId: client.id })}><Plus className="size-4" />{" "}{tr("Task")}</Button>
                  </div>
                  {pendingTasks.length === 0 && checklist.filter((c) => c.case_id === kase.id && c.required && c.status === "missing").length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted">{tr("Nothing outstanding for this client. 🎉")}</p>
                  ) : (
                    <>
                      <ul className="-mx-3">
                        {pendingTasks.slice(0, 5).map((t) => <TaskRow key={t.id} task={t} showClient={false} compact />)}
                      </ul>
                      {checklist.filter((c) => c.case_id === kase.id && c.required && c.status === "missing").length > 0 && (
                        <button onClick={() => changeTab("documents")} className="mt-2 flex w-full items-center gap-3 rounded-xl bg-warning/10 px-4 py-3 text-left text-sm font-medium ring-1 ring-warning/30">
                          <FileText className="size-4 text-warning" />
                          {tr("Waiting for")}{" "}{checklist.filter((c) => c.case_id === kase.id && c.required && c.status === "missing").map((c) => c.label.split(" (")[0].toLowerCase()).join(", ")}
                          <ChevronRight className="ml-auto size-4" />
                        </button>
                      )}
                    </>
                  )}
                </Card>
              </div>
              <div className="space-y-5 lg:col-span-5">
                <Card className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[15px] font-semibold">{tr("Interview")}</h2>
                    <Button size="sm" variant="soft" onClick={() => setSched(true)}><CalendarPlus className="size-4" />{" "}{tr("Schedule")}</Button>
                  </div>
                  {nextInterview ? (
                    <ul><InterviewCard iv={{ ...nextInterview, client_name: client.full_name, client_phone: client.phone, client_whatsapp: client.whatsapp }} /></ul>
                  ) : (
                    <p className="rounded-xl bg-surface2 p-4 text-sm text-muted">{tr("No interview scheduled yet.")}</p>
                  )}
                </Card>
                <Card className="space-y-3 p-5 text-sm">
                  <h2 className="text-[15px] font-semibold">{tr("Contact")}</h2>
                  {[["Phone", client.phone], ["WhatsApp", client.whatsapp], ["Email", client.email]].map(([l, v]) => (
                    <div key={l} className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"><span className="text-muted">{l}</span><span className="truncate font-medium">{v || "—"}</span></div>
                  ))}
                  <p className="pt-1 text-xs text-muted">{tr("Client since")}{" "}{fmt(client.created_at, tz, "d MMM yyyy")}</p>
                </Card>
                <DangerZone client={client} />
              </div>
            </div>
          )}
          {tab === "tasks" && (
            <Card className="p-4 sm:p-5">
              <div className="mb-2 flex items-center justify-between px-2">
                <h2 className="text-[15px] font-semibold">{tr("Tasks for")}{" "}{client.full_name}</h2>
                <Button size="sm" variant="gold" onClick={() => app.openQuickAdd({ clientId: client.id })}><Plus className="size-4" />{" "}{tr("New task")}</Button>
              </div>
              {tasks.length === 0 ? <EmptyState icon={<ListChecks className="size-6" />} title={tr("No tasks yet")} body={tr("Add a call, a reminder or a document request for this client.")} /> : <ul className="-mx-1"><AnimatePresence initial={false}>{tasks.map((t) => <TaskRow key={t.id} task={t} showClient={false} />)}</AnimatePresence></ul>}
            </Card>
          )}
          {tab === "notes" && <NotesTab clientId={client.id} notes={notes} />}
          {tab === "documents" && <DocumentsTab client={client} documents={documents} checklist={checklist.filter((c) => c.case_id === kase?.id)} caseId={kase?.id ?? null} />}
          {tab === "emails" && <EmailsTab clientId={client.id} email={client.email} links={links} />}
          {tab === "timeline" && <Timeline activity={activity} notes={notes} tz={tz} />}
        </motion.div>
      </AnimatePresence>

      <EditClientModal open={edit} onClose={() => setEdit(false)} client={client} />
      <ScheduleModal open={sched} onClose={() => setSched(false)} clients={[{ id: client.id, full_name: client.full_name, embassy: kase?.embassy ?? null, visa_category: kase?.visa_category ?? null }]} defaults={defaults} tz={tz} />
      <span className="hidden">{router ? "" : ""}</span>
    </div>
  );
}

/* ───────────── case card ───────────── */
function CaseCard({ kase, cases, setCaseId, clientId }: { kase: Detail["cases"][number]; cases: Detail["cases"]; setCaseId: (id: string) => void; clientId: string }) {
  const app = useApp();
  const toast = useToast();
  const [f, setF] = React.useState({ visa_category: kase.visa_category, embassy: kase.embassy ?? "", ds160_confirmation: kase.ds160_confirmation ?? "", application_status: kase.application_status, payment_status: kase.payment_status, interview_prep_status: kase.interview_prep_status });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setF({ visa_category: kase.visa_category, embassy: kase.embassy ?? "", ds160_confirmation: kase.ds160_confirmation ?? "", application_status: kase.application_status, payment_status: kase.payment_status, interview_prep_status: kase.interview_prep_status }), [kase]);
  const dirty = JSON.stringify(f) !== JSON.stringify({ visa_category: kase.visa_category, embassy: kase.embassy ?? "", ds160_confirmation: kase.ds160_confirmation ?? "", application_status: kase.application_status, payment_status: kase.payment_status, interview_prep_status: kase.interview_prep_status });
  async function save() {
    setBusy(true);
    try {
      await api(`/api/cases/${kase.id}`, { method: "PATCH", body: f });
      toast({ tone: "success", title: tr("Case updated") });
      app.bumpData();
    } catch (e) {
      toast({ tone: "error", title: tr("Couldn't save"), body: e instanceof ApiError ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{tr("Case details")}</h2>
        <div className="flex items-center gap-2">
          {cases.length > 1 && <Select value={kase.id} onChange={(e) => setCaseId(e.target.value)} className="h-9 w-48 text-sm" aria-label={tr("Choose case")}>{cases.map((c) => <option key={c.id} value={c.id}>{tr(c.visa_category)} · {tr(c.application_status)}</option>)}</Select>}
          <Button size="sm" variant="soft" onClick={async () => { await api(`/api/clients/${clientId}/cases`, { body: { visa_category: "B1/B2 Visitor" } }); app.bumpData(); }}><Plus className="size-4" />{" "}{tr("Case")}</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Application status")}><Select value={tr(f.application_status)} onChange={(e) => setF({ ...f, application_status: e.target.value as typeof f.application_status })}>{APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{tr(s)}</option>)}</Select></Field>
        <Field label={tr("Visa category")}><Select value={tr(f.visa_category)} onChange={(e) => setF({ ...f, visa_category: e.target.value })}>{[...new Set([...VISA_CATEGORIES, f.visa_category])].map((s) => <option key={s} value={s}>{tr(s)}</option>)}</Select></Field>
        <Field label={tr("Embassy or consulate")}><Input value={f.embassy} onChange={(e) => setF({ ...f, embassy: e.target.value })} /></Field>
        <Field label={tr("DS-160 confirmation number")}><Input value={f.ds160_confirmation} onChange={(e) => setF({ ...f, ds160_confirmation: e.target.value })} placeholder={tr("AA00XXXXXX")} autoComplete="off" /></Field>
        <Field label={tr("Payment status")}><Select value={tr(f.payment_status)} onChange={(e) => setF({ ...f, payment_status: e.target.value as typeof f.payment_status })}>{PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{tr(s)}</option>)}</Select></Field>
        <Field label={tr("Interview preparation")}><Select value={tr(f.interview_prep_status)} onChange={(e) => setF({ ...f, interview_prep_status: e.target.value as typeof f.interview_prep_status })}>{PREP_STATUSES.map((s) => <option key={s} value={s}>{tr(s)}</option>)}</Select></Field>
      </div>
      <AnimatePresence>
        {dirty && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setF({ visa_category: kase.visa_category, embassy: kase.embassy ?? "", ds160_confirmation: kase.ds160_confirmation ?? "", application_status: kase.application_status, payment_status: kase.payment_status, interview_prep_status: kase.interview_prep_status })}>{tr("Discard")}</Button>
              <Button variant="gold" size="sm" loading={busy} onClick={save}>{tr("Save changes")}</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

/* ───────────── notes ───────────── */
const NOTE_ICON = { note: "📝", call: "📞", whatsapp: "💬", email: "✉️", meeting: "🤝" } as const;
function NotesTab({ clientId, notes }: { clientId: string; notes: Detail["notes"] }) {
  const app = useApp();
  const toast = useToast();
  const [body, setBody] = React.useState("");
  const [kind, setKind] = React.useState<keyof typeof NOTE_ICON>("note");
  const [pin, setPin] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const speech = useSpeech((t) => setBody((p) => (p ? p + " " : "") + t));
  const shown = q ? notes.filter((n) => n.body.toLowerCase().includes(q.toLowerCase())) : notes;
  async function add() {
    setBusy(true);
    try {
      await api("/api/notes", { body: { client_id: clientId, body, kind, pinned: pin } });
      setBody(""); setPin(false);
      app.bumpData();
    } catch (e) {
      toast({ tone: "error", title: tr("Couldn't save the note"), body: e instanceof ApiError ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <Card className="h-fit p-5 lg:col-span-5">
        <h2 className="mb-3 text-[15px] font-semibold">{tr("Add a note")}</h2>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(Object.keys(NOTE_ICON) as (keyof typeof NOTE_ICON)[]).map((k) => (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={cn("rounded-full px-3 py-1.5 text-xs font-medium capitalize ring-1 transition", kind === k ? "bg-gold/25 ring-gold" : "bg-surface2 ring-line text-muted hover:ring-gold/60")}>{NOTE_ICON[k]} {tr(k)}</button>
          ))}
        </div>
        <div className="relative">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={tr("What happened? e.g. Client asked for a call on Thursday to discuss the interview.")} className="min-h-32 pr-14" aria-label={tr("Note")} />
          {speech.supported && (
            <div className="absolute right-3 top-3 flex flex-col items-center gap-1">
              <button type="button" onClick={speech.listening ? speech.stop : speech.start} aria-label={speech.listening ? tr("Stop dictation") : tr("Dictate note")} className={cn("relative grid size-10 place-items-center rounded-full", speech.listening ? "bg-danger text-white" : "bg-surface2 hover:bg-surface3")}>
                {speech.listening && <span className="animate-pulse-ring absolute inset-0 rounded-full border-2 border-danger" />}
                {speech.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </button>
              <button type="button" onClick={() => speech.setLang(SPEECH_LANGS[(SPEECH_LANGS.findIndex((l) => l.code === speech.lang) + 1) % SPEECH_LANGS.length].code)} className="rounded px-1 text-[10px] font-bold text-muted hover:bg-surface2" aria-label={tr("Dictation language")}>{SPEECH_LANGS.find((l) => l.code === speech.lang)?.label}</button>
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <button onClick={() => setPin(!pin)} className={cn("flex items-center gap-1.5 text-sm font-medium", pin ? "text-goldink" : "text-muted")}>{pin ? <Pin className="size-4" /> : <PinOff className="size-4" />} {pin ? tr("Pinned") : tr("Pin note")}</button>
          <Button variant="gold" size="sm" onClick={add} loading={busy} disabled={!body.trim()}>{tr("Save note")}</Button>
        </div>
      </Card>
      <div className="space-y-3 lg:col-span-7">
        {notes.length > 3 && <div className="relative"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search notes…")} className="pl-10" aria-label={tr("Search notes")} /></div>}
        {shown.length === 0 && <Card className="p-4"><EmptyState icon={<StickyNote className="size-6" />} title={tr("No notes yet")} body={tr("Log calls, WhatsApp chats and decisions here. Turn any note into a follow-up task.")} /></Card>}
        <AnimatePresence initial={false}>
          {shown.map((n) => (
            <motion.div key={n.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
              <Card className={cn("p-4", n.pinned && "ring-1 ring-gold/50")}>
                <div className="flex items-start gap-3">
                  <span className="text-lg" aria-hidden>{NOTE_ICON[n.kind]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{n.body}</p>
                    <p className="mt-2 text-xs text-muted">{ago(n.created_at)} · <span className="capitalize">{tr(n.kind)}</span>{n.pinned && tr(" · pinned")}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row">
                    <IconButton label={tr("Turn into a task")} onClick={() => app.openQuickAdd({ text: n.body, clientId, mode: "ai", source: "note", sourceRef: n.id })} className="size-9"><Wand2 className="size-4" /></IconButton>
                    <IconButton label={n.pinned ? tr("Unpin") : tr("Pin")} onClick={async () => { await api(`/api/notes/${n.id}`, { method: "PATCH", body: { pinned: !n.pinned } }); app.bumpData(); }} className="size-9">{n.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}</IconButton>
                    <IconButton label={tr("Delete note")} onClick={async () => { if (confirm(tr("Delete this note?"))) { await api(`/api/notes/${n.id}`, { method: "DELETE" }); app.bumpData(); } }} className="size-9 text-danger"><Trash2 className="size-4" /></IconButton>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ───────────── documents ───────────── */
export function DocumentsTab({ client, documents, checklist, caseId }: { client: { id: string; full_name: string }; documents: Detail["documents"]; checklist: Detail["checklist"]; caseId: string | null }) {
  const app = useApp();
  const toast = useToast();
  const [cat, setCat] = React.useState<string>("Passport");
  const [drag, setDrag] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [preview, setPreview] = React.useState<Detail["documents"][number] | null>(null);
  const [newItem, setNewItem] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function send(files: FileList | File[], category = cat) {
    setUploading(true);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("client_id", client.id);
      fd.set("category", category);
      if (caseId) fd.set("case_id", caseId);
      try {
        await upload("/api/documents", fd, app.caps.maxUploadMb ?? 15);
        toast({ tone: "success", title: tr("Document stored privately"), body: file.name });
      } catch (e) {
        toast({ tone: "error", title: `Couldn't upload ${file.name}`, body: e instanceof ApiError ? e.message : undefined });
      }
    }
    setUploading(false);
    app.bumpData();
  }
  const missingReq = checklist.filter((c) => c.required && c.status === "missing").length;
  const done = checklist.filter((c) => c.status !== "missing").length;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <Card className="h-fit p-5 lg:col-span-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{tr("Document checklist")}</h2>
          <Chip tone={missingReq ? "warning" : "success"}>{missingReq ? tr("{n} required missing", { n: missingReq }) : tr("All required in")}</Chip>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface3"><motion.div className="h-full rounded-full bg-gradient-to-r from-gold2 to-gold" initial={{ width: 0 }} animate={{ width: `${checklist.length ? (done / checklist.length) * 100 : 0}%` }} transition={{ duration: 0.8, ease: EASE }} /></div>
        <ul className="space-y-1">
          {checklist.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-surface2">
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs", c.status === "received" ? "bg-success text-white" : c.status === "waived" ? "bg-surface3 text-muted" : "border-2 border-linestrong")}>{c.status === "received" ? <Check className="size-3.5" strokeWidth={3.5} /> : c.status === "waived" ? "–" : ""}</span>
              <span className="min-w-0 flex-1 text-sm"><span className={cn(c.status !== "missing" && "text-muted")}>{tr(c.label)}</span>{!c.required && <span className="ml-1.5 text-[11px] text-muted">{tr("optional")}</span>}</span>
              {c.status === "missing" && (
                <>
                  <button onClick={() => { setCat(c.category); fileRef.current?.click(); }} className="rounded-lg px-2 py-1 text-xs font-semibold text-goldink hover:bg-gold/15">{tr("Upload")}</button>
                  <button onClick={async () => { await api(`/api/checklist/${c.id}`, { method: "PATCH", body: { status: "waived" } }); app.bumpData(); }} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface3">{tr("Waive")}</button>
                </>
              )}
              {c.status !== "missing" && c.status === "waived" && <button onClick={async () => { await api(`/api/checklist/${c.id}`, { method: "PATCH", body: { status: "missing" } }); app.bumpData(); }} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface3">{tr("Undo")}</button>}
            </li>
          ))}
        </ul>
        {caseId && (
          <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!newItem.trim()) return; await api(`/api/cases/${caseId}/checklist`, { body: { label: newItem, category: cat, required: false } }); setNewItem(""); app.bumpData(); }}>
            <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder={tr("Add a checklist item…")} className="h-10 text-sm" aria-label={tr("New checklist item")} />
            <Button type="submit" variant="soft" size="sm" className="h-10"><Plus className="size-4" /></Button>
          </form>
        )}
      </Card>

      <div className="space-y-5 lg:col-span-7">
        <Card
          className={cn("border-2 border-dashed p-6 text-center transition-colors", drag ? "border-gold bg-gold/10" : "border-linestrong")}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) send(e.dataTransfer.files); }}
        >
          <motion.div animate={drag ? { scale: 1.12, y: -4 } : { scale: 1, y: 0 }} className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-gold/15 text-goldink"><Upload className="size-6" /></motion.div>
          <p className="font-display text-xl font-semibold">{tr("Drop files here")}</p>
          <p className="mt-1 text-sm text-muted">{tr("PDF, JPG, PNG, WEBP, HEIC, DOCX · up to")}{" "}{app.caps.maxUploadMb ?? 15}{" "}{tr("MB · stored privately")}</p>
          <div className="mx-auto mt-4 flex max-w-sm flex-col gap-2 sm:flex-row">
            <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={tr("Document category")} className="h-11">{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{tr(c)}</option>)}</Select>
            <Button variant="gold" loading={uploading} onClick={() => fileRef.current?.click()}><Paperclip className="size-4" />{" "}{tr("Choose file")}</Button>
          </div>
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx,.txt" onChange={(e) => { if (e.target.files?.length) send(e.target.files); e.target.value = ""; }} />
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="mb-2 px-1 text-[15px] font-semibold">{tr("Files")}{" "}<span className="font-normal text-muted">· {documents.length}</span></h2>
          {documents.length === 0 ? <EmptyState icon={<FileText className="size-6" />} title={tr("No files yet")} body={tr("Uploaded files are visible only to you and never public.")} /> : (
            <ul className="space-y-1.5">
              <AnimatePresence initial={false}>
                {documents.map((d) => (
                  <motion.li key={d.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }} className="flex items-center gap-3 rounded-2xl bg-surface2/60 p-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-goldink ring-1 ring-line">{d.mime_type.startsWith("image/") ? <ImageIcon className="size-5" /> : <FileText className="size-5" />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.filename}</p>
                      <p className="text-xs text-muted">{tr(d.category)} · {bytes(d.size_bytes)} · {ago(d.uploaded_at)}{d.source === "gmail" && tr(" · from Gmail")}</p>
                    </div>
                    {["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(d.mime_type) && <IconButton label={tr("Preview")} onClick={() => setPreview(d)} className="size-9"><Eye className="size-4" /></IconButton>}
                    <a href={`/api/documents/${d.id}/download`} aria-label={`Download ${d.filename}`} className="grid size-9 place-items-center rounded-xl text-ink/80 hover:bg-surface3"><Download className="size-4" /></a>
                    <IconButton label={tr("Delete file")} onClick={async () => { if (!confirm(tr("Permanently delete {name}?", { name: d.filename }))) return; await api(`/api/documents/${d.id}`, { method: "DELETE" }); app.bumpData(); }} className="size-9 text-danger"><Trash2 className="size-4" /></IconButton>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Card>
      </div>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.filename} subtitle={preview ? `${tr(preview.category)} · ${client.full_name}` : undefined} size="xl">
        {preview && (preview.mime_type === "application/pdf" ? <iframe title={preview.filename} src={`/api/documents/${preview.id}/download?inline=1`} className="h-[70dvh] w-full rounded-2xl border border-line bg-white" /> : /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/documents/${preview.id}/download?inline=1`} alt={preview.filename} className="mx-auto max-h-[70dvh] rounded-2xl" />)}
      </Modal>
    </div>
  );
}

/* ───────────── emails ───────────── */
function EmailsTab({ clientId, email, links }: { clientId: string; email: string | null; links: Detail["links"] }) {
  const app = useApp();
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <h2 className="text-[15px] font-semibold">{tr("Linked email conversations")}</h2>
        <Link href={`/gmail?client=${clientId}`}><Button size="sm" variant="gold" disabled={!email}><Search className="size-4" />{" "}{tr("Find emails with this client")}</Button></Link>
      </div>
      {!email && <p className="mb-3 rounded-xl bg-warning/10 p-3 text-sm text-[#7a520c] dark:text-[#f0c36d]">{tr("Add this client's email address to search for their messages.")}</p>}
      {links.length === 0 ? <EmptyState icon={<Mail className="size-6" />} title={tr("No emails linked yet")} body={tr("Open a conversation in Gmail and confirm the link — nothing is ever linked automatically.")} /> : (
        <ul className="space-y-2">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-3 rounded-2xl bg-surface2/60 p-3.5">
              <span className="grid size-10 place-items-center rounded-xl bg-gold/15 text-goldink"><Mail className="size-5" /></span>
              <Link href={`/gmail?thread=${l.thread_id}`} className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.subject || tr("(no subject)")}</p>
                <p className="truncate text-xs text-muted">{l.from_addr} · {l.last_message_at ? ago(l.last_message_at) : ""}</p>
              </Link>
              <IconButton label={tr("Unlink conversation")} onClick={async () => { await api(`/api/gmail/threads/${encodeURIComponent(l.thread_id)}/link`, { method: "DELETE", body: { client_id: clientId } }); app.bumpData(); }} className="size-9"><Link2Off className="size-4" /></IconButton>
              <a href={`https://mail.google.com/mail/u/0/#all/${l.thread_id}`} target="_blank" rel="noopener noreferrer" aria-label={tr("Open in Gmail")} className="grid size-9 place-items-center rounded-xl hover:bg-surface3"><ExternalLink className="size-4" /></a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ───────────── timeline ───────────── */
function Timeline({ activity, notes, tz }: { activity: Detail["activity"]; notes: Detail["notes"]; tz: string }) {
  const items = [
    ...activity.map((a) => ({ id: a.id, at: a.created_at, text: a.summary, kind: a.action.split(".")[0] })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  void notes;
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-[15px] font-semibold">{tr("Activity timeline")}</h2>
      {items.length === 0 ? <p className="py-6 text-center text-sm text-muted">{tr("No activity recorded yet.")}</p> : (
        <ol className="relative ml-3 space-y-5 border-l border-linestrong pl-6">
          {items.map((a, i) => (
            <motion.li key={a.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }} className="relative">
              <span className="absolute -left-[31px] top-1 size-3 rounded-full bg-gold ring-4 ring-surface" />
              <p className="text-sm font-medium">{a.text}</p>
              <p className="text-xs text-muted tabular">{fmt(a.at, tz, "d MMM yyyy · HH:mm")} · {ago(a.at)}</p>
            </motion.li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/* ───────────── edit / danger ───────────── */
function EditClientModal({ open, onClose, client }: { open: boolean; onClose: () => void; client: Detail["client"] }) {
  const app = useApp();
  const toast = useToast();
  const [f, setF] = React.useState({ full_name: client.full_name, email: client.email ?? "", phone: client.phone ?? "", whatsapp: client.whatsapp ?? "", preferred_language: client.preferred_language ?? "hy" });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setF({ full_name: client.full_name, email: client.email ?? "", phone: client.phone ?? "", whatsapp: client.whatsapp ?? "", preferred_language: client.preferred_language ?? "hy" }); setErr(null); } }, [open, client]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={tr("Edit client")} size="md" footer={<><Button variant="outline" onClick={onClose}>{tr("Cancel")}</Button><Button variant="gold" loading={busy} disabled={!f.full_name.trim()} onClick={async () => { setBusy(true); setErr(null); try { await api(`/api/clients/${client.id}`, { method: "PATCH", body: f }); toast({ tone: "success", title: tr("Client updated") }); app.bumpData(); onClose(); } catch (e) { setErr(e instanceof ApiError ? e.message : tr("Couldn't save.")); } finally { setBusy(false); } }}>{tr("Save")}</Button></>}>
      <div className="space-y-4">
        <Field label={tr("Full name")}><Input value={f.full_name} onChange={set("full_name")} data-autofocus /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Phone")}><Input value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
          <Field label={tr("WhatsApp")}><Input value={f.whatsapp} onChange={set("whatsapp")} inputMode="tel" /></Field>
          <Field label={tr("Email")}><Input type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label={tr("Language")}><Select value={f.preferred_language} onChange={set("preferred_language")}><option value="hy">{tr("Armenian")}</option><option value="ru">{tr("Russian")}</option><option value="en">{tr("English")}</option></Select></Field>
        </div>
        {err && <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{err}</p>}
      </div>
    </Modal>
  );
}

function DangerZone({ client }: { client: Detail["client"] }) {
  const router = useRouter();
  const toast = useToast();
  const [erase, setErase] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Card className="border-danger/20 p-5">
      <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold"><ShieldAlert className="size-4 text-danger" />{" "}{tr("Archive or erase")}</h2>
      <p className="mb-3 text-sm text-muted">{tr("Archiving hides the client and stops their reminders. Erasing permanently deletes everything, including files.")}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={async () => { if (!confirm(tr("Archive {name}? Their reminders will stop.", { name: client.full_name }))) return; await api(`/api/clients/${client.id}`, { method: "DELETE" }); toast({ tone: "info", title: tr("Client archived") }); router.push("/clients"); router.refresh(); }}><Archive className="size-4" />{" "}{tr("Archive")}</Button>
        <Button size="sm" variant="danger" onClick={() => setErase(true)}><Skull className="size-4" />{" "}{tr("Erase permanently")}</Button>
      </div>
      <Modal open={erase} onClose={() => setErase(false)} title={tr("Erase this client forever?")} size="sm" footer={<><Button variant="outline" onClick={() => setErase(false)}>{tr("Keep client")}</Button><Button variant="danger" loading={busy} disabled={name.trim().toLowerCase() !== client.full_name.trim().toLowerCase()} onClick={async () => { setBusy(true); try { const r = await api<{ files_removed: number }>(`/api/clients/${client.id}/erase`, { body: { confirm_name: name } }); toast({ tone: "info", title: tr("Client erased"), body: `${r.files_removed} file(s) removed` }); router.push("/clients"); router.refresh(); } catch (e) { toast({ tone: "error", title: tr("Couldn't erase"), body: e instanceof ApiError ? e.message : undefined }); setBusy(false); } }}>{tr("Erase forever")}</Button></>}>
        <p className="text-sm">{tr("This permanently deletes")}{" "}<b>{client.full_name}</b>{tr(", their cases, notes, tasks, interviews, email links, uploaded documents and activity history. It cannot be undone.")}</p>
        <Field label={`Type “${client.full_name}” to confirm`} className="mt-4"><Input value={name} onChange={(e) => setName(e.target.value)} data-autofocus autoComplete="off" /></Field>
      </Modal>
    </Card>
  );
}

export { FileCheck2, Landmark };
