# ADR-0097 — Stock ledger, moving-average valuation and the standalone / connected ownership split

- **Status:** Proposed. Becomes Accepted with the Director's acceptance of slice S2a of the build plan.
- **Date:** 2026-11-01
- **Related:** [spec](../specs/inventory-project-consumption.spec.md), [plan](../plans/2026-10-31-inventory-project-consumption.md), [standalone ERP route](0094-pmo-standalone-erp-route.md), [ERP owns the GL](0048-erpnext-headless-accounting-engine.md), [operational layer](0055-external-system-adapters-sot-enhancement.md), [SoD enforcement](0019-server-enforced-sod-and-delete-gating-for-crud.md), [role rank](0070-approval-authority-is-rank-not-role-list.md). Issue #1512.

## Context

ADR-0094 makes stock quantity and valuation PMO-owned while an organisation runs standalone, and ERP-owned once it employs a connected ERP. Stock is money: an issue to a project carries a value that later reaches cost reports, and a wrong or editable value is a misstatement. The schema has to make the standalone case exact and tamper-proof, and has to leave one clean place where a connected ERP takes over valuation without PMO keeping a second, competing ledger.

## Decision

1. **An append-only ledger plus a derived balance, one writer.** `stock_ledger` holds one row per quantity movement per warehouse (`seq` gives total order) and is never updated or deleted, for anyone. `stock_balances` holds one row per item and warehouse with quantity and value on hand. A single definer function, `stock_write_entry`, is the only code that inserts a ledger row or changes a balance; a repository test fails if any other migration writes either table. Clients have no write grant on documents, lines, ledger or balances; every movement goes through the posting RPCs.
2. **Moving-average valuation per item per warehouse, in posting order.** A stock-in adds `round(q × unit cost, 2)`. A stock-out takes `round(q × value on hand / quantity on hand, 2)`, multiplying before dividing, and an out of the whole remaining quantity takes the whole remaining value, so no residue is ever left. Valuation follows posting order (`seq`), never the movement date. The client never sends a cost for a stock-out; a cost it sends there is ignored. Negative stock is refused by the writer and by a table check.
3. **The ownership split of spec section 6.** PMO always owns the document header, project, work item, actor, time, reason, `client_request_id`, material allowance and reorder level. Standalone, PMO also owns quantity, valuation, unit cost and ledger value. Connected, the ERP will own those four; PMO's copy becomes machine-written and is shown with its freshness.
4. **The posting RPC is the one swap point.** When a connected ERP is employed (#1508), the posting path changes its valuation source in one place. An ERP posting status lives in a side mirror table, never as a column on `stock_documents`, so the document stays the stable push key.
5. **Fail closed on ownership.** Every standalone write first calls `domain_externally_owned(org, 'inventory')`; true, null or an error refuses with `STK_OWNED_BY_ERP` before anything is written. Reads are unaffected.

## Consequences

- No FIFO layers and no lot trace. Moving average reconciles like-for-like with an ERP that also values by moving average.
- No negative stock, ever; a correction is a new document (adjustment or count), never an edit.
- History written while standalone stays readable after an ERP is employed (the epoch rule: rows before the employ date are PMO's, rows after are the ERP's mirror).
- #1508 must refuse to employ an ERP for inventory while any Draft stock document exists, so no document straddles the two owners.
- ERP owns the GL (ADR-0048/0055): this ledger is a stock sub-ledger for quantities and their value, never a GL posting.

## Alternatives rejected

- **FIFO cost layers:** no lot-trace need, more state, and the connected ERP reconciliation would no longer be like-for-like.
- **Balances derived from the ledger only:** no cheap row to lock for the negative-stock guard, and every read becomes an aggregate.
- **Mutable documents:** an edited posted document breaks the stable key the ERP push needs and the audit trail; corrections are new documents.
