"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell, CalendarDays, CheckSquare, FolderLock, LayoutDashboard, LogOut, Mail, Menu, Moon, Plus, Search, Settings, Sun, Users, Landmark, Sparkles, Download, MonitorSmartphone,
} from "lucide-react";
import { AppCtx, type AppCtxValue, type QuickAddPrefill } from "./app-context";
import { Avatar, Button, Chip, IconButton, Logo, Modal, cn, useToast } from "./ui";
import { useTheme } from "./providers";
import { QuickAdd } from "./quick-add";
import { SearchPalette } from "./search-palette";
import { TaskDrawerHost } from "./task-bits";
import { api } from "@/lib/client/api";
import { deviceLabel, enablePush, playChime, useInstall } from "@/lib/client/hooks";

const NAV = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: LayoutDashboard, key: "d" },
  { href: "/tasks", label: "My Tasks", short: "Tasks", icon: CheckSquare, key: "t" },
  { href: "/calendar", label: "Calendar", short: "Calendar", icon: CalendarDays, key: "c" },
  { href: "/interviews", label: "Interviews", short: "Interviews", icon: Landmark, key: "i" },
  { href: "/clients", label: "Clients", short: "Clients", icon: Users, key: "l" },
  { href: "/gmail", label: "Gmail", short: "Gmail", icon: Mail, key: "m" },
  { href: "/documents", label: "Documents", short: "Docs", icon: FolderLock, key: "o" },
  { href: "/notifications", label: "Notifications", short: "Alerts", icon: Bell, key: "n" },
  { href: "/settings", label: "Settings", short: "Settings", icon: Settings, key: "s" },
] as const;

type Props = Omit<AppCtxValue, "openQuickAdd" | "openSearch" | "unread" | "refreshUnread" | "bumpData" | "dataVersion"> & { initialUnread: number; children: React.ReactNode };

