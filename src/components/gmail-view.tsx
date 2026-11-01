"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowUpRight, Download, ExternalLink, FolderInput, Inbox, ListPlus, Lock, Mail, MailCheck, Paperclip, RefreshCw, Search, ShieldCheck, Sparkles, Unplug, UserCheck, Link2, X } from "lucide-react";
import { Avatar, Button, Card, Chip, Drawer, EmptyState, Field, Input, Rise, Segmented, Select, Skeleton, Stagger, cn, useToast } from "./ui";
import { useApp } from "./app-context";
import { api, ApiError } from "@/lib/client/api";
import { ago, bytes } from "@/lib/client/format";
import { DOCUMENT_CATEGORIES } from "@/lib/constants";
import { useDebounced } from "@/lib/client/hooks";
import type { EmailAnalysis } from "@/lib/ai/assist";
import { tr } from "@/lib/i18n";

interface Status {
  configured: boolean;
  connected: boolean;
  account: string | null;
  expected_account: string;
  gmail_scope: boolean;
  last_error: string | null;
  unread: number | null;
  ai_email_analysis: boolean;
}
interface Msg {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  subject: string;
  date: string | null;
  snippet: string;
  unread: boolean;
  needs_action: boolean;
  action_reasons: string[];
  suggestion: { client_id: string; full_name: string } | null;
  linked: { client_id: string; full_name: string; status: string } | null;
}
interface ThreadMsg { id: string; from: string; fromName: string; to: string; subject: string; date: string | null; body?: string; snippet: string; attachments?: { messageId: string; attachmentId: string; filename: string; mimeType: string; size: number }[] }
interface ClientOpt { id: string; full_name: string; email: string | null }

const ERR: Record<string, string> = {
  not_configured: "Google isn't set up on the server yet.",
  cancelled: "You cancelled the Google consent screen — nothing was connected.",
  invalid_state: "That sign-in link expired. Please try connecting again.",
  no_refresh_token: "Google didn't grant ongoing access. Remove “US Visa Desk” from myaccount.google.com/permissions and connect again.",
  scope_missing: "Gmail permission wasn't ticked on the consent screen. Connect again and allow access to read email.",
  exchange_failed: "Google couldn't complete the connection. Please try again.",
  google_error: "Google reported a problem. Please try again.",
};

