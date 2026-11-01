import { z } from "zod";
import { handler, HttpError } from "@/lib/api";
import { withUser } from "@/lib/db";
import { pushConfigured, saveSubscription } from "@/lib/notifications";

const Body = z.object({
  endpoint: z.string().url().max(1000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(8).max(100) }),
  label: z.string().max(80).nullish(),
});

export const POST = handler({ schema: Body }, async ({ user, body, req }) => {
  if (!pushConfigured()) throw new HttpError(503, "Push notifications aren't configured on the server yet (VAPID keys missing).", "push_not_configured");
  const id = await withUser(user.id, (q) => saveSubscription(q, user.id, body, req.headers.get("user-agent"), body.label ?? null));
  return { ok: true, id };
});

const Del = z.object({ endpoint: z.string().url().max(1000) });
export const DELETE = handler({ schema: Del }, async ({ user, body }) => {
  await withUser(user.id, (q) => q.query("UPDATE push_subscriptions SET status='revoked', updated_at=now() WHERE user_id=$1 AND endpoint=$2", [user.id, body.endpoint]));
  return { ok: true };
});
