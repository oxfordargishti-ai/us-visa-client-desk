"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Landmark, MapPin, Phone, MessageCircle, FileCheck2, GraduationCap } from "lucide-react";
import { Avatar, Chip, ProgressRing, cn } from "./ui";
import { useApp } from "./app-context";
import { fmt, phoneHref, whatsappHref } from "@/lib/client/format";
import { humanCountdown } from "@/lib/time";
import { useNow } from "@/lib/client/hooks";
import type { InterviewRow } from "@/lib/types";

export function countdownLabel(iso: string, now: Date | null) {
  if (!now) return { big: "—", small: "", past: false, frac: 0 };
  const c = humanCountdown(iso, now);
  if (c.past) return { big: Math.abs(c.totalMs) < 3 * 3600_000 ? "Now" : "Past", small: "", past: true, frac: 1 };
  const frac = 1 - Math.min(1, c.totalMs / (7 * 86_400_000));
  if (c.days >= 1) return { big: `${c.days}d`, small: `${c.hours}h`, past: false, frac };
  if (c.hours >= 1) return { big: `${c.hours}h`, small: `${c.minutes}m`, past: false, frac };
  return { big: `${c.minutes}m`, small: "to go", past: false, frac };
}

const prepTone = { "Not Started": "warning", "In Progress": "info", Ready: "success" } as const;
const docsTone = { Missing: "danger", Partial: "warning", Complete: "success" } as const;

export function InterviewCard({ iv, compact = false, index = 0 }: { iv: InterviewRow; compact?: boolean; index?: number }) {
  const app = useApp();
  const now = useNow(30_000);
  const cd = countdownLabel(iv.interview_at, now);
  const urgent = now ? new Date(iv.interview_at).getTime() - now.getTime() < 36 * 3600_000 : false;
  return (
    <motion.li initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * index, type: "spring", stiffness: 260, damping: 26 }} whileHover={{ y: -2 }} className={cn("sweep relative flex items-center gap-4 rounded-2xl p-4 ring-1", urgent ? "bg-gradient-to-br from-gold/15 to-transparent ring-gold/50" : "bg-surface2/60 ring-line")}>
      <ProgressRing value={cd.frac} size={compact ? 64 : 76} stroke={compact ? 6 : 7} tone={urgent ? "gold" : "success"} className="text-ink">
        <div className="text-center leading-none">
          <div className="tabular font-display text-xl font-bold">{cd.big}</div>
          {cd.small && <div className="mt-0.5 text-[10px] font-medium text-muted">{cd.small}</div>}
        </div>
      </ProgressRing>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Avatar name={iv.client_name ?? "?"} size={26} />
          <Link href={`/clients/${iv.client_id}`} className="truncate font-semibold hover:text-goldink hover:underline">
            {iv.client_name}
          </Link>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium tabular">
          {fmt(iv.interview_at, app.tz, "EEE d MMM · HH:mm")}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
          <MapPin className="size-3 shrink-0" /> {iv.embassy ?? "Embassy not set"}
          {iv.visa_category && <span>· {iv.visa_category}</span>}
        </p>
        {!compact && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Chip tone={prepTone[iv.prep_status]}><GraduationCap className="size-3" /> Prep: {iv.prep_status}</Chip>
            <Chip tone={docsTone[iv.docs_status]}><FileCheck2 className="size-3" /> Docs: {iv.docs_status}</Chip>
          </div>
        )}
      </div>
      <div className="hidden flex-col gap-1 sm:flex">
        {iv.client_phone && (
          <a href={phoneHref(iv.client_phone)} aria-label={`Call ${iv.client_name}`} className="grid size-9 place-items-center rounded-xl bg-surface text-muted ring-1 ring-line hover:text-ink">
            <Phone className="size-4" />
          </a>
        )}
        {iv.client_whatsapp && (
          <a href={whatsappHref(iv.client_whatsapp)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${iv.client_name}`} className="grid size-9 place-items-center rounded-xl bg-surface text-muted ring-1 ring-line hover:text-ink">
            <MessageCircle className="size-4" />
          </a>
        )}
        {!iv.client_phone && !iv.client_whatsapp && <Landmark className="size-5 text-muted/50" aria-hidden />}
      </div>
    </motion.li>
  );
}
