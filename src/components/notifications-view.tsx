"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Bell, BellOff, BellRing, CheckCheck, Clock, Download, Mail, MonitorSmartphone, Send, Share, Smartphone, SquarePlus, Trash2, CircleCheck, Info, Volume2 } from "lucide-react";
import { Button, Card, Chip, EmptyState, Rise, SectionTitle, Segmented, Skeleton, Stagger, cn, useToast } from "./ui";
import { useApp } from "./app-context";
import { api, ApiError } from "@/lib/client/api";
import { ago, fmt } from "@/lib/client/format";
import { deviceLabel, disablePush, enablePush, getPushState, playChime, useInstall, type PushState } from "@/lib/client/hooks";
import type { NotificationRow } from "@/lib/types";

interface Payload {
  notifications: NotificationRow[];
  unread: number;
  devices: { id: string; device_label: string | null; user_agent: string | null; status: string; last_success_at: string | null; last_error: string | null; created_at: string }[];
  upcoming: { id: string; task_id: string; remind_at: string; status: string; title: string; last_error: string | null; attempt_count: number }[];
  capabilities: { push: boolean; email: boolean };
}

const STATUS_TONE = { sent: "success", failed: "danger", expired: "warning", skipped: "neutral", pending: "gold" } as const;
const CH_ICON = { push: BellRing, email: Mail, inapp: Bell } as const;

