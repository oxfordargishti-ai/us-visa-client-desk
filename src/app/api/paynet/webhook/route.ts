import { NextResponse, type NextRequest } from "next/server";
import { handlePaynetWebhook } from "@/lib/repo/payments";

// Paynet → Desk. The callback_url of every payment created by /api/portal/payment/checkout.
// Signed with X-Paynet-Signature: lowercase hex HMAC-SHA256 of the RAW body with PAYNET_WEBHOOK_SECRET.
// Paynet waits 10 s for a 2xx and retries 1, 5 and 30 minutes later otherwise.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const raw = await req.text(); // the exact bytes Paynet signed — read before any parsing
  if (raw.length > 64 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413 });
  try {
    const r = await handlePaynetWebhook(raw, {
      signature: req.headers.get("x-paynet-signature"),
      signatureNext: req.headers.get("x-paynet-signature-next"),
    });
    return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[paynet] webhook error:", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
