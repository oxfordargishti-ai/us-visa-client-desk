"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, FileText, Search } from "lucide-react";
import { Card, Chip, Input, cn } from "./ui";
import { api } from "@/lib/client/api";
import { ago } from "@/lib/client/format";
import { tr } from "@/lib/i18n";

type Intake = { id: string; payload: Record<string, unknown>; matched: string; received_at: string };

/** "passportNumber" / "passport_number" → "Passport number" */
const human = (k: string) => k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

/** Flattens nested answers into labelled rows, keeping section names as headings. */
function rows(o: unknown, prefix = ""): { k: string; v: string }[] {
  if (o == null) return [];
  if (Array.isArray(o)) return o.flatMap((x, i) => (typeof x === "object" ? rows(x, `${prefix}${prefix ? " · " : ""}${i + 1}`) : [{ k: prefix, v: String(x) }]));
  if (typeof o === "object") return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => rows(v, prefix ? `${prefix} · ${human(k)}` : human(k)));
  const v = String(o).trim();
  return v ? [{ k: prefix, v }] : [];
}

/** Client page: the DS-160 questionnaire the client filled in on the form site. */
export function IntakeCard({ clientId }: { clientId: string }) {
  const [list, setList] = React.useState<Intake[] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  React.useEffect(() => {
    api<{ intakes: Intake[] }>(`/api/clients/${clientId}/intake`).then((r) => setList(r.intakes)).catch(() => setList([]));
  }, [clientId]);
  if (!list || list.length === 0) return null;
  const latest = list[0];
  const all = rows(latest.payload);
  const shown = q ? all.filter((r) => (r.k + " " + r.v).toLowerCase().includes(q.toLowerCase())) : all;
  return (
    <Card className="overflow-hidden p-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 p-5 text-left">
        <span className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-gold2 to-gold text-navy shadow-md"><FileText className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{tr("DS-160 answers")}</span>
          <span className="block text-xs text-muted">{tr("Received {when}", { when: ago(latest.received_at) })} · {tr("{n} answers", { n: all.length })}</span>
        </span>
        {list.length > 1 && <Chip tone="gold">{list.length}×</Chip>}
        <motion.span animate={{ rotate: open ? 180 : 0 }}><ChevronDown className="size-5 text-muted" /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-line">
            <div className="p-4">
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Find an answer…")} className="pl-9" />
              </div>
              <dl className="max-h-[60vh] divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line">
                {shown.map((r, i) => (
                  <div key={i} className={cn("grid grid-cols-1 gap-0.5 px-3 py-2 sm:grid-cols-[40%_60%] sm:gap-3", i % 2 && "bg-surface2/50")}>
                    <dt className="text-xs font-medium text-muted">{r.k}</dt>
                    <dd className="break-words text-sm">{r.v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
