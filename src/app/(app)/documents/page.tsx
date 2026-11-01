import { requireUser } from "@/lib/session";
import { withUser } from "@/lib/db";
import { DocumentListQuery, listDocuments } from "@/lib/repo/documents";
import { listClients } from "@/lib/repo/clients";
import { DocumentsView } from "@/components/documents-view";

export const metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const parsed = DocumentListQuery.safeParse({ client_id: sp.client || undefined, category: sp.category || undefined, q: sp.q || undefined, limit: 300 });
  const f = parsed.success ? parsed.data : DocumentListQuery.parse({});
  const user = await requireUser();
  const data = await withUser(user.id, async (q) => {
    const [documents, clients, missing] = await Promise.all([
      listDocuments(q, user.id, f),
      listClients(q, user.id, { limit: 500 }),
      q.query<{ client_id: string; full_name: string; labels: string[] }>(
        `SELECT c.id AS client_id, c.full_name, array_agg(d.label ORDER BY d.sort_order) AS labels
           FROM document_checklists d JOIN client_cases k ON k.id=d.case_id AND k.deleted_at IS NULL JOIN clients c ON c.id=d.client_id AND c.deleted_at IS NULL
          WHERE d.user_id=$1 AND d.required AND d.status='missing' AND k.application_status NOT IN ('Visa Issued','Visa Refused','Case Closed')
          GROUP BY c.id, c.full_name ORDER BY count(*) DESC, c.full_name LIMIT 30`, [user.id]),
    ]);
    return { documents, clients: clients.map((c) => ({ id: c.id, full_name: c.full_name })), missing };
  });
  return <DocumentsView {...data} filters={{ client: f.client_id ?? "", category: f.category ?? "", q: f.q ?? "" }} />;
}
