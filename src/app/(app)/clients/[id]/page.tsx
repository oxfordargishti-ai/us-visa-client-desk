import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/repo/prefs";
import { getClientDetail } from "@/lib/repo/clients";
import { ClientDetail } from "@/components/client-detail";
import { zId } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: "Client" };
}

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!zId.safeParse(id).success) notFound();
  const user = await requireUser();
  const res = await withUser(user.id, async (q) => {
    const prefs = await getPrefs(q, user.id);
    return { prefs, detail: await getClientDetail(q, user.id, id), defaults: prefs.default_interview_reminders };
  });
  if (!res.detail) notFound();
  return <ClientDetail detail={res.detail} tz={res.prefs.timezone} defaults={res.defaults} initialTab={sp.tab ?? "overview"} />;
}
