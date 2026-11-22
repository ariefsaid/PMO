# Spec: Billed per month on the work-order page

**Status:** Draft, 2026-11-22. Lane gap-billing, map #2516, size S. Money path: **read-only derivation** (no posting, no SoD change, no setting, no new table). IDs `FR-BPM-###`, `AC-BPM-###`. Plan: `docs/plans/2026-11-22-billed-per-month.md`. OD-SCOPE-2 holds: no month rule, name or threshold in code.

**Job story.** When I read a work order, I want to see what was billed for it per month, so I can see its billing history without opening each invoice.

## 1. AS-IS (verified on the base)
- The work-order page `/work-orders/:id` (`pages/WorkOrderDetail.tsx`) shows billing only as four totals (invoiced, pending, paid, remaining) from the view `work_order_billing` plus the acceptance list (`pages/work-order-detail/BillingSection.tsx`, FR-WORP-023). **No per-month figure exists on it.** The revenue plan (#2671) is a *plan* by day/month, not billed; plan-vs-actual shows plan against validated progress, not billing.
- "Billed" is already defined once: `work_order_billing_lines` (head body: migration 1046 section 6): one row per live record, `billed` = invoice at net plus recovery excl. tax (down payment bills 0, cancelled invoice excluded), live unraised claim at gross (down payment 0, withdrawn excluded), live opening-balance claimed amount; `work_order_billing.invoiced + pending` is the sum of it (0337). `figures_complete` is false when a line has no amount or is in a currency other than the work order's. The earned-and-billed spec (DD-EBR-1, `earned-billed-revenue.spec.md` FR-EBR-012) pins "billed" to exactly this.
- The view carries **no date**. The dates exist on the sources: `sales_invoices.invoice_date` (nullable; read through `sales_invoice_work_billed`), `progress_claims.created_at`, `opening_balances.as_of`.
- Who sees money here today: the page's Billing panel renders only when `can('view','salesInvoice')` (Admin, Executive, Project Manager, Finance); the view is `security_invoker`, so RLS on invoices and claims decides rows. Light accounts (Foreman, Field user) have no work-order page at all (OD-SCOPE-4).

## 2. Definitions
- **Billed** = the `billed` of `work_order_billing_lines`, unchanged. No second derivation.
- **Billed month** of a line = the calendar month of its **billed date**: invoice → `invoice_date`; live unraised claim → its creation instant in the organisation's time zone (as `org_current_month`); opening balance → `as_of`. An invoice with no `invoice_date` has no month and is listed as **"No invoice date"**, never dropped, never placed in a guessed month.
- A month's figure is **per currency**; amounts in different currencies are never added. A line with no amount is **"not totalled"** for its month: it makes that month read incomplete (a count), never zero.
- **Reconciliation:** for a work order whose figures are complete, the per-month amounts plus "No invoice date" sum to `invoiced + pending`.

## 3. Requirements (EARS)
- FR-BPM-001 The view `work_order_billing_lines` shall gain one trailing column `billed_on date` (rows, `billed`, `submitted`, `paid` unchanged), so one definition of billed carries its date. No new table, function, setting or grant.
- FR-BPM-002 The work-order page's Billing panel shall list, newest month first, **Billed per month**: month, billed amount excl. tax in its currency, and the number of records behind it, for every month in which the work order has billed records.
- FR-BPM-003 Months without records are not listed. "No invoice date" lists last when present. A month with an un-totalled record reads "includes N record(s) with no amount" and shows the totalled part as a floor, never as complete.
- FR-BPM-004 When lines exist in more than one currency, each currency forms its own rows; nothing is converted or summed across them.
- FR-BPM-005 The list shall show for the work order a total equal to the sum of the rows per currency; where `figures_complete` is false the total says it is incomplete (existing words).
- FR-BPM-006 The list shall render only where the Billing panel already renders (`can('view','salesInvoice')`); the read is the caller's RLS. A caller with no rights sees no list, no row and no figure. A failed read shows the panel's own error with retry; an empty read says "Nothing billed yet" (never "0").
- FR-BPM-007 Usable at 390 px and 1440 px; English and Bahasa Indonesia; DESIGN.md tokens, no table wider than the phone (stacked rows).
- No refusal is introduced (read-only), so the refusals catalogue gains nothing.

## 4. Settings
None. On for every organisation. No money figure changes: the existing four totals are untouched, and the new rows only regroup the same lines.

## 5. Database-enforced rules and proofs
The rule that matters is "billed is one definition". Enforced by the view (restated from 1046 with one added column); proof `supabase/tests/1790_billed_on_month.test.sql`.

## 6. Acceptance criteria
| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-BPM-001 | Given invoices dated in two months, a down payment, a cancelled invoice and a withdrawn claim, then `work_order_billing_lines.billed_on` is the invoice date, the down payment bills 0, and cancelled/withdrawn rows are absent (same rows as before the column). | pgTAP |
| AC-BPM-002 | Given an unraised claim created at 23:30 on the last day of a month in the organisation's zone, then `billed_on` is that local date. Given an opening balance, then `billed_on` is `as_of`. | pgTAP |
| AC-BPM-003 | Given a work order with complete figures, then the lines' `billed` grouped by month plus the undated lines equal `work_order_billing.invoiced + pending`. | pgTAP (Layer-1 money test) |
| AC-BPM-004 | Given lines (month, currency, billed, record), when grouped, then months are newest first, "No invoice date" last, per-currency rows never summed together, an un-totalled record is counted and flagged, the total per currency equals the row sum. | Unit (pure `billedByMonth`) |
| AC-BPM-005 | Given Finance opens a work order with billing in two months, then the panel lists both months with amounts and the total equals the Invoiced + Pending figures shown above it. | Unit (RTL) |
| AC-BPM-006 | Given a role without `view salesInvoice`, then the Billing panel and the per-month list are absent and no read for the lines is made. Given nothing billed, the list says "Nothing billed yet". Given the read fails, then the panel shows its error with retry. | Unit (RTL) |
| AC-BPM-007 | Given Bahasa Indonesia, every new string is translated (locale parity guard); at 390 px no horizontal scroll. | Unit (i18n) + screenshots |
| AC-BPM-008 | Given Finance on a work order with invoices in two months, when they open `/work-orders/:id`, then the months and amounts show. | E2E (one journey) |

**Mutation check (required):** in the migration, change the invoice branch's `w.invoice_date` to `current_date` and AC-BPM-001 goes red; drop the `withdrawn_at is null` line and AC-BPM-001/003 go red.

## 7. Questions for the owner
1. A claim not yet raised as an invoice has no invoice date. Recommended (built): month of its creation in the organisation's time zone. Alternative: list unraised claims under their own "Not yet invoiced" row. Which reads better to Finance?
2. Should the month list split invoiced (submitted) from pending? Recommended: no, one billed figure as the earned-billed spec; the panel's totals above already split them.

## 8. Out of scope
Month filter or chart, project-level per-month view (the management pack and billing plan have those), earned side, forecast, export, plan against billed.
