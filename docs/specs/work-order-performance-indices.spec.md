# Spec: Cost and schedule performance indices per work order and project (#2597)

**Status:** proposed; owner decisions below need sign-off before build. Map #2516 (contractor field operations), after the December go-live. Target February to March 2027. IDs `FR-CSP-###`, `NFR-CSP-###`, `AC-CSP-###`. Plan: `docs/plans/2026-11-21-work-order-performance-indices.md`. Executor: Orca worker; **Money path: read-only derivation.** It posts nothing, changes no separation-of-duties rule, adds no write path and stores no figure. A wrong index is a wrong business decision, so it ships alone and gets the three reviewers. The panel is composed with the `restructure` skill and judged rendered by the owner (`docs/ux/screen-rules.md`).

## Job story

When a work order is running, I want to see the cost performance index and the schedule performance index next to the progress curve, computed from validated progress at contract rate, so that I can tell whether we are earning as fast as we are spending and as fast as we planned, and act on a work order that is slipping before the month-end review.

## Context and boundary (checked against `origin/dev`)

- **Earned value source.** Validated daily site report quantities at contract rate: `dsr_progress_lines.frozen_amount` on `daily_site_reports` with `status = 'validated'`, not superseded, not archived (1040/1041). The shipped read `work_order_validated_revenue(p_work_order)` (1041) sums all of them with **no date**, so a date-bounded figure needs a new read over the same rows (OD-CSP-2). A validated line with no rate has no `frozen_amount` ("no rate", AC-DSR-004); it is counted and reported, never valued at 0 silently.
- **Actual cost source.** `work_order_cost_amounts(p_project_id)` (0999, #2519): one row per cost line with `work_order_id`, `occurred_on`, `currency`, `amount` or a `reason` it is unreadable; gated to Admin, Executive, Finance, Project Manager. The plan-vs-actual derivation in `pmo-portal/src/lib/workOrderPlanVsActual.ts` already groups these; this feature reuses that grouping and its restricted/not-comparable states (FR-WPVA-013/014).
- **Budget at completion (BAC)** = the work order's net value, `work_order_billing.order_net` (0337: `closing_value` when stamped, else `order_value` less tax when inclusive). It is on the **revenue basis**, the same basis as earned value, so the schedule index compares like with like (OD-CSP-3).
- **Planned value** needs a time-phased plan. The work order has `start_date` and `end_date` (0193). Task baselines (#1574) and work-order milestones (#1640) exist as plans but are not money-weighted per work order. v1 plans by calendar (OD-CSP-1).
- **The S-curve** is the project Delivery lens' cumulative percentage curve built from phases and tasks (`pmo-portal/src/lib/delivery/sCurve.ts`, rendered by `ProjectSCurve` (`pmo-portal/pages/project-detail/ProjectSCurve.tsx`, placed in `ProjectSections.tsx`)). Its math is **not changed**; the indices appear beside it and on the work-order page's plan-versus-actual section (`pmo-portal/pages/work-order-detail/PlanVsActualSection.tsx`).
- Not the same as **Left to bill** or **Remaining work** (glossary): those are invoice and recognition quantities; earned value here is validated field progress at contract rate, before invoicing.
- No ERP write, no outbox row, no mirror change.

## Definitions (used by the acceptance criteria)

All money is exact decimal, excludes tax, in the work order's currency; ratios use integer cents.

- **As-of date** = today in the organisation's timezone (`default_timezone`, `org_current_month`, 0245) unless a date is supplied; never browser time.
- **EV** (earned value to date) = sum of `frozen_amount` over validated, live progress lines of reports with `work_date <= as-of`. **Unrated lines** = validated lines with no `frozen_amount`; their count is reported and EV is flagged **incomplete** while any exist.
- **PV** (planned value to date) = BAC x planned fraction. Planned fraction = elapsed days from `start_date` through `min(as-of, end_date)`, inclusive, over total days `start_date` through `end_date`, inclusive; 0 before `start_date`; 1 on and after `end_date`. Undefined when either date is missing, or `end_date < start_date`.
- **AC** (actual cost to date) = sum of the work order's direct cost lines (`work_order_cost_amounts`) in the work order's currency with `occurred_on <= as-of`. Shared (unattributed) cost is not allocated here (OD-CSP-4). A cost in another currency is listed apart and makes AC **not comparable**; an unreadable line makes it **restricted**.
- **CPI** = EV / AC; **SPI** = EV / PV. Rounded half up to two decimals, from exact integers. Undefined when the denominator is 0, when EV is incomplete, or when AC is restricted or not comparable.
- **Cost variance** = EV - AC; **schedule variance** = EV - PV; shown as money with the sign in text ("under budget by", "behind plan by").
- **Project figures** = sums of EV, PV and AC over the project's work orders in status `Issued` or `Closed` whose own figures are complete, then the same ratios; never the average of the work orders' indices. Draft and Cancelled work orders are excluded and counted.
- **Reading** (display bands, thresholds in OD-CSP-5): index below 0.90 "behind / over cost", 0.90 to 1.10 "on track", above 1.10 "ahead / under cost".

Hand calculation (test fixture): BAC 1,000,000; `start_date` 2026-01-01, `end_date` 2026-01-10 (10 days); as-of 2026-01-04 so 4 days elapsed, planned fraction 0.4, PV 400,000. Validated progress: day 1 100,000, day 3 200,000, day 5 50,000 (after as-of, excluded); EV = 300,000. Direct cost to as-of: 150,000 + 100,000 = 250,000 = AC. SPI = 300,000 / 400,000 = **0.75**; CPI = 300,000 / 250,000 = **1.20**; schedule variance -100,000; cost variance +50,000.

## Requirements (EARS)

**Figures**
- FR-CSP-001 The system shall show, per work order, EV, PV, AC, CPI, SPI, cost variance and schedule variance as of a date, using the Definitions above.
- FR-CSP-002 The system shall show the same figures per project over its `Issued` and `Closed` work orders, as the ratio of sums.
- FR-CSP-003 EV shall come only from validated, non-superseded, non-archived daily-site-report progress at the frozen contract rate; draft, submitted and returned reports shall add nothing.
- FR-CSP-004 EV, PV and AC shall be computed from exact decimals in the database; the browser shall not recompute them from raw rows; the indices shall be rounded only for display.
- FR-CSP-005 When EV is incomplete because of unrated lines, the system shall show no index, state how many unrated lines, and link to them.
- FR-CSP-006 When PV is undefined (no start or end date), the system shall show no SPI and name the missing date; CPI shall still show.
- FR-CSP-007 When AC is 0, the system shall show no CPI and say "no cost recorded yet"; it shall never show infinity or 0.
- FR-CSP-008 When cost is in another currency or its money is unreadable to the caller, the system shall show AC as "not comparable" or "restricted", the same as plan-versus-actual (FR-WPVA-013/014), and no CPI.
- FR-CSP-009 For a `Closed` work order the system shall use its closing value as BAC and the as-of date capped at its `end_date`; for a `Cancelled` one it shall show nothing and say why.

**Presentation**
- FR-CSP-010 The project page shall show the project's CPI and SPI beside the S-curve and name the basis (validated progress at contract rate; calendar plan) in one line; the S-curve itself shall not change.
- FR-CSP-011 The work-order page shall show its figures in the plan-versus-actual section, with a drill-down to the validated reports, the cost lines and the planned fraction's two dates behind each figure (FR-WPVA-041 pattern).
- FR-CSP-012 Every index shall state in text what it means ("behind plan", "over cost"), not by colour alone, and shall show the as-of date.
- FR-CSP-013 The system shall hide an uncomputable figure with its reason in one line, never as 0 (`docs/ux/screen-rules.md`).

**Access**
- FR-CSP-014 The read shall be refused by the database to any caller who may not see both revenue on the project (the daily site report's `dsr_may_see_revenue`) and cost (Admin, Executive, Finance, the project's Project Manager). The route and panel are gated by `can()` (UX only).
- FR-CSP-015 `org_id` is never sent by the client; another organisation's rows are never returned (ADR-0017); the read adds no write and does not refresh any mirror.

## Non-functional requirements
- NFR-CSP-001 One database read returns a project's per-work-order rows and the project total as one JSON value, bounded to 500 work orders with a `truncated` flag the screen reports.
- NFR-CSP-002 English and Bahasa Indonesia strings in the existing `workOrderPva` namespace and the project namespace; `DESIGN.md` tokens; usable at phone width.
- NFR-CSP-003 Dates are organisation calendar dates computed in the database; the as-of date is shown.
- NFR-CSP-004 RLS-adjacent helpers wrapped in `(select helper())` (`supabase/tests/0646_rls_initplan.test.sql`); the migration is reversible.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-CSP-001 | Given the hand-calculation fixture, when figures are derived, then EV 300,000, PV 400,000, AC 250,000, SPI 0.75, CPI 1.20, schedule variance -100,000 and cost variance +50,000. | Unit (pure function) |
| AC-CSP-002 | Given AC of 0, when derived, then CPI is undefined and the text says no cost recorded yet; given PV undefined, then SPI is undefined and CPI still shows. | Unit |
| AC-CSP-003 | Given as-of before `start_date`, when derived, then planned fraction is 0, PV 0 and SPI undefined; given as-of after `end_date`, then planned fraction is 1. | Unit |
| AC-CSP-004 | Given EV 1 cent and AC 3 cents, when rounded, then CPI 0.33 by integer half-up arithmetic, identical to a float-free reference. | Unit |
| AC-CSP-005 | Given a project of two work orders with CPI 2.00 and 0.50 and unequal sizes, when the project figure is derived, then it is the ratio of sums, not 1.25. | Unit |
| AC-CSP-006 | Given reports in draft, submitted, returned and validated status plus a superseded validated one, when EV is read, then only the live validated one counts. | pgTAP |
| AC-CSP-007 | Given a validated line dated after the as-of date, when EV is read, then it is excluded; on the as-of date, included. | pgTAP |
| AC-CSP-008 | Given a validated line with no rate, when read, then EV is flagged incomplete with a count of 1 and no index is returned. | pgTAP |
| AC-CSP-009 | Given the fixture seeded as reports, rate-catalogue rates and cost lines, when the read runs, then its figures equal AC-CSP-001 and its AC equals the plan-versus-actual row for the work order. | pgTAP |
| AC-CSP-010 | Given a cost in a second currency, when read, then AC is "not comparable" and no CPI; given a line the caller may not read, then AC is "restricted". | pgTAP |
| AC-CSP-011 | Given a Closed work order with a stamped closing value, when read, then BAC is the closing value and PV uses `end_date`; given Draft or Cancelled, then no figures. | pgTAP |
| AC-CSP-012 | Given a work date on the last day of a month in a timezone ahead of UTC, when the read runs, then it falls in that organisation-local day. | pgTAP |
| AC-CSP-013 | Given a caller who is an Engineer, a Viewer, another project's Project Manager, or an offboarded account, when the read runs, then it is refused with insufficient privilege and returns no row. | pgTAP (+ mutation check) |
| AC-CSP-014 | Given a caller in another organisation, then none of the first organisation's work orders appear. | pgTAP |
| AC-CSP-015 | Given more than the row bound, when read, then `truncated` is true and the screen reports it. | pgTAP (server flag) + Unit render |
| AC-CSP-016 | Given a Finance user and a project with validated progress and cost, when they open the project page, then CPI and SPI show beside the S-curve with the as-of date and the basis line, and a work order's row opens its page with the same figures. | E2E (one journey, owner-sketch-approved layout) |

Mutation check: in the read, include `submitted` reports in EV and AC-CSP-006 must go red; drop the as-of bound and AC-CSP-007 must go red; remove the role gate and AC-CSP-013 must go red; replace the ratio of sums with an average and AC-CSP-005 must go red; restore.

## Errors
| Condition | Result |
|---|---|
| Role not allowed, or not an active member | Database refusal; panel hidden for that role |
| Read fails or returns a malformed figure | Shared error state with retry; never a plausible zero |
| No validated progress yet | EV 0 and CPI 0.00 are real figures only when cost exists; with neither, the panel says nothing is recorded yet |
| Work order has no dates | SPI hidden with the missing date named |
| Unrated validated lines | Indices hidden, count and link shown |
| Cost in another currency, or unreadable | AC "not comparable" or "restricted"; no CPI |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-CSP-1 | Planned value is **linear by calendar** between the work order's start and end dates over BAC. | Work that is front- or back-loaded reads as slipping or ahead by the curve's shape alone; the answer is a weighted plan (baseline tasks, #1574, or milestone weights), which needs its own money-weighted plan and is a later spec. |
| OD-CSP-2 | EV is date-bounded by report `work_date` through a new read; the shipped undated `work_order_validated_revenue` is untouched. | Using the undated function makes EV ignore the as-of date, so SPI changes only when a report is validated, not when time passes. |
| OD-CSP-3 | EV and PV are on the **revenue basis** (contract rate), AC on cost. CPI is then a margin-style ratio, not a pure cost-efficiency index. | If the owner wants CPI against budgeted cost, the plan figure `direct_budget` (0997) is the base instead and a work order without one has no CPI; the two bases give different numbers for the same work. |
| OD-CSP-4 | AC counts **direct** cost only; allocated shared cost is not included. A toggle for the allocated figure is a follow-up. | Excluding shared cost flatters CPI on a work order that draws heavily on shared resources; including it makes the figure depend on the split setting (FR-WPVA-022). |
| OD-CSP-5 | Bands at 0.90 and 1.10 in text; no traffic-light colour alone. | Thresholds nobody uses make every work order read "on track" or "behind". |
| OD-CSP-6 | Project figure = ratio of sums over `Issued` and `Closed` work orders with complete figures; the count of excluded work orders is shown. | Averaging indices lets a tiny work order outweigh a large one; including incomplete ones hides an unknown inside a number. |
| OQ-CSP-1 | Should the indices be as-of any past date (a date picker) or only today? Default today plus an as-of parameter for the monthly pack. | A month-end review cannot reproduce last month's numbers. |
| OQ-CSP-2 | Does the owner want a trend (index per week) next to the curve? Default no in v1. | Management sees only a point, not a direction. |
| OQ-CSP-3 | Bahasa Indonesia wording for the two indices (default "Indeks kinerja biaya" and "Indeks kinerja jadwal"). | Terms the finance team does not use. |

## Delivery checklist
- [ ] Owner signs OD-CSP-1..6 and answers OQ-CSP-1..3.
- [ ] Owner sketch-glance of the panel before build.
- [ ] Glossary entries: earned value, planned value, cost performance index, schedule performance index (with the build).
- [ ] After release: `improve-codebase-architecture` on the changed areas.
