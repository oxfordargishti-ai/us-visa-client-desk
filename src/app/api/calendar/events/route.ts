import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { EventRangeQuery, listEvents } from "@/lib/repo/calendar";

export const GET = handler({ schema: EventRangeQuery }, async ({ user, body }) => ({
  events: await withUser(user.id, (q) => listEvents(q, user.id, body)),
}));
