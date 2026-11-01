import { requireUser } from "@/lib/session";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/repo/prefs";
import { ClientListQuery, listClients } from "@/lib/repo/clients";
import { ClientsView } from "@/components/clients-view";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const parsed = ClientListQuery.safeParse({ q: sp.q || undefined, status: sp.status || undefined, visa: sp.visa || undefined, limit: 300 });
  const filters = parsed.success ? parsed.data : ClientListQuery.parse({});
  const user = await requireUser();
  const { clients, all, tz } = await withUser(user.id, async (q) => {
    const prefs = await getPrefs(q, user.id);
    return { tz: prefs.timezone, clients: await listClients(q, user.id, filters), all: await listClients(q, user.id, { limit: 500 }) };
  });
  const counts: Record<string, number> = {};
  for (const c of all) if (c.application_status) counts[c.application_status] = (counts[c.application_status] ?? 0) + 1;
  const visas = [...new Set(all.map((c) => c.visa_category).filter(Boolean))] as string[];
  return <ClientsView clients={clients} counts={counts} total={all.length} visas={visas} q={filters.q ?? ""} status={filters.status ?? ""} visa={filters.visa ?? ""} tz={tz} />;
}