export function GmailView({ clients, initialThread, initialClient, error, justConnected }: { clients: ClientOpt[]; initialThread: string | null; initialClient: string; error: string | null; justConnected: boolean }) {
  const app = useApp();
  const toast = useToast();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [msgs, setMsgs] = React.useState<Msg[] | null>(null);
  const [err, setErr] = React.useState<{ text: string; code?: string } | null>(null);
  const [unreadOnly, setUnreadOnly] = React.useState(!initialClient);
  const [q, setQ] = React.useState("");
  const [clientId, setClientId] = React.useState(initialClient);
  const [thread, setThread] = React.useState<string | null>(initialThread);
  const [loading, setLoading] = React.useState(false);
  const dq = useDebounced(q, 350);

  React.useEffect(() => {
    api<Status>("/api/gmail/status").then(setStatus).catch(() => setStatus(null));
  }, [app.dataVersion]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ unread: unreadOnly ? "1" : "0" });
      if (dq) qs.set("q", dq);
      if (clientId) qs.set("client_id", clientId);
      const r = await api<{ messages: Msg[] }>(`/api/gmail/messages?${qs}`);
      setMsgs(r.messages);
    } catch (e) {
      setMsgs([]);
      setErr({ text: e instanceof ApiError ? e.message : "Couldn't load Gmail.", code: e instanceof ApiError ? e.code : undefined });
    } finally {
      setLoading(false);
    }
  }, [unreadOnly, dq, clientId]);

  const ready = status?.connected && status.gmail_scope;
  React.useEffect(() => {
    if (ready) load();
  }, [ready, load, app.dataVersion]);

  async function disconnect() {
    if (!confirm(tr("Disconnect Gmail? Stored access is deleted and revoked at Google. Linked conversations stay on client records."))) return;
    await api("/api/gmail/disconnect", { body: {} });
    toast({ tone: "info", title: tr("Gmail disconnected"), body: tr("Access was revoked and stored tokens deleted.") });
    setMsgs(null);
    app.bumpData();
  }

  const urgent = msgs?.filter((m) => m.needs_action).length ?? 0;
  return (
    <Stagger className="space-y-6">
      <Rise className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-goldink">{tr("Read-only inbox")}</p>
          <h1 className="mt-1 font-display text-4xl font-semibold sm:text-5xl">{tr("Gmail")}</h1>
        </div>
        {ready && (
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="success"><MailCheck className="size-3.5" /> {status?.account}</Chip>
            {status?.account && status.expected_account && status.account.toLowerCase() !== status.expected_account.toLowerCase() && <Chip tone="warning"><AlertTriangle className="size-3" />{" "}{tr("Not")}{" "}{status.expected_account}</Chip>}
            <Button size="sm" variant="outline" onClick={load} loading={loading}><RefreshCw className="size-4" />{" "}{tr("Refresh")}</Button>
            <Button size="sm" variant="ghost" onClick={disconnect}><Unplug className="size-4" />{" "}{tr("Disconnect")}</Button>
          </div>
        )}
      </Rise>

      {error && <Rise><p role="alert" className="rounded-2xl bg-danger/10 p-4 text-sm font-medium text-danger">{ERR[error] ? tr(ERR[error]) : tr("Something went wrong connecting Gmail.")}</p></Rise>}
      {justConnected && ready && <Rise><p className="rounded-2xl bg-success/10 p-4 text-sm font-medium text-success">{tr("Connected — you're reading real mail from")}{" "}{status?.account}{tr(". No password was shared.")}</p></Rise>}

      {status && !status.configured && (
        <Rise>
          <Card className="p-6">
            <h2 className="font-display text-2xl font-semibold">{tr("Google isn't set up yet")}</h2>
            <p className="mt-1 text-muted">{tr("Gmail needs a Google Cloud OAuth client. Add")}{" "}<code className="rounded bg-surface2 px-1.5 py-0.5 text-[13px]">{tr("GOOGLE_CLIENT_ID")}</code>{" "}{tr("and")}{" "}<code className="rounded bg-surface2 px-1.5 py-0.5 text-[13px]">{tr("GOOGLE_CLIENT_SECRET")}</code>{" "}{tr("to the server settings — the README walks through it in about ten minutes.")}</p>
          </Card>
        </Rise>
      )}

      {status?.configured && !ready && (
        <Rise>
          <Card className="overflow-hidden">
            <div className="hero-navy noise relative p-8">
              <div className="relative max-w-xl">
                <span className="grid size-14 place-items-center rounded-2xl bg-gold/20 text-gold2"><Mail className="size-7" /></span>
                <h2 className="mt-4 font-display text-3xl font-semibold">{tr("Connect")}{" "}{status.expected_account}</h2>
                <p className="mt-2 text-white/70">{tr("See unread client emails, find every message from a client and link conversations to their file — without ever sharing your password.")}</p>
                <Button variant="gold" size="lg" className="mt-6" onClick={() => (window.location.href = "/api/gmail/connect")}><Lock className="size-4" />{" "}{tr("Connect with Google")}</Button>
                {status.last_error && <p className="mt-4 rounded-xl bg-danger/20 p-3 text-sm text-rose-200">{status.last_error}</p>}
              </div>
            </div>
            <ul className="grid gap-px bg-line sm:grid-cols-3">
              {[
                [ShieldCheck, "Read-only", "This desk can never send, delete, archive or change an email."],
                [Lock, "Tokens stay on the server", "Encrypted at rest, never sent to your browser."],
                [Unplug, "Disconnect any time", "One click deletes the stored access and revokes it at Google."],
              ].map(([I, t, d]) => {
                const Icon = I as typeof ShieldCheck;
                return <li key={t as string} className="bg-surface p-5"><Icon className="mb-2 size-5 text-goldink" /><p className="font-semibold">{t as string}</p><p className="mt-0.5 text-sm text-muted">{d as string}</p></li>;
              })}
            </ul>
          </Card>
        </Rise>
      )}

      {ready && (
        <>
          <Rise className="space-y-3">
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search by sender, subject or words…")} aria-label={tr("Search email")} className="h-12 w-full rounded-2xl border border-linestrong bg-surface pl-11 pr-4 text-[15px] shadow-soft focus:border-gold focus:outline-none focus:ring-4 focus:ring-gold/20" />
              </div>
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-12 md:w-64" aria-label={tr("Show emails for a client")}>
                <option value="">{tr("Whole inbox")}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </Select>
              <Segmented<"unread" | "all"> id="gm-unread" value={unreadOnly && !clientId ? "unread" : "all"} onChange={(v) => setUnreadOnly(v === "unread")} options={[{ value: "unread", label: <>{tr("Unread")}{status?.unread != null ? <span className="ml-1.5 text-xs opacity-70">{status.unread}</span> : null}</> }, { value: "all", label: "All" }]} />
            </div>
            {urgent > 0 && <p className="flex items-center gap-2 text-sm font-medium text-[#8a5f10] dark:text-[#f0c36d]"><AlertTriangle className="size-4" /> {tr("{n} messages may need action", { n: urgent })}</p>}
          </Rise>

          {err && (
            <Rise>
              <Card className="p-5"><p className="font-medium text-danger">{err.text}</p>{err.code === "google_reconnect" && <Button className="mt-3" variant="gold" size="sm" onClick={() => (window.location.href = "/api/gmail/connect")}>{tr("Reconnect Gmail")}</Button>}</Card>
            </Rise>
          )}

          <Rise>
            <Card className="overflow-hidden">
              {msgs === null || (loading && !msgs.length) ? (
                <div className="space-y-px p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
              ) : msgs.length === 0 && !err ? (
                <EmptyState icon={<Inbox className="size-6" />} title={clientId ? tr("No emails with this client") : unreadOnly ? tr("Inbox zero") : tr("No messages found")} body={unreadOnly ? tr("No unread email in the inbox.") : tr("Try different words.")} />
              ) : (
                <ul className="divide-y divide-line">
                  <AnimatePresence initial={false}>
                    {msgs.map((m, i) => (
                      <motion.li key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.025 }}>
                        <button onClick={() => setThread(m.threadId)} className="flex w-full items-start gap-3.5 px-4 py-4 text-left transition hover:bg-surface2/70 sm:px-5">
                          <Avatar name={m.fromName} size={42} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className={cn("truncate text-[15px]", m.unread ? "font-semibold" : "font-medium text-muted")}>{m.fromName}</span>
                              <span className="shrink-0 text-xs text-muted">{ago(m.date)}</span>
                            </span>
                            <span className={cn("block truncate text-sm", m.unread ? "font-medium" : "text-muted")}>{m.subject}</span>
                            <span className="line-clamp-1 text-[13px] text-muted">{m.snippet}</span>
                            <span className="mt-2 flex flex-wrap gap-1.5">
                              {m.needs_action && <Chip tone="warning"><AlertTriangle className="size-3" />{" "}{tr("May need action")}{m.action_reasons[0] ? ` · ${m.action_reasons[0]}` : ""}</Chip>}
                              {m.linked && <Chip tone="success"><UserCheck className="size-3" /> {m.linked.full_name}</Chip>}
                              {m.suggestion && <Chip tone="gold"><Link2 className="size-3" />{" "}{tr("Looks like")}{" "}{m.suggestion.full_name}</Chip>}
                            </span>
                          </span>
                          {m.unread && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-gold" aria-label={tr("Unread")} />}
                        </button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </Card>
          </Rise>
        </>
      )}

      <ThreadDrawer threadId={thread} onClose={() => setThread(null)} clients={clients} msgSummary={msgs?.find((m) => m.threadId === thread) ?? null} aiOn={Boolean(status?.ai_email_analysis)} aiAvailable={app.caps.ai} />
    </Stagger>
  );
}

function ThreadDrawer({ threadId, onClose, clients, msgSummary, aiOn, aiAvailable }: { threadId: string | null; onClose: () => void; clients: ClientOpt[]; msgSummary: Msg | null; aiOn: boolean; aiAvailable: boolean }) {
  const app = useApp();
  const toast = useToast();
  const [data, setData] = React.useState<{ messages: ThreadMsg[]; links: { client_id: string; full_name: string; status: string }[]; gmail_url: string } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [linkTo, setLinkTo] = React.useState("");
  const [analysis, setAnalysis] = React.useState<EmailAnalysis | null>(null);
  const [analysing, setAnalysing] = React.useState(false);
  const [saveFor, setSaveFor] = React.useState<{ a: NonNullable<ThreadMsg["attachments"]>[number]; client: string; cat: string } | null>(null);

  React.useEffect(() => {
    setData(null);
    setErr(null);
    setAnalysis(null);
    setLinkTo(msgSummary?.suggestion?.client_id ?? "");
    if (!threadId) return;
    let live = true;
    api<{ messages: ThreadMsg[]; links: { client_id: string; full_name: string; status: string }[]; gmail_url: string }>(`/api/gmail/threads/${encodeURIComponent(threadId)}`)
      .then((r) => live && setData(r))
      .catch((e) => live && setErr(e instanceof ApiError ? e.message : tr("Couldn't open this conversation.")));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const last = data?.messages[data.messages.length - 1];
  const subject = data?.messages[0]?.subject ?? msgSummary?.subject ?? "Conversation";

  async function link() {
    if (!linkTo || !last) return;
    try {
      await api(`/api/gmail/threads/${encodeURIComponent(threadId!)}/link`, { body: { client_id: linkTo, subject, snippet: last.snippet, from: last.from, last_message_at: last.date, origin: msgSummary?.suggestion?.client_id === linkTo ? "email_match" : "manual" } });
      toast({ tone: "success", title: tr("Conversation linked"), body: tr("Saved on {name}'s file.", { name: clients.find((c) => c.id === linkTo)?.full_name ?? "" }) });
      app.bumpData();
      const r = await api<{ links: { client_id: string; full_name: string; status: string }[] }>(`/api/gmail/threads/${encodeURIComponent(threadId!)}`);
      setData((d) => (d ? { ...d, links: r.links } : d));
    } catch (e) {
      toast({ tone: "error", title: tr("Couldn't link"), body: e instanceof ApiError ? e.message : undefined });
    }
  }

  async function analyse() {
    setAnalysing(true);
    try {
      setAnalysis((await api<{ analysis: EmailAnalysis }>(`/api/gmail/threads/${encodeURIComponent(threadId!)}/analyze`, { body: {} })).analysis);
    } catch (e) {
      toast({ tone: "error", title: tr("AI summary unavailable"), body: e instanceof ApiError ? e.message : undefined });
    } finally {
      setAnalysing(false);
    }
  }

  return (
    <Drawer open={Boolean(threadId)} onClose={onClose} title={subject} subtitle={last ? `${tr("{n} messages", { n: data!.messages.length })} · ${last.fromName}` : undefined}
      footer={data ? <>
        <Button variant="soft" size="sm" onClick={() => app.openQuickAdd({ mode: "ai", text: `Follow up on email "${subject}" from ${last?.fromName ?? "client"}`, source: "gmail", sourceRef: threadId, clientId: data.links[0]?.client_id ?? msgSummary?.suggestion?.client_id ?? null })}><ListPlus className="size-4" />{" "}{tr("Task from email")}</Button>
        <a href={data.gmail_url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:bg-surface2">{tr("Open in Gmail")}{" "}<ArrowUpRight className="size-4" /></a>
      </> : undefined}>
      {err && <p className="rounded-xl bg-danger/10 p-4 text-sm font-medium text-danger">{err}</p>}
      {!data && !err && <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>}
      {data && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-surface2/70 p-4">
            <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><FolderInput className="size-4 text-goldink" />{" "}{tr("Client file")}</p>
            {data.links.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{data.links.map((l) => <Chip key={l.client_id} tone="success"><UserCheck className="size-3" />{" "}{tr("Linked to")}{" "}{l.full_name}</Chip>)}</div>}
            <div className="flex gap-2">
              <Select value={linkTo} onChange={(e) => setLinkTo(e.target.value)} className="h-10 text-sm" aria-label={tr("Link to client")}><option value="">{tr("Choose a client to link…")}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.email && c.email.toLowerCase() === last?.from ? tr(" · matches sender") : ""}</option>)}</Select>
              <Button variant="gold" size="sm" className="h-10" disabled={!linkTo} onClick={link}>{tr("Link")}</Button>
            </div>
            <p className="mt-2 text-xs text-muted">{tr("Nothing is linked unless you confirm it here.")}</p>
          </div>

          {aiAvailable && (
            <div>
              {!analysis ? (
                <Button variant="soft" size="sm" onClick={analyse} loading={analysing} disabled={!aiOn} title={!aiOn ? tr("Turn on AI email analysis in Settings") : undefined}><Sparkles className="size-4" />{" "}{tr("Summarize with AI")}</Button>
              ) : (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 rounded-2xl bg-gradient-to-br from-gold/20 to-gold/5 p-4 ring-1 ring-gold/30">
                  <p className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles className="size-4 text-goldink" />{" "}{tr("AI summary")}{" "}<span className="font-normal text-muted">{tr("· check before relying on it")}</span></p>
                  <p className="text-sm">{analysis.summary}</p>
                  {analysis.deadlines.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Possible deadlines")}</p><ul className="mt-1 list-disc pl-5 text-sm">{analysis.deadlines.map((d, i) => <li key={i}>{d.date ? `${d.date} — ` : ""}{d.description}</li>)}</ul></div>}
                  {analysis.document_requests.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Documents requested")}</p><ul className="mt-1 list-disc pl-5 text-sm">{analysis.document_requests.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}
                  {analysis.appointment_related && <Chip tone="info">{tr("Appointment-related")}</Chip>}
                  {analysis.follow_up_tasks.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Suggested follow-ups")}</p>
                      {analysis.follow_up_tasks.map((t, i) => (
                        <button key={i} onClick={() => app.openQuickAdd({ mode: "manual", title: t.title, category: t.category, source: "gmail", sourceRef: threadId, clientId: analysis.suggested_client_id ?? data.links[0]?.client_id ?? null })} className="flex w-full items-center gap-2 rounded-xl bg-surface px-3 py-2 text-left text-sm ring-1 ring-line hover:ring-gold/60"><ListPlus className="size-4 shrink-0 text-goldink" /> {tr(t.title)}</button>
                      ))}
                    </div>
                  )}
                  {analysis.suggested_client_id && analysis.suggested_client_id !== linkTo && <Button size="sm" variant="outline" onClick={() => setLinkTo(analysis.suggested_client_id!)}>{tr("Select suggested client:")}{" "}{clients.find((c) => c.id === analysis.suggested_client_id)?.full_name}</Button>}
                </motion.div>
              )}
              {!aiOn && <p className="mt-1.5 text-xs text-muted">{tr("AI email analysis is off. Turn it on in Settings → AI & privacy. It sends a trimmed, redacted copy of the conversation to Claude.")}</p>}
            </div>
          )}

          <ol className="space-y-4">
            {data.messages.map((m) => (
              <li key={m.id} className="rounded-2xl ring-1 ring-line">
                <div className="flex items-center gap-3 border-b border-line bg-surface2/50 px-4 py-3">
                  <Avatar name={m.fromName} size={34} />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{m.fromName}</p><p className="truncate text-xs text-muted">{m.from}</p></div>
                  <span className="text-xs text-muted">{ago(m.date)}</span>
                </div>
                {/* Plain text only — email HTML is never rendered, so tracking pixels and scripts can't run. */}
                <pre className="whitespace-pre-wrap break-words px-4 py-3 font-sans text-sm leading-relaxed">{m.body || m.snippet}</pre>
                {m.attachments && m.attachments.length > 0 && (
                  <ul className="space-y-2 border-t border-line p-3">
                    {m.attachments.map((a) => (
                      <li key={a.attachmentId} className="flex items-center gap-3 rounded-xl bg-surface2/60 px-3 py-2.5">
                        <Paperclip className="size-4 shrink-0 text-goldink" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.filename}</span><span className="text-xs text-muted">{a.mimeType} · {bytes(a.size)}</span></span>
                        <a href={`/api/gmail/attachment?messageId=${a.messageId}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}`} aria-label={`Download ${a.filename}`} className="grid size-9 place-items-center rounded-xl hover:bg-surface3"><Download className="size-4" /></a>
                        <Button size="sm" variant="soft" onClick={() => setSaveFor({ a, client: linkTo || data.links[0]?.client_id || "", cat: "Client Correspondence" })}><FolderInput className="size-4" />{" "}{tr("Save")}</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <AnimatePresence>
        {saveFor && (
          <div className="fixed inset-0 z-[75] grid place-items-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-navy/60 backdrop-blur-sm" onClick={() => setSaveFor(null)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-md space-y-4 rounded-3xl bg-surface p-6 shadow-2xl">
              <div className="flex items-start justify-between"><h3 className="font-display text-2xl font-semibold">{tr("Save to a client's documents")}</h3><button onClick={() => setSaveFor(null)} aria-label={tr("Close")}><X className="size-5" /></button></div>
              <p className="truncate text-sm text-muted">{saveFor.a.filename}</p>
              <Field label={tr("Client")}><Select value={saveFor.client} onChange={(e) => setSaveFor({ ...saveFor, client: e.target.value })}><option value="">{tr("Choose…")}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</Select></Field>
              <Field label={tr("Category")}><Select value={saveFor.cat} onChange={(e) => setSaveFor({ ...saveFor, cat: e.target.value })}>{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{tr(c)}</option>)}</Select></Field>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSaveFor(null)}>{tr("Cancel")}</Button><Button variant="gold" disabled={!saveFor.client} onClick={async () => { try { await api("/api/gmail/attachment/save", { body: { message_id: saveFor.a.messageId, attachment_id: saveFor.a.attachmentId, filename: saveFor.a.filename, client_id: saveFor.client, category: saveFor.cat } }); toast({ tone: "success", title: tr("Saved to client documents") }); setSaveFor(null); app.bumpData(); } catch (e) { toast({ tone: "error", title: tr("Couldn't save the file"), body: e instanceof ApiError ? e.message : undefined }); } }}>{tr("Save file")}</Button></div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Drawer>
  );
}

export { Mail, ExternalLink };
