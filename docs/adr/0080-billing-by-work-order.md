# ADR-0080 — Clients are billed against their work order; the database refuses invoicing past it, before any ERP write

- **Status:** Proposed (2026-10-07, issues #785 / #786, owner ruling OD-BILL-1)
- **Related:** ADR-0048 (ERPNext is the accounting engine; PMO mirrors money), ADR-0055 (external system is SoT per
  domain), ADR-0058 (outbox: one PMO record mints at most one ERP document; the outbox insert precedes every ERP
  POST), ADR-0077 (down payment and claims as invoice lines; DD-PBL-9 "one definition of billed work"), ADR-0079
  (assistant coarse tools), DD-WO-1..10 (work orders), DD-VI-3a (never refuse a mirror the ERP already holds),
  DD-RCPT-1 (withheld tax settles an invoice), OD-TAX-1 (no bare money figure).
- **Spec:** `docs/specs/progress-billing.spec.md` §7 (FR-BWO-*, AC-BWO-001..006, AC-UNB-002/004/005).
- **Plan:** `docs/plans/2026-10-07-billing-by-work-order.md`. **Rulings:** DD-BWO-1..12 in `docs/decisions.md`.

## Context

The owner ruled (OD-BILL-1) that a client is billed by its PO/SO — the work order — never by tracker milestones.
Each work order must show invoiced, paid and still-to-invoice; Finance invoices it in one step (a Draft pre-filled
with what is left, partial allowed); **the server refuses invoicing beyond the work order's value**; the work order
shows Paid when its invoices are fully paid. #786's "still to invoice" reads the same per-work-order figure.

What exists: `work_orders` (0193; Draft → Issued → Closed, + Cancelled; value frozen once issued) and
`sales_invoices.work_order_id` (nullable, same-project trigger). Invoices reach `sales_invoices` two ways:

1. **ERP path (the only UI path today).** `adapter-dispatch` inserts an `external_command_outbox` row, then POSTs to
   ERPNext, then a **service-role** writer inserts/updates the mirror row. A refusal at the mirror would leave a real
   ERP document with no PMO row and wedge every sweep replay (the DD-VI-3a lesson).
2. **Native path.** RLS lets Admin/Exec/PM/Finance insert `sales_invoices` directly in an org whose revenue is not
   ERP-owned (no UI yet; #784 will build one). Definer RPCs may update rows under a user JWT.

Progress claims (0250) are invoices-to-be: a live claim on a work order will become an invoice, and its invoice row
reuses the claim id. The shipped view `sales_invoice_work_billed` is the one definition of billed work (DD-PBL-9).

Two Finance users can invoice the same work order at the same moment. `transition_work_order` locks the work
order row then the project row; `create_progress_claim` locks the project row.

## Decision

1. **What a work order has been billed.** Per invoice linked to the work order and not Cancelled: its billed work
   from `sales_invoice_work_billed` (net of tax, plus the down-payment recovery its claim removed); a down-payment
   invoice counts zero (an advance, recovered through later claims). Per live progress claim on the work order not
   yet raised as an invoice: its gross. "Invoiced" = Submitted/Unpaid/Paid; "not yet submitted" = Draft invoices +
   unraised claims; "still to invoice" = work-order value excl. tax − both. One `security_invoker` view
   (`work_order_billing_lines`) states this per record; a second (`work_order_billing`) aggregates it per work order.
   Nothing is stored.
2. **One refusal, three entry points, one helper.** `assert_work_order_invoiceable(org, work order, project,
   record, amount, currency)` refuses (SQLSTATE `BW001`) when the work order is not Issued/Closed, is on another
   project or org, the amount or currency cannot be checked, or the new amount plus everything already billed
   (the views above **plus in-flight ERP commands** not yet mirrored) would pass the value. It is called:
   - from a `BEFORE INSERT` trigger on `external_command_outbox` for sales-invoice create/update/amend commands —
     **before any ERP write**, so a refusal never strands an ERP document;
   - from a `BEFORE INSERT/UPDATE` trigger on `sales_invoices` for every writer **except** the service-role mirror and
     a no-JWT server load — the native path and any definer RPC acting for a user;
   - from `create_progress_claim`, so a claim reserves its gross when it is created (claims are immutable).
3. **The mirror is never refused.** An overage that arrives from ERPNext (a Desk edit, an amendment) is recorded
   and shown as "Over-invoiced by X".
4. **Concurrency by a per-work-order advisory transaction lock**, taken by every billing writer before it reads.
   Not a row lock: `create_progress_claim` would take project→work order while `transition_work_order` takes
   work order→project. `create_progress_claim` takes the advisory lock before its project row lock.
5. **An ordinary invoice create may name its work order.** The dispatch keeps `workOrderId` on create only (org
   checked by the existing link pre-flight; project/status/amount by the fence); edits and amends never move it.
   The ERP draft takes the work order's client PO as `po_no`. The assistant's work-order draft links it too and
   defaults to what is still to invoice.
6. **Paid is derived.** A work order is Paid when nothing is still to invoice, nothing is in draft, and every
   submitted invoice on it is Paid (ERPNext outstanding 0; withheld tax counts as settled, DD-RCPT-1).

## Consequences

- The over-invoice rule holds on both write paths and under concurrency, and is proved in pgTAP with mutation
  checks; a refusal on the ERP path is a 422 (`BW001` joins the dispatch's business-rejection codes).
- The outbox fence reads in-flight command payloads (`items[].qty × rate`), so the payload shape is now an input to
  a money control. A command without readable lines is refused, never waved through (fail closed).
- Invoices raised without a work order stay legal (project-level), count only in the contract view, and do not
  consume any PO.
- Credit notes are not linked to work orders: the PMO way to reduce a work order's invoiced figure is to cancel the
  invoice (owner question in the spec).
- Down payments do not consume a PO under this definition; at completion, with the down payment fully recovered,
  the two views agree. A recovery schedule that leaves part of a down payment unrecovered is #766's concern.
- No table or column is added; the isolation denominator and the 0178 allow-list (59) are unchanged.
- Reversal: `supabase/migrations/rollback/0262_billing_by_work_order_down.sql`; posted ERP documents are untouched.
