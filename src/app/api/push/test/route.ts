import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { sendTestNotification } from "@/lib/notifications";

export const POST = handler({}, async ({ user }) => withUser(user.id, (q) => sendTestNotification(q, user.id)));
