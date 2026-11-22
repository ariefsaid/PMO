# Feature: Site cash estimate by purpose and work order, for a period

> **Status:** Approved by the coordinator with the recommended answers to OQ-CAE-1..4 (phase 1); built in phase 2. Extends `docs/specs/site-imprest.spec.md` (#1515) and
> `docs/specs/site-cash-work-order.spec.md` (#2732). Plan: `docs/plans/2026-11-22-cash-advance-estimate.md`.
> **IDs:** `FR-CAE-###`, `AC-CAE-###`, `OQ-CAE-#`.

## 1. Job story

*When I plan site cash, I want an estimate of the advance needed, and what it is for (by purpose and work order),
over a period, so that I can ask head office for the right top-up before the cash runs short, not only read the
current balance.*

## 2. Today (verified on this branch)

Site cash is the imprest float (glossary "Site cash"). What exists:

- **Balance and position:** `get_imprest_position` returns cash book, advances out, receipts waiting, top-up in flight,
  and `gap` = limit minus (cash + advances + receipts waiting) (`supabase/migrations/0424_imprest_position.sql`
  `get_imprest_position`; shown as "Still needed" at `pmo-portal/pages/ImprestFloatDetail.tsx:219` and
  `pmo-portal/pages/ImprestFloats.tsx:145`). This is "refill to the limit", not a forecast.
- **A monthly plan per purpose:** `imprest_plans` (one per float and month) with `imprest_plan_lines` (one per
  budget category = the purpose, amount > 0), submitted and approved by route
  (`0422_imprest_floats_plans.sql` tables; `transition_imprest_plan` live definition in `0534_feature_enforcement.sql`,
  which keeps 0426's route check). The editor is `pmo-portal/pages/imprest/PlansSection.tsx` and offers only this
  month and next month (`PlansSection.tsx` month select).
- **Plan versus actual for one month:** `get_imprest_plan_usage(float, month)` (planned, drawn, remaining, exceptions,
  per category) and `imprest_remaining`/`imprest_drawn` (`0423_imprest_cash.sql`, `0424`). The float detail shows only the
  current month (`get_imprest_position.plan_lines`).
- **Work order on spend:** a claim charged to a float may name a work order (`expense_claims.work_order_id`,
  `1260_expense_claim_cost_attribution.sql`, written by `set_cost_attribution`); a cash advance may not (`COST_ADVANCE`).
  Drawn money is counted per category only; nothing reads the work order for the float.
- **Not present:** a plan line has no work order; no figure sums plans over several months; no "advance needed" figure
  that compares the plan with cash on hand. (Scope of this claim: searched `supabase/migrations`, `supabase/functions`,
  `pmo-portal/pages`, `pmo-portal/src`, `docs/decisions.md`, ADRs and specs with `scripts/prior-art.sh` for
  "cash advance", "petty cash", "site cash"; those sources are silent on a work-order or multi-month estimate.)

So the base answers the **purpose, monthly** half through the plan. The new work is the **work order** split, the
**period** (several months), and the **advance needed** figure.

## 3. How the estimate is made

It is an **entered plan**, not a formula. The existing approved monthly plan stays the single place a person enters
"how much, for what". Two additions, no second plan beside it:

1. A person may **split a plan line over work orders** of the float's project (optional; the part left unsplit is "not
   assigned to a work order"). The split is a breakdown of the line: the line, its total and its approval route are
   unchanged.
2. A read, `get_imprest_estimate(float, from_month, to_month)`, lists by month, purpose and work order what is planned
   and what is already drawn, and states the **advance needed**:
   `max(0, still to spend over the period - cash in hand - top-up in flight)`, where still to spend is the sum of the
   rows' `max(0, planned - drawn)` for months that have not ended (a line with no split is one row, so this is the
   purpose's remaining; split lines add a row per work order and one for the unassigned part). No customer rule, no coefficient. A month with no plan is
   shown as "no plan" and contributes nothing; the screen names who adds one.

Plans counted: the live plan of each month (Approved, else Submitted), else the author's Draft marked "not yet
approved". Approval status is shown per month; the figure is advisory and caps nothing (DD-IMP-4 stands).

## 4. Requirements (EARS)

- **FR-CAE-001** The system shall let the author of a Draft or Rejected plan assign part of a plan line to one work order
  of the float's project, one amount per (line, work order).
- **FR-CAE-002** The system shall refuse a split whose work orders add up to more than the line's planned amount
  (`ICE_SPLIT_OVER_LINE`), a work order of another project or org (`ICE_WO_PROJECT`), a cancelled work order
  (`ICE_WO_CANCELLED`), and a split change once the plan is not Draft or Rejected (42501 as for lines).
- **FR-CAE-003** While a line has splits, the system shall refuse lowering its planned amount below their sum
  (`ICE_SPLIT_OVER_LINE`); deleting a line deletes its splits.
- **FR-CAE-004** When a user opens the estimate for a float and a period of 1 to 12 whole months, the system shall return
  per month, purpose and work order (or "not assigned"): planned, drawn, still to spend, plus the period totals and the
  advance needed (section 3).
- **FR-CAE-005** Drawn on a work-order row = the float's claims on that work order, that month, that purpose, status
  Approved or Paid (kind claim); drawn on the "not assigned" row = the purpose's drawn minus the work-order rows' drawn,
  never below zero. Drawn on the purpose total is `imprest_drawn`, unchanged.
- **FR-CAE-006** The system shall return no rows to a caller who cannot see the float (invoker rights, as
  `get_imprest_position`), and shall refuse a period over 12 months or ending before it starts
  (`ICE_PERIOD`).
- **FR-CAE-007** The float page shall show the estimate: period (this month through the last planned month, default),
  a table by purpose with work-order rows beneath, the advance needed, and a "Request this advance" action (shown only to a viewer who may request a top-up) that opens
  the existing top-up request (nothing is prefilled or sent by the estimate; a viewer who may not is told who does).
- **FR-CAE-008** Where a month in the period has no plan, the screen shall say "No plan for {month}" and name who adds one
  (people with approval rank, the same set that may create plans).
- **FR-CAE-009** The plan editor shall let the author split a line over work orders and show the unassigned remainder; a
  disabled split control says why (plan is not editable, or the project has no open work order).
- **FR-CAE-010** Refusals above shall have an English and a Bahasa Indonesia sentence in the refusals catalogue saying
  what to do next.
- **FR-CAE-011** Splits shall have row-level security: visible to whoever sees the plan; written only through the security-definer functions `save_imprest_plan_line_split` and `delete_imprest_plan_line_split`
  (no client write grant), only by the plan's author while the plan is Draft or Rejected, refused to a light account;
  `org_id` stamped from the line by trigger, never from the client.

## 5. Acceptance criteria

| ID | Given / When / Then | Owning layer |
|---|---|---|
| AC-CAE-001 | Given a Draft plan line of 100 and a work order on the float's project, when the author splits 60 to it, then it is saved and the unassigned remainder reads 40 | pgTAP |
| AC-CAE-002 | Given that line, when splits would total 101, then refused `ICE_SPLIT_OVER_LINE` | pgTAP |
| AC-CAE-003 | Given a work order of another project, or a cancelled one, when split, then refused `ICE_WO_PROJECT` / `ICE_WO_CANCELLED` | pgTAP |
| AC-CAE-004 | Given a Submitted or Approved plan, when its author edits a split, then refused (42501) | pgTAP |
| AC-CAE-005 | Given a split of 60, when the line is lowered to 50, then refused; when the line is deleted, its splits go | pgTAP |
| AC-CAE-006 | Given an Engineer or another org's user, when they read splits or the estimate, then they see no rows; a write is refused | pgTAP |
| AC-CAE-007 | Given approved plans for this and next month, claims drawn, and cash in hand, when the estimate is read, then planned, drawn, still to spend and advance needed equal the worked figures, and a past month adds no still to spend | pgTAP |
| AC-CAE-008 | Given claims charged to a work order, when read, then the work-order row's drawn counts only them and the unassigned row holds the rest | pgTAP |
| AC-CAE-009 | Given cash in hand above still to spend, when read, then advance needed is 0, never negative; given a top-up in flight, it is subtracted | pgTAP |
| AC-CAE-010 | Given a period of 13 months or reversed, when read, then refused `ICE_PERIOD` | pgTAP |
| AC-CAE-011 | Given a month with no plan, when the estimate is shown, then the row says no plan and who adds one | Vitest |
| AC-CAE-012 | Given the estimate with an advance needed, then the figure, its by-purpose and by-work-order rows, and the top-up action show on phone and desktop, in English and Bahasa Indonesia | Vitest (render) + e2e journey step |
| AC-CAE-013 | Given the plan editor, when the author splits a line, then the remainder updates; a frozen plan shows the control disabled with the reason | Vitest |
| AC-CAE-014 | Each `ICE_*` code has an English and an Indonesian sentence | Vitest (catalogue guard) |

Mutation check (phase 2): set the split-sum check to always pass, then AC-CAE-002 must fail; make the estimate read
`drawn` as 0, then AC-CAE-007/008 must fail; drop the RLS select predicate, then AC-CAE-006 must fail.

## 6. Settings added

None. The estimate and the split are on for every org. They change no money figure, approval route or who may see a
float (visibility follows the plan), so no switch applies. The period cap (12 months) is a constant of the read, not a
customer rule.

## 7. Existing tests whose steps change

- `pmo-portal/pages/imprest/PlansSection.test.tsx`, `PlansSection.floor.test.tsx`: the line list gains a split control;
  existing line steps keep their goals.
- `pmo-portal/pages/ImprestFloatDetail.test.tsx`, `.floor.test.tsx`: a new estimate section renders; nothing asserted
  today is removed.
- `pmo-portal/e2e/AC-IMP-090-site-imprest-journey.spec.ts`: one added step (read the estimate); goal oracles intact.
- pgTAP allow-lists and shape guards that enumerate tables: `0825_rls_policy_shape_guard.test.sql`,
  `2711_light_account_boundary_sweep.test.sql`, `imprest_acl.test.sql`, the isolation-probe denominator
  (`scripts/isolation-probe-denominator.d/legacy.json`), and `scripts/check-unpaged-reads.mjs` gain the new table.

## 8. Questions only the customer can answer

| # | Question | Recommended answer (built meanwhile) |
|---|---|---|
| OQ-CAE-1 | Is "the advance needed" the top-up head office should send site cash for the period (what we build), or a cash advance to a named person? Today an advance cannot name a work order (`COST_ADVANCE`). | The top-up to site cash. Person advances keep their own flow. |
| OQ-CAE-2 | Should cash coming from receipts waiting (already spent, not yet refilled) lower the advance needed? | No: receipts waiting are cash already gone; only cash in hand and a top-up in flight lower it. |
| OQ-CAE-3 | Plans today cover this and next month only. For a longer period do site teams plan further ahead? | Keep this and next month in the editor; the estimate reads any months that have a plan (cap 12). Widen the editor if asked. |
| OQ-CAE-4 | Should the estimate count an unapproved Draft plan? | Yes, labelled "not yet approved", so a planner sees the need before approval. |
