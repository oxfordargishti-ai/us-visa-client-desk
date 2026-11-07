# Online payments (Paynet) — client portal «Վճարել առցանց»

Clients pay the amount you set, by card, on Paynet's hosted checkout page, from the **«Վճարման տվյալներ»** section of
the client portal (portal.usvisawithargishti.com). The portal is a static Wix site and cannot hold secrets, so this
Desk is the payment server. **This build is sandbox-only**: it refuses live keys and live-mode payments.

## How it works

1. **You set the amount** — Desk → client page → *Online payment* → *Request an online payment* (AMD, what it is for).
   The client must have an email: the Gmail address they sign in to the portal with. One open request per client.
2. **The client presses «Վճարել առցանց»** on the portal (signed in with Google). The portal sends only its
   application id and the client's Wix sign-in token. The Desk checks the token with Wix, checks that the
   application belongs to that client, takes the amount **from your request in the Desk database**, and creates the
   Paynet payment (`POST https://paynet.am/api/v1/payments`, `X-Paynet-Key`, `Idempotency-Key`).
   Paynet's `order_id` is `<portal application id>-<unique attempt code>`.
3. **The client pays on Paynet's page** and is sent back to the portal (`?lxpay=return&attempt=…`). The portal shows
   only what the Desk has confirmed by reading the payment back from Paynet
   (`GET /api/v1/orders/{order_id}/payment`) — never the redirect itself.
4. **Paynet's webhook** (`POST /api/paynet/webhook`) is checked against `X-Paynet-Signature` (HMAC-SHA256 of the raw
   body with `PAYNET_WEBHOOK_SECRET`), processed once per `delivery_id`, and again only *triggers* a read-back from
   Paynet's API. A payment counts as paid only when Paynet's API says `completed`, `livemode=false`, same amount,
   same currency, same order.
5. **When it is paid** the request turns *Paid*, the case's payment status becomes *Paid*, the activity log records it
   and you get an in-app alert. A second payment for an already-settled request is flagged *refund needed*.

Repeated clicks, a second tab or a lost connection never create a second payment: an unfinished attempt is reused
(same checkout page), and a create that got no answer is retried with the same `Idempotency-Key`.

## Set it up (sandbox)

1. Create a Paynet account at https://paynet.am and, in its dashboard, add the **Sandbox** provider.
2. **Developers → API keys**: create a **test** key (`sk_test_…`). **Webhooks**: set the URL to
   `https://<this Desk's address>/api/paynet/webhook` and copy the signing secret.
3. In **Vercel → this project → Settings → Environment Variables** add:

| Variable | Required | Value |
| --- | --- | --- |
| `PAYNET_TEST_API_KEY` | yes | the `sk_test_…` key. A key that is not a test key switches payments off. |
| `PAYNET_WEBHOOK_SECRET` | yes | the webhook signing secret from Paynet |
| `PAYNET_WEBHOOK_SECRET_NEXT` | no | only during a secret rotation |
| `PAYNET_PORTAL_VISIBILITY` | no | `test-link` (default): the Pay button shows only on `https://portal.usvisawithargishti.com/?paytest=1`. `everyone`: all signed-in clients. |
| `PAYNET_PROCESSOR` | no | default `sandbox` |
| `PAYNET_STORE_DOMAIN` | no | default `portal.usvisawithargishti.com` |
| `PORTAL_URL` | no | where Paynet sends clients back; default `https://portal.usvisawithargishti.com/` |
| `PORTAL_ORIGINS` | no | sites allowed to call the payment API; default the portal and www.usvisawithargishti.com |

4. Redeploy. The client page shows *Online payment is switched off on the server: …* until both required values are
   set correctly.
5. Test: create a request for yourself (your Gmail), open `https://portal.usvisawithargishti.com/?paytest=1`, sign in
   with that Gmail, go to «Վճարման տվյալներ», press «Վճարել առցանց», pay with Paynet's test card
   `4111 1111 1111 1111` (declined: `4000 0000 0000 0002`; expires: `4000 0000 0000 0259`).

Going live later needs a deliberate code change (this build refuses `sk_live_` keys and `livemode` payments).

## Endpoints

| Method | Path | Who | |
| --- | --- | --- | --- |
| GET | `/api/portal/payment/config` | anyone | `{ enabled, mode: "sandbox", visibility }` — no client data |
| GET | `/api/portal/payment?applicationId=&attempt=` | portal, Wix member token | the client's own request + latest attempt (read back from Paynet first) |
| POST | `/api/portal/payment/checkout` `{ applicationId }` | portal, Wix member token | `{ checkoutUrl, attemptId, reused }` — any other body field is refused |
| POST | `/api/paynet/webhook` | Paynet | signature-checked, deduplicated |
| GET/POST | `/api/clients/{id}/payment-requests` | you | list / create a request |
| PATCH | `/api/payment-requests/{id}` `{ action: "cancel" \| "verify" }` | you | cancel / re-read from Paynet |

Tables (migration `004_online_payments.sql`, additive): `payment_requests`, `online_payments` (one row per attempt),
`paynet_webhook_deliveries`. Erasing a client removes theirs. Keys, secrets, tokens and client details are never
written to logs.
