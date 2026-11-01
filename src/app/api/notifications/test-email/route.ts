import { handler } from "@/lib/api";
import { withUser } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { defaultMailer, emailConfigured } from "@/lib/notifications";

/** Sends one test email to the reminder address, so the owner can confirm the email fallback really delivers. */
export const POST = handler({}, async ({ user }) => {
  if (!emailConfigured()) throw new HttpError(400, "Email isn't set up on the server yet (SMTP settings are missing).", "email_not_configured");
  const to = await withUser(user.id, async (q) => {
    const [r] = await q.query<{ to: string }>(
      "SELECT COALESCE(p.notification_email, u.email) AS to FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id WHERE u.id = $1",
      [user.id],
    );
    return r?.to;
  });
  if (!to) throw new HttpError(400, "No email address to send to.", "no_address");
  try {
    await defaultMailer({
      to,
      subject: "Test email — your reminder emails are working",
      text: "This is a test from your US VISA WITH ARGISHTI Client Desk. If a phone notification can't be delivered, reminders will arrive like this.",
      html: "<p>This is a test from your <b>US VISA WITH ARGISHTI</b> Client Desk.</p><p>If a phone notification can't be delivered, reminders will arrive like this.</p>",
    });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(/re_[A-Za-z0-9_]+/g, "[key]").slice(0, 200);
    console.error("[email] test failed:", msg);
    throw new HttpError(502, `The email service refused the message: ${msg}`, "email_failed");
  }
  return { ok: true, to };
});
