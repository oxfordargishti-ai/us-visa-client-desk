"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { CreditCard, RefreshCw, TriangleAlert, X } from "lucide-react";
import { Button, Card, Chip, Field, Input, Modal, cn, useToast } from "./ui";
import { useApp } from "./app-context";
import { api, ApiError } from "@/lib/client/api";
import { ago } from "@/lib/client/format";
import { tr } from "@/lib/i18n";

interface Attempt {
  id: string;
  status: "creating" | "pending" | "processing" | "completed" | "failed" | "expired" | "refunded" | "error";
  amount_amd: number;
  provider_payment_id: string | null;
  failure_code: string | null;
  livemode: boolean | null;
  duplicate: boolean;
  created_at: string;
  completed_at: string | null;
}
interface PayRequest {
  id: string;
  amount_amd: number;
  description: string;
  status: "open" | "paid" | "cancelled" | "refunded";
  wix_application_id: string | null;
  created_at: string;
  paid_at: string | null;
  attempts: Attempt[];
}
interface Resp {
  requests: PayRequest[];
  payments: { enabled: boolean; mode: "sandbox"; visibility: "test-link" | "everyone"; problem: string | null };
}

const AMD = (n: number) => `${n.toLocaleString("en-US")} ֏`;
const REQ_TONE = { open: "warning", paid: "success", cancelled: "neutral", refunded: "info" } as const;
const ATT_TONE = { creating: "neutral", pending: "warning", processing: "warning", completed: "success", failed: "danger", expired: "neutral", refunded: "info", error: "danger" } as const;
const REQ_LABEL = { open: "Awaiting payment", paid: "Paid", cancelled: "Cancelled", refunded: "Refunded" } as const;
const ATT_LABEL = { creating: "Starting", pending: "Checkout open", processing: "Processing", completed: "Paid", failed: "Declined", expired: "Expired", refunded: "Refunded", error: "Not accepted" } as const;

