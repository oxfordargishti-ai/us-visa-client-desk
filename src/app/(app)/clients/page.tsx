import { requireUser, getCurrentPrefs } from "@/lib/session";
import { parallelReader } from "@/lib/db";
import { ClientListQuery, listClients } from "@/lib/repo/clients";
import { ClientsView } from "@/components/clients-view";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const parsed = ClientListQuery.safeParse({ q: sp.q || undefined, status: sp.status || undefined, visa: sp.visa || undefined, limit: 300 });
  const filters = parsed.success ? parsed.data : ClientListQuery.parse({});
  const user = await requireUser();
  const filtered = Boolean(filters.q || filters.status || filters.visa);
  const [prefs, clients, everyone] = await Promise.all([
    getCurrentPrefs(),
    listClients(parallelReader(user.id), user.id, filters),
    filtered ? listClients(parallelReader(user.id), user.id, { limit: 500 }) : Promise.resolve(null),
  ]);
  const all = everyone ?? clients;
  const tz = prefs.timezone;
  const counts: Record<string, number> = {};
  for (const c of all) if (c.application_status) counts[c.application_status] = (counts[c.application_status] ?? 0) + 1;
  const visas = [...new Set(all.map((c) => c.visa_category).filter(Boolean))] as string[];
  return <ClientsView clients={clients} counts={counts} total={all.length} visas={visas} q={filters.q ?? ""} status={filters.status ?? ""} visa={filters.visa ?? ""} tz={tz} />;
}