export function NotificationsView() {
  const app = useApp();
  const router = useRouter();
  const toast = useToast();
  const install = useInstall();
  const [data, setData] = React.useState<Payload | null>(null);
  const [tab, setTab] = React.useState<"inbox" | "log" | "scheduled">("inbox");
  const [push, setPush] = React.useState<PushState>("default");
  const [busy, setBusy] = React.useState(false);
  const [testRes, setTestRes] = React.useState<{ configured: boolean; devices: number; results: { device: string | null; status: string; error?: string }[] } | null>(null);

  const load = React.useCallback(async () => {
    try {
      setData(await api<Payload>("/api/notifications?channel=all&limit=120"));
    } catch {
      /* handled by api() for 401 */
    }
    setPush(await getPushState());
  }, []);
  React.useEffect(() => {
    load();
  }, [load, app.dataVersion]);

  async function turnOn() {
    setBusy(true);
    try {
      await enablePush(app.vapidKey, deviceLabel());
      toast({ tone: "success", title: "Alerts are on", body: "This device will now get reminders even when the app is closed." });
      await load();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't turn on alerts", body: e instanceof Error ? e.message : undefined });
      setPush(await getPushState());
    } finally {
      setBusy(false);
    }
  }
  async function turnOff() {
    await disablePush();
    toast({ tone: "info", title: "Alerts turned off for this device" });
    load();
  }
  async function test() {
    setBusy(true);
    try {
      const r = await api<NonNullable<typeof testRes>>("/api/push/test", { body: {} });
      setTestRes(r);
      if (app.soundEnabled) playChime();
      app.refreshUnread();
      load();
    } catch (e) {
      toast({ tone: "error", title: "Test failed", body: e instanceof ApiError ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const [emailBusy, setEmailBusy] = React.useState(false);
  async function testEmail() {
    setEmailBusy(true);
    try {
      const r = await api<{ ok: boolean; to: string }>("/api/notifications/test-email", { body: {} });
      toast({ tone: "success", title: "Test email sent", body: `Check the inbox of ${r.to} (and the spam folder).` });
    } catch (e) {
      toast({ tone: "error", title: "Test email failed", body: e instanceof ApiError ? e.message : undefined });
    } finally {
      setEmailBusy(false);
    }
  }

  const inbox = data?.notifications.filter((n) => n.channel === "inapp") ?? [];
  const log = data?.notifications.filter((n) => n.channel !== "inapp" || n.status !== "sent") ?? [];
  const pushConfigured = app.caps.push;

  return (
    <Stagger className="space-y-6">
      <Rise className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-goldink">Reminder centre</p>
          <h1 className="mt-1 font-display text-4xl font-semibold sm:text-5xl">Notifications</h1>
        </div>
        {inbox.some((n) => !n.read_at) && (
          <Button variant="outline" onClick={async () => { await api("/api/notifications/read", { body: { all: true } }); app.refreshUnread(); load(); }}><CheckCheck className="size-4" /> Mark all read</Button>
        )}
      </Rise>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-5">
          {/* this device */}
          <Rise>
            <Card className="overflow-hidden">
              <div className="hero-navy noise relative p-6">
                <div className="relative flex items-start gap-4">
                  <span className={cn("relative grid size-14 shrink-0 place-items-center rounded-2xl", push === "subscribed" ? "bg-success/25 text-emerald-300" : "bg-gold/20 text-gold2")}>
                    {push === "subscribed" && <span className="animate-pulse-ring absolute inset-0 rounded-2xl border-2 border-emerald-300/60" />}
                    {push === "subscribed" ? <BellRing className="size-7" /> : <BellOff className="size-7" />}
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-display text-2xl font-semibold leading-tight">
                      {!pushConfigured ? "Push alerts need server setup" : push === "subscribed" ? "Alerts are on for this device" : push === "denied" ? "Alerts are blocked" : push === "needs-install" ? "Install the app to get alerts" : push === "unsupported" ? "Background alerts aren't supported here" : "Turn on reminder alerts"}
                    </h2>
                    <p className="mt-1 text-sm text-white/70">
                      {!pushConfigured ? "The server's push keys aren't set yet — see the setup guide. In-app and email reminders still work." :
                        push === "subscribed" ? "Reminders arrive even when this app is closed." :
                        push === "denied" ? "Allow notifications for this site in your browser or phone settings, then reload." :
                        push === "needs-install" ? "On iPhone and iPad, alerts only work from the installed app. Follow the steps below." :
                        push === "unsupported" ? "You'll still see reminders here and get an email fallback." :
                        "Get a tap on the shoulder before every interview and call."}
                    </p>
                  </div>
                </div>
                <div className="relative mt-5 flex flex-wrap gap-2.5">
                  {pushConfigured && (push === "default" || push === "granted-unsubscribed") && <Button variant="gold" onClick={turnOn} loading={busy}><BellRing className="size-4" /> Turn on alerts</Button>}
                  {push === "subscribed" && (
                    <>
                      <Button variant="gold" onClick={test} loading={busy}><Send className="size-4" /> Send test notification</Button>
                      <Button variant="outline" className="!border-white/25 !bg-white/10 !text-white hover:!bg-white/20" onClick={turnOff}>Turn off</Button>
                    </>
                  )}
                  {(!pushConfigured || push === "unsupported" || push === "needs-install" || push === "denied") && <Button variant="gold" onClick={test} loading={busy}><Send className="size-4" /> Send in-app test</Button>}
                  {app.caps.email && <Button variant="outline" className="!border-white/25 !bg-white/10 !text-white hover:!bg-white/20" onClick={testEmail} loading={emailBusy}><Mail className="size-4" /> Send test email</Button>}
                </div>
              </div>
              <AnimatePresence>
                {testRes && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="space-y-2 p-5 text-sm">
                      <p className="flex items-center gap-2 font-semibold"><CircleCheck className="size-4 text-success" /> In-app test added to your inbox</p>
                      {!testRes.configured && <p className="text-muted">Push isn't configured on the server, so no device was contacted.</p>}
                      {testRes.configured && testRes.devices === 0 && <p className="text-muted">No device is subscribed yet — turn on alerts on a device first.</p>}
                      {testRes.results.map((r, i) => (
                        <p key={i} className="flex items-start gap-2">
                          <Chip tone={r.status === "sent" ? "success" : r.status === "expired" ? "warning" : "danger"}>{r.status}</Chip>
                          <span><b>{r.device}</b>{r.error && <span className="block text-xs text-muted">{r.error}</span>}</span>
                        </p>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          </Rise>

          {/* install + iOS guide */}
          <Rise>
            <Card className="p-5" id="install">
              <SectionTitle icon={<Smartphone className="size-4" />} title="Install on your phone or computer" sub={install.installed ? "Installed — you're using the app" : "Gets you an app icon and reliable alerts"} />
              {!install.installed && install.canInstall && <Button variant="gold" onClick={install.install}><Download className="size-4" /> Install app</Button>}
              <details className="group mt-3 rounded-2xl bg-surface2/70 p-4 open:ring-1 open:ring-gold/40" open={install.ios && !install.installed}>
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">iPhone &amp; iPad (Safari) <span className="text-xs font-medium text-muted group-open:hidden">Show steps</span></summary>
                <ol className="mt-3 space-y-3 text-sm">
                  {[
                    [Share, "Open this site in Safari and tap the Share button."],
                    [SquarePlus, "Choose “Add to Home Screen”, then tap Add."],
                    [Smartphone, "Open “Visa Desk” from your Home Screen (not from Safari)."],
                    [BellRing, "Come back to this page and tap “Turn on alerts”, then Allow."],
                  ].map(([I, t], i) => {
                    const Icon = I as typeof Share;
                    return <li key={i} className="flex items-start gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-gold text-xs font-bold text-navy">{i + 1}</span><span className="pt-0.5">{t as string}</span><Icon className="ml-auto size-4 shrink-0 text-muted" /></li>;
                  })}
                </ol>
                <p className="mt-3 flex gap-2 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" /> Requires iOS/iPadOS 16.4 or newer. Apple only allows web alerts for apps added to the Home Screen.</p>
              </details>
              <details className="group mt-2 rounded-2xl bg-surface2/70 p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">Android &amp; desktop (Chrome / Edge) <span className="text-xs font-medium text-muted group-open:hidden">Show steps</span></summary>
                <p className="mt-3 text-sm">Use the browser menu → <b>Install app</b> (or the Install button above). Then tap <b>Turn on alerts</b> and allow notifications. Alerts also work in a normal browser tab.</p>
              </details>
              <p className="mt-3 flex items-start gap-2 text-xs text-muted"><Volume2 className="mt-0.5 size-3.5 shrink-0" /> Sound: while the app is open you'll hear a soft chime. For background alerts your phone or computer's own notification sound is used — web apps can't set a custom one.</p>
            </Card>
          </Rise>

          <Rise>
            <Card className="p-5">
              <SectionTitle icon={<MonitorSmartphone className="size-4" />} title="Your devices" />
              {!data ? <Skeleton className="h-16" /> : data.devices.length === 0 ? <p className="rounded-xl bg-surface2 p-4 text-sm text-muted">No device is subscribed yet.</p> : (
                <ul className="space-y-2">
                  {data.devices.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 rounded-xl bg-surface2/70 p-3">
                      <Smartphone className="size-5 text-goldink" />
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{d.device_label || d.user_agent?.slice(0, 40) || "Device"}</p><p className="text-xs text-muted">{d.status === "expired" ? "Expired — turn alerts on again on that device" : d.last_success_at ? `Last alert ${ago(d.last_success_at)}` : `Added ${ago(d.created_at)}`}</p></div>
                      <Chip tone={d.status === "active" ? "success" : "warning"}>{d.status}</Chip>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Rise>
        </div>

        <div className="space-y-4 lg:col-span-7">
          <Rise>
            <Segmented<typeof tab> id="notif-tab" value={tab} onChange={setTab} options={[{ value: "inbox", label: <>Inbox{data && data.unread > 0 && <span className="ml-1.5 rounded-full bg-gold px-1.5 text-xs font-bold text-navy">{data.unread}</span>}</> }, { value: "scheduled", label: "Scheduled" }, { value: "log", label: "Delivery log" }]} />
          </Rise>
          <Rise>
            <Card className="p-2 sm:p-3">
              {!data && <div className="space-y-2 p-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
              {data && tab === "inbox" && (inbox.length === 0 ? <EmptyState icon={<Bell className="size-6" />} title="No notifications yet" body="Reminders appear here when they fire, even if you missed the push." /> : (
                <ul>
                  <AnimatePresence initial={false}>
                    {inbox.map((n) => (
                      <motion.li key={n.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex items-start gap-3 rounded-2xl p-3.5 transition", !n.read_at && "bg-gold/10")}>
                        <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", n.read_at ? "bg-surface3" : "bg-gold")} />
                        <button className="min-w-0 flex-1 text-left" onClick={async () => { if (!n.read_at) { await api("/api/notifications/read", { body: { ids: [n.id] } }); app.refreshUnread(); } if (n.url) router.push(n.url); }}>
                          <p className={cn("text-sm", !n.read_at && "font-semibold")}>{n.body}</p>
                          <p className="mt-0.5 text-xs text-muted">{ago(n.created_at)}</p>
                        </button>
                        {n.url?.startsWith("/tasks?open=") && (
                          <Button size="sm" variant="soft" onClick={async () => { await api(`/api/tasks/${n.url!.split("=")[1]}/snooze`, { body: { minutes: 15 } }); toast({ tone: "info", title: "Snoozed 15 minutes" }); }}><Clock className="size-3.5" /> 15 min</Button>
                        )}
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              ))}
              {data && tab === "scheduled" && (data.upcoming.length === 0 ? <EmptyState icon={<Clock className="size-6" />} title="Nothing scheduled" body="Reminders for your open tasks and interviews are listed here before they fire." /> : (
                <ul>
                  {data.upcoming.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 rounded-2xl p-3.5">
                      <span className="grid size-10 place-items-center rounded-xl bg-gold/15 text-goldink"><Clock className="size-5" /></span>
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.title}</p><p className="text-xs text-muted tabular">{fmt(r.remind_at, app.tz, "EEE d MMM · HH:mm")}{r.last_error && ` · ${r.last_error}`}</p></div>
                      <Chip tone={r.status === "failed" ? "danger" : r.attempt_count > 0 ? "warning" : "gold"}>{r.status === "pending" ? (r.attempt_count > 0 ? `retry ${r.attempt_count}` : "scheduled") : r.status}</Chip>
                    </li>
                  ))}
                </ul>
              ))}
              {data && tab === "log" && (log.length === 0 ? <EmptyState icon={<Send className="size-6" />} title="No deliveries yet" body="Every push, email and in-app delivery is recorded here with its outcome." /> : (
                <ul>
                  {log.map((n) => {
                    const Icon = CH_ICON[n.channel];
                    return (
                      <li key={n.id} className="flex items-start gap-3 rounded-2xl p-3.5">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface2 text-goldink"><Icon className="size-5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-medium">{n.body}</p>
                          <p className="text-xs text-muted">{n.channel === "inapp" ? "In-app" : n.channel === "push" ? "Push" : "Email"} · {ago(n.created_at)}</p>
                          {n.error && <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-[#8a5f10] dark:text-[#f0c36d]"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> {n.error}</p>}
                        </div>
                        <Chip tone={STATUS_TONE[n.status as keyof typeof STATUS_TONE] ?? "neutral"}>{n.status}</Chip>
                      </li>
                    );
                  })}
                </ul>
              ))}
            </Card>
          </Rise>
        </div>
      </div>
      <span className="hidden"><Trash2 /></span>
    </Stagger>
  );
}
