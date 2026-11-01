import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { SearchQuery, globalSearch } from "@/lib/repo/search";

export const GET = handler({ schema: SearchQuery }, async ({ user, body }) => ({ hits: await withUser(user.id, (q) => globalSearch(q, user.id, body)) }));
