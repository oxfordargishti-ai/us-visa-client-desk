import { requireUser } from "@/lib/session";
import { withUser } from "@/lib/db";
import { listClients } from "@/lib/repo/clients";
import { GmailView } from "@/components/gmail-view";

export const metadata = { title: "Gmail" };
export const dynamic = "force-dynamic";

export default async function GmailPage({ searchParams }: { searchParams: Promise<{ thread?: string; client?: string; error?: string; connected?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const clients = await withUser(user.id, async (q) => (await listClients(q, user.id, { limit: 500 })).map((c) => ({ id: c.id, full_name: c.full_name, email: c.email })));
  return <GmailView clients={clients} initialThread={sp.thread ?? null} initialClient={sp.client ?? ""} error={sp.error ?? null} justConnected={sp.connected === "1"} />;
}
