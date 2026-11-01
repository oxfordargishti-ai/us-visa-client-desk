// Tiny translation layer. English text is the key, so untranslated text simply shows in English.
//   tr("New client")                       → "Նոր հաճախորդ" (hy) / "Новый клиент" (ru)
//   tr("{n} min ago", { n: 5 })            → interpolation with {name} placeholders
// The current language comes from the `uva_lang` cookie: the server sets it for each render, the browser reads <html lang>.
import { hy } from "./hy";
import { ru } from "./ru";

export const LANGS = [
  { code: "en", label: "English", short: "EN" },
  { code: "hy", label: "Հայերեն", short: "ՀԱՅ" },
  { code: "ru", label: "Русский", short: "РУС" },
] as const;
export type Lang = (typeof LANGS)[number]["code"];
export const LANG_COOKIE = "uva_lang";
export const DEFAULT_LANG: Lang = "en";

const DICTS: Record<Lang, Record<string, string>> = { en: {}, hy, ru };

export const isLang = (v: unknown): v is Lang => v === "en" || v === "hy" || v === "ru";

let serverLang: Lang = DEFAULT_LANG;

/** Called by the root layout on every server render with the visitor's language. */
export function setRenderLang(l: Lang) {
  serverLang = l;
}

export function getLang(): Lang {
  if (typeof document !== "undefined") {
    const l = document.documentElement.lang;
    if (isLang(l)) return l;
  }
  return serverLang;
}

function fill(s: string, vars?: Record<string, string | number>) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Translate into the current language. (`tr` avoids clashing with the many local variables named `t`.) */
export function tr(s: string | null | undefined, vars?: Record<string, string | number>): string {
  if (s == null) return "";
  return fill(DICTS[getLang()][s] ?? s, vars);
}

/** Translate into an explicit language (server code: emails, SMS, API messages). */
export function tl(lang: Lang, s: string, vars?: Record<string, string | number>): string {
  return fill(DICTS[lang][s] ?? s, vars);
}

/** Luxon / Intl locale for dates in the current language. */
export const dateLocale = (l: Lang = getLang()) => (l === "hy" ? "hy-AM" : l === "ru" ? "ru-RU" : "en-GB");
