# ADR-0091 — A final BAST closes accepted work at a separate server-only value

- **Status:** Accepted design (2026-10-21, owner OD-CQ-1..4; implementation pending)
- **Related:** ADR-0077 (assessments vs claims, DP recovery); ADR-0080 (WO billing fence and locks);
  ADR-0019 (server SoD); DD-WO-5 (issued PO content frozen); OD-BUDGET-6 amendment / 0298
  (sole operator); DD-PBL-9 (one billed-work definition).
- **Spec:** `docs/specs/progress-billing.spec.md` §8, DD-CQ-1..8.
- **Plan:** `docs/plans/2026-10-21-contract-quantities.md`.
- **Migration / reverse:** `0337_contract_quantities.sql` / `rollback/0337_contract_quantities_down.sql`.

## Context

A contract can contain 1,900 km of a generic service at 50,000 per km; a client PO orders 1,000 km,
then accepts 997 km finally. These are three different facts: contract quantity, order quantity and
accepted quantity. The remaining contract quantity is 903 km, not 900. The accepted value is
49,850,000 before tax, not the PO's 50,000,000.

The shipped BoQ belongs to the project but has only one nullable work-order link. Claims use that
link for scope. `work_orders.order_value` is the client's original PO; 0193's update trigger and
0227's setter deliberately freeze it after issue. 0197 drawdown/issue gates and 0262 billing/fences
normalise that PO to net. Editing it at completion would erase the distinction the owner needs.

## Decision

### One contract line, many allocations

Replace `boq_items.work_order_id` with `work_order_lines`, unique on WO/BoQ line. Each allocation
states a positive quantity of one same-project contract line. Over-ordering is visible, not blocked.
Migrate existing links at full line quantity, then drop the old column: no dual-read compatibility
mode or second source of truth. Claims with a WO require an allocation on that WO; claims without
a WO require no allocation anywhere. Claim and invoice work-order columns themselves remain.

Lump sum is one lot with assessed/accepted fractions; unit rate uses measured quantities. A line's
basis is explicit and defaults from its unit in the FE/CLI. No duplicated line per monthly PO.

### Acceptance is a first-class, cumulative record

BAST headers/lines are prepared, confirmed or withdrawn through three audited SECURITY DEFINER
RPCs; clients read them under RLS and have no direct DML grants. A stage BAST is evidence and claim
pre-fill, not an invoice and not final closure. Confirmation requires a same-project Issued/Approved
register document with a file. Finance/Admin confirms somebody else's preparation, except when the
caller is the sole active org member by the exact 0298 predicate; the confirmation basis is stored.
Confirmed headers and lines are immutable. At most one confirmed final exists per WO.

### New money field: closing value is not editable PO money

Add nullable `work_orders.closing_value numeric(14,2)` (always net, in WO currency) and
`closing_acceptance_id uuid` referencing its final BAST. No client INSERT/UPDATE grants. A trigger
allows the first setting only during the confirm RPC's narrow transaction-local write window
(0252 pattern, cleared immediately), and forbids later alteration/clearing even by other definer
paths. The pair, WO Closed status and closed_at are written atomically with final confirmation.
No public setter, tax-input field or ERP write is introduced.

Final confirmation takes `lock_work_order_billing(wo)` before its WO row lock, validates current
allocations/evidence, computes `sum(round(final_quantity * rate, 2))`, and refuses BW001 if it is
above the original PO net or below billed plus pending work. Equality passes; unreadable totals
fail closed. Preserve ADR-0080's in-flight reservation semantics and mirror treatment. Rates are
read at confirmation; the stamped closing value is never recomputed after a later line edit.

The response `{closing_value, dp_held}` gives the UI authoritative money and the project-level
unrecovered DP notice. Closing neither forgives, refunds nor silently recovers DP. Finance uses
existing “recover the rest” on a subsequent claim or an explicit refund process.

### Effective net replaces operational order-net reads everywhere

```sql
coalesce(wo.closing_value,
  case when wo.tax_treatment = 'inclusive'
       then wo.order_value - wo.tax_amount else wo.order_value end)
```

Use that exact expression in:

1. `work_order_billing.order_net` and `remaining` (keep view column names/types for consumers).
2. `assert_work_order_invoiceable`'s ceiling, preserving all outbox/native/claim callers.
3. `get_project_drawdown`'s committed/draft aggregation.
4. `transition_work_order`'s issue-gate committed sum; its candidate Draft still has no closing value.

Downstream invoice dialogs, dashboards and assistant reads already consuming billing/drawdown inherit
it; do not introduce a second FE ceiling calculation. Showing the **original Order value**, quoting
the client's PO, and checking final closing value against original order net intentionally keep the
original fields. Closing value is already net: do not subtract order tax from it again. Search all
order-net expressions at build/rebase and classify each reader rather than blindly renaming money.

WIP uses quantity-based earned work less DD-PBL-9 billed work when contract lines exist. DD-CQ-5's
closed-allocation adjustment substitutes accepted final quantity for what the closed WO ordered;
open assessed work only counts beyond the closed ordered quantity. It is not a blanket closing-value
subtraction and is not ERP recognition. Projects without lines retain the percent method. The
management pack remains unchanged in this slice; its recognition alignment is a named follow-up.

## Why not edit order_value (DD-WO-5)?

It is the client's PO, not a final measurement. Restating 50,000,000 as 49,850,000 would destroy the
original order fact and its issue/value-author witness. DD-WO-5's freeze and issued-at identity stay
intact. A new, server-only, final-acceptance-linked value expresses a different fact without changing
the PO, its tax metadata, or an already-created ERP document.

## Alternatives considered

| Alternative | Disposition |
|---|---|
| Edit the PO value on close | Rejected: conflates ordered and accepted value; violates DD-WO-5. |
| Cancel/reissue a PO for every final measurement | Rejected: cancellation/replacement is for a changed client PO, not ordinary acceptance of a measured quantity. |
| Derive closing value on every read from BAST × current rate | Rejected: later line edits would change a completed money ceiling. Confirmation stamps one value. |
| Keep both BoQ.work_order_id and allocations | Rejected: two scope authorities; a shared contract line cannot name all its WOs in the old column. |
| Duplicate contract lines per WO | Rejected: duplicates the contract balance and fragments assessed/claimed quantities. |
| Store BAST only as a document | Rejected: does not encode cumulative quantities, finality, SoD or atomic closure. |
| Require final BAST before every invoice | Rejected: partial/stage billing remains legal; ordinary register evidence remains usable. |
| Automatically refund or recover remaining DP on close | Rejected: closure is not a money command; keep the balance visible and require an explicit action. |

## Consequences and reversal

- Three new business tables, three client-callable definers and one server-only money pair require
  RLS/grant/SoD and immutable-money proofs, 0178 allow-list re-count (70 +3 =73 at this base), and
  isolation-manifest updates. Acceptance children inherit tenancy through their parent rather than
  adding an undecided org column.
- Index and pre-aggregate allocations and latest confirmed cumulative acceptances to avoid a
  history × allocations × claims join multiplier. One summary RPC remains the read seam.
- The old schema cannot express multiple allocations. Rollback re-adds the old column and restores
  a link only when exactly one allocation exists; export/review multi-allocation and acceptance data
  before dropping it. Restore functions/views/ACLs/guard before dropping referenced objects. Never
  rewrite posted invoices or silently choose a WO in the lossy case.
- Shipped manual WO closure and pre-existing Closed rows need an explicit integration disposition;
  the plan records the exact source locations under Open points. This ADR does not silently remove
  that workflow or fabricate historical BASTs.
