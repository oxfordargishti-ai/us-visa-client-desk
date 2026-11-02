"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, Check, Mail, MessageSquareText, Send, Smartphone, TriangleAlert } from "lucide-react";
import { Button, Card, Chip, Field, Input, Modal, Segmented, Switch, Textarea, cn, useToast } from "./ui";
import { useApp } from "./app-context";
import { api, ApiError } from "@/lib/client/api";
import { ago } from "@/lib/client/format";
import { tr } from "@/lib/i18n";

type Channel = "email" | "sms";
type Kind = "interview_reminder" | "documents_request" | "custom";
interface Msg { id: string; channel: Channel; kind: string; to_address: string | null; subject: string | null; body: string; status: string; error: string | null; created_at: string; sent_at: string | null }
interface ClientLite { id: string; full_name: string; email: string | null; phone: string | null; notify_email: boolean; notify_sms: boolean; preferred_language: string | null }

/** SMS in Armenian/Russian uses the 70-character Unicode encoding; Latin text fits 160. Shown so costs aren't a surprise. */
function smsParts(text: string) {
  const unicode = /[^\x00-\x7F]/.test(text);
  const per = unicode ? (text.length > 70 ? 67 : 70) : text.length > 160 ? 153 : 160;
  return { parts: Math.max(1, Math.ceil(text.length / per)), unicode };
}

