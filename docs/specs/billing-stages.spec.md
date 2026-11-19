# Measurement to invoice — billing stages, deadlines, per-item reconciliation and retention (#2522, #1572)

Map: #2516. Money path (ships alone). Builds on progress billing (0250, `progress-billing.spec.md`), work-order
quantities and acceptances (0337, 0441), the native progress-claim invoice (0924) and the left-to-bill derivation
(`left-to-bill-one-derivation.spec.md`). Decision record: ADR-0103 (retention held on the receivable, not as an
invoice line).

## Job story

When a contractor's measured work has to pass through several hands before it can be invoiced (internal
measurement, a joint survey with the client, the client's review, approval and acceptance), the project team wants
each step, its documents and its age on one page, so that the invoice goes out complete and before the client's
monthly cut-off, and finance can show for every bill-of-quantities item what was done, measured and billed, and
how much of each invoice the client is still holding back as retention.

## Terms

- **Billing stage** — one ordered step a progress claim passes through before its invoice can be raised. A
  project (the contract) defines its stage list; each new progress claim takes a copy (its *stage plan*). Editing
  the project's list never changes a claim already made.
- **Client-side stage** — a stage that happens in the client's own system. PMO cannot see it, so a person records it
  by hand: status, date, the client's document number and the proof document.
- **Stage checklist** — the documents a stage needs. Each item names a document; a required item must have a
  project document attached (issued or approved, with a file — the claim-evidence rule) before the stage can be
  completed. An attached document also becomes the claim's billing evidence.
- **Stage age** — days a stage has been current: from the day it started (the previous stage's completion date, or
  the claim date for the first) to its completion date, or to today while open.
