import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { PrefsPatch, getPrefs, updatePrefs } from "@/lib/repo/prefs";

export const GET = handler({}, async ({ user }) => ({ preferences: await withUser(user.id, (q) => getPrefs(q, user.id)) }));
export const PATCH = handler({ schema: PrefsPatch }, async ({ user, body }) => ({ preferences: await withUser(user.id, (q) => updatePrefs(q, user.id, body)) }));
