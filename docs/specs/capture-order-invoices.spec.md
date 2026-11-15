# Purchase capture — place an ERP order and its project-less invoices as one purchase (#2277)

Status: draft for owner sign-off · Issue: #2277 (part of #2195, map #450) · Builds on: B1 (migration 0882, merged to `dev`
in 78ff44236) · Plan: `docs/plans/2026-11-15-capture-order-invoices.md` · Tier: **money path** (ships alone)

## Owner questions (one line each; the recommended answer is what this spec assumes)

1. **Attach to a purchase raised in PMO (not captured)?** Recommended: **no** — refuse `ordinary_purchase_requires_decision`; only a captured, record-only purchase takes an attachment.
2. **Undo one attachment on its own?** Recommended: **yes** — `undo-record-only <purchase> --attach <request>` removes only that attachment; without `--attach` the whole purchase is undone.
3. **An invoice of the same order that the ERP already tags with this project?** Recommended: **include it**, linked with no PMO decision (its ERP tag already counts it).

## Context

B1 lets an active Admin place an ERP supplier invoice that carries no ERP project on one PMO project
(`assign_capture_invoices`, decision `project`). B1 refuses an invoice that bills an ERP purchase order
(`capture_assignment_validate`, `family_incomplete`, `supabase/migrations/0882_capture_invoice_assignment.sql:480`),
because the order and its invoices must be one purchase: the open commitment of a purchase is
`greatest(0, value − ledger-held)` (`procurement_ledger_held`, 0858; `procurement_open_commitments`, 0723), and the
held part comes from the invoices linked to **the same** purchase. An invoice placed alone would count as actual on one
purchase while the order's full amount stayed open on another, or would be left for a later capture of the order.
The linker already enforces "an invoice and the order it bills sit in one purchase" (I-2, 0882 §2b) and "an untagged
invoice joins a purchase only with an active Admin placement on that purchase's project" (I-3, 0882 §2b).

This slice adds one assignment decision, `order_family`: the Admin names the order, the project and **every** invoice
that bills it, and the system either creates one record-only purchase holding them all, or attaches the invoices to the
captured purchase the order already has. Each untagged invoice gets an ordinary B1 `project` decision, so its ledger
lines count exactly as B1's do (`capture_assigned_gl`, the engine's voucher anti-join, ERP-tag precedence — unchanged).
Nothing is written to the ERP.

## Glossary additions (`docs/glossary.md`)

- **Order family** — one ERP purchase order and every submitted supplier invoice that bills it.
- **Family placement** — an active Admin's decision that an order family belongs to one PMO project, recorded as one
  record-only purchase (new) or as invoices attached to the order's captured purchase (attach).
- **Attachment** — the invoices one family placement linked to a purchase that already held the order; undone on its own.

## Money and control rules (binding)

- **MC-1 One purchase per family.** After a family placement, the order and every invoice of its family are linked to the
  same purchase (linker I-2, unchanged).
- **MC-2 Ledger is the actuals oracle.** An untagged invoice adds its mapped expense ledger rows once, on the chosen
  project, through B1's `capture_assigned_gl`; the order adds no actuals; no face amount is ever an actual (ADR-0048).
- **MC-3 Commitment once.** The purchase's open commitment is read by the canonical readers only
  (`procurement_ledger_held(_many)` 0858, `procurement_open_commitments` 0723, `project_committed_spend` 0651); this
  slice changes none of them. Result: order value minus the linked invoices' held amount, never below zero.
- **MC-4 Whole family.** The named invoices must be exactly the order's submitted, non-return, not-yet-linked invoices; a
  family with a submitted return invoice, or an invoice billing more than one order, is refused.
- **MC-5 ERP wins.** If the ERP later tags an invoice's ledger rows, B1's precedence applies unchanged (the PMO placement
  places nothing for that voucher; the report flags it).
- **MC-6 No new spending authority.** The purchase stays record-only: every forward step, child record and ERP command is
  refused by the shared record-only guard (0858 `record_only_step_refusal` / `guard_record_only_status`, unchanged).

## Functional requirements (EARS)

