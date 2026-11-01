"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Check, FileWarning, ListChecks, Mail, MessageCircle, Phone, Plus, Search, UserPlus, Users, CalendarClock } from "lucide-react";
import { Avatar, Button, Card, Chip, EmptyState, Field, Input, Modal, Rise, Select, Stagger, cn, useToast } from "./ui";
import { useApp } from "./app-context";
import { api, ApiError } from "@/lib/client/api";
import { APPLICATION_STATUSES, VISA_CATEGORIES } from "@/lib/constants";
import { ago, fmt, phoneHref, STATUS_TONE, whatsappHref } from "@/lib/client/format";
import { useDebounced, useCreateIntent } from "@/lib/client/hooks";
import type { ClientListItem } from "@/lib/repo/clients";
import { tr } from "@/lib/i18n";

export function ClientsView({ clients, counts, total, visas, q, status, visa, tz }: { clients: ClientListItem[]; counts: Record<string, number>; total: number; visas: string[]; q: string; status: string; visa: string; tz: string }) {
  const router = useRouter();
  const [search, setSearch] = React.useState(q);
  const [open, setOpen] = React.useState(false);
  useCreateIntent("client", () => setOpen(true));
  const dq = useDebounced(search, 250);
  const first = React.useRef(true);

  const go = React.useCallback(
    (next: { q?: string; status?: string; visa?: string }) => {
      const p = new URLSearchParams();
      const m = { q, status, visa, ...next };
      if (m.q) p.set("q", m.q);
      if (m.status) p.set("status", m.status);
      if (m.visa) p.set("visa", m.visa);
      router.replace(p.size ? `/clients?${p}` : "/clients", { scroll: false });
    },
    [q, status, visa, router],
  );
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (dq !== q) go({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  return (
    <Stagger className="space-y-6">
      <Rise className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-goldink">{tr("{n} clients", { n: total })}</p>
          <h1 className="mt-1 font-display text-4xl font-semibold sm:text-5xl">{tr("Clients")}</h1>
        </div>
        <Button variant="gold" size="lg" className="self-start" onClick={() => setOpen(true)}>
          <UserPlus className="size-4" />{" "}{tr("New client")}
        </Button>
      </Rise>

      <Rise className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("Search name, email, phone or client ID…")} aria-label={tr("Search clients")} className="h-12 w-full rounded-2xl border border-linestrong bg-surface pl-11 pr-4 text-[15px] shadow-soft focus:border-gold focus:outline-none focus:ring-4 focus:ring-gold/20" />
          </div>
          <Select value={visa} onChange={(e) => go({ visa: e.target.value })} className="h-12 md:w-56" aria-label={tr("Filter by visa type")}>
            <option value="">{tr("All visa types")}</option>
            {visas.map((v) => <option key={v} value={v}>{tr(v)}</option>)}
          </Select>
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" aria-label={tr("Filter by status")}>
          <button onClick={() => go({ status: "" })} className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium ring-1 transition", !status ? "bg-navy text-white ring-navy dark:bg-gold dark:text-navy dark:ring-gold" : "bg-surface ring-line text-muted hover:ring-gold/60")}>
            {tr("All")}{" "}<span className="ml-1 opacity-70">{total}</span>
          </button>
          {APPLICATION_STATUSES.filter((s) => counts[s]).map((s) => (
            <button key={s} onClick={() => go({ status: status === s ? "" : s })} className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium ring-1 ring-inset transition", status === s ? "bg-navy text-white ring-navy dark:bg-gold dark:text-navy dark:ring-gold" : STATUS_TONE[s])}>
              {tr(s)} <span className="ml-1 opacity-70">{counts[s]}</span>
            </button>
          ))}
        </div>
      </Rise>

      {clients.length === 0 ? (
        <Rise>
          <Card className="p-4">
            <EmptyState icon={<Users className="size-6" />} title={total === 0 ? tr("Add your first client") : tr("No clients match")} body={total === 0 ? tr("Create a client profile to track their case, tasks, documents and emails in one place.") : tr("Try a different search or clear the filters.")} action={<Button variant="gold" size="sm" onClick={() => (total === 0 ? setOpen(true) : (setSearch(""), router.replace("/clients")))}>{total === 0 ? <><UserPlus className="size-4" />{" "}{tr("New client")}</> : tr("Clear filters")}</Button>} />
          </Card>
        </Rise>
      ) : (
        <motion.ul layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence>
            {clients.map((c, i) => (
              <motion.li key={c.id} layout initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ delay: Math.min(i, 8) * 0.04, type: "spring", stiffness: 300, damping: 28 }}>
                <ClientCard c={c} tz={tz} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
      <NewClientModal open={open} onClose={() => setOpen(false)} />
    </Stagger>
  );
}

function ClientCard({ c, tz }: { c: ClientListItem; tz: string }) {
  return (
    <Card hover className="relative h-full">
      <Link href={`/clients/${c.id}`} className="block p-5" aria-label={`Open ${c.full_name}`}>
        <div className="flex items-start gap-3.5">
          <Avatar name={c.full_name} size={48} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-xl font-semibold leading-tight">{c.full_name}</h3>
            <p className="mt-0.5 text-xs text-muted">{c.client_code}{c.visa_category && ` · ${tr(c.visa_category)}`}</p>
          </div>
        </div>
        {c.application_status && <span className={cn("mt-4 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", STATUS_TONE[c.application_status])}>{tr(c.application_status)}</span>}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Mini icon={<CalendarClock className="size-3.5" />} label={tr("Interview")} value={c.next_interview_at ? fmt(c.next_interview_at, tz, "d MMM") : "—"} strong={Boolean(c.next_interview_at)} />
          <Mini icon={<ListChecks className="size-3.5" />} label={tr("Open tasks")} value={String(c.open_tasks)} />
          <Mini icon={<FileWarning className="size-3.5" />} label={tr("Missing docs")} value={String(c.missing_docs)} warn={c.missing_docs > 0} />
        </div>
        <p className="mt-3 text-xs text-muted">{tr("Last activity")}{" "}{ago(c.last_touch_at)}</p>
      </Link>
      <div className="flex divide-x divide-line border-t border-line">
        {[
          { href: phoneHref(c.phone), icon: Phone, label: "Call" },
          { href: whatsappHref(c.whatsapp), icon: MessageCircle, label: "WhatsApp", ext: true },
          { href: c.email ? `mailto:${c.email}` : undefined, icon: Mail, label: "Email" },
        ].map((a) =>
          a.href ? (
            <a key={a.label} href={a.href} target={a.ext ? "_blank" : undefined} rel="noopener noreferrer" className="flex flex-1 items-center justify-center gap-1.5 py-3 text-[13px] font-medium text-muted transition hover:bg-surface2 hover:text-ink" aria-label={`${a.label} ${c.full_name}`}>
              <a.icon className="size-4" /> <span className="hidden sm:inline">{tr(a.label)}</span>
            </a>
          ) : (
            <span key={a.label} className="flex flex-1 items-center justify-center gap-1.5 py-3 text-[13px] text-muted/40" aria-hidden>
              <a.icon className="size-4" /> <span className="hidden sm:inline">{tr(a.label)}</span>
            </span>
          ),
        )}
      </div>
    </Card>
  );
}

function Mini({ icon, label, value, warn, strong }: { icon: React.ReactNode; label: string; value: string; warn?: boolean; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl px-1 py-2", warn ? "bg-warning/12" : strong ? "bg-gold/15" : "bg-surface2/70")}>
      <div className="mb-0.5 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{icon}</div>
      <div className={cn("tabular text-[15px] font-semibold", warn && "text-[#8a5f10] dark:text-[#f0c36d]")}>{value}</div>
      <div className="text-[10.5px] text-muted">{label}</div>
    </div>
  );
}

export function NewClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const empty = { full_name: "", email: "", phone: "", whatsapp: "", preferred_language: "hy", visa_category: VISA_CATEGORIES[0] as string, embassy: "U.S. Embassy Yerevan", application_status: "New Client" as string };
  const [f, setF] = React.useState(empty);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) (setF(empty), setErr(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ client: { id: string } }>("/api/clients", {
        body: { full_name: f.full_name, email: f.email, phone: f.phone, whatsapp: f.whatsapp, preferred_language: f.preferred_language, case: { visa_category: f.visa_category, embassy: f.embassy, application_status: f.application_status } },
      });
      toast({ tone: "success", title: tr("Client created"), body: f.full_name });
      onClose();
      router.push(`/clients/${r.client.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tr("Couldn't create the client."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={tr("New client")} subtitle={tr("A document checklist is created automatically.")} footer={<><Button variant="outline" onClick={onClose}>{tr("Cancel")}</Button><Button variant="gold" loading={busy} disabled={!f.full_name.trim()} onClick={() => submit()}><Check className="size-4" />{" "}{tr("Create client")}</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={tr("Full name")}><Input value={f.full_name} onChange={set("full_name")} data-autofocus placeholder={tr("e.g. Karen Sargsyan")} required /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Phone")}><Input value={f.phone} onChange={set("phone")} inputMode="tel" placeholder="+374 99 000000" /></Field>
          <Field label={tr("WhatsApp")} hint={tr("Leave blank if the same as phone")}><Input value={f.whatsapp} onChange={set("whatsapp")} inputMode="tel" placeholder="+374 99 000000" /></Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Email")}><Input type="email" value={f.email} onChange={set("email")} placeholder={tr("name@example.com")} /></Field>
          <Field label={tr("Language")}>
            <Select value={f.preferred_language} onChange={set("preferred_language")}>
              <option value="hy">{tr("Armenian")}</option><option value="ru">{tr("Russian")}</option><option value="en">{tr("English")}</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Visa category")}><Select value={tr(f.visa_category)} onChange={set("visa_category")}>{VISA_CATEGORIES.map((v) => <option key={v} value={v}>{tr(v)}</option>)}</Select></Field>
          <Field label={tr("Status")}><Select value={tr(f.application_status)} onChange={set("application_status")}>{APPLICATION_STATUSES.map((v) => <option key={v} value={v}>{tr(v)}</option>)}</Select></Field>
        </div>
        <Field label={tr("Embassy or consulate")}><Input value={f.embassy} onChange={set("embassy")} /></Field>
        {err && <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{err}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

export { Chip, Plus };
