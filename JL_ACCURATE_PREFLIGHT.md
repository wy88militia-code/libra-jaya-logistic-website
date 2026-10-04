# JL billing → Accurate Libra (read-only phase)

This branch adds a read-only preflight, NOT a production posting feature.
Existing Accurate credentials and billing flows are unchanged. No external API
save, customer creation, receipt creation, billing mutation or accounting posting
is implemented in this phase.

## Paired rollout

1. Review both branches `feat/jl-accurate-billing-preflight` in JL Express and Libra.
2. Configure a NEW dedicated `LIBRA_JL_BRIDGE_SECRET` (random, minimum 32 characters)
   with the identical value in the two server runtimes. Do not reuse the HC bridge
   secret, admin-session secret, or Accurate credential. Do not put it in Sheets,
   frontend code, chat, git or logs. Missing configuration fails closed.
3. Deploy Libra bridge first, then the JL admin preflight. These changes have not
   been deployed by the author. Open `/admin-accurate-jl.html` with an existing JL
   admin session. Choose a cleared final booking and explicit Accurate customer
   and service item codes. The bridge checks the existing Libra production
   database identity, branch, customer and service masters using read calls only.
4. Check the returned component amounts against the booking source. A component
   mismatch blocks preflight rather than inserting a balancing amount. Final
   tax overrides stale price snapshot tax. Last-mile already inside cargo must
   not be included twice. Discount is already included in `cargoSubtotal`.
5. Finance must verify tax mapping and read-back total before implementing the
   posting executor. `ready` always remains false in this read-only phase.

## Tests

From the JL repository run:

```
node --test tests/jl-accurate-readiness.test.mjs
```

Nine tests cover paid/credit guards, partner code, approval/finalization, invalid
amounts, stale snapshots, total mismatch, dates, fingerprints and signed bodies.
They do not demonstrate a live connection or deployment.

## Pending production phase

- Persist customer/service/tax mapping in the agreed master SSOT; current form
  mappings are preview inputs, not saved mappings.
- Certify tax flags/master item tax against actual Accurate API and a test DB.
- Add immutable invoice-number idempotency (not amount-derived numbering), an
  atomic execution lock, signed confirmation, and strict read-back of customer,
  branch, all lines, tax and grand total.
- Network uncertainty must become RECONCILE_REQUIRED; never blindly repost.
- Add mapping/finalization audit trail and protect posted invoices from edits
  and deletion. Verify role authority before enabling actual posting.
- Add sales receipts separately only for verified payments and mapped bank or
  gateway-clearing account. Invoice creation alone does not mark it paid.
- No production financial writes until the above are validated and approved.
