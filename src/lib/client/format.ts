import { DateTime } from "luxon";
import { dateLocale, tr } from "../i18n";

export const fmt = (iso: string | null | undefined, tz: string, f = "EEE d MMM · HH:mm") => {
  if (!iso) return "—";
  const d = DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).setLocale(dateLocale());
  return d.isValid ? d.toFormat(f) : "—";
};

export const timeOnly = (iso: string | null | undefined, tz: string) => fmt(iso, tz, "HH:mm");

export function relativeDay(iso: string, tz: string, now = new Date()): string {
  const d = DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).setLocale(dateLocale()).startOf("day");
  const n = DateTime.fromJSDate(now).setZone(tz).startOf("day");
  const diff = Math.round(d.diff(n, "days").days);
  if (diff === 0) return tr("Today");
  if (diff === 1) return tr("Tomorrow");
  if (diff === -1) return tr("Yesterday");
  if (diff > 1 && diff < 7) return d.toFormat("cccc");
  return d.toFormat("d MMM");
}

export function ago(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return tr("just now");
  if (s < 3600) return tr("{n} min ago", { n: Math.floor(s / 60) });
  if (s < 86400) return tr("{n} h ago", { n: Math.floor(s / 3600) });
  if (s < 86400 * 7) return tr("{n} d ago", { n: Math.floor(s / 86400) });
  return DateTime.fromISO(iso).setLocale(dateLocale()).toFormat("d MMM yyyy");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "2026-11-02T11:00:00Z" → value for <input type="datetime-local"> in the owner's timezone */
export function toLocalInput(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm");
}
/** value from <input type="datetime-local"> interpreted in the owner's timezone → UTC ISO */
export function fromLocalInput(value: string, tz: string): string | null {
  if (!value) return null;
  const d = DateTime.fromFormat(value, "yyyy-MM-dd'T'HH:mm", { zone: tz });
  return d.isValid ? d.toUTC().toISO() : null;
}

export const phoneHref = (p: string | null | undefined) => (p ? `tel:${p.replace(/[^+\d]/g, "")}` : undefined);
export const whatsappHref = (p: string | null | undefined) => (p ? `https://wa.me/${p.replace(/\D/g, "")}` : undefined);

export const STATUS_TONE: Record<string, string> = {
  "New Client": "bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-500/25",
  "Documents Pending": "bg-amber-500/14 text-amber-800 dark:text-amber-300 ring-amber-500/30",
  "DS-160 In Progress": "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 ring-indigo-500/25",
  "DS-160 Completed": "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 ring-indigo-500/25",
  "Appointment Pending": "bg-orange-500/12 text-orange-800 dark:text-orange-300 ring-orange-500/25",
  "Interview Scheduled": "bg-[#c9a86a]/20 text-[#7a5d22] dark:text-[#e3cb98] ring-[#c9a86a]/40",
  "Interview Preparation": "bg-violet-500/12 text-violet-700 dark:text-violet-300 ring-violet-500/25",
  "Interview Completed": "bg-teal-500/12 text-teal-800 dark:text-teal-300 ring-teal-500/25",
  "Administrative Processing": "bg-slate-500/14 text-slate-700 dark:text-slate-300 ring-slate-500/25",
  "Visa Issued": "bg-emerald-500/14 text-emerald-800 dark:text-emerald-300 ring-emerald-500/30",
  "Visa Refused": "bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-500/25",
  "Case Closed": "bg-zinc-500/12 text-zinc-600 dark:text-zinc-400 ring-zinc-500/25",
};