/** Client page: what the client owes for online payment (the amount Paynet is asked to charge), and every attempt. */
export function ClientPaymentsCard({ client }: { client: { id: string; full_name: string; email: string | null } }) {
  const app = useApp();
  const toast = useToast();
  const [data, setData] = React.useState<Resp | null>(null);
  const [form, setForm] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [desc, setDesc] = React.useState(tr("Visa consultation service fee"));
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api<Resp>(`/api/clients/${client.id}/payment-requests`).then(setData).catch(() => setData({ requests: [], payments: { enabled: false, mode: "sandbox", visibility: "test-link", problem: null } }));
  }, [client.id]);
  React.useEffect(load, [load, app.dataVersion]);

  if (!data) return null;
  const open = data.requests.find((r) => r.status === "open");
  const latest = open ?? data.requests[0];
  const history = data.requests.filter((r) => r !== latest);
  const p = data.payments;

  const act = async (id: string, action: "cancel" | "verify") => {
    setBusy(action);
    try {
      await api(`/api/payment-requests/${id}`, { method: "PATCH", body: { action } });
      toast({ tone: action === "cancel" ? "info" : "success", title: action === "cancel" ? tr("Payment request cancelled") : tr("Status checked with Paynet") });
      load();
    } catch (e) {
      toast({ tone: "error", title: e instanceof ApiError ? e.message : tr("Couldn't save.") });
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy("create");
    setErr(null);
    try {
      await api(`/api/clients/${client.id}/payment-requests`, { body: { amount_amd: Number(amount.replace(/[\s,]/g, "")), description: desc } });
      toast({ tone: "success", title: tr("Payment request created"), body: tr("The client can now pay from the portal.") });
      setForm(false);
      setAmount("");
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tr("Couldn't save."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-gold2 to-gold text-navy shadow-md"><CreditCard className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{tr("Online payment")}</h2>
          <p className="text-xs text-muted">{tr("Paid by the client from the portal with Paynet")}</p>
        </div>
        <Chip tone="info">{tr("Test mode")}</Chip>
      </div>

      {p.problem && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-xs text-ink/80 ring-1 ring-warning/30">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{tr("Online payment is switched off on the server")}: {p.problem}</span>
        </p>
      )}
      {!p.problem && p.visibility === "test-link" && (
        <p className="mb-3 rounded-xl bg-surface2 p-3 text-xs text-muted">{tr("While testing, the Pay button shows only on the portal link that ends in ?paytest=1.")}</p>
      )}

      {latest ? (
        <div className="rounded-2xl ring-1 ring-line">
          <div className="flex flex-wrap items-center gap-2 p-4">
            <span className="text-2xl font-semibold tabular-nums">{AMD(latest.amount_amd)}</span>
            <Chip tone={REQ_TONE[latest.status]}>{tr(REQ_LABEL[latest.status])}</Chip>
            <span className="w-full text-sm text-muted">{latest.description} · {ago(latest.created_at)}</span>
          </div>
          {latest.attempts.length > 0 && (
            <ul className="divide-y divide-line border-t border-line text-sm">
              {latest.attempts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <Chip tone={ATT_TONE[a.status]}>{tr(ATT_LABEL[a.status])}</Chip>
                  {a.duplicate && <Chip tone="danger">{tr("Extra payment — refund it in Paynet")}</Chip>}
                  {a.failure_code && a.status !== "expired" && <span className="text-xs text-muted">{a.failure_code}</span>}
                  <span className="ml-auto text-xs text-muted">{ago(a.completed_at ?? a.created_at)}</span>
                  {a.provider_payment_id && <span className="w-full truncate font-mono text-[11px] text-muted">Paynet · {a.provider_payment_id}</span>}
                </li>
              ))}
            </ul>
          )}
          {latest.status === "open" && (
            <div className="flex flex-wrap gap-2 border-t border-line p-3">
              {latest.attempts.some((a) => ["creating", "pending", "processing"].includes(a.status)) && (
                <Button size="sm" variant="soft" loading={busy === "verify"} onClick={() => act(latest.id, "verify")}><RefreshCw className="size-4" />{tr("Check status now")}</Button>
              )}
              <Button size="sm" variant="ghost" loading={busy === "cancel"} onClick={() => act(latest.id, "cancel")}><X className="size-4" />{tr("Cancel request")}</Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">{tr("No payment requested yet.")}</p>
      )}

      {!open && (
        <Button className="mt-3 w-full" variant="gold" onClick={() => setForm(true)} disabled={!client.email}>
          <CreditCard className="size-4" />{tr("Request an online payment")}
        </Button>
      )}
      {!client.email && !open && <p className="mt-2 text-xs text-muted">{tr("Add the client's email first — it must be the Gmail address they sign in to the portal with.")}</p>}

      <AnimatePresence initial={false}>
        {history.length > 0 && (
          <motion.details initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted">{tr("Earlier requests")} · {history.length}</summary>
            <ul className="mt-2 space-y-1.5">
              {history.map((r) => (
                <li key={r.id} className={cn("flex items-center gap-2 rounded-xl px-3 py-2 ring-1 ring-line")}>
                  <span className="tabular-nums">{AMD(r.amount_amd)}</span>
                  <Chip tone={REQ_TONE[r.status]}>{tr(REQ_LABEL[r.status])}</Chip>
                  <span className="ml-auto text-xs text-muted">{ago(r.paid_at ?? r.created_at)}</span>
                </li>
              ))}
            </ul>
          </motion.details>
        )}
      </AnimatePresence>

      <Modal
        open={form}
        onClose={() => setForm(false)}
        title={tr("Request an online payment")}
        subtitle={client.full_name}
        size="sm"
        footer={<><Button variant="outline" onClick={() => setForm(false)}>{tr("Cancel")}</Button><Button variant="gold" loading={busy === "create"} disabled={!/^\d[\d\s,]*$/.test(amount.trim()) || desc.trim().length < 2} onClick={create}>{tr("Request payment")}</Button></>}
      >
        <div className="space-y-4">
          <Field label={tr("Amount (AMD)")} hint={tr("Whole drams. This is exactly what Paynet will charge.")}>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="50 000" data-autofocus />
          </Field>
          <Field label={tr("What it is for")}>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} />
          </Field>
          <p className="text-xs text-muted">{tr("The client sees this on the portal after signing in with Google as {email}.", { email: client.email ?? "—" })}</p>
          {err && <p className="text-sm text-danger">{err}</p>}
        </div>
      </Modal>
    </Card>
  );
}
