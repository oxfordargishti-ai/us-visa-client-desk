"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Eye, EyeOff, ShieldCheck, CalendarClock, BellRing, FolderLock, Sparkles, ArrowRight, Check } from "lucide-react";
import { Button, Disclaimer, EASE, Field, Input, Logo } from "./ui";
import { api, ApiError } from "@/lib/client/api";

// Deterministic "random" so server and client render identical particles.
const rand = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
// Rounded so server and browser always print identical strings (Math.sin's last digits can differ between engines).
const r2 = (n: number) => Math.round(n * 10) / 10;
const PARTICLES = Array.from({ length: 28 }, (_, i) => ({ x: r2(rand(i, 1) * 100), y: r2(20 + rand(i, 2) * 80), s: r2(2 + rand(i, 3) * 3), d: r2(6 + rand(i, 4) * 8), delay: r2(rand(i, 5) * 6) }));

const FEATURES = [
  { icon: Sparkles, t: "Say it in plain English", d: "Claude turns “Call Karen tomorrow at 3 PM” into a task you approve." },
  { icon: BellRing, t: "Reminders that always arrive", d: "Server-side alerts, even when the app is closed." },
  { icon: CalendarClock, t: "Interviews at a glance", d: "Live countdowns, prep checklists and document status." },
  { icon: FolderLock, t: "Private by design", d: "Encrypted tokens, signed file access, full audit trail." },
];

const ERRORS: Record<string, string> = {
  google_off: "Google sign-in isn't turned on for this desk.",
  google_failed: "Google sign-in didn't complete. Please try again.",
  not_authorized: "That Google account doesn't have access to this desk.",
};

