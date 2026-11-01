"use client";

import * as React from "react";
import { Globe } from "lucide-react";
import { motion } from "motion/react";
import { LANGS, LANG_COOKIE, getLang, type Lang } from "@/lib/i18n";
import { cn } from "./ui";

/** Saves the language for a year and reloads so every screen, date and calendar switches together. */
export function setLanguage(code: Lang) {
  document.cookie = `${LANG_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

/** Three-way pill: EN · ՀԱՅ · РУС */
export function LanguagePills({ className, dark }: { className?: string; dark?: boolean }) {
  const [cur, setCur] = React.useState<Lang>("en");
  React.useEffect(() => setCur(getLang()), []);
  return (
    <div role="radiogroup" aria-label="Language" className={cn("relative inline-flex rounded-2xl p-1", dark ? "bg-white/10 ring-1 ring-white/15" : "bg-surface2", className)}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          role="radio"
          aria-checked={cur === l.code}
          title={l.label}
          onClick={() => cur !== l.code && setLanguage(l.code)}
          className={cn("relative z-10 rounded-xl px-3 py-1.5 text-xs font-bold tracking-wide transition-colors", cur === l.code ? "text-navy" : dark ? "text-white/70 hover:text-white" : "text-muted hover:text-ink")}
        >
          {cur === l.code && <motion.span layoutId={`lang-${dark ? "d" : "l"}`} className="absolute inset-0 -z-10 rounded-xl bg-gold shadow-md" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          {l.short}
        </button>
      ))}
    </div>
  );
}

/** Compact globe button for the top bar: cycles through the three languages. */
export function LanguageButton() {
  const [cur, setCur] = React.useState<Lang>("en");
  React.useEffect(() => setCur(getLang()), []);
  const next = LANGS[(LANGS.findIndex((l) => l.code === cur) + 1) % LANGS.length];
  return (
    <button onClick={() => setLanguage(next.code)} title={`→ ${next.label}`} aria-label={`Language: ${LANGS.find((l) => l.code === cur)?.label}. Switch to ${next.label}`} className="flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold text-ink/80 transition-colors hover:bg-surface2">
      <Globe className="size-[18px]" />
      {LANGS.find((l) => l.code === cur)?.short}
    </button>
  );
}