/** Card on the client page: consent per channel, "Send message", and the history of what the client was sent. */
export function ClientMessagesCard({ client }: { client: ClientLite }) {
  const app = useApp();
  const toast = useToast();
  const [msgs, setMsgs] = React.useState<Msg[] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [consent, setConsent] = React.useState({ email: client.notify_email, sms: client.notify_sms });
  React.useEffect(() => setConsent({ email: client.notify_email, sms: client.notify_sms }), [client.notify_email, client.notify_sms]);

  const load = React.useCallback(() => {
    api<{ messages: Msg[] }>(`/api/clients/${client.id}/messages`).then((r) => setMsgs(r.messages)).catch(() => setMsgs([]));
  }, [client.id]);
  React.useEffect(load, [load, app.dataVersion]);

  async function toggle(ch: Channel, v: boolean) {
    const next = { ...consent, [ch]: v };
    setConsent(next);
    try {
      await api(`/api/clients/${client.id}`, { method: "PATCH", body: ch === "email" ? { notify_email: v } : { notify_sms: v } });
      toast({ tone: "success", title: v ? tr("Reminders on") : tr("Reminders off"), body: ch === "email" ? tr("Email") : "SMS" });
    } catch (e) {
      setConsent(consent);
      toast({ tone: "error", title: tr("Couldn't save"), body: e instanceof ApiError ? e.message : undefined });
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><BellRing className="size-4 text-goldink" /> {tr("Messages to client")}</h2>
        <Button size="sm" variant="gold" onClick={() => setOpen(true)}><Send className="size-4" /> {tr("Send")}</Button>
      </div>
      <p className="mb-3 text-xs text-muted">{tr("Interview reminders go out automatically on the channels the client agreed to.")}</p>
      <div className="space-y-2">
        <ConsentRow icon={<Mail className="size-4" />} label={tr("Email reminders")} detail={client.email || tr("No email address")} disabled={!client.email} checked={consent.email} onChange={(v) => toggle("email", v)} />
        <ConsentRow icon={<Smartphone className="size-4" />} label={tr("SMS reminders")} detail={client.phone || tr("No phone number")} disabled={!client.phone} checked={consent.sms} onChange={(v) => toggle("sms", v)} warn={consent.sms && !app.caps.sms ? tr("SMS isn't set up yet") : undefined} />
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{tr("Sent messages")}</p>
        {msgs === null ? (
          <div className="skeleton h-12 rounded-xl" />
        ) : msgs.length === 0 ? (
          <p className="rounded-xl bg-surface2 p-3 text-sm text-muted">{tr("Nothing sent yet.")}</p>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {msgs.slice(0, 6).map((m) => (
                <motion.li key={m.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-surface2 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    {m.channel === "email" ? <Mail className="size-3.5 text-muted" /> : <MessageSquareText className="size-3.5 text-muted" />}
                    <span className="font-medium">{tr(m.kind === "interview_reminder" ? "Interview reminder" : m.kind === "documents_request" ? "Documents request" : "Message")}</span>
                    <Chip tone={m.status === "sent" ? "success" : m.status === "failed" ? "danger" : "neutral"} className="ml-auto">{tr(m.status === "sent" ? "Sent" : m.status === "failed" ? "Failed" : m.status === "skipped" ? "Not sent" : "Sending")}</Chip>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{m.body}</p>
                  <p className="mt-1 text-[11px] text-muted">{ago(m.sent_at ?? m.created_at)}{m.error ? ` · ${tr(m.error)}` : ""}</p>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
      <SendMessageModal open={open} onClose={() => setOpen(false)} client={{ ...client, notify_email: consent.email, notify_sms: consent.sms }} onSent={load} />
    </Card>
  );
}

function ConsentRow({ icon, label, detail, checked, onChange, disabled, warn }: { icon: React.ReactNode; label: string; detail: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; warn?: string }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-line", disabled && "opacity-60")}>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", checked ? "bg-gold/20 text-goldink" : "bg-surface2 text-muted")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted">{warn ? <span className="text-warning">{warn}</span> : detail}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

export function SendMessageModal({ open, onClose, client, onSent }: { open: boolean; onClose: () => void; client: ClientLite; onSent?: () => void }) {
  const app = useApp();
  const toast = useToast();
  const [kind, setKind] = React.useState<Kind>("interview_reminder");
  const [channel, setChannel] = React.useState<Channel>(client.notify_sms && !client.notify_email ? "sms" : "email");
  const [draft, setDraft] = React.useState<{ subject: string; text: string; sms: string } | null>(null);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [note, setNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setNote(null);
    if (kind === "custom") {
      setDraft(null);
      setSubject("US VISA WITH ARGISHTI");
      setBody("");
      return;
    }
    let live = true;
    api<{ draft: { subject: string; text: string; sms: string } }>(`/api/clients/${client.id}/messages/draft?kind=${kind}`)
      .then((r) => live && (setDraft(r.draft), setSubject(r.draft.subject)))
      .catch((e) => live && (setDraft(null), setBody(""), setNote(e instanceof ApiError ? e.message : tr("Couldn't prepare the text."))));
    return () => void (live = false);
  }, [open, kind, client.id]);
  React.useEffect(() => {
    if (draft) setBody(channel === "sms" ? draft.sms : draft.text);
  }, [draft, channel]);

  const consentOk = channel === "email" ? client.notify_email : client.notify_sms;
  const address = channel === "email" ? client.email : client.phone;
  const ready = channel === "email" ? app.caps.email : app.caps.sms;
  const parts = channel === "sms" ? smsParts(body) : null;

  async function send() {
    setBusy(true);
    try {
      const r = await api<{ result: { status: string; error: string | null } | null }>(`/api/clients/${client.id}/messages`, { body: { channel, kind, subject: channel === "email" ? subject : undefined, body } });
      if (r.result?.status === "sent") {
        toast({ tone: "success", title: tr("Message sent"), body: `${client.full_name} · ${channel === "email" ? tr("Email") : "SMS"}` });
        onSent?.();
        onClose();
      } else {
        toast({ tone: "error", title: tr("Not sent"), body: r.result?.error ? tr(r.result.error) : undefined });
        onSent?.();
      }
    } catch (e) {
      toast({ tone: "error", title: tr("Not sent"), body: e instanceof ApiError ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr("Message to {name}", { name: client.full_name })}
      subtitle={tr("Written in the client's language. Edit anything before sending.")}
      size="md"
      footer={<><Button variant="outline" onClick={onClose}>{tr("Cancel")}</Button><Button variant="gold" loading={busy} disabled={!body.trim() || !consentOk || !address || !ready} onClick={send}><Send className="size-4" /> {tr("Send now")}</Button></>}
    >
      <div className="space-y-4">
        <Segmented<Kind> id="msg-kind" value={kind} onChange={setKind} className="w-full overflow-x-auto" options={[{ value: "interview_reminder", label: "Interview reminder" }, { value: "documents_request", label: "Missing documents" }, { value: "custom", label: "Own text" }]} />
        <Segmented<Channel> id="msg-channel" value={channel} onChange={setChannel} options={[{ value: "email", label: <span className="flex items-center gap-1.5"><Mail className="size-4" /> {tr("Email")}</span> }, { value: "sms", label: <span className="flex items-center gap-1.5"><Smartphone className="size-4" /> SMS</span> }]} />
        {(!address || !consentOk || !ready) && (
          <p className="flex items-start gap-2 rounded-xl bg-warning/10 px-3.5 py-2.5 text-sm text-[#8a5f10] ring-1 ring-warning/30 dark:text-[#f0c36d]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {!address ? tr(channel === "email" ? "This client has no email address." : "This client has no valid mobile number.") : !consentOk ? tr("Turn on {channel} reminders for this client first — only after they agreed.", { channel: channel === "email" ? tr("Email") : "SMS" }) : tr(channel === "email" ? "Email isn't set up on the server yet (SMTP settings are missing)." : "SMS isn't set up yet (Twilio settings are missing).")}
          </p>
        )}
        {note && <p className="rounded-xl bg-surface2 px-3.5 py-2.5 text-sm text-muted">{note}</p>}
        {channel === "email" && <Field label={tr("Subject")}><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
        <Field label={tr("Message")} hint={parts ? tr("{n} SMS parts", { n: parts.parts }) + (parts.unicode ? " · " + tr("non-Latin letters use 70 characters per part") : "") : undefined}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-40" />
        </Field>
        <p className="flex items-center gap-1.5 text-xs text-muted"><Check className="size-3.5" /> {tr("To")}: {address || "—"}</p>
      </div>
    </Modal>
  );
}
