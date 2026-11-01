"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, Brain, CalendarSync, CheckCircle2, Database, Download, KeyRound, Lock, Palette, ShieldCheck, TriangleAlert, XCircle, Mail, Globe, HardDrive, Timer, Cpu } from "lucide-react";
import { Button, Card, Chip, Field, Input, Rise, Segmented, Select, Stagger, Switch, cn, useToast } from "./ui";
import { useApp } from "./app-context";
import { useTheme } from "./providers";
import { api, ApiError } from "@/lib/client/api";
import { REMINDER_PRESETS } from "@/lib/constants";
import type { Prefs } from "@/lib/types";

const TZ_COMMON = ["Asia/Yerevan", "Europe/London", "Europe/Moscow", "Europe/Berlin", "Asia/Dubai", "America/New_York", "America/Chicago", "America/Los_Angeles", "UTC"];

interface StatusItem { key: string; label: string; ok: boolean; warn?: boolean; detail: string; extra?: string }

export function SettingsView({ prefs: initial, email, name, flash }: { prefs: Prefs; email: string; name: string; flash: string | null }) {
  const app = useApp();
  const toast = useToast();
  const { theme, setTheme } = useTheme();
  const [p, setP] = React.useState(initial);
  const [status, setStatus] = React.useState<StatusItem[] | null>(null);
  const [gm, setGm] = React.useState<{ connected: boolean; calendar_scope: boolean; calendar_sync_enabled: boolean; account: string | null } | null>(null);
  const [pw, setPw] = React.useState({ current: "", next: "" });
  const [pwBusy, setPwBusy] = React.useState(false);
  const [syncBusy, setSyncBusy] = React.useState(false);

  React.useEffect(() => {
    api<{ items: StatusItem[] }>("/api/system/status").then((r) => setStatus(r.items)).catch(() => undefined);
    api<{ connected: boolean; calendar_scope: boolean; calendar_sync_enabled: boolean; account: string | null }>("/api/gmail/status").then(setGm).catch(() => undefined);
    if (flash) toast({ tone: "info", title: flash });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save<K extends keyof Prefs>(patch: Pick<Prefs, K> | Partial<Prefs>, quiet = false) {
    const prev = p;
    setP({ ...p, ...patch });
    try {
      const r = await api<{ preferences: Prefs }>("/api/preferences", { method: "PATCH", body: patch });
      setP(r.preferences);
      if (!quiet) toast({ tone: "success", title: "Saved" });
      app.bumpData();
    } catch (e) {
      setP(prev);
      toast({ tone: "error", title: "Couldn't save", body: e instanceof ApiError ? e.message : undefined });
    }
  }
  const toggleOffset = (key: "default_task_reminders" | "default_interview_reminders", m: number) => {
    const cur = p[key];
    save({ [key]: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => a - b) } as Partial<Prefs>);
  };

  const tzs = React.useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : TZ_COMMON;
    return [...new Set([p.timezone, ...TZ_COMMON, ...all])];
  }, [p.timezone]);

  return (
    <Stagger className="mx-auto max-w-4xl space-y-6">
      <Rise>
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-goldink">Preferences</p>
        <h1 className="mt-1 font-display text-4xl font-semibold sm:text-5xl">Settings</h1>
      </Rise>

      {/* setup status */}
      <Rise>
        <Card className="p-5">
          <Head icon={<Cpu className="size-4" />} title="Setup status" sub="What's connected, and what still needs your credentials" />
          {!status ? <div className="skeleton h-24" /> : (
            <ul className="divide-y divide-line">
              {status.map((s) => (
                <li key={s.key} className="flex items-start gap-3 py-3">
                  {s.ok ? <CheckCircle2 className={cn("mt-0.5 size-5 shrink-0", s.warn ? "text-warning" : "text-success")} /> : <XCircle className="mt-0.5 size-5 shrink-0 text-warning" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{s.label}</p>
                    <p className="text-[13px] text-muted">{s.detail}</p>
                    {s.extra && <p className="mt-0.5 text-[13px] font-medium text-danger">{s.extra}</p>}
                  </div>
                  <Chip tone={s.ok && !s.warn ? "success" : "warning"}>{s.ok && !s.warn ? "Ready" : "Needs setup"}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Rise>

      <Rise>
        <Card className="p-5">
          <Head icon={<Palette className="size-4" />} title="Appearance & time" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Theme"><Segmented<"light" | "dark" | "system"> id="theme" value={theme} onChange={(t) => { setTheme(t); }} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "Auto" }]} /></Field>
            <Field label="Timezone" hint="All task times and reminders are shown in this zone (stored as UTC)."><Select value={p.timezone} onChange={(e) => save({ timezone: e.target.value })}>{tzs.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          </div>
        </Card>
      </Rise>

      <Rise>
        <Card className="p-5">
          <Head icon={<BellRing className="size-4" />} title="Reminders" sub="Defaults for new tasks and interviews — you can still change each one" />
          <OffsetPicker label="New tasks" value={p.default_task_reminders} onToggle={(m) => toggleOffset("default_task_reminders", m)} />
          <div className="h-5" />
          <OffsetPicker label="Interviews" value={p.default_interview_reminders} onToggle={(m) => toggleOffset("default_interview_reminders", m)} />
          <div className="mt-6 space-y-1 border-t border-line pt-3">
            <Row title="Push notifications" desc="Server-sent alerts to your subscribed devices, even when the app is closed." checked={p.notif_push} onChange={(v) => save({ notif_push: v })} />
            <Row title="Email fallback" desc="If no device can receive a push, email the reminder instead." checked={p.notif_email_fallback} onChange={(v) => save({ notif_email_fallback: v })} />
            <Row title="Chime while the app is open" desc="A soft sound for in-app reminders. Background alerts use your device's own sound." checked={p.sound_enabled} onChange={(v) => save({ sound_enabled: v })} />
            <Field label="Send fallback emails to" className="pt-3"><Input type="email" defaultValue={p.notification_email ?? email} onBlur={(e) => e.target.value && e.target.value !== p.notification_email && save({ notification_email: e.target.value })} /></Field>
          </div>
        </Card>
      </Rise>

      <Rise>
        <Card className="p-5">
          <Head icon={<Brain className="size-4" />} title="AI & privacy" sub="You decide what Claude can see. Everything it proposes needs your approval." />
          <Row title="AI task capture" desc="Turn plain-English sentences into a task preview. Nothing is saved without your confirmation." checked={p.ai_task_parsing} onChange={(v) => save({ ai_task_parsing: v })} />
          <Row title="Share client names with Claude" desc="Lets Claude spell and recognise client names. When off, names are matched on this server only." checked={p.ai_share_client_names} onChange={(v) => save({ ai_share_client_names: v })} />
          <Row title="AI email summaries (opt-in)" desc="Sends a trimmed copy of a conversation you open — with ID/phone numbers and quoted history masked — to Claude. Off by default." checked={p.ai_email_analysis} onChange={(v) => save({ ai_email_analysis: v })} />
          <Row title="AI day suggestions" desc="Suggests an order for today's tasks. Advice only — tasks are never changed." checked={p.ai_planner_suggestions} onChange={(v) => save({ ai_planner_suggestions: v })} />
          <p className="mt-3 flex gap-2 rounded-xl bg-surface2 p-3 text-xs text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> Passport images and document files are never sent to AI. Claude never gives legal conclusions or approval predictions in this app.</p>
        </Card>
      </Rise>

      <Rise>
        <Card className="p-5">
          <Head icon={<CalendarSync className="size-4" />} title="Google Calendar" sub="Optional one-way sync: tasks and interviews appear in your Google Calendar" />
          {!app.caps.google ? <p className="rounded-xl bg-surface2 p-4 text-sm text-muted">Google isn't configured on the server yet.</p> : !gm ? <div className="skeleton h-16" /> : !gm.calendar_scope ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-md text-sm text-muted">Adds permission to create events (only events — nothing else) in the Google account you sign in with. Event titles include client names.</p>
              <Button variant="gold" onClick={() => (window.location.href = "/api/gmail/connect?for=calendar")}><CalendarSync className="size-4" /> Connect Google Calendar</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Row title="Sync to Google Calendar" desc={`Account: ${gm.account ?? "—"}`} checked={gm.calendar_sync_enabled} onChange={async (v) => { try { const r = await api<{ synced?: number; failed?: number }>("/api/google-calendar/settings", { body: { enabled: v } }); setGm({ ...gm, calendar_sync_enabled: v }); toast({ tone: "success", title: v ? `Sync on — ${r.synced ?? 0} events sent` : "Sync off" }); } catch (e) { toast({ tone: "error", title: "Couldn't change sync", body: e instanceof ApiError ? e.message : undefined }); } }} />
              <Button variant="soft" size="sm" loading={syncBusy} disabled={!gm.calendar_sync_enabled} onClick={async () => { setSyncBusy(true); try { const r = await api<{ synced: number; failed: number }>("/api/google-calendar/settings", { body: { sync_now: true, mark_all_dirty: true } }); toast({ tone: r.failed ? "error" : "success", title: `${r.synced} synced${r.failed ? `, ${r.failed} failed` : ""}` }); } catch (e) { toast({ tone: "error", title: "Sync failed", body: e instanceof ApiError ? e.message : undefined }); } finally { setSyncBusy(false); } }}>Sync now</Button>
            </div>
          )}
          <div className="mt-4 border-t border-line pt-4">
            <Link href="/gmail" className="flex items-center gap-2 text-sm font-semibold text-goldink hover:underline"><Mail className="size-4" /> Manage Gmail connection</Link>
          </div>
        </Card>
      </Rise>

      <Rise>
        <Card className="p-5">
          <Head icon={<Database className="size-4" />} title="Your data" sub="You own it. Export or delete any time." />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[13px] font-medium">Export everything</p>
              <a href="/api/export" className="inline-flex h-11 items-center gap-2 rounded-xl border border-linestrong bg-surface px-4 text-[15px] font-semibold hover:bg-surface2"><Download className="size-4" /> Download JSON</a>
              <p className="mt-1.5 text-xs text-muted">Clients, tasks, notes, interviews, history. Secrets are never included.</p>
            </div>
            <Field label="Auto-delete documents of closed cases after" hint="Only affects cases marked “Case Closed”. Off by default.">
              <Select value={p.document_retention_days ?? ""} onChange={(e) => save({ document_retention_days: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Never (keep until I delete them)</option>
                {[90, 180, 365, 730].map((d) => <option key={d} value={d}>{d} days</option>)}
              </Select>
            </Field>
          </div>
        </Card>
      </Rise>

      <Rise>
        <Card className="p-5">
          <Head icon={<KeyRound className="size-4" />} title="Password" sub={`${name} · ${email}`} />
          <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setPwBusy(true); try { await api("/api/auth/password", { body: pw }); toast({ tone: "success", title: "Password changed", body: "Other devices were signed out." }); setPw({ current: "", next: "" }); } catch (e) { toast({ tone: "error", title: "Couldn't change password", body: e instanceof ApiError ? e.message : undefined }); } finally { setPwBusy(false); } }}>
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></Field>
            <Field label="New password" hint="At least 10 characters with letters and numbers."><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required minLength={10} /></Field>
            <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={pwBusy} disabled={!pw.current || pw.next.length < 10}><Lock className="size-4" /> Change password</Button></div>
          </form>
        </Card>
      </Rise>

      <Rise>
        <p className="px-1 pb-6 text-xs leading-relaxed text-muted">US VISA WITH ARGISHTI is an independent visa application support service, not affiliated with the U.S. government. This desk organises your work; it does not provide legal conclusions or guarantee visa outcomes.</p>
      </Rise>
      <span className="hidden"><Globe /><HardDrive /><Timer /><TriangleAlert /><AnimatePresence><motion.span /></AnimatePresence></span>
    </Stagger>
  );
}

function Head({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="grid size-9 place-items-center rounded-xl bg-gold/15 text-goldink">{icon}</span>
      <div><h2 className="text-[16px] font-semibold">{title}</h2>{sub && <p className="text-[13px] text-muted">{sub}</p>}</div>
    </div>
  );
}
function Row({ title, desc, checked, onChange }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-5 py-3">
      <div><p className="text-[15px] font-medium">{title}</p><p className="mt-0.5 max-w-xl text-[13px] text-muted">{desc}</p></div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}
function OffsetPicker({ label, value, onToggle }: { label: string; value: number[]; onToggle: (m: number) => void }) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {REMINDER_PRESETS.map((r) => {
          const on = value.includes(r.minutes);
          return <button key={r.minutes} onClick={() => onToggle(r.minutes)} aria-pressed={on} className={cn("rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 transition", on ? "bg-gold/25 text-[#6b5019] ring-gold dark:text-gold2" : "bg-surface text-muted ring-line hover:ring-gold/60")}>{on && "✓ "}{r.label}</button>;
        })}
      </div>
    </div>
  );
}
