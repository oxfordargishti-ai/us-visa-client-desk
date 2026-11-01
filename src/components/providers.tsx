"use client";

import * as React from "react";
import { MotionConfig } from "motion/react";
import { ToastProvider } from "./ui";

type Theme = "light" | "dark" | "system";
const ThemeCtx = React.createContext<{ theme: Theme; setTheme: (t: Theme) => void; resolved: "light" | "dark" } | null>(null);
export const useTheme = () => {
  const c = React.useContext(ThemeCtx);
  if (!c) throw new Error("useTheme outside provider");
  return c;
};

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  return dark ? "dark" : "light";
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("system");
  const [resolved, setResolved] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const saved = (localStorage.getItem("uva-theme") as Theme | null) ?? "system";
    setThemeState(saved);
    setResolved(apply(saved));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => (localStorage.getItem("uva-theme") ?? "system") === "system" && setResolved(apply("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem("uva-theme", t);
    } catch {
      /* private mode */
    }
    setResolved(apply(t));
    // Remember the choice on the server too (best effort — ignored when signed out).
    fetch("/api/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: t }) }).catch(() => undefined);
  }, []);

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, resolved }}>
      <MotionConfig reducedMotion="user">
        <ToastProvider>{children}</ToastProvider>
      </MotionConfig>
    </ThemeCtx.Provider>
  );
}
