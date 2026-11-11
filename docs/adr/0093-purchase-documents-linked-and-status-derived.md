---
status: accepted
date: 2026-10-23
---

# ERP purchase documents are linked into purchases; purchase status is derived from evidence

Spec: `docs/specs/procurement-flexible-entry.spec.md` (issue #1319). Owner rulings 2026-10-23.

## Context

Two shipped decisions block the first client's purchase history (about 55 vendor invoices that exist only in
ERPNext) from reaching project Procurement tabs with their documents:

- **DD-XING-2** (decisions.md): pre-go-live ERP history is a *read-only read model, never adopted*. #1277 shipped
  exactly that for purchases: `erp_purchase_documents`, a list labelled "already counted in Actuals", never
  attached to a purchase.
- **ADR-0033** kept procurement status *declared* through `transition_procurement()`; records were evidence only,
  and "record-derived status is the adapter's job once a real ERP is the backend".

Meanwhile `OD-SAR-GATES` (2026-07-14) already ruled that PMO is the flexible layer and chain gates are org config,
default off, and listed "flexible procurement chain entry" as an unbuilt retrofit.

DD-XING-2's reason was sound: adopting an ERP document would mint a PMO record that never passed PMO's process
and could double count spend. The owner's ruling keeps that concern and answers it differently.

## Decision

1. **Link, do not adopt.** An ERP purchase document stays a read-model row in `erp_purchase_documents`. A new
   `procurement_erp_links` row attaches it to one purchase (unique per document). Nothing is copied into the PMO
   record tables, nothing is written to ERPNext, no outbox command exists for it, so nothing can be pushed back.
   DD-XING-2 stands for every other domain; for purchase documents it is superseded by this ADR.
2. **No double count, by construction.** Actuals remain ledger-only (ADR-0048). A purchase's *open commitment* in
   an ERP-ledger org is `greatest(0, total_value − ledger-held amount)`, where ledger-held is the pre-tax amount of
   its submitted ERP purchase invoices (linked, or PMO-pushed and mirrored). Committed spend is the sum of open
   commitments, computed once in SQL (`procurement_open_commitment`, `project_committed_spend`) and read by every
   client figure that previously summed `total_value` itself.
3. **Status is derived, monotonic.** A purchase's status is the furthest step it holds evidence for (PMO record or
   linked ERP document), and evidence never moves it backwards. Declared steps (submit, approve, reject, quote
   selection, cancel, pay) stay on `transition_procurement()`, which also gains forward skips. This amends
   ADR-0033's "status remains declared"; Model C (many documents per step, nullable predecessors) is unchanged.
4. **Gates are an org setting, default off, enforced in the database** (`organizations.procurement_gates`, four
   booleans), checked on every path to a step: the transition RPC, PMO record inserts by users, linking, and the
   ERP dispatch before any ERP write. They are separate from the ERPNext binding's `process_gates` because an org
   without ERPNext has no binding row to hold them.
5. **SoD follows the approval, not the path.** Approver ≠ payer moves into the procurement update guard so every
   path to Paid (transition, a Paid payment record, a linked Payment Entry) enforces it, Admin included.

## Consequences

- `erp_purchase_documents` gains Purchase Receipts, supplier Payment Entries and `net_total`; its reader allow-list
  (AC-EPR-006) grows to the new link/orphan/commitment functions.
- Recording a document now moves status; client flows that record and then request the same step keep working
  because the transition RPC treats an already-held document step as a no-op. Journeys that clicked a "mark" button
  after recording a document change their steps (goal oracles unchanged).
- With gates off, a purchase can reach Paid without an approval. When an approval *is* recorded, the shipped
  ceiling and SoD still apply. Orgs that want the old strict chain switch the gates on.
- Reversal: drop the link table, views and functions; restore the 0284 transition body and 0349 guard body (rollback
  files). Linked history then reverts to the read-only list; no PMO record is lost because none was created from
  ERP data except Draft purchases marked `origin = 'erp_link'`, which the rollback leaves in place.
