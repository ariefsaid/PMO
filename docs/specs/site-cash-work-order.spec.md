# Feature: Site cash and expense claims carry a work order (SCWO)

Issue #2732 (map #2516). Status: **Draft, 2026-11-21**. Money path: **ships alone, with database proofs**.
Builds on ADR-0104 / `docs/specs/work-order-cost-attribution.spec.md` (#2517: one rule trigger, one write path,
one read seam) and `docs/specs/work-order-plan-vs-actual.spec.md` (#2519: one SQL read for actuals). Extends
`docs/specs/expense-claims.spec.md` (#775) and `docs/specs/site-imprest.spec.md` (#1515). IDs: `FR-SCWO-###`, `AC-SCWO-###`.
Owner-set target: 15 December 2026.

**Job story.** When site staff spend from a cash float or claim an expense, I want that spending to name its work
order and discipline, so a work order's cost includes what was bought with site cash and not only what went through a
purchase order.

## 1. AS-IS (read from shipped code, not from the docs)
- Spending against a site float is a row of `expense_claims` (`imprest_float_id` set, 0423); a claim and a cash
  advance are one table, `kind` = `claim` | `advance` (0247). There is no second "float spending" table.
- Seven cost sources carry `work_order_id` + `discipline_id` (0951). `expense_claims` is not one of them.
- Content of a claim is frozen after submission (`assert_expense_claim_update`, DD-EXP-10); routing is decided on
  `project_id`, `budget_category` and amount, never on a work order.
- `work_order_cost_amounts(project)` (0999, 1113, 1115) is the one read behind plan versus actual. In PMO mode the
  project actual is paid purchases plus equipment charge (`project_finance_actuals`, 0909): **approved claims are not in
  it today**. In ERP-ledger mode the actual is the ledger; a claim reaches it when its approval posting is pushed
  (`expense_posting_erp_mirror`, 0270).
- `work_order_cost_lines` (view, latest body 1037) has no claim rows.

## 2. Decisions proposed here (for the Director to ratify)
- **DD-SCWO-1 One home, no new table.** `expense_claims` gains nullable `work_order_id` and `discipline_id`, under
  exactly ADR-0104's rule (`check_cost_attribution`, same `COST_*` errors, same `set_cost_attribution` write path).
  Float spending needs no extra column: it is already a claim row.
- **DD-SCWO-2 Only `kind = claim` is a cost.** A cash advance is cash moving, not cost; the cost is the claim that
  settles it. An advance refuses attribution (`COST_ADVANCE`, 23514). A claim settling an advance carries its own
  attribution.
- **DD-SCWO-3 Attribution is correctable after submission; nothing else is.** It does not enter routing, amount or
  posting. The only writer is `set_cost_attribution` (a definer; clients get no column grant), so the DD-EXP-10 freeze,
  which already waves a BYPASSRLS actor through, needs no exemption and none is added. Who may: the 0951 rule (Admin, Executive, Finance, Project Manager any claim of
  the org, audited; the claimant their own claim while Draft or Rejected).
- **DD-SCWO-4 Money is counted once, never inferred.** An Approved or Paid claim counts at its `amount` (the org
  currency, DD-EXP-11). It is a work-order cost line only when it **names a work order**. An unattributed claim keeps
  today's treatment exactly: it is inside the project actual where the ledger already holds it (so it stays in the
  shared pool and follows the existing split) and outside the PMO-mode actual where it is not today. No existing
  organisation's figure moves until someone names a work order on a claim.
  - *PMO mode:* an attributed claim is **added** to the project figure (it was not in it) as a direct cost line.
  - *ERP-ledger mode:* the claim is carved out of the unassigned remainder (`project_actuals`) only once its approval
    posting is `pushed`; before that it is listed `not-posted` with no amount, so the ledger figure is never counted twice.

## 3. Requirements (EARS)
- FR-SCWO-001 The system shall hold an optional work order and an optional discipline on every expense claim; both null
  means a project-level (shared) cost, as before.
- FR-SCWO-002 When a work order is named, it shall belong to the claim's project and org; a claim with no project
  cannot name one; a newly named cancelled work order is refused; a discipline shall be on the org's active list (the
  ADR-0104 errors `COST_WO_PROJECT`, `COST_WO_NO_PROJECT`, `COST_WO_CANCELLED`, `COST_DISCIPLINE`, SQLSTATE 23514),
  for every writer, definers included.
- FR-SCWO-003 A record of kind `advance` shall refuse a work order or discipline (`COST_ADVANCE`).
- FR-SCWO-004 `set_cost_attribution` shall accept source `expense_claim`, with the DD-SCWO-3 who-may rule; another
  org's id reads as absent; one audit row per record carrying the before value.
- FR-SCWO-005 While a claim is Submitted, Approved, Paid or Cancelled, a change to the attribution through
  `set_cost_attribution` shall leave every other column of the claim as it was, and a client shall have no direct write
  to the two columns (DD-SCWO-3).
