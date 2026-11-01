import { requireUser, getCurrentPrefs } from "@/lib/session";
import { parallelReader } from "@/lib/db";
import { listInterviews } from "@/lib/repo/interviews";
import { listClients } from "@/lib/repo/clients";
import { InterviewsView } from "@/components/interviews-view";

export const metadata = { title: "Interviews" };
export const dynamic = "force-dynamic";

export default async function InterviewsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const sp = await searchParams;
  const scope = sp.scope === "past" ? "past" : "upcoming";
  const user = await requireUser();
  const q = parallelReader(user.id);
  const data = await (async () => {
    const prefs = await getCurrentPrefs();
    const [upcoming, past, clients] = await Promise.all([
      listInterviews(q, user.id, { scope: "upcoming", limit: 100 }),
      scope === "past" ? listInterviews(q, user.id, { scope: "past", limit: 100 }) : Promise.resolve([]),
      listClients(q, user.id, { limit: 500 }),
    ]);
    return { upcoming, past, defaults: prefs.default_interview_reminders, clients: clients.map((c) => ({ id: c.id, full_name: c.full_name, embassy: c.embassy, visa_category: c.visa_category })) };
  })();
  return <InterviewsView {...data} scope={scope} />;
}
