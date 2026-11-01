"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Download, Eye, FileText, FileWarning, FolderLock, Image as ImageIcon, Lock, Search, Trash2, Upload } from "lucide-react";
import { Avatar, Button, Card, Chip, EmptyState, Field, IconButton, Modal, Rise, Select, Stagger, cn, useToast } from "./ui";
import { useApp } from "./app-context";
import { api, ApiError, upload } from "@/lib/client/api";
import { DOCUMENT_CATEGORIES } from "@/lib/constants";
import { ago, bytes } from "@/lib/client/format";
import { useDebounced, useCreateIntent } from "@/lib/client/hooks";
import type { DocumentRow } from "@/lib/types";
import { tr } from "@/lib/i18n";

export function DocumentsView({ documents, clients, missing, filters }: { documents: DocumentRow[]; clients: { id: string; full_name: string }[]; missing: { client_id: string; full_name: string; labels: string[] }[]; filters: { client: string; category: string; q: string } }) {
  const app = useApp();
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = React.useState(filters.q);
  const dq = useDebounced(q, 300);
  const [open, setOpen] = React.useState(false);
  useCreateIntent("document", () => setOpen(true));
  const [preview, setPreview] = React.useState<DocumentRow | null>(null);
  const first = React.useRef(true);

  const go = React.useCallback((n: Partial<typeof filters>) => {
    const m = { ...filters, ...n };
    const p = new URLSearchParams();
    if (m.client) p.set("client", m.client);
    if (m.category) p.set("category", m.category);
    if (m.q) p.set("q", m.q);
    router.replace(p.size ? `/documents?${p}` : "/documents", { scroll: false });
  }, [filters, router]);
  React.useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (dq !== filters.q) go({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  return (
    <Stagger className="space-y-6">
      <Rise className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.26em] text-goldink"><Lock className="size-3" />{" "}{tr("Private · signed access only")}</p>
          <h1 className="mt-1 font-display text-4xl font-semibold sm:text-5xl">{tr("Documents")}</h1>
        </div>
        <Button variant="gold" size="lg" className="self-start" onClick={() => setOpen(true)}><Upload className="size-4" />{" "}{tr("Upload")}</Button>
      </Rise>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <Rise className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search file names, notes, clients…")} aria-label={tr("Search documents")} className="h-12 w-full rounded-2xl border border-linestrong bg-surface pl-11 pr-4 text-[15px] shadow-soft focus:border-gold focus:outline-none focus:ring-4 focus:ring-gold/20" />
            </div>
            <Select value={filters.client} onChange={(e) => go({ client: e.target.value })} className="h-12 md:w-52" aria-label={tr("Client")}><option value="">{tr("All clients")}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</Select>
            <Select value={tr(filters.category)} onChange={(e) => go({ category: e.target.value })} className="h-12 md:w-48" aria-label={tr("Category")}><option value="">{tr("All categories")}</option>{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{tr(c)}</option>)}</Select>
          </Rise>
          <Rise>
            <Card className="p-3 sm:p-4">
              {documents.length === 0 ? (
                <EmptyState icon={<FolderLock className="size-6" />} title={tr("No documents found")} body={tr("Upload passports, DS-160 confirmations and supporting files. They're stored privately and only reachable through this signed-in desk.")} action={<Button variant="gold" size="sm" onClick={() => setOpen(true)}><Upload className="size-4" />{" "}{tr("Upload a document")}</Button>} />
              ) : (
                <ul className="space-y-1.5">
                  <AnimatePresence initial={false}>
                    {documents.map((d) => (
                      <motion.li key={d.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }} className="flex items-center gap-3 rounded-2xl p-3 transition hover:bg-surface2/70">
                        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/15 text-goldink">{d.mime_type.startsWith("image/") ? <ImageIcon className="size-5" /> : <FileText className="size-5" />}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{d.filename}</p>
                          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                            <Link href={`/clients/${d.client_id}?tab=documents`} className="font-medium text-goldink hover:underline">{d.client_name}</Link>
                            <span>· {tr(d.category)}</span><span>· {bytes(d.size_bytes)}</span><span>· {ago(d.uploaded_at)}</span>
                          </p>
                        </div>
                        {["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(d.mime_type) && <IconButton label={tr("Preview")} onClick={() => setPreview(d)} className="size-9"><Eye className="size-4" /></IconButton>}
                        <a href={`/api/documents/${d.id}/download`} aria-label={`Download ${d.filename}`} className="grid size-9 place-items-center rounded-xl hover:bg-surface3"><Download className="size-4" /></a>
                        <IconButton label={tr("Delete")} className="size-9 text-danger" onClick={async () => { if (!confirm(tr("Permanently delete {name}?", { name: d.filename }))) return; try { await api(`/api/documents/${d.id}`, { method: "DELETE" }); app.bumpData(); } catch (e) { toast({ tone: "error", title: tr("Couldn't delete"), body: e instanceof ApiError ? e.message : undefined }); } }}><Trash2 className="size-4" /></IconButton>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </Card>
          </Rise>
        </div>

        <Rise className="lg:col-span-4">
          <Card className="p-5 lg:sticky lg:top-24">
            <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold"><FileWarning className="size-4 text-warning" />{" "}{tr("Missing documents")}</h2>
            <p className="mb-3 text-xs text-muted">{tr("Required checklist items still outstanding, for active cases.")}</p>
            {missing.length === 0 ? <p className="py-6 text-center text-sm text-muted">{tr("Nothing missing. 🎉")}</p> : (
              <ul className="space-y-1.5">
                {missing.map((m) => (
                  <li key={m.client_id}>
                    <Link href={`/clients/${m.client_id}?tab=documents`} className="block rounded-xl p-2.5 ring-1 ring-line transition hover:bg-surface2">
                      <span className="flex items-center gap-2.5"><Avatar name={m.full_name} size={28} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{m.full_name}</span><Chip tone="warning">{m.labels.length}</Chip></span>
                      <span className="mt-1 block truncate pl-[38px] text-xs text-muted">{m.labels.map((l) => l.split(" (")[0]).join(", ")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Rise>
      </div>

      <UploadModal open={open} onClose={() => setOpen(false)} clients={clients} defaultClient={filters.client} />
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.filename} subtitle={preview ? `${tr(preview.category)} · ${preview.client_name}` : undefined} size="xl">
        {preview && (preview.mime_type === "application/pdf" ? <iframe title={preview.filename} src={`/api/documents/${preview.id}/download?inline=1`} className="h-[70dvh] w-full rounded-2xl border border-line bg-white" /> : /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/documents/${preview.id}/download?inline=1`} alt={preview.filename} className="mx-auto max-h-[70dvh] rounded-2xl" />)}
      </Modal>
    </Stagger>
  );
}

function UploadModal({ open, onClose, clients, defaultClient }: { open: boolean; onClose: () => void; clients: { id: string; full_name: string }[]; defaultClient: string }) {
  const app = useApp();
  const toast = useToast();
  const [client, setClient] = React.useState(defaultClient);
  const [cat, setCat] = React.useState<string>("Passport");
  const [files, setFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) { setClient(defaultClient); setFiles([]); } }, [open, defaultClient]);
  async function go() {
    setBusy(true);
    let ok = 0;
    for (const f of files) {
      const fd = new FormData();
      fd.set("file", f); fd.set("client_id", client); fd.set("category", cat);
      try { await upload("/api/documents", fd, app.caps.maxUploadMb ?? 15); ok++; } catch (e) { toast({ tone: "error", title: `${f.name} wasn't saved`, body: e instanceof ApiError ? e.message : undefined }); }
    }
    setBusy(false);
    if (ok) { toast({ tone: "success", title: tr("{n} documents stored privately", { n: ok }) }); app.bumpData(); onClose(); }
  }
  return (
    <Modal open={open} onClose={onClose} title={tr("Upload documents")} subtitle={tr("Files are stored privately and linked to the client you choose.")} footer={<><Button variant="outline" onClick={onClose}>{tr("Cancel")}</Button><Button variant="gold" loading={busy} disabled={!client || !files.length} onClick={go}><Upload className="size-4" />{" "}{tr("Upload")}{" "}{files.length || ""}</Button></>}>
      <div className="space-y-4">
        <Field label={tr("Client")}><Select value={client} onChange={(e) => setClient(e.target.value)} data-autofocus><option value="">{tr("Choose a client…")}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</Select></Field>
        <Field label={tr("Category")}><Select value={cat} onChange={(e) => setCat(e.target.value)}>{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{tr(c)}</option>)}</Select></Field>
        <div onDragOver={(e) => (e.preventDefault(), setDrag(true))} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); setFiles([...files, ...Array.from(e.dataTransfer.files)]); }} className={cn("rounded-2xl border-2 border-dashed p-6 text-center transition", drag ? "border-gold bg-gold/10" : "border-linestrong")}>
          <Upload className="mx-auto mb-2 size-6 text-goldink" />
          <p className="text-sm font-medium">{tr("Drop files here or")}{" "}<button type="button" className="font-semibold text-goldink underline" onClick={() => ref.current?.click()}>{tr("browse")}</button></p>
          <p className="mt-1 text-xs text-muted">{tr("PDF, JPG, PNG, WEBP, HEIC, DOCX · max")}{" "}{app.caps.maxUploadMb ?? 15}{" "}{tr("MB each")}</p>
          <input ref={ref} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx,.txt" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>
        {files.length > 0 && <ul className="space-y-1.5">{files.map((f, i) => <li key={i} className="flex items-center justify-between rounded-xl bg-surface2 px-3 py-2 text-sm"><span className="truncate">{f.name}</span><button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="ml-3 text-xs font-semibold text-danger">{tr("Remove")}</button></li>)}</ul>}
      </div>
    </Modal>
  );
}