- **Invoice deadline** — the day of month (1–31, clamped to the month's last day) by which the project's invoice
  must reach the client. A per-project warning window (days) says how early to warn.
- **Measured quantity** — the quantity on live (not withdrawn) progress claims, per bill-of-quantities item.
- **Billed quantity** — the quantity on progress claims whose invoice exists and is not cancelled.
- **Retention** — the share of a progress claim the client holds back until a later event (handover, end of the
  defects period). It is held on the receivable: the invoice and its VAT stay at full value; the amount due now is
  the invoice less the retention still held. A **retention release** is a scheduled, then recorded, payment-due
  event for part or all of a claim's retention.

## Requirements

### Stage plans
- **FR-BST-001** (ubiquitous) A project shall hold an ordered list of billing stages, each with a name, a
  client-side flag and a checklist of named documents (required or optional). Only Finance or an Admin of the
  project's organisation shall replace the list, and it shall be replaced as one whole ordered list.
- **FR-BST-002** (event-driven) When a progress claim is created on a project with a stage list, the database shall
  copy the list onto the claim as its stage plan, with the first stage current from the claim date. A down-payment
  or time-and-materials claim, and a claim on a project with no list, shall get no stage plan.
- **FR-BST-003** (ubiquitous) A claim's stage plan shall be changed only through the database functions below; no
  client write grant shall exist on it.

### Recording stages
- **FR-BST-010** (event-driven) When Finance, an Admin or a Project Manager attaches a document to a stage
  checklist item, the database shall accept only a document of the claim's project that is issued or approved and
  has a file, and shall add it to the claim's billing evidence.
- **FR-BST-011** (event-driven) When a stage is completed, the database shall require that every earlier stage is
  completed, every required checklist item has a document, the completion date is not in the future and not before
  the previous stage's completion date, and — for a client-side stage — the client's document number is given.
- **FR-BST-012** (event-driven) When a stage is completed, the next stage shall become current from that date.
- **FR-BST-013** (state-driven) While a stage is completed, or its claim is withdrawn, the stage and its checklist
  shall not change.

### Invoice gate (money rule, database-enforced)
- **FR-BST-020** (state-driven) While a progress claim has any stage not completed, the database shall refuse to
  raise its invoice: the native invoice (no-ERP organisation) and the ERP outbox command alike, with detail
  `billing-stages-incomplete`.

### Age and deadline
- **FR-BST-030** (ubiquitous) Each stage shall show its age in days (Terms).
- **FR-BST-031** (ubiquitous) Finance or an Admin shall set the project's invoice deadline day (1–31, or none) and
  warning window (0–27 days, default 5).
- **FR-BST-032** (state-driven) While a claim's invoice is not raised and the project has a deadline, the screen
  shall show the next deadline date (this month's, or next month's once this month's day has passed) and the days
  left, and shall warn when the days left are within the warning window.

### Per-item reconciliation
- **FR-BST-040** (ubiquitous) The database shall return, per bill-of-quantities item of a project (or of one work
  order's allocation), the scope quantity, progress to date, measured, billed and billed amount, the unbilled
  quantity (progress less billed, not below 0), the surplus quantity (the larger of progress and billed above scope)
  and a status: `unbilled` (billed 0), `partly_billed`, `fully_billed` (billed equals scope) or `surplus` (billed
  above scope).
- **FR-BST-041** (ubiquitous) The billed amount summed over items shall equal the gross of the project's (or work
  order's) invoiced progress claims, read through `sales_invoice_work_billed` (net plus recovery).
- **FR-BST-042** (state-driven) While a work-order view's item is also allocated to another work order, its progress
  is project-level and shall be unknown (null) for that work order, never apportioned.

### Retention
- **FR-RET-001** (ubiquitous) Finance or an Admin shall set a project's retention percentage (0 to under 100).
- **FR-RET-002** (event-driven) When a progress claim is created, the database shall stamp its retention
  percentage from the project and its retention amount as the percentage of the claim's gross, rounded to 2
  decimals, capped at the claim's net (gross less down-payment recovery). Other claim kinds hold none. Neither
  shall change afterwards.
- **FR-RET-003** (ubiquitous) The invoice built from a claim shall not change: retention is not an invoice line and
  VAT stays on the full value (ADR-0103).
- **FR-RET-010** (event-driven) When Finance or an Admin schedules a release, the database shall refuse it unless
  the claim is a live progress claim with retention and the scheduled plus released total stays within the claim's
  retention.
- **FR-RET-011** (event-driven) When Finance or an Admin records a release as released, the database shall require
  the claim's invoice to be submitted (not Draft, not Cancelled), a release date not in the future and not before
  the invoice date, and any proof document to be one of the project's issued or approved documents with a file.
- **FR-RET-012** (state-driven) While a release is recorded as released it shall not change or be removed; a
  scheduled one may be cancelled.
- **FR-RET-020** (ubiquitous) Per claim the database shall report retention, scheduled, released and held
  (retention less released).

## Non-functional
- **NFR-BST-001** Every new table carries `org_id` stamped by the server, RLS on, select for active members in the
  org (Engineers excluded, as for claims), and no client write grant.
- **NFR-BST-002** Every function that writes is `security definer`, re-asserts membership, role and org, locks the
  claim row (`for update`) in the same order as the claim functions, and writes an audit event.
- **NFR-BST-003** Reconciliation is one SQL derivation (`billing_reconciliation`, security invoker); the screen does
  not recompute it.

## Acceptance criteria

- **AC-BST-001** Given a project whose stage list is internal measurement → joint survey (client-side) → client
  approval (client-side), When Finance creates a progress claim, Then the claim has three stages in that order, the
  first current from the claim date, and a down-payment claim on the same project has none.
- **AC-BST-002** Given a Project Manager or Engineer, When they replace a project's stage list, Then it is refused
  (42501); Finance succeeds, and a claim made before the change keeps its old plan.
- **AC-BST-003** Given a stage with a required checklist item and no document, When someone completes it, Then it
  is refused (`stage-documents-missing`); after a Project Manager attaches an approved document with a file it
  completes, the next stage becomes current from that date, and the document is in the claim's evidence.
- **AC-BST-004** Given the second stage, When someone completes it before the first, Then it is refused
  (`stage-out-of-order`); a client-side stage without the client's document number is refused
  (`client-reference-missing`); a future date is refused; a completed stage cannot be recorded again.
- **AC-BST-005** Given a claim with evidence and an incomplete stage, When Finance raises its native invoice, or an
  ERP outbox command is written for it, Then both are refused with `billing-stages-incomplete`; once every stage is
  complete both succeed. (Mutation-checked: disabling the gate turns this red.)
- **AC-BST-006** Given a document that is draft or has no file, or belongs to another project, When it is attached
  to a checklist item, Then it is refused; a foreign organisation's user cannot see or change the stages.
- **AC-BST-010** Given a stage started on 1 March and today 11 March, Then its age is 10 days; completed 5 March, 4
  days.
- **AC-BST-011** Given a deadline day 25 and a 5-day window, When today is the 20th, Then the next deadline is the
  25th, 5 days left, warning; on the 19th, no warning; on the 26th the next deadline is next month's 25th; day 31 in
  February is the 28th (29th in a leap year).
- **AC-BST-020** Given a work order with items A (scope 10) and B (scope 5), progress A 6 / B 5, claims A 4 invoiced,
  A 2 not yet invoiced, B 6 invoiced, When the reconciliation is read, Then A is measured 6, billed 4, unbilled 2,
  `partly_billed`; B is billed 6, surplus 1, `surplus`; and the summed billed amount equals the invoiced claims'
  gross from `sales_invoice_work_billed`. A cancelled invoice's quantity is no longer billed.
- **AC-RET-001** Given a project with 5% retention, When a 1,000,000 progress claim recovering 200,000 of a down
  payment is created, Then its retention is 50,000 and its invoice is still 800,000 net with the same lines; a
  down-payment claim holds 0; editing the claim's retention is refused.
- **AC-RET-002** Given that claim, When Finance schedules 25,000 and 25,000, Then a further 1 is refused
  (`retention-exceeded`); a release cannot be recorded while the invoice is Draft; once approved, recording one
  released leaves 25,000 held; the released row cannot be cancelled; the scheduled one can.
- **AC-RET-003** Given a Project Manager, When they schedule or release retention or change the project's retention
  percentage, Then it is refused (42501).
- **AC-RET-004** Given a project with measured work and an approved claim invoice, When Finance views the reconciliation and schedules, cancels and records a retention release with proof, Then the quantities and billed amount agree with the claim and the recorded release and proof are visible.
- **AC-TRACE-001** Given one work order, When it is traced (progress → claim → each stage with its documents →
  invoice → retention), Then every stage has its documents attached, the invoice is raised and the reconciliation
  agrees with the claim and invoice.

## Owner decisions (defaults taken; the owner may overrule)
- **OD-BST-1** The stage list lives on the project (the contract), not per work order; work orders under it share it.
- **OD-BST-2** The invoice itself is the terminal step and is not a stage row; "invoice" in a list is redundant.
- **OD-BST-3** Stages are recorded by Finance, Admin and Project Manager; the list and retention by Finance/Admin.
- **OD-RET-1** Retention base is the claim's gross progress value before tax (VAT on full value per DD-PBL-11),
  capped at the net after down-payment recovery. ADR-0103.
- **OD-RET-2** Daily progress entries do not exist yet; "progress" reads the latest monthly assessment quantity.

## Traceability

| AC | Owning test (layer) |
|---|---|
| AC-BST-001..006 | `supabase/tests/0960_billing_stages.test.sql` (pgTAP) |
| AC-BST-010, AC-BST-011 | `pmo-portal/src/lib/billingStages.test.ts` (unit) |
| AC-BST-020 | `supabase/tests/0962_billing_reconciliation.test.sql` (pgTAP) |
| AC-RET-004 | `pmo-portal/e2e/AC-RET-004-billing-reconciliation-retention.spec.ts` (e2e) |
| AC-RET-001..003 | `supabase/tests/0961_retention.test.sql` (pgTAP) |
| AC-TRACE-001 | `supabase/tests/0962_billing_reconciliation.test.sql` (pgTAP, the full trace) · `pmo-portal/pages/project-detail/tabs/__tests__/ClaimBillingStages.test.tsx` (render) |
