# Libra Partner Wallet + Xendit

## Netlify environment variables
Set these in Netlify Project configuration > Environment variables. Do not put secrets in `netlify.toml` or browser JavaScript.

- `PARTNER_SESSION_SECRET` — random secret, minimum 32 characters.
- `XENDIT_SECRET_KEY` — Xendit server secret key (test key first).
- `XENDIT_WEBHOOK_TOKEN` — verification token from Xendit Webhook settings.
- `PARTNER_MIN_TOPUP` — optional, default `100000`.
- `PARTNER_MAX_TOPUP` — optional, default `500000000`.
- `PARTNER_QRIS_MAX_AMOUNT` — optional safety cap for direct QRIS, default `10000000`.
- Existing `ADMIN_SESSION_SECRET` and `ADMIN_PIN` remain required for Admin Tool.

## Xendit configuration
1. Start with Xendit Test Mode.
2. Configure webhook URL to:
   `https://YOUR-DOMAIN/.netlify/functions/xendit-partner-webhook`
3. Subscribe the endpoint to both `payment.capture` and `payment_session.completed` while the two payment modes coexist.
4. Use the Xendit webhook verification token as `XENDIT_WEBHOOK_TOKEN` in Netlify.
5. Top-up up to `PARTNER_QRIS_MAX_AMOUNT` uses Payments API v3 dynamic QRIS (`channel_code: QRIS`).
6. Larger top-ups keep using Xendit Payment Session / Payment Link.
7. Wallet credit occurs only after a verified webhook with matching payment request/session ID and exact amount.

## Partner administration
- Admin login: `/admin-login.html`
- Admin Tool: `/admin-tool`
- Partner administration: `/admin-partners`
- Partner login: `/partner/login.html`
- Partner wallet: `/partner/wallet.html`

When a partner is created, the admin assigns a six-digit PIN. An API Key and API Secret are generated and displayed once. Keep them confidential.

## Booking debit
Call `POST /.netlify/functions/partner-booking-debit` from the booking workflow after the final price is fixed.

Example JSON:
```json
{
  "bookingId": "LBR-20260902-0001",
  "amount": 425000,
  "metadata": {
    "route": "DJJ-WAENA",
    "source": "PORTAL"
  }
}
```

If the balance is insufficient, the endpoint returns HTTP `402` with code `INSUFFICIENT_BALANCE`. The same Booking ID is idempotent and will not debit twice.

## Production activation checklist
- Test partner login and wallet.
- Test direct QRIS creation, scan, `payment.capture`, and automatic wallet credit.
- Test Payment Link fallback for a nominal above the QRIS safety cap.
- Confirm webhook retries do not duplicate credit.
- Confirm repeated booking requests do not duplicate debit.
- Rotate API credentials if exposed.
- Move Xendit from test to live only after reconciliation and finance approval.