- FR-SCWO-006 A claim's project shall not change to another project while it names a work order of the old project
  (`COST_WO_PROJECT` on the project column).
- FR-SCWO-007 `work_order_cost_lines` shall return one `expense_claim` row per claim (kind `claim`), RLS of
  `expense_claims` deciding what a caller sees; the repository groups it with the other sources.
- FR-SCWO-008 `work_order_cost_amounts(project)` shall return, per attributed claim, its amount with reason `counted`
  when Approved or Paid (and, in ledger mode, posted), `not-posted` with no amount for Draft, Submitted, Rejected,
  Cancelled, or an unposted approval in ledger mode; unattributed claims add no line.
- FR-SCWO-009 Plan versus actual, per work order, per discipline and rolled up to the project, shall include the
  `counted` claim lines in direct cost; the project total equals the project actual plus attributed PMO-mode claims
  (ledger mode: the project actual unchanged); no claim is counted twice.
- FR-SCWO-010 The claim form (and the float draw form, the same modal) shall carry the work order and discipline pickers
  already shipped (`CostAttributionFields`), under the same project rule; a refusal after the claim saved reads "saved,
  but the work order or discipline was not set" and never offers a retry that duplicates the claim.
- FR-SCWO-011 The claim detail shall show the claim's work order and discipline, and let a permitted user correct them.
- FR-SCWO-012 English and Bahasa Indonesia strings for every new label and error.

## 4. Settings and defaults
- **New settings: none.** Both columns default to null; no existing claim, screen, route, approval, posting or total
  changes until a person names a work order. Existing tests stay untouched.
- Nothing is client-named in code; disciplines remain the org's own list (ADR-0104).

## 5. Database-enforced rules and their pgTAP file
All in `supabase/tests/1260_site_cash_work_order.test.sql` (two orgs, roles Admin/Finance/PM/Engineer/claimant), each denial
asserting errcode **and** message; mutation-checked (FR-SCWO-002, -003, -004, -005, -008).

## 6. Acceptance criteria
| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-SCWO-001 | Given a claim on project P, when a work order of P and an active discipline are set, then it saves; a work order of another project or org is refused `COST_WO_PROJECT`. | pgTAP |
| AC-SCWO-002 | Given a claim with no project, when a work order is named, then `COST_WO_NO_PROJECT`; a cancelled work order newly named is `COST_WO_CANCELLED`; an archived or foreign discipline is `COST_DISCIPLINE`. | pgTAP |
| AC-SCWO-003 | Given a float cash advance, when a work order is named, then `COST_ADVANCE`; the claim that settles it may carry its own. | pgTAP |
| AC-SCWO-004 | Given an Approved claim, when Finance sets its work order, then it saves with one audit row (before value); when the claimant or an Engineer tries, 42501; another org's claim id reads as not found. | pgTAP |
| AC-SCWO-005 | Given a Paid claim, when Finance sets its work order, then only the two columns change; when the claimant writes the columns directly, it is refused (permission denied). | pgTAP |
| AC-SCWO-006 | Given a claim naming a work order, when its project is changed, then refused `COST_WO_PROJECT`. | pgTAP |
| AC-SCWO-007 | Given attributed claims across statuses, when cost lines are read as Finance, then one `expense_claim` row each; an Engineer sees only their own; another org sees none. | pgTAP |
| AC-SCWO-008 | Given WO-A with a Paid claim 400 (CIV), an Approved claim 100 (ELE), a Submitted claim 50 and an unattributed Approved claim 70, when actuals are read in PMO mode, then WO-A direct gains 500 (400 CIV, 100 ELE), the Submitted one is `not-posted` with no amount, the 70 adds no line, and the project actual (purchases and equipment) is unchanged. | pgTAP |
| AC-SCWO-009 | Given the same data in ledger mode with the 400 claim posting `pushed` and the rest unposted, when read, then 400 moves from `project_actuals` to WO-A once, and the ledger total is unchanged. | pgTAP |
| AC-SCWO-010 | Given claim cost lines, when plan versus actual is derived, then per-work-order, per-discipline and project roll-up include them exactly once and shared cost allocation (default and custom split) is unchanged for orgs with no attributed claims. | Unit (`workOrderPlanVsActual.test.ts`) + pgTAP |
| AC-SCWO-011 | Given the claim form with a project chosen, when a work order and discipline are picked and the claim saved, then the claim carries both; a refusal after save shows the "saved, but" message and no duplicate on retry. | Unit (`ExpenseClaimFormModal`) |
| AC-SCWO-012 | Given a claim on a float, when it is created with a work order, then the float's position and plan usage figures are identical to a claim without one. | pgTAP |
| AC-SCWO-013 | Given the claim detail, then the work order and discipline show, are correctable by a permitted role and absent for others; English and Bahasa strings both resolve. | Unit + curated e2e (one journey) |
| AC-SCWO-014 | Given no attribution anywhere, when `work_order_cost_amounts` is read before and after this migration, then rows are identical (no regression). | pgTAP |