- **FR-001** (event) When an active Admin sends an assignment row with `decision: "order_family"`, the system shall accept
  it only with `source_id` (the ERP order's source id), `project_id`, `invoice_ids` (1–50 distinct source ids) and an
  optional boolean `accept_set_aside`, and shall refuse any other key, including `allow_capital_as_overhead`.
- **FR-002** (ubiquitous) The system shall refuse a batch in which an id appears twice across `source_id` and
  `invoice_ids` of all rows (`duplicate_assignment_row`).
- **FR-003** (event) When a family row is validated, the system shall refuse it unless the order is a submitted ERP
  purchase order of the caller's organization (`not_found`, `source_kind_unsupported`, `document_cancelled`), not raised
  by PMO (`document_recorded_by_pmo`), with a known currency and exactly one PMO vendor (`currency_unknown`,
  `supplier_unknown`), and carries no ERP project or only the chosen project (`family_project_conflict`,
  `document_spans_projects`).
- **FR-004** (event) When the named invoices differ from the order's submitted, non-return invoices not yet linked to the
  order's purchase, the system shall refuse the row with `family_incomplete` and return `missing_invoice_ids` and
  `extra_invoice_ids`.
- **FR-005** (event) When any submitted invoice of the family is a return, the system shall refuse with
  `family_has_return`; when any named invoice bills more than one order, with `family_ambiguous`; when any named invoice
  differs from the order in supplier or currency, with `supplier_mismatch` / `currency_mismatch`.
- **FR-006** (ubiquitous) The system shall apply to each named invoice that carries no ERP project every B1 `project`
  check of `capture_assignment_validate` with B1's reasons, except that billing exactly this order is allowed.
- **FR-007** (state) While a named invoice carries the chosen project as its only ERP project, the system shall link it
  without a PMO decision; while it carries any other ERP project, the system shall refuse the row
  (`family_project_conflict`).
- **FR-008** (event) When the order is not linked to any purchase and the row passes, the system shall, in one
  transaction, record one B1 `project` decision per untagged invoice (with the family request and order on it), create one
  record-only purchase on the project linking the order and every named invoice, record its capture row, and write the
  audit event `procurement.record_only_create` with `family: true`.
- **FR-009** (conditional) While the order is linked to a purchase, when the row passes, the system shall attach the
  invoices to that purchase only if it is record-only, captured from the ERP (order or invoice kind, no journal), active,
  on the chosen project, with the order's vendor and currency; else it shall refuse with
  `ordinary_purchase_requires_decision` (not record-only) or `family_conflict` (anything else).
- **FR-010** (event) When an attachment is recorded, the system shall record its decisions and links as in FR-008, store
  the purchase's stage before the attachment, update the stage by FR-011, and write `procurement.erp_family_attach`.
- **FR-011** (ubiquitous) The system shall set the purchase's record-only stage to `paid` when every linked invoice is
  paid, `invoiced` when none is paid or part paid, else `part_paid`.
- **FR-012** (ubiquitous) The system shall write no ERP document, outbox row or payment, and shall return
  `erp_write: false` on every result.
- **FR-013** (event) When a family row is previewed, the system shall return the outcome (`create` | `attach`), the
  purchase (null for a new one), per invoice its mapped amount, excluded lines, prior placement and whether it is
  ERP-tagged, and the purchase's open commitment before and after, then roll everything back.
- **FR-014** (event) When the same `request_id` is sent again with the same payload, the system shall return `skip`; with
  a different payload, `request_conflict`; after its undo, `undone`.
- **FR-015** (event) When an active Admin undoes a captured purchase with no attachment named, the system shall undo every
  active decision on it (restoring each invoice's overhead mark as B1 does), remove its links and cancel it.
- **FR-016** (event) When an active Admin undoes a named attachment, the system shall undo only that attachment's
  decisions and links, restore the stored stage, and keep the purchase and its order; a second undo returns
  `already_undone`.
- **FR-017** (conditional) While the purchase has a later PMO step (a queued or committed payment for a captured invoice,
  or any PMO request, order, receipt, invoice or payment record), when either undo is requested, the system shall refuse
  it with `has_later_pmo_steps`; when an invoice's overhead mark changed since the placement, with
  `assignment_mark_changed`.
- **FR-018** (ubiquitous) The capture report shall show, per decision, the family request and order, and the capture
  preview shall give each unassigned invoice that bills one order that order's source id (`order_source_id`).
- **FR-019** (ubiquitous) Only an active, unbanned Admin of the organization, through the purchase-capture route or the
  command-line sign-in already allowed for B1, shall reach the family entry points.
- **FR-020** (event) When an Admin runs `pmo purchases assign <file>` with family rows, the CLI shall check them locally
  (shape, distinct ids, invoice count), print one line per row with the outcome, purchase, invoice amounts, commitment
  before → after and the next command; `pmo purchases undo-record-only <purchase> --attach <request> --reason <text>`
  shall undo one attachment.

## Non-functional

- **NFR-001** A 500-row batch reads the attribution engine once (B1's batch read, extended to the named invoices).
- **NFR-002** Lock order is fixed: capture fence → order-name lock (`lock_erp_order_family`) → documents by id → purchase
  → capture rows → decisions → marks, matching the linker, so concurrent family and B1 rows cannot deadlock.
- **NFR-003** The migration is reversible: the down file restores every replaced body verbatim and refuses while any
  family decision exists (B1 rollback harness pattern).

## Acceptance criteria (Given/When/Then)

- **AC-001** Given an untagged order O of 1000.00 and its untagged invoice I (net 600.00, mapped ledger 600.00), When an
  Admin applies a family placement on Project P, Then one record-only purchase on P links O and I, P's mapped actuals
  rise by 600.00, P's open commitment is 400.00, and no outbox row exists.
- **AC-002** Given a rule that sends untagged Cost lines to Project C, When the family of AC-001 is placed on P, Then C
  loses 600.00, P gains 600.00, the organization's mapped actuals are unchanged and its open commitment rises by 400.00.
- **AC-003** Given O already captured as record-only purchase W on P (open commitment 1000.00), When I is attached, Then
  W links O and I, W's open commitment is 400.00, P's actuals rise by 600.00, W's stage is `invoiced`, and no new
  purchase exists.
- **AC-004** Given O billed by I1 and I2, When a row names only I1, Then it is refused `family_incomplete` with
  `missing_invoice_ids = [I2]`, and nothing is written.
- **AC-005** Given I billing O and O2, When a family row for O names I, Then it is refused `family_ambiguous`.
- **AC-006** Given O tagged in the ERP with Project Q, or O linked to a purchase on Q, or O linked to a purchase raised in
  PMO, When a family row places it on P, Then it is refused `family_project_conflict`, `family_conflict` or
  `ordinary_purchase_requires_decision`.
- **AC-007** Given a submitted return invoice billing O, When the family is placed, Then it is refused `family_has_return`.
- **AC-008** Given a named invoice that is all capital spending, or whose ledger is newer than the snapshot, When the
  family is placed, Then it is refused with B1's `capital_spending_not_assignable` / `snapshot_refresh_required`.
- **AC-009** Given an applied family request, When it is resent unchanged, Then the outcome is `skip`; with another
  invoice list, `request_conflict`.
- **AC-010** Given a family row, When it is previewed, Then the result shows `create`, each invoice's mapped amount,
  commitment before 0.00 and after 400.00, and afterwards no decision, link, purchase or capture row exists.
- **AC-011** Given the purchase of AC-001, When an Admin undoes it with a reason, Then I's decision is undone, its mark is
  restored, the purchase is Cancelled, P's actuals and commitment return to their prior values; a second undo returns
  `already_undone`.
- **AC-012** Given the attachment of AC-003, When an Admin undoes that attachment, Then W keeps O only, W's commitment is
  1000.00 again, W's stage is `ordered` again, W is not Cancelled, and P's actuals fall by 600.00.
- **AC-013** Given a payment queued in PMO for a captured invoice of the purchase, When either undo is requested, Then it
  is refused `has_later_pmo_steps` and nothing changes.
- **AC-014** Given the purchase of AC-001, When the ERP later tags I's ledger rows with P, Then P's actuals are unchanged
  and counted once; When it tags them with Q, Then the report shows `tagged_in_erp: true` and `erp_project_id = Q`.
- **AC-015** Given a Finance, Project Manager or Executive member, When they call the family entry points, Then they are
  refused; an order or project of another organization returns `not_found`.
- **AC-016** Given O billed by untagged I1 and I2 tagged in the ERP with P, When the family is placed on P, Then I1 has a
  decision, I2 is linked without one, and P's actuals rise by I1's mapped amount only.
- **AC-017** Given a preview revision, When a capture or assignment changes the sources before apply, Then the apply
  returns `source_stale`.
- **AC-018** Given a family file, When the Admin runs `pmo purchases assign` without `--apply`, Then the CLI prints each
  row's outcome, invoice amounts, commitment before → after, `erp_write: false` and the exact apply command; a malformed
  family row is refused locally; `undo-record-only --attach` sends the attachment's request.
- **AC-019** Given an unassigned invoice that bills one captured-census order, When the capture preview runs, Then its
  `unassigned_documents` entry carries `order_source_id`, and an `assign` call passes family rows through unchanged with
  `erp_write: false`.
- **AC-020** Given migration NNNN applied, When its down runs with no family decision, Then every replaced body is
  restored verbatim; with one, it refuses.
- **AC-021** Given two sessions applying family placements for the same order at once, When both commit, Then exactly one
  succeeds and the other is refused (`source_already_decided` or `family_conflict`); O is linked to one purchase only.

## Out of scope

The screen (later #2195 screen slice); splitting a family across projects (B2's split is per invoice); orders billed by
invoices of several orders; return invoices; receipts and payments as family members (they stay on the existing paths);
attaching to a purchase raised in PMO (owner question 1); any ERP write.
