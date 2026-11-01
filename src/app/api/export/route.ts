import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { exportAll } from "@/lib/repo/export";

export const GET = handler({}, async ({ user }) => {
  const data = await withUser(user.id, (q) => exportAll(q, user.id));
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="us-visa-desk-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
});
