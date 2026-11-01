"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, Mic, MicOff, Sparkles, Wand2, ShieldCheck } from "lucide-react";
import { Button, Chip, Modal, Segmented, Skeleton, Textarea, cn, useToast, EASE } from "./ui";
import { TaskForm, WarningList, type ClientOption, type Flag } from "./task-form";
import { useApp, type QuickAddPrefill } from "./app-context";
import { api, ApiError } from "@/lib/client/api";
import { draftProblems, draftToPayload, emptyDraft, type Draft } from "@/lib/client/task-draft";
import type { TaskPreview } from "@/lib/ai/task-parser";
import { SPEECH_LANGS, useSpeech } from "@/lib/client/hooks";
import { utcToZonedParts } from "@/lib/time";
import { tr } from "@/lib/i18n";

const EXAMPLES = [
  "Call Karen tomorrow at 3 PM to prepare him for his U.S. visa interview. Remind me five hours before.",
  "Collect Anahit's bank statements by Friday 5 PM, remind me a day before",
  "Every Monday 10:00 update the weekly client report",
];

export function QuickAdd({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: QuickAddPrefill }) {
  const app = useApp();
  const toast = useToast();
  const [mode, setMode] = React.useState<"ai" | "manual">("ai");
  const [text, setText] = React.useState("");
  const [parsing, setParsing] = React.useState(false);
  const [preview, setPreview] = React.useState<TaskPreview | null>(null);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft(app.defaultReminders));
  const [flags, setFlags] = React.useState<Flag[]>([]);
  const [clients, setClients] = React.useState<ClientOption[]>([]);
  const [ackNoClient, setAckNoClient] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const speech = useSpeech((t) => setText((p) => (p ? p + " " : "") + t));

  // Reset every time it opens.
  React.useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError(null);
    setAckNoClient(false);
    setFlags([]);
    const base = emptyDraft(app.defaultReminders);
    if (prefill?.title) base.title = prefill.title;
    if (prefill?.clientId) base.client_id = prefill.clientId;
    if (prefill?.category) base.category = prefill.category as Draft["category"];
    if (prefill?.dueAt) {
      const p = utcToZonedParts(prefill.dueAt, app.tz);
      base.date = p.date;
      base.time = p.time;
    }
    setDraft(base);
    setText(prefill?.text ?? "");
    setMode(prefill?.mode ?? (app.aiEnabled ? "ai" : "manual"));
    api<{ clients: ClientOption[] }>("/api/clients?limit=500").then((r) => setClients(r.clients)).catch(() => undefined);
  }, [open, prefill, app.defaultReminders, app.tz, app.aiEnabled]);

  async function runParse() {
    setParsing(true);
    setError(null);
    try {
      const r = await api<{ preview: TaskPreview }>("/api/tasks/parse", { body: { text } });
      const p = r.preview;
      setPreview(p);
      setFlags(p.needs_review as Flag[]);
      setAckNoClient(false);
      setDraft({
        title: p.title,
        description: p.description ?? "",
        category: p.category,
        priority: p.priority,
        client_id: p.client_id,
        date: p.date ?? "",
        time: p.time ?? "",
        noDate: false,
        duration: p.duration_minutes,
        recurrence: p.recurrence ?? "",
        recurrence_until: p.recurrence_until ?? "",
        reminder_offsets: p.reminder_offsets,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr("The AI couldn't read that. You can still fill the task in manually."));
    } finally {
      setParsing(false);
    }
  }

  const problems = draftProblems(draft, app.tz);
  const unresolvedClient = Boolean(preview?.client_mention && !draft.client_id && !ackNoClient);
  const canSave = problems.length === 0 && !unresolvedClient && !saving;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = { ...draftToPayload(draft, app.tz), source: preview ? "ai" : prefill?.source ?? "manual", source_ref: prefill?.sourceRef ?? null, ai_original_text: preview?.ai_original_text ?? null };
      const r = await api<{ task: { id: string }; reminders: unknown[]; skipped_reminders: { label: string }[] }>("/api/tasks", { body: payload });
      const bits = [payload.due_at ? tr("on your calendar") : null, r.reminders.length ? tr("{n} reminders scheduled", { n: r.reminders.length }) : null].filter(Boolean);
      toast({ tone: "success", title: tr("Task saved"), body: [bits.join(" · "), r.skipped_reminders.length ? tr("{n} reminders skipped — already in the past", { n: r.skipped_reminders.length }) : ""].filter(Boolean).join(" — ") || undefined });
      app.bumpData();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr("Couldn't save the task."));
    } finally {
      setSaving(false);
    }
  }

  const reviewing = mode === "ai" && preview;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={reviewing ? tr("Review before saving") : tr("New task")}
      subtitle={reviewing ? tr("Nothing is saved until you confirm.") : tr("Describe it in your own words, or fill it in yourself.")}
      footer={
        reviewing || mode === "manual" ? (
          <>
            {reviewing && (
              <Button variant="ghost" onClick={() => setPreview(null)} className="mr-auto">
                <ArrowLeft className="size-4" />{" "}{tr("Edit my text")}
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              {tr("Cancel")}
            </Button>
            <Button variant="gold" onClick={save} disabled={!canSave} loading={saving}>
              <Check className="size-4" /> {reviewing ? tr("Confirm & save task") : tr("Save task")}
            </Button>
          </>
        ) : undefined
      }
    >
      {!reviewing && (
        <div className="mb-5">
          <Segmented
            id="qa-mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "ai", label: <span className="flex items-center gap-1.5"><Sparkles className="size-3.5" />{" "}{tr("Describe it")}</span> },
              { value: "manual", label: "Manual" },
            ]}
          />
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {mode === "ai" && !preview && (
          <motion.div key="ai-input" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25, ease: EASE }}>
            {!app.aiEnabled ? (
              <div className="rounded-2xl bg-surface2 p-5 text-sm">
                <p className="font-semibold">{tr("AI task capture isn't set up yet")}</p>
                <p className="mt-1 text-muted">{tr("Add your Anthropic API key in the server settings (see the setup guide) or switch it on in Settings. Until then, the Manual tab works fully.")}</p>
                <Button variant="soft" size="sm" className="mt-3" onClick={() => setMode("manual")}>
                  {tr("Use Manual")}
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim().length > 2) runParse();
                    }}
                    placeholder={tr("Call Karen tomorrow at 3 PM to prepare him for his U.S. visa interview. Remind me five hours before.")}
                    className="min-h-36 pr-14 text-base"
                    maxLength={1500}
                    data-autofocus
                    aria-label={tr("Describe the task")}
                  />
                  {speech.supported && (
                    <div className="absolute right-3 top-3 flex flex-col items-center gap-1.5">
                      <button type="button" onClick={speech.listening ? speech.stop : speech.start} aria-label={speech.listening ? tr("Stop dictation") : tr("Dictate")} className={cn("relative grid size-10 place-items-center rounded-full transition", speech.listening ? "bg-danger text-white" : "bg-surface2 hover:bg-surface3")}>
                        {speech.listening && <span className="animate-pulse-ring absolute inset-0 rounded-full border-2 border-danger" />}
                        {speech.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                      </button>
                      <button type="button" onClick={() => speech.setLang(SPEECH_LANGS[(SPEECH_LANGS.findIndex((l) => l.code === speech.lang) + 1) % SPEECH_LANGS.length].code)} className="rounded-md px-1.5 text-[10px] font-bold text-muted hover:bg-surface2" aria-label={tr("Dictation language")}>
                        {SPEECH_LANGS.find((l) => l.code === speech.lang)?.label}
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {EXAMPLES.map((ex) => (
                    <button key={ex} type="button" onClick={() => setText(ex)} className="max-w-full truncate rounded-full bg-surface2 px-3 py-1.5 text-xs text-muted ring-1 ring-line transition hover:text-ink hover:ring-gold/60">
                      {ex}
                    </button>
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <ShieldCheck className="size-3.5 text-success" />{" "}{tr("You review everything before it's saved.")}
                  </p>
                  <Button variant="gold" size="lg" onClick={runParse} loading={parsing} disabled={text.trim().length < 3}>
                    <Wand2 className="size-4" />{" "}{tr("Preview task")}
                  </Button>
                </div>
                {parsing && (
                  <div className="mt-5 space-y-3" aria-live="polite" aria-busy>
                    <p className="flex items-center gap-2 text-sm font-medium text-goldink">
                      <Sparkles className="size-4 animate-pulse" />{" "}{tr("Reading your instruction…")}
                    </p>
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10 w-4/5" />
                    <Skeleton className="h-10 w-3/5" />
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}

        {(reviewing || mode === "manual") && (
          <motion.div key="form" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="space-y-5">
            {reviewing && preview && (
              <>
                <div className="flex items-start gap-3 rounded-2xl bg-gradient-to-br from-gold/20 to-gold/5 p-4 ring-1 ring-gold/30">
                  <Sparkles className="mt-0.5 size-5 shrink-0 text-goldink" />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">{tr("Here's what I understood")}</p>
                    <p className="mt-0.5 break-words text-muted">“{preview.ai_original_text}”</p>
                    {flags.length > 0 && (
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-medium text-[#7a520c] dark:text-[#f0c36d]">
                        {tr("Please check:")}{" "}{flags.map((f) => <Chip key={f} tone="warning">{f}</Chip>)}
                      </p>
                    )}
                  </div>
                </div>
                <WarningList items={preview.warnings} />
                {preview.duplicates.length > 0 && (
                  <div className="rounded-xl bg-surface2 p-3 text-[13px]">
                    <p className="mb-1 font-semibold">{tr("Similar open tasks")}</p>
                    {preview.duplicates.map((d) => (
                      <p key={d.id} className="truncate text-muted">• {d.title}</p>
                    ))}
                  </div>
                )}
                {preview.assumptions.length > 0 && <p className="text-xs text-muted">{tr("Assumed:")}{" "}{preview.assumptions.join("; ")}</p>}
              </>
            )}

            <TaskForm draft={draft} onChange={setDraft} clients={clients} tz={app.tz} flags={flags} candidates={preview?.client_candidates} idPrefix="qa" />

            {preview?.client_mention && !draft.client_id && (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-warning/10 p-3.5 text-[13px] ring-1 ring-warning/30">
                <input type="checkbox" checked={ackNoClient} onChange={(e) => setAckNoClient(e.target.checked)} className="mt-0.5 size-4 accent-[#c9a86a]" />
                <span>
                  <b>“{preview.client_mention}”</b>{" "}{tr("isn't linked to a client. Choose a client above, or tick this to save the task without linking one.")}
                </span>
              </label>
            )}
            {!canSave && problems.length > 0 && (
              <p className="text-[13px] font-medium text-danger" role="status">
                {problems[0]}
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">
                {error}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {mode === "ai" && !preview && error && (
        <p role="alert" className="mt-4 rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">
          {error}{" "}
          <button className="underline" onClick={() => setMode("manual")}>
            {tr("Fill it in manually")}
          </button>
        </p>
      )}
    </Modal>
  );
}
