# Receive lane completion

Branch: `feat/1124d-receive-against-order` (money path; ships alone). Runtime candidate: `b80244d73e91da201c6e331228c853ff7f5f9f0c`. Subsequent report-only commits do not change the tested runtime.

Spec: `docs/specs/receive-against-order.spec.md`. Plan: `docs/plans/2026-11-24-receive-against-order.md`. Decision: `docs/adr/0124-order-receipt-fx-snapshots.md`. Migrations used: 2220–2227, each with its rollback.

## What a person sees

- An Admin opts the organisation into receiving against orders. The switch confirms its organisation-wide effect and refuses ERP-owned purchasing or inventory. The existing receive form remains while off.
- Purchasing maps each order line to stock before a count. A count freezes that mapping. Unmapped service/direct-use lines keep their existing path and are labelled on receiving.
- A keeper opens a sent order, chooses a kept warehouse and receipt date, and enters counted quantities. Ordered/outstanding quantities and prices are withheld from the storekeeper's receiving reads. Decimal-comma entry is accepted without floating-point quantity arithmetic.
- Purchasing sees ordered, received, outstanding and receipt status per line, both in receiving and on the purchase record's Items tab.
- Counts enter stock at order cost in organisation currency. The receipt snapshots receipt-date FX and publication date; same currency uses 1. A missing rate names the pair and day in English or Bahasa.
- An excess waits for another purchasing user. Its order appears in the shared waiting list. The approval pins each line's excess; an intervening receipt that increases the excess returns it for fresh review. Every approval snapshot remains immutable.
- Three-way match consumes the new receipt lines. Posted receipts remain immutable; a separate correcting movement preserves their evidence and removes the reversed quantity from matching.

## Owning proofs and gates

| Scope | Runner and result |
|---|---|
| AC-RGO-001–011 | Spare runner: `supabase/tests/2220_receive_against_order.test.sql`, passing, including 15 mutation kills and the intervening-receipt review case |
| Existing match, stock and connected ownership contracts | Spare runner: `three_way_match.test.sql`, `stock_posting_guards.test.sql`, `odoo_stock_posting.test.sql`, and `0178_anon_executable_definers.test.sql`; together with receiving, **393 assertions across five files passed** on the runtime candidate |
| AC-RGO-012 | Spare runner: `pages/stock/OrderReceivingLines.test.tsx`, both English and Bahasa passed |
| Supporting frontend behaviour | Spare runner: 50 passing tests across nine files, combining unchanged-source proofs from `5ed76893b` with the final changed screen/order-record proofs from `b0bcb6909`; frontend TypeScript is unchanged in the runtime candidate |
| Local final gates | `npm run check:guards`, `npm run typecheck`, and ESLint with zero warnings on touched TypeScript passed; `git diff --check` clean |
| Focused UI coverage | Receiving and purchase-record progress components: 96.42% lines, 87.02% statements in the targeted V8 run |
| UI source checks | Shared primitives and DESIGN tokens; targeted Impeccable static detector passed |
| Browser selection | `node scripts/affected-e2e.mjs` selected 324 existing specs because shared App/policy surfaces changed; no local browser journeys were run |

Supporting unit files: `OrderReceiving.test.tsx`, `OrderReceivingProgress.test.tsx`, `StockNewEntry.test.tsx`, `policy.orderReceiving.test.ts`, `orderReceivingRefusals.test.ts`, `refusals.test.ts`, `waitingKinds.test.ts`, and `ProcurementDetails.buyer.test.tsx`, in addition to the owning line-component test.

The mutation probes check a passing behaviour oracle, break its database rule, observe that oracle fail, and roll back the mutation and its writes. They cover mapping authority/tenancy/freeze, setting authority/ERP ownership, blind table/function reads, order cost/FX/missing rate, excess approval and separation, immutable receipts, reversal matching, and stale excess approval.

## Integration-owned rendered proof

The Director explicitly assigned captures and `ux-proof` to the integration worker, once on the integration branch. Capture at 1440 and 390 in English and Bahasa:

- `/stock/new/receive`: setting off with the existing form; enabled blind keeper with mapped and unmapped lines; count confirmation; missing-rate refusal; partial and full receipt histories.
- `/stock/new/receive?order=<seeded-order>`: purchasing progress and mapping; pending excess and reason dialog; a stale approval after another receipt; approved count ready for the receiver; reversal confirmation and preserved movement link.
- `/procurement/<seeded-purchase>` on Items: purchaser receipt progress and receiving link; the storekeeper version with quantity facts withheld.
- `/approvals`: the receiving-excess section opens the correct order. Include the empty, loading and failed-read states of the new receiving surface.

## Open list

No unfinished implementation item or product decision remains within the signed lane. ERP-connected receiving and valuation reconciliation remain the approved separate follow-up. Rendered integration acceptance remains with the assigned integration executor; this report does not claim those captures were run locally. No PR, merge or deployment was performed.

DONE: 1124d-receive

Rollback order: 2450 → 2229 → 2228 → 2227 → 2226 → 2225 → 2224 → 2223 → 2222 → 2221 → 2220, using each matching down migration. The 2450 down migration restores the preceding 2227 body and 2220 policy set; the 2224 down migration restores the pre-receiving 2090 waiting body, including clock-in decisions.