export function LoginScreen({ next, error, googleEnabled }: { next: string; error: string | null; googleEnabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(error ? ERRORS[error] ?? null : null);
  const [shake, setShake] = React.useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/auth/login", { body: { email, password } });
      setDone(true);
      setTimeout(() => router.replace(next), 900);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't sign in. Please try again.");
      setShake((s) => s + 1);
      setBusy(false);
    }
  }

  return (
    <main className="hero-navy noise relative isolate min-h-dvh overflow-hidden">
      {/* ambient background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="animate-float absolute -left-24 top-[-10%] size-[520px] rounded-full bg-gold/25 blur-[110px]" />
        <div className="animate-float absolute -right-32 bottom-[-15%] size-[620px] rounded-full bg-[#3b5bdb]/25 blur-[130px]" style={{ animationDelay: "-3s" }} />
        <div className="animate-float absolute left-[38%] top-[55%] size-[300px] rounded-full bg-gold/15 blur-[90px]" style={{ animationDelay: "-6s" }} />
        <div className="absolute inset-0 opacity-[0.18]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.07) 1px, transparent 1px)", backgroundSize: "56px 56px", maskImage: "radial-gradient(70% 60% at 50% 40%, #000 30%, transparent 100%)", WebkitMaskImage: "radial-gradient(70% 60% at 50% 40%, #000 30%, transparent 100%)" }} />
        {PARTICLES.map((p, i) => (
          <motion.span key={i} className="absolute rounded-full bg-gold2" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s }} animate={{ y: [0, -60, -120], opacity: [0, 0.9, 0] }} transition={{ duration: p.d, delay: p.delay, repeat: Infinity, ease: "easeInOut" }} />
        ))}
      </div>

      <div className="mx-auto grid min-h-dvh max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        {/* brand side */}
        <motion.section initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }} className="order-2 text-white lg:order-1">
          <motion.p variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="mb-4 hidden text-xs font-semibold uppercase tracking-[0.28em] text-gold2 lg:block">
            Private client desk
          </motion.p>
          <motion.h1 variants={{ hidden: { opacity: 0, y: 24, filter: "blur(8px)" }, show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.8, ease: EASE } } }} className="font-display text-[2.6rem] font-semibold leading-[1.02] sm:text-6xl lg:text-7xl">
            Your Legal Bridge
            <br />
            <span className="gold-text animate-[goldpan_6s_linear_infinite]">to the U.S.</span>
          </motion.h1>
          <motion.p variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="mt-5 max-w-lg text-lg text-white/70">
            Every client, interview, deadline and document — calm, organised and never forgotten.
          </motion.p>
          <ul className="mt-8 hidden gap-3 sm:grid sm:grid-cols-2">
            {FEATURES.map((f) => (
              <motion.li key={f.t} variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }} className="glass rounded-2xl p-4 text-white" style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(201,168,106,0.2)" }}>
                <f.icon className="mb-2 size-5 text-gold2" aria-hidden />
                <p className="text-sm font-semibold">{f.t}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-white/60">{f.d}</p>
              </motion.li>
            ))}
          </ul>
        </motion.section>

        {/* sign-in card */}
        <section className="order-1 mx-auto w-full max-w-md lg:order-2">
          <motion.div initial={{ opacity: 0, y: 36, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 140, damping: 20, delay: 0.1 }}>
            <div className="relative mx-auto mb-6 w-40 sm:w-48">
              <div className="relative overflow-hidden rounded-[28px] bg-white p-1.5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)] ring-1 ring-gold/60">
                <Logo plate={false} className="w-full rounded-[22px]" />
                <span aria-hidden className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 bg-gradient-to-r from-transparent via-white/80 to-transparent" />
              </div>
              <span aria-hidden className="absolute -inset-3 -z-10 rounded-[34px] bg-gold/30 blur-2xl" />
            </div>

            <motion.form
              key={shake}
              onSubmit={submit}
              animate={shake ? { x: [0, -12, 10, -8, 6, 0] } : undefined}
              transition={{ duration: 0.45 }}
              className="relative rounded-[28px] bg-white/95 px-6 pb-6 pt-8 text-navy shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/40 backdrop-blur-xl sm:px-8"
            >
              <h2 className="text-center font-display text-3xl font-semibold">Welcome back</h2>
              <p className="mt-1 text-center text-sm text-[#566074]">Sign in to your command center</p>

              <div className="mt-6 space-y-4 [&_label>span:first-child]:!text-navy/80 [&_input]:!bg-white [&_input]:!text-navy">
                <Field label="Email">
                  <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@usvisawithargishti.com" data-autofocus />
                </Field>
                <Field label="Password">
                  <div className="relative">
                    <Input type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="pr-12" placeholder="••••••••••" />
                    <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-[#566074] hover:bg-black/5">
                      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </Field>
              </div>

              <AnimatePresence>
                {err && (
                  <motion.p role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-4 overflow-hidden rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-[#a52a3b]">
                    {err}
                  </motion.p>
                )}
              </AnimatePresence>

              <Button type="submit" variant="primary" size="lg" loading={busy && !done} className="mt-6 w-full !bg-navy !text-white">
                <AnimatePresence mode="wait" initial={false}>
                  {done ? (
                    <motion.span key="ok" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-2 text-gold2">
                      <Check className="size-5" /> Welcome
                    </motion.span>
                  ) : (
                    <motion.span key="go" exit={{ opacity: 0 }} className="flex items-center gap-2">
                      Sign in <ArrowRight className="size-4" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </Button>

              {googleEnabled && (
                <a href="/api/auth/google" className="mt-3 flex h-12 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold text-navy transition hover:bg-black/[0.03]">
                  <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
                    <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.4z" />
                    <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.6 7.5 24 12 24z" />
                    <path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6l3.8-3z" />
                    <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.5 11.5 0 0 0 12 0C7.5 0 3.700 2.400 1.800 6.100l3.800 3C6.500 6.800 9 4.800 12 4.800z" />
                  </svg>
                  Continue with Google
                </a>
              )}

              <div className="mt-6 flex items-start gap-2 border-t border-black/5 pt-4 text-[#566074]">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <Disclaimer className="!text-[11px] !text-[#566074]" />
              </div>
            </motion.form>
          </motion.div>
        </section>
      </div>
    </main>
  );
}
