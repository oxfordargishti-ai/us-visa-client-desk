"use client";

import * as React from "react";

export interface QuickAddPrefill {
  text?: string;
  mode?: "ai" | "manual";
  title?: string;
  clientId?: string | null;
  dueAt?: string | null; // ISO
  category?: string;
  source?: "manual" | "ai" | "gmail" | "note";
  sourceRef?: string | null;
}

export interface AppCtxValue {
  user: { id: string; name: string; email: string };
  tz: string;
  soundEnabled: boolean;
  caps: { ai: boolean; push: boolean; email: boolean; google: boolean; googleLogin: boolean; storage: string; maxUploadMb?: number };
  vapidKey: string;
  defaultReminders: number[];
  aiEnabled: boolean;
  openQuickAdd: (p?: QuickAddPrefill) => void;
  openSearch: () => void;
  unread: number;
  refreshUnread: () => void;
  bumpData: () => void; // tell open pages that data changed
  dataVersion: number;
}

export const AppCtx = React.createContext<AppCtxValue | null>(null);
export const useApp = () => {
  const c = React.useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppShell");
  return c;
};
