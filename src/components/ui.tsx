"use client";

import * as React from "react";
import clsx from "clsx";
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type HTMLMotionProps, type Variants } from "motion/react";
import { Check, Loader2, X, AlertTriangle, Info, CircleCheck } from "lucide-react";
import { initials } from "@/lib/client/format";
import { tr } from "@/lib/i18n";

export const cn = clsx;

/* ───────────────────────── Motion presets ───────────────────────── */
export const EASE = [0.2, 0.7, 0.2, 1] as const;
export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } } };
export const rise: Variants = {
  hidden: { opacity: 0, y: 16, filter: "blur(4px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.55, ease: EASE } },
};

export function Stagger({ children, className, as = "div" }: { children: React.ReactNode; className?: string; as?: "div" | "ul" | "section" }) {
  const C = motion[as] as typeof motion.div;
  return (
    <C variants={stagger} initial="hidden" animate="show" className={className}>
      {children}
    </C>
  );
}
export function Rise({ children, className, ...rest }: HTMLMotionProps<"div">) {
  return (
    <motion.div variants={rise} className={className} {...rest}>
      {children}
    </motion.div>
  );
}

/* ───────────────────────── Buttons ───────────────────────── */
type BtnVariant = "primary" | "gold" | "outline" | "ghost" | "danger" | "soft";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-navy text-white hover:bg-navy2 dark:bg-gold dark:text-navy dark:hover:bg-gold2 shadow-[0_8px_20px_-8px_rgba(11,20,38,0.6)]",
  gold: "bg-gradient-to-br from-gold2 via-gold to-gold3 text-navy shadow-[0_10px_24px_-10px_rgba(201,168,106,0.9)] hover:brightness-105",
  outline: "border border-linestrong bg-surface text-ink hover:bg-surface2",
  ghost: "text-ink hover:bg-surface2",
  soft: "bg-surface2 text-ink hover:bg-surface3",
  danger: "bg-danger text-white hover:brightness-110 shadow-[0_8px_20px_-8px_rgba(204,71,87,0.7)]",
};
const BTN_SIZE = { sm: "h-9 px-3 text-sm gap-1.5 rounded-xl", md: "h-11 px-4 text-[15px] gap-2 rounded-xl", lg: "h-14 px-6 text-base gap-2.5 rounded-2xl" };

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: BtnVariant;
  size?: keyof typeof BTN_SIZE;
  loading?: boolean;
  children?: React.ReactNode;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, disabled, className, children, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      disabled={disabled || loading}
      className={cn(
        "relative inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        BTN[variant],
        BTN_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </motion.button>
  );
});

export function IconButton({ label, className, children, ...rest }: Omit<HTMLMotionProps<"button">, "children"> & { label: string; children: React.ReactNode }) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      whileHover={{ scale: 1.06 }}
      aria-label={label}
      title={label}
      className={cn("grid size-10 place-items-center rounded-xl text-ink/80 transition-colors hover:bg-surface2 hover:text-ink", className)}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

