# Receive lane status

Status: **built and acceptance-proven**. The completion report is `docs/briefs/decisions-1124/receive-report.md`.

Captured Director rulings:

- Purchasing maps each order line to an existing stock item; receivers never change mappings. Unmapped service/direct-use lines retain the existing path. A receipt freezes its mapping.
- Stock valuation uses organisation currency and receipt-date `fx_rate_on`, snapshots the rate, uses 1 for the same currency, and refuses missing rates with pair and date.
- Enablement is limited to PMO-owned purchasing and inventory. ERP-connected receiving remains a follow-up.

Spec: `docs/specs/receive-against-order.spec.md`. Plan: `docs/plans/2026-11-24-receive-against-order.md`.

There is no unresolved product decision inside this lane. The approved follow-up is ERP-connected receiving and valuation reconciliation; this lane explicitly refuses enablement while either purchasing or inventory is ERP-owned.

The Director assigned rendered English/Bahasa captures at 1440/390 and `ux-proof` to the integration worker, once on the integration branch. The completion report lists the routes and states to capture. Existing bills and three-way match retain purchase-currency comparisons; ADR-0124 records the additional receipt-date JISDOR snapshot use.

DONE: 1124d-receive