export function AppShell({ children, initialUnread, ...base }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const { theme, setTheme, resolved } = useTheme();
  const install = useInstall();

  const [unread, setUnread] = React.useState(initialUnread);
  const [quick, setQuick] = React.useState<{ open: boolean; prefill?: QuickAddPrefill }>({ open: false });
  const [search, setSearch] = React.useState(false);
  const [more, setMore] = React.useState(false);
  const [dataVersion, setDataVersion] = React.useState(0);
  const lastUnread = React.useRef(initialUnread);
  const lastTop = React.useRef<string | null>(null);

  const refreshUnread = React.useCallback(async () => {
    try {
      const r = await api<{ unread: number; notifications: { id: string; title: string; body: string; url: string | null }[] }>("/api/notifications?channel=inapp&limit=3");
      if (r.unread > lastUnread.current && r.notifications[0] && r.notifications[0].id !== lastTop.current) {
        toast({ tone: "info", title: "Reminder", body: r.notifications[0].body, action: r.notifications[0].url ? { label: "Open", run: () => router.push(r.notifications[0].url!) } : undefined });
        if (base.soundEnabled) playChime();
        router.refresh();
      }
      lastTop.current = r.notifications[0]?.id ?? lastTop.current;
      lastUnread.current = r.unread;
      setUnread(r.unread);
    } catch {
      /* offline or signed out — ignore */
    }
  }, [router, toast, base.soundEnabled]);

  // Service worker registration + messages from notifications.
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "navigate" && typeof e.data.url === "string") router.push(e.data.url);
      if (e.data?.type === "push-received") refreshUnread();
      if (e.data?.type === "resubscribe" && base.vapidKey && "Notification" in window && Notification.permission === "granted") {
        // The browser rotated this device's push subscription — register the new one so reminders keep arriving.
        enablePush(base.vapidKey, deviceLabel()).catch(() => undefined);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [router, refreshUnread, base.vapidKey]);

  // Poll for new in-app reminders while the app is open and visible.
  React.useEffect(() => {
    lastTop.current = null;
    const tick = () => document.visibilityState === "visible" && refreshUnread();
    const t = setInterval(tick, 45_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refreshUnread]);

  // Keyboard shortcuts: ⌘/Ctrl+K or "/" search · "n" new task · "g" then a letter jumps to a page.
  React.useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.matches?.("input, textarea, select, [contenteditable='true']");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      // "g" then a letter jumps to a page (checked first so "g n" means Notifications, not "new task").
      if (gAt && Date.now() - gAt < 900) {
        gAt = 0;
        const hit = NAV.find((n) => n.key === e.key);
        if (hit) {
          e.preventDefault();
          router.push(hit.href);
          return;
        }
      }
      if (e.key === "/") (e.preventDefault(), setSearch(true));
      else if (e.key === "n") (e.preventDefault(), setQuick({ open: true }));
      else if (e.key === "g") gAt = Date.now();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  React.useEffect(() => setMore(false), [pathname]);

  const ctx: AppCtxValue = React.useMemo(
    () => ({
      ...base,
      openQuickAdd: (p) => setQuick({ open: true, prefill: p }),
      openSearch: () => setSearch(true),
      unread,
      refreshUnread,
      bumpData: () => {
        setDataVersion((v) => v + 1);
        router.refresh();
      },
      dataVersion,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base.user.id, base.tz, base.soundEnabled, base.vapidKey, base.aiEnabled, base.defaultReminders, unread, dataVersion, refreshUnread, router],
  );

  async function signOut() {
    await api("/api/auth/logout", { body: {} }).catch(() => undefined);
    window.location.href = "/login";
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <AppCtx.Provider value={ctx}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-xl focus:bg-gold focus:px-4 focus:py-2 focus:font-semibold focus:text-navy">
        Skip to content
      </a>

      {/* ───────── desktop sidebar ───────── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[272px] flex-col bg-navy text-white lg:flex" style={{ backgroundImage: "radial-gradient(120% 60% at 0% 0%, rgba(201,168,106,0.16), transparent 60%), linear-gradient(180deg, #0b1426, #0a1220)" }}>
        <div aria-hidden className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-gold/40 to-transparent" />
        <Link href="/dashboard" className="group mx-5 mt-6 block" aria-label="US VISA WITH ARGISHTI — dashboard">
          <div className="relative overflow-hidden rounded-3xl bg-white p-1.5 shadow-[0_16px_40px_-14px_rgba(0,0,0,0.7)] ring-1 ring-gold/50 transition-transform group-hover:scale-[1.02]">
            <Logo plate={false} className="w-full rounded-[18px]" />
            <span aria-hidden className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 bg-gradient-to-r from-transparent via-white/80 to-transparent" />
          </div>
        </Link>
        <p className="mt-3 px-6 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-gold2/90">Your Legal Bridge to the U.S.</p>

        <nav className="mt-6 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">
          {NAV.map((n) => {
            const active = isActive(n.href);
            const badge = n.href === "/notifications" ? unread : 0;
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cn("relative flex items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-medium transition-colors", active ? "text-white" : "text-white/65 hover:bg-white/5 hover:text-white")}>
                {active && (
                  <motion.span layoutId="nav-active" transition={{ type: "spring", stiffness: 380, damping: 34 }} className="absolute inset-0 rounded-2xl bg-gradient-to-r from-gold/25 via-gold/10 to-transparent ring-1 ring-gold/40">
                    <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-gold" />
                  </motion.span>
                )}
                <n.icon className={cn("relative size-[19px]", active && "text-gold2")} aria-hidden />
                <span className="relative">{n.label}</span>
                {badge > 0 && <span className="relative ml-auto grid min-w-6 place-items-center rounded-full bg-gold px-1.5 text-xs font-bold text-navy">{badge > 99 ? "99+" : badge}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 p-4">
          {!install.installed && (install.canInstall || install.ios) && (
            <button onClick={() => (install.canInstall ? install.install() : router.push("/notifications#install"))} className="flex w-full items-center gap-3 rounded-2xl bg-white/5 px-4 py-3 text-left text-sm text-white/80 ring-1 ring-white/10 transition hover:bg-white/10">
              <Download className="size-4 text-gold2" /> Install the app
            </button>
          )}
          <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
            <Avatar name={base.user.name} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{base.user.name}</p>
              <p className="truncate text-xs text-white/50">{base.user.email}</p>
            </div>
            <IconButton label="Sign out" onClick={signOut} className="text-white/70 hover:bg-white/10 hover:text-white">
              <LogOut className="size-[18px]" />
            </IconButton>
          </div>
        </div>
      </aside>

      {/* ───────── main column ───────── */}
      <div className="lg:pl-[272px]">
        <header className="glass safe-top sticky top-0 z-30 border-x-0 border-t-0">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 lg:px-8">
            <button onClick={() => setSearch(true)} className="group flex h-11 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-surface/80 px-4 text-left text-sm text-muted transition hover:border-gold/60 hover:shadow-md lg:max-w-xl" aria-label="Search">
              <Search className="size-4 shrink-0 transition-colors group-hover:text-goldink" />
              <span className="truncate">Search clients, tasks, notes…</span>
              <kbd className="ml-auto hidden rounded-md border border-line bg-surface2 px-1.5 py-0.5 text-[11px] font-medium sm:block">⌘K</kbd>
            </button>
            <div className="ml-auto hidden items-center gap-1 sm:flex">
              <Button variant="gold" size="md" onClick={() => setQuick({ open: true })} className="mr-1">
                <Sparkles className="size-4" /> New task
              </Button>
            </div>
            <BellButton unread={unread} />
            <IconButton label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={resolved} initial={{ rotate: -90, opacity: 0, scale: 0.6 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: 90, opacity: 0, scale: 0.6 }} transition={{ duration: 0.22 }}>
                  {resolved === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
                </motion.span>
              </AnimatePresence>
            </IconButton>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-[1400px] px-4 pb-32 pt-6 lg:px-8 lg:pb-16 lg:pt-8">
          {children}
        </main>
      </div>

      {/* ───────── mobile bottom navigation ───────── */}
      <nav className="glass safe-bottom fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 lg:hidden" aria-label="Primary">
        <ul className="mx-auto grid max-w-lg grid-cols-[1fr_1fr_88px_1fr_1fr] items-end px-2 pt-1.5">
          {[NAV[0], NAV[1]].map((n) => (
            <BottomItem key={n.href} href={n.href} short={n.short} icon={n.icon} active={isActive(n.href)} />
          ))}
          <li className="relative grid place-items-center">
            <motion.button whileTap={{ scale: 0.88 }} onClick={() => setQuick({ open: true })} aria-label="Quick add task" className="relative -mt-7 grid size-16 place-items-center rounded-full bg-gradient-to-br from-gold2 via-gold to-gold3 text-navy shadow-[0_14px_30px_-6px_rgba(201,168,106,0.9)] ring-4 ring-bg">
              <span aria-hidden className="animate-pulse-ring absolute inset-0 rounded-full border-2 border-gold" />
              <Plus className="size-8" strokeWidth={2.6} />
            </motion.button>
          </li>
          <BottomItem href={NAV[2].href} short={NAV[2].short} icon={NAV[2].icon} active={isActive(NAV[2].href)} />
          <li>
            <button onClick={() => setMore(true)} className="flex w-full flex-col items-center gap-0.5 py-1.5 text-[10.5px] font-medium text-muted" aria-label="More">
              <Menu className="size-[22px]" />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title="Everything" size="sm">
        <div className="grid grid-cols-3 gap-3">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("relative flex flex-col items-center gap-2 rounded-2xl p-4 text-center text-[12px] font-medium ring-1 ring-line transition active:scale-95", isActive(n.href) ? "bg-gold/15 ring-gold/40" : "bg-surface2")}>
              <n.icon className="size-6 text-goldink" />
              {n.short}
              {n.href === "/notifications" && unread > 0 && <span className="absolute right-2 top-2 grid min-w-5 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-navy">{unread}</span>}
            </Link>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between rounded-2xl bg-surface2 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={base.user.name} size={36} />
            <div>
              <p className="text-sm font-semibold">{base.user.name}</p>
              <p className="text-xs text-muted">{base.user.email}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-surface2 p-4">
          <span className="flex items-center gap-2 text-sm font-medium">
            <MonitorSmartphone className="size-4 text-goldink" /> Appearance
          </span>
          <div className="flex gap-1">
            {(["light", "dark", "system"] as const).map((t) => (
              <Chip key={t} tone={theme === t ? "gold" : "neutral"} className="cursor-pointer capitalize" >
                <button onClick={() => setTheme(t)}>{t}</button>
              </Chip>
            ))}
          </div>
        </div>
      </Modal>

      <QuickAdd open={quick.open} prefill={quick.prefill} onClose={() => setQuick({ open: false })} />
      <SearchPalette open={search} onClose={() => setSearch(false)} />
      <TaskDrawerHost />
    </AppCtx.Provider>
  );
}

function BottomItem({ href, short, icon: Icon, active }: { href: string; short: string; icon: React.ComponentType<{ className?: string }>; active: boolean; [k: string]: unknown }) {
  return (
    <li>
      <Link href={href} aria-current={active ? "page" : undefined} className={cn("relative flex flex-col items-center gap-0.5 py-1.5 text-[10.5px] font-medium transition-colors", active ? "text-ink" : "text-muted")}>
        {active && <motion.span layoutId="bottom-active" className="absolute -top-1.5 h-[3px] w-8 rounded-full bg-gold" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
        <Icon className={cn("size-[22px]", active && "text-goldink")} />
        {short}
      </Link>
    </li>
  );
}

function BellButton({ unread }: { unread: number }) {
  const prev = React.useRef(unread);
  const [wiggle, setWiggle] = React.useState(0);
  React.useEffect(() => {
    if (unread > prev.current) setWiggle((w) => w + 1);
    prev.current = unread;
  }, [unread]);
  return (
    <Link href="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative grid size-10 place-items-center rounded-xl text-ink/80 transition-colors hover:bg-surface2">
      <motion.span key={wiggle} animate={wiggle ? { rotate: [0, -18, 16, -12, 8, 0] } : undefined} transition={{ duration: 0.7 }}>
        <Bell className="size-5" />
      </motion.span>
      <AnimatePresence>
        {unread > 0 && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute right-0.5 top-0.5 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[18px] text-white ring-2 ring-bg">
            {unread > 99 ? "99+" : unread}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}