/* ───────────────────────── Surfaces ───────────────────────── */
export function Card({ className, children, hover = false, ...rest }: HTMLMotionProps<"div"> & { hover?: boolean; children?: React.ReactNode }) {
  return (
    <motion.div
      whileHover={hover ? { y: -3, boxShadow: "0 2px 4px rgba(11,20,38,0.05), 0 20px 44px -14px rgba(11,20,38,0.28)" } : undefined}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className={cn("card", hover && "sweep", className)}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function SectionTitle({ icon, title, action, sub }: { icon?: React.ReactNode; title: string; action?: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        {icon && <span className="grid size-8 place-items-center rounded-lg bg-gold/15 text-goldink">{icon}</span>}
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{tr(title)}</h2>
          {sub && <p className="text-xs text-muted">{tr(sub)}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Chip({ children, className, tone = "neutral", dot }: { children: React.ReactNode; className?: string; tone?: "neutral" | "gold" | "success" | "warning" | "danger" | "info"; dot?: string }) {
  const tones = {
    neutral: "bg-surface2 text-muted ring-line",
    gold: "bg-gold/18 text-[#7a5d22] dark:text-gold2 ring-gold/40",
    success: "bg-success/12 text-success ring-success/25",
    warning: "bg-warning/15 text-[#8a5f10] dark:text-[#f0c36d] ring-warning/30",
    danger: "bg-danger/12 text-danger ring-danger/25",
    info: "bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-500/25",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} />}
      {children}
    </span>
  );
}

export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 40;
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-2xl font-display font-semibold text-navy", className)}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, hsl(${38 + hue} 55% 80%), hsl(${38 + hue} 48% 62%))` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="mb-4 grid size-14 place-items-center rounded-2xl bg-gold/15 text-goldink">
        {icon}
      </motion.div>
      <p className="font-display text-xl font-semibold">{tr(title)}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{tr(body)}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ───────────────────────── Form fields ───────────────────────── */
const field = "w-full rounded-xl border border-linestrong bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 transition-shadow focus:border-gold focus:outline-none focus:ring-4 focus:ring-gold/20 disabled:opacity-60";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(field, "h-11", className)} {...p} />;
});
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(field, "h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%238a93a6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m4 6 4 4 4-4'/></svg>")` }} {...p}>
      {children}
    </select>
  );
});
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(field, "min-h-24 py-3", className)} {...p} />;
});
export function Field({ label, hint, error, children, className, flag }: { label: string; hint?: string; error?: string; children: React.ReactNode; className?: string; flag?: boolean }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-ink/80">
        {tr(label)}
        {flag && <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a5f10] dark:text-[#f0c36d]">{tr("Please check")}</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{tr(hint)}</span>}
      {error && <span className="mt-1 block text-xs text-danger">{tr(error)}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-gold" : "bg-surface3")}
    >
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 32 }} className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow-md", checked ? "right-0.5" : "left-0.5")} />
    </button>
  );
}

export function Segmented<T extends string>({ options, value, onChange, id, className }: { options: { value: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void; id: string; className?: string }) {
  return (
    <div role="tablist" className={cn("relative inline-flex rounded-2xl bg-surface2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("relative z-10 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition-colors", value === o.value ? "text-navy dark:text-navy" : "text-muted hover:text-ink")}
        >
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 -z-10 rounded-xl bg-white shadow-md dark:bg-gold" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          {typeof o.label === "string" ? tr(o.label) : o.label}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── Overlays ───────────────────────── */
function useFocusTrap(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const el = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? []);
    const t = setTimeout(() => (el?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, ref, onClose]);
}

export function Modal({ open, onClose, title, children, size = "md", footer, subtitle, hideHeader }: { open: boolean; onClose: () => void; title?: string; subtitle?: string; children: React.ReactNode; size?: "sm" | "md" | "lg" | "xl"; footer?: React.ReactNode; hideHeader?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);
  const w = { sm: "md:max-w-md", md: "md:max-w-xl", lg: "md:max-w-3xl", xl: "md:max-w-5xl" }[size];
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:p-6">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} onClick={onClose} className="absolute inset-0 bg-navy/55 backdrop-blur-md" />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title ? tr(title) : undefined}
            initial={{ opacity: 0, y: 48, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 32, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={cn("relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-2xl ring-1 ring-line md:rounded-[28px]", w)}
          >
            <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-surface3 md:hidden" />
            {!hideHeader && (
              <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-4 md:pt-6">
                <div>
                  {title && <h2 className="font-display text-2xl font-semibold leading-tight">{tr(title)}</h2>}
                  {subtitle && <p className="mt-0.5 text-sm text-muted">{tr(subtitle)}</p>}
                </div>
                <IconButton label={tr("Close")} onClick={onClose} className="-mr-2 -mt-1">
                  <X className="size-5" />
                </IconButton>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">{children}</div>
            {footer && <div className="safe-bottom flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface2/60 px-6 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Right-hand drawer on desktop, bottom sheet on phones. */
export function Drawer({ open, onClose, title, children, footer, subtitle }: { open: boolean; onClose: () => void; title?: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[65] flex items-end justify-end md:items-stretch">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-navy/45 backdrop-blur-sm" />
          <motion.aside
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0.6, x: 60, y: 0 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-2xl ring-1 ring-line md:max-h-none md:w-[480px] md:rounded-none md:rounded-l-[28px]"
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0">
                <h2 className="truncate font-display text-2xl font-semibold leading-tight">{title}</h2>
                {subtitle && <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>}
              </div>
              <IconButton label={tr("Close")} onClick={onClose} className="-mr-2">
                <X className="size-5" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="safe-bottom flex flex-wrap items-center gap-3 border-t border-line bg-surface2/60 px-6 py-4">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────── Toasts ───────────────────────── */
interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}
const ToastCtx = React.createContext<{ push: (t: Omit<Toast, "id">) => void } | null>(null);
export const useToast = () => {
  const c = React.useContext(ToastCtx);
  if (!c) throw new Error("useToast outside provider");
  return c.push;
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const idRef = React.useRef(0);
  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = ++idRef.current;
    setItems((p) => [...p.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), t.action ? 7000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[90] flex flex-col items-center gap-2 px-4 md:bottom-6">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-navy px-4 py-3 text-white shadow-2xl ring-1 ring-gold/30"
            >
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", t.tone === "success" ? "bg-success/25 text-emerald-300" : t.tone === "error" ? "bg-danger/25 text-rose-300" : "bg-gold/25 text-gold2")}>
                {t.tone === "success" ? <CircleCheck className="size-4" /> : t.tone === "error" ? <AlertTriangle className="size-4" /> : <Info className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{tr(t.title)}</p>
                {t.body && <p className="line-clamp-2 text-xs text-white/70">{tr(t.body)}</p>}
              </div>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.run();
                    setItems((p) => p.filter((x) => x.id !== t.id));
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm font-semibold text-gold2 hover:bg-white/10"
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/* ───────────────────────── Data-viz & delight ───────────────────────── */
export function AnimatedNumber({ value, className, duration = 1.1 }: { value: number; className?: string; duration?: number }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v).toString());
  React.useEffect(() => {
    const c = animate(mv, value, { duration, ease: EASE });
    return () => c.stop();
  }, [value, duration, mv]);
  return <motion.span className={cn("tabular", className)}>{rounded}</motion.span>;
}

export function ProgressRing({ value, size = 96, stroke = 8, children, tone = "gold", className }: { value: number; size?: number; stroke?: number; children?: React.ReactNode; tone?: "gold" | "danger" | "success"; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const id = React.useId();
  const stops = { gold: ["#e3cb98", "#c9a86a"], danger: ["#f08a97", "#cc4757"], success: ["#5fd1b0", "#16856a"] }[tone];
  return (
    <div className={cn("relative grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={stops[0]} />
            <stop offset="100%" stopColor={stops[1]} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, value))) }}
          transition={{ duration: 1.3, ease: EASE, delay: 0.15 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** Round checkbox with a drawn tick and a small burst of gold sparks on completion. */
export function CompleteCheck({ checked, onToggle, size = 28, disabled, label }: { checked: boolean; onToggle: () => void; size?: number; disabled?: boolean; label: string }) {
  const [burst, setBurst] = React.useState(0);
  const sparks = React.useMemo(() => Array.from({ length: 10 }, (_, i) => ({ a: (i / 10) * Math.PI * 2, d: 20 + (i % 3) * 7, s: 3 + (i % 2) * 2 })), []);
  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      whileTap={{ scale: 0.82 }}
      onClick={() => {
        if (!checked) setBurst((b) => b + 1);
        onToggle();
      }}
      className={cn("relative grid shrink-0 place-items-center rounded-full border-2 transition-colors", checked ? "border-transparent bg-gradient-to-br from-gold2 to-gold3" : "border-linestrong bg-surface hover:border-gold")}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" stroke="#0b1426" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={{ duration: 0.32, ease: EASE }} />
      </svg>
      <AnimatePresence>
        {burst > 0 &&
          checked &&
          sparks.map((s, i) => (
            <motion.span
              key={`${burst}-${i}`}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: Math.cos(s.a) * s.d, y: Math.sin(s.a) * s.d, opacity: 0, scale: 0.2 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="pointer-events-none absolute rounded-full bg-gold"
              style={{ width: s.s, height: s.s }}
            />
          ))}
      </AnimatePresence>
      {checked && <motion.span aria-hidden initial={{ scale: 0.6, opacity: 0.7 }} animate={{ scale: 2.1, opacity: 0 }} transition={{ duration: 0.6 }} className="pointer-events-none absolute inset-0 rounded-full border border-gold" />}
    </motion.button>
  );
}

export function Logo({ className, plate = true }: { className?: string; plate?: boolean }) {
  // The supplied logo, unaltered — only cropped and resized. It lives on a white plate so its native background reads as intentional.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/logo-320.png" srcSet="/brand/logo-320.png 1x, /brand/logo-640.png 2x" alt={tr("US VISA WITH ARGISHTI")} className={cn(plate && "rounded-2xl bg-white", className)} draggable={false} />
  );
}

export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] leading-relaxed text-muted", className)}>
      {tr("US VISA WITH ARGISHTI is an independent visa application support service. It is not affiliated with the U.S. government, and nothing here is legal advice or a guarantee of visa approval.")}
    </p>
  );
}

export const PriorityDot = ({ p }: { p: string }) => (
  <span className={cn("inline-block size-2 rounded-full", p === "Urgent" ? "bg-danger" : p === "High" ? "bg-warning" : p === "Low" ? "bg-surface3" : "bg-gold")} title={`${p} priority`} />
);

export { Check };
