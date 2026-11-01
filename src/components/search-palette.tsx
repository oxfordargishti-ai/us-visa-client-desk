"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, CheckSquare, FileText, Folder, Mail, Search, StickyNote, Users, CornerDownLeft, Sparkles, LayoutDashboard, Bell, Settings, Landmark } from "lucide-react";
import { cn } from "./ui";
import { useApp } from "./app-context";
import { api } from "@/lib/client/api";
import { useDebounced } from "@/lib/client/hooks";
import type { SearchHit } from "@/lib/repo/search";
import { tr } from "@/lib/i18n";

const ICON = { client: Users, task: CheckSquare, event: CalendarDays, note: StickyNote, document: FileText, email: Mail } as const;
const LABEL = { client: "Clients", task: "Tasks", event: "Calendar", note: "Notes", document: "Documents", email: "Linked emails" } as const;
const FILTERS = [
  { key: "", label: "All" },
  { key: "clients", label: "Clients" },
  { key: "tasks", label: "Tasks" },
  { key: "notes", label: "Notes" },
  { key: "documents", label: "Documents" },
  { key: "emails", label: "Emails" },
];

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const app = useApp();
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const dq = useDebounced(q.trim(), 160);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const quick = React.useMemo(
    () => [
      { title: "New task with AI", sub: "Describe it in plain English", icon: Sparkles, run: () => app.openQuickAdd() },
      { title: "Go to Dashboard", sub: "G then D", icon: LayoutDashboard, run: () => router.push("/dashboard") },
      { title: "Go to Calendar", sub: "G then C", icon: CalendarDays, run: () => router.push("/calendar") },
      { title: "Go to Interviews", sub: "G then I", icon: Landmark, run: () => router.push("/interviews") },
      { title: "Go to Clients", sub: "G then L", icon: Users, run: () => router.push("/clients") },
      { title: "Go to Notifications", sub: "G then N", icon: Bell, run: () => router.push("/notifications") },
      { title: "Go to Settings", sub: "G then S", icon: Settings, run: () => router.push("/settings") },
    ],
    [app, router],
  );

  React.useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setActive(0);
      setFilter("");
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || dq.length < 1) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(dq)}${filter ? `&types=${filter}` : ""}`)
      .then((r) => !cancelled && (setHits(r.hits), setActive(0)))
      .catch(() => !cancelled && setHits([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dq, filter, open]);

  const items = dq ? hits : quick;
  const go = (i: number) => {
    const it = items[i];
    if (!it) return;
    onClose();
    if ("href" in it) router.push(it.href);
    else it.run();
  };

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)));
      else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
      else if (e.key === "Enter") (e.preventDefault(), go(active));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, active]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[8dvh] md:pt-[12dvh]">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-navy/60 backdrop-blur-md" />
          <motion.div role="dialog" aria-modal="true" aria-label={tr("Search")} initial={{ opacity: 0, y: -16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }} transition={{ type: "spring", stiffness: 420, damping: 34 }} className="relative w-full max-w-2xl overflow-hidden rounded-3xl bg-surface shadow-2xl ring-1 ring-gold/30">
            <div className="flex items-center gap-3 border-b border-line px-5">
              <Search className="size-5 text-goldink" aria-hidden />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search clients, tasks, notes, documents, emails…")} aria-label={tr("Search")} className="h-16 flex-1 bg-transparent text-lg outline-none placeholder:text-muted/70" />
              {loading && <span className="size-4 animate-spin rounded-full border-2 border-gold border-t-transparent" aria-label={tr("Searching")} />}
              <kbd className="hidden rounded-md border border-line bg-surface2 px-1.5 py-0.5 text-[11px] text-muted sm:block">{tr("esc")}</kbd>
            </div>
            <div className="flex gap-1.5 overflow-x-auto border-b border-line px-4 py-2.5">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)} className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-medium transition", filter === f.key ? "bg-navy text-white dark:bg-gold dark:text-navy" : "bg-surface2 text-muted hover:text-ink")}>
                  {tr(f.label)}
                </button>
              ))}
            </div>
            <ul className="max-h-[52dvh] overflow-y-auto p-2" role="listbox">
              {dq && !loading && items.length === 0 && (
                <li className="px-4 py-10 text-center text-sm text-muted">
                  {tr("Nothing found for “")}{dq}”.
                </li>
              )}
              {items.map((it, i) => {
                const isHit = "href" in it;
                const Icon = isHit ? ICON[it.type] ?? Folder : it.icon;
                const prev = isHit ? (items[i - 1] as SearchHit | undefined) : undefined;
                return (
                  <React.Fragment key={isHit ? `${it.type}-${it.id}` : it.title}>
                    {isHit && (!prev || prev.type !== it.type) && <li className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{tr(LABEL[it.type])}</li>}
                    {!isHit && i === 0 && <li className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{tr("Quick actions")}</li>}
                    <li role="option" aria-selected={active === i}>
                      <button onMouseEnter={() => setActive(i)} onClick={() => go(i)} className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors", active === i ? "bg-gold/15" : "hover:bg-surface2")}>
                        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", active === i ? "bg-gold text-navy" : "bg-surface2 text-goldink")}>
                          <Icon className="size-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium">{isHit ? it.title : tr(it.title)}</span>
                          {(isHit ? it.subtitle : it.sub) && <span className="block truncate text-xs text-muted">{isHit ? it.subtitle : tr(it.sub ?? "")}</span>}
                        </span>
                        {active === i && <CornerDownLeft className="size-4 text-muted" />}
                      </button>
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
