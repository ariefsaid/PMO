# ADR-0035 — Procurement-cycle bulk import: case-grouped, multi-type, one sheet

Date: 2026-06-23
Status: Proposed
Relates to: ADR-0024 (export), ADR-0027 (single-entity import descriptor), ADR-0033 (procurement
case + records model), OD-PROC-3 (system vs external number), Model C (`docs/specs/procurement-records.spec.md`).

## Context

ADR-0027 shipped single-entity bulk import: one `ImportDescriptor<Input>`, a flat per-row commit
through the entity's existing create repository, RLS as the sole write authority. Companies, then
Contacts/Projects/Procurement-*header* followed as descriptor fast-follows (2026-06-23).

The owner wants to bulk-import a **whole procurement cycle** from **one sheet with a `type` column**
(PR, RFQ, Quotation, PO, GR, VI, Payment), covering both **ongoing bulk entry** and **historical
migration**.

This does not fit the ADR-0027 descriptor, for reasons grounded in the existing model:

- **The case is the anchor, not the PR (Model C, AC-PR-028/029).** `procurement_id` is `not null` on
  every record table; all settlement FKs (`receipts.po_id`, `invoices.po_id`, `payments.invoice_id`)
  are **nullable**. A case may have **no PR, no quotation, no PO** — a direct Invoice→Payment case is
  valid and the ledger renders exactly the rows that exist. So rows cannot be grouped by PR.
- **Records of different types have different shapes and different create RPCs.** A single flat
  per-row descriptor with one `create` fn cannot dispatch across 7 record types + the case header.
- **Numbers are already modeled (OD-PROC-3).** PMO always mints the **system number**; the
  outside-world number is the optional **external reference** (every create fn takes `reference_number`).
  A legacy "PR-2024-0042" is an external number. So historical migration needs **no number-override
  RPC/schema change** — legacy numbers go in `external_ref`; PMO mints fresh system numbers.

## Decision

**A new, dedicated procurement-cycle import flow** — NOT a generic `ImportDescriptor`. Same `.xlsx`
parse/lazy-exceljs seam as ADR-0024/0027; new grouping + ordered-commit logic on top.

1. **One sheet, `type` column, case-grouped.** Columns: `case_ref` (sheet-local grouping label —
   never persisted as a number), `type` ∈ {PR,RFQ,Quotation,PO,GR,VI,Payment}, case attributes
   (`project`, `title`, `case_status`), `external_ref`, and the record's own `status`/`date`/`amount`
   (+ `vendor` for Quotation). Every `type` is optional per case.

2. **Case synthesized per group; first row wins.** Rows sharing a `case_ref` form one case. The case
   header is created once from the group's case attributes (first non-empty row wins), via the existing
   `createProcurement` (requester = importing user). No manual "Procurement" row.

3. **Records attach via their existing create RPCs.** Each record row dispatches by `type` to the
   already-audited security-definer RPC (`create_purchase_request/rfq/purchase_order/payment`,
   `create_quotation/receipt/procurement_invoice`). `org_id` never client-supplied; the RPCs'
   parent-org + role gate remain the sole write authority. No new write path, no new RLS.

4. **Legacy numbers → `external_ref`; PMO mints system numbers (OD-PROC-3).** We do **not** override
   minted numbers. This collapses "ongoing entry" and "historical migration" to one write path.

5. **Ordered commit within a case; settlement FKs resolved intra-group.** Per case group, commit in
   canonical order (case → PR → RFQ → Quotation → PO → GR → VI → Payment) so predecessors exist before
   `payments.invoice_id` / `invoices.po_id` are linked. Where a predecessor isn't in the sheet, the FK
   is left null (Model C). A case whose header create fails skips its whole group; within a group,
   per-record best-effort (ADR-0027 model), failures reported per row.

6. **Role-gated affordance; preview performs zero writes.** Reuses the ADR-0027 wizard's FSM shape
   (upload → map → preview → commit → result) and `<ImportButton>`-style `can('create','procurement')`
   gate. The preview validates + shows the grouped case/record tree; the only write is the explicit
   confirm.

## Considered alternatives

- **Extend the generic `ImportDescriptor` to multi-type** — rejected: grouping + ordered commit +
  cross-row FK resolution + 8 heterogeneous create fns would bloat the audited single-entity contract
  every other importer depends on. A separate flow keeps ADR-0027 simple.
- **Number-override path (mint the legacy number as the system number)** — rejected: contradicts
  OD-PROC-3 (PMO mints; external is separate) and needs RPC + uniqueness-guard + pgTAP changes for no
  real gain. Legacy numbers as `external_ref` satisfy migration traceability.
- **Two-pass (headers sheet, then records sheet)** — rejected by owner: one self-contained sheet is
  the requirement.

## Consequences

- **Migration ≈ ongoing entry.** One write path; "Both" use cases met without schema/RPC changes.
- **Security = ADR-0027-grade.** Parse is read-only over an in-memory buffer; every write is an existing
  audited RPC with its parent-org + role gate; no client `org_id`; cross-org import impossible.
- **New flow to maintain** (parser grouping, ordered committer, preview tree) — larger than a descriptor
  fast-follow. Insert-only v1 (no update-existing); `MAX_IMPORT_ROWS` cap inherited.
- **`case_ref` is import-only** — a transient grouping label, not stored; PMO's `procurements.code` is
  the persisted case identifier.

## Files (planned)

`src/lib/import/procurementCycle/{types,parse,group,validate,commit,index}.ts` (pure utils + the
ordered committer; lazy exceljs) · `src/components/import/ProcurementCycleImport*.tsx` (or a wizard
variant) · `pages/Procurement.tsx` toolbar wiring. Detailed task plan:
`docs/plans/2026-06-23-procurement-cycle-import.md`.
