# Spec: Billed per month on the work-order page

**Status:** Approved 2026-11-22 (coordinator, option A: one calculation shared with work in hand); built. Lane gap-billing, map #2516, size S. Money path: **read-only derivation** (no posting, no SoD change, no setting, no new table). IDs `FR-BPM-###`, `AC-BPM-###`. Plan: `docs/plans/2026-11-22-billed-per-month.md`. OD-SCOPE-2: no month rule, name or threshold in code.

**Job story.** When I read a work order, I want to see what was billed for it per month, so I can see its billing history without opening each invoice.

## 1. AS-IS (verified on the base)
- The work-order page `/work-orders/:id` (`pages/WorkOrderDetail.tsx`, `pages/work-order-detail/BillingSection.tsx`, FR-WORP-023) shows billing as four totals (invoiced, pending, paid, remaining) from `work_order_billing`, plus acceptances. **No per-month figure exists on it.** The revenue plan (#2671) and plan-vs-actual do not show billed.
- **The per-month billed figures already exist on the Finance "work in hand" screen**: `get_work_in_hand` (migration 1148, the only definition) returns, per Issued work order, `window_months` (the six complete months before the as-of month, organisation time zone) and `billed_to_date`, from `sales_invoice_work_billed`: submitted invoices (Submitted, Unpaid, Paid), no down payments, dated, valued, in the work order's own currency. A work order that cannot be totalled returns no figures. It cannot serve the page as it is: it refuses Project Manager (Admin, Executive, Finance only), omits the current month, returns only Issued work orders, and has no work-order filter (it reads the whole organisation).
- Who sees money on the page today: the Billing panel renders only when `can('view','salesInvoice')` (Admin, Executive, Project Manager, Finance). Row-level security on `sales_invoices` is organisation-wide for those four roles (restrictive policy `sales_invoices_engineer_read_scope`); it does not scope a Project Manager to their own projects. Light accounts have no work-order page (OD-SCOPE-4).

## 2. Definitions
- **Billed (per month)** = exactly the work-in-hand figure: sum of `net + recovery` of submitted invoices dated in the organisation-local month, excluding tax, down payments billing nothing, own currency only. **Drafts, cancelled invoices and claims not yet raised as invoices are not in it.** This differs from the page's "Invoiced + Pending" totals (which include drafts and unraised claims); the block says so.
- **One calculation.** `work_order_billed_months_core(work_orders, bound)` holds the per-work-order monthly sum. `get_work_in_hand` (restated) and `get_work_order_billed_months` both read it.
- Months run from the first billed month through the **current month to date** (marked), every month between included (a month with no billing reads 0.00, a true zero because the figures are complete).
- A work order whose billed figure cannot be stated in its own currency has **no monthly figures** and says so (as work in hand).

## 3. Requirements (EARS)
- FR-BPM-001 The system shall hold the per-work-order monthly billed calculation once, in `work_order_billed_months_core`, and `get_work_in_hand` shall read it with its output unchanged.
- FR-BPM-002 `get_work_order_billed_months(p_work_order, p_as_of default null)` shall return, for a work order of any status, the organisation's time zone, currency, an incomplete flag, and the months from the first billed month through the as-of month, each with its billed amount (scale-two text) and a to-date mark on the as-of month.
- FR-BPM-003 It shall be callable by Admin, Executive, Project Manager and Finance (the `can('view','salesInvoice')` set) who are active members; other roles and unauthenticated callers are refused 42501; another organisation's work order is "not found" (P0002); row-level security decides the rows.
- FR-BPM-004 The Billing panel shall list, newest month first, each month's billed amount excl. tax, the current month marked "to date", and a total; and say that the figures count submitted invoices only. It renders only where the panel already renders (`can('view','salesInvoice')`), with its own loading, error-with-retry, "No submitted invoice yet." and "cannot be totalled" states; never a blank, never a zero for a failed read.
- FR-BPM-005 Usable at 390 px and 1440 px; English and Bahasa Indonesia; DESIGN.md tokens.
- No refusal a person meets is introduced (read-only), so the refusals catalogue gains nothing.

## 4. Settings
None. On for every organisation. No existing figure changes.

## 5. Database-enforced rules and proofs
Gate and shared calculation in the database; proof `supabase/tests/1790_work_order_billed_months.test.sql`. Existing `supabase/tests/work_in_hand.test.sql` is unchanged and must stay green (the restated function's output is unchanged).

## 6. Acceptance criteria
| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-BPM-001 | Given invoices in Sep and Oct and Dec, then months run Sep to Dec with Nov as 0.00 and Dec marked to date. | pgTAP |
| AC-BPM-002 | Given a draft, a cancelled invoice, an undated invoice, a later-month invoice and a down payment, then none counts; an inclusive invoice counts excl. tax. | pgTAP (Layer-1 money test) |
| AC-BPM-003 | Given a Closed work order, an empty one, one with a foreign-currency invoice, then: reads; no months; incomplete with no months. The organisation's time zone is reported. | pgTAP |
| AC-BPM-004 | Given the same work order, then each month equals the `get_work_in_hand` window figure and the months add up to its `billed_to_date`. | pgTAP |
| AC-BPM-005 | Given Finance and Project Manager, then they read; an Engineer and an unauthenticated caller are refused; another organisation's work order is not found; anon has no execute. | pgTAP |
| AC-BPM-006 | Given the panel, then months list newest first with to-date mark and total, the "submitted invoices only" statement shows, incomplete/empty/error states read in words, and a role that may not view invoices sees none. | Unit (RTL) |
| AC-BPM-007 | Given the DAL, then the rpc is called for the one work order, figures parse as numbers (total in cents) and a malformed month or amount is an error, never a zero. | Unit |
| AC-BPM-008 | Given Bahasa Indonesia, then every new string is translated. | Unit (RTL) + locale parity |
| AC-BPM-009 | Given Finance opens a work order with invoices in two months, then both months and amounts show and the current month reads "to date". | E2E (one journey) |

**Mutation check (required):** in `work_order_billed_months_core` drop `and not w.is_down_payment` (AC-BPM-002 and 004 go red) or change `'Submitted', 'Unpaid', 'Paid'` to include `'Draft'` (AC-BPM-002 red); in `get_work_order_billed_months` change the role list to include Engineer (AC-BPM-005 red).

## 7. Questions for the owner
1. A Project Manager reads any project's work-order months, as they already read every invoice and the page's totals (row-level security on invoices is organisation-wide). If a Project Manager should see only their own projects' billing, that is a wider change across all invoice reads, not this block. Recommended: leave as is.
2. The month figures count submitted invoices only (work in hand's definition), so they do not add up to the page's Invoiced + Pending (which include drafts and unraised claims). The block says so. Recommended: keep one definition across screens.

## 8. Out of scope
Month filter or chart, project-level view, earned side, forecast, export, plan against billed.
