# Budget split from the CLI and loader (#1423 remainder)

Status: Draft for owner sign-off. Date: 2026-11-15. Issue: #1423 (under map #1442).
Requirement IDs are local to this spec; tests prefix titles with `budget-split-cli AC-###`.

## Problem and job story

The app already lets a project manager enter one total per category, review a proposed split by project
days, edit it, and save it (#1472, `docs/specs/budget-whole-project.spec.md`). The CLI and the starting-data
loader (`pmo load`) cannot: they create per-year Draft lines only, and refuse a whole-project Draft. An
operator seeding a multi-year client must hand-phase one line per category per year, outside the app.

**Job story:** When I load a multi-year project's budget from a file, I want to give one total per category
and choose how it spreads over the years, with a dry-run that prints the year × category grid, so the
Draft arrives ready for review and activation in the app, with no hand-phasing and no invented allocation.

## What exists today (verified on `origin/dev`, 2026-11-15)

- Delivered in the app (#1472): whole-project mode, three methods (`by_days`, `percent_by_year`,
  `amount_by_year`), category overrides, exact-money allocation in `pmo-portal/src/lib/budget/budgetDistribution.ts`
  (`byDays`, `fromPercents`, `fromAmounts`, `yearsInSpan`) and `savedDistribution.ts` (`planFor`), persisted by
  RPC `save_budget_distribution(p_version, p_method, p_inputs, p_basis, p_rows, p_category_overrides)`
  (migration 0577; Draft-only, role- and org-checked).
- The server-resolved fiscal calendar is available to callers through the `external-items` function,
  purpose `budget-project-calendar` (`pmo-portal/src/lib/repositories/budgetProjection.ts`). The CLI already
  calls `external-items` for `budget-accounts`.
- `pmo load` (`scripts/lib/pmo-load.mjs`) fixes `LOAD_BUDGET_MODE = 'per_year'`, takes lines with an optional
  `fiscal_year`, and **skips** a project whose Draft is whole-project (`resolveBudget`). `pmo load --dry-run`
  prints a plan but no split.
- `pmo budgets activate` is refused in the CLI by design (`ACTIVATION_ENABLED`); this spec does not change that.
- The ticket's remaining ask (owner verification comment, 2026-11-13): "the CLI and import path has no split
  option (by duration or percentages) with a dry-run grid." Nothing else from #1423 is open.

## What is new

A split option on the loader and on one new command, reusing the shipped pure functions and the shipped
save RPC. No schema change, no new RPC, no new write path: every write is an existing RLS/RPC-governed one.

## Functional requirements (EARS)

| ID | Requirement |
|---|---|
| FR-001 | Where a loader file project sets `budget_mode: "whole_project"`, the system shall create the Draft in whole-project mode and accept budget lines as category totals with no `fiscal_year`. |
| FR-002 | Where a whole-project project entry sets `budget_split`, the system shall accept `{ "method": "by_duration" }`, `{ "method": "percent", "years": { "<fiscal year>": "<n>", … } }` or `{ "method": "amount", "years": { … } }`, and an optional per-category `overrides` map of the same shape. When `budget_split` is omitted the method shall be by duration. |
| FR-003 | When the loader plans a whole-project budget, the system shall compute the year × category grid with the shipped `budgetDistribution`/`planFor` functions from the project's start and end dates and the fiscal calendar, and shall print it in dry-run and apply output. A project with no end date covers only its start fiscal year (owner resolution 2026-10-29). |
| FR-004 | When the split is invalid (percentages not summing to 100, an amount override not equal to its category total, a negative or non-finite value, a year outside the project span, an incomplete year row), the system shall name the project, category and year, refuse that project's budget, and write nothing for it. An explicit zero year shall remain valid. |
| FR-005 | When the fiscal calendar cannot be resolved (outage, unmapped project dates), the system shall refuse that project's split with the reason and shall not fall back to calendar years. |
| FR-006 | When apply runs, the system shall save the split through `save_budget_distribution` after the lines exist, using the same plan rows the grid printed. |
| FR-007 | `pmo budgets split <version_id> [--split by-duration \| --percent <FY>=<n>,… \| --amount <FY>=<n>,…] [--category <name> …] [--dry-run]` shall do the same for an existing whole-project Draft, from the version's saved category totals, and shall print the grid before writing. |
| FR-008 | While a dry-run is requested, the system shall write nothing and shall print, for each project, the method, the fiscal years, each category's yearly amounts and their sum equal to the category total. |
| FR-009 | When re-run on a Draft whose saved split already equals the planned one, the system shall report "unchanged" and write nothing; when the saved split differs, `pmo load` shall refuse to overwrite it and point to `pmo budgets split`. |
| FR-010 | While a version is Active or Archived, or the project is per-year, the system shall refuse the split with the existing server message and shall not change mode. A loader file mixing `fiscal_year` on lines with `budget_mode: "whole_project"` shall be rejected at validation. |
| FR-011 | The system shall not activate a budget, push to an ERP, or alter any existing per-year file's behaviour; a file without `budget_mode` loads exactly as today. |

## Non-functional requirements

- **NFR-001 Money:** every printed and saved amount reconciles to the entered total to the minor unit (existing
  exact-decimal convention; no float summation). Output of one input is identical on every run.
- **NFR-002 Authority:** the CLI is a client of the same RPCs; roles, org scope, Draft-only and editor
  attribution stay server-enforced (ADR-0016/0019). Nothing here widens `LOAD_RPCS`/`ALLOWED_RPCS` beyond
  `save_budget_distribution`.
- **NFR-003 Parity:** one allocation implementation. The CLI imports the shipped `budgetDistribution`/`planFor`
  code (or a tested `.mjs` re-export); it must not re-implement the rounding rule.
- **NFR-004 Public hygiene:** examples and fixtures use invented names and amounts only.

## Acceptance criteria

| ID | Given / When / Then | Owning layer |
|---|---|---|
| AC-001 | Given a file project in whole-project mode with 3 category totals and by-duration over 2027-07-01…2029-06-30, when `pmo load --dry-run` runs, then the grid has 2 or 3 fiscal years per the calendar, each category's row sums to its total, and nothing is written. | unit (`scripts/lib/pmo-load.split.test.mjs`) |
| AC-002 | Given a leap-day span and a non-calendar fiscal year, when by-duration is planned, then amounts equal `byDays` output exactly (parity with the app). | unit |
| AC-003 | Given percent 0/40/60, when planned, then yearly amounts are 0/40%/60% of each total and the zero year is kept in the saved rows. | unit |
| AC-004 | Given percent not summing to 100, a year outside the span, a negative value, an amount override not equal to the category total, then the project is refused with project, category and year named and no write is attempted. | unit |
| AC-005 | Given a category override alongside a budget-wide split, then the category follows its override and others inherit; each reconciles independently. | unit |
| AC-006 | Given the calendar function returns unavailable, then the project's split is refused with the reason and no calendar-year guess is used. | unit |
| AC-007 | Given apply, then lines are created without `fiscal_year` in a whole-project Draft and `save_budget_distribution` is called once with the printed rows. | unit (mocked api) |
| AC-008 | Given a second run with identical input, then output says unchanged and no write is issued; given a differing saved split, `load` refuses and names `pmo budgets split`. | unit |
| AC-009 | Given `pmo budgets split <id> --percent …` on a whole-project Draft, then the grid prints and, on apply, the saved snapshot equals it; on a per-year or Active version it is refused. | unit + pgTAP existing |
| AC-010 | Given a file without `budget_mode`, then plan and apply are byte-identical to today (regression). | unit (existing load tests stay green) |
| AC-011 | Given an operator session, when a whole-project file is applied against local Supabase and the project opened in the app, then the Draft shows the same grid as the dry-run and is ready to activate. | e2e (one curated journey) |
| AC-012 | Given the grants, then `save_budget_distribution` is reachable by the operator roles that can already edit the Draft and refused for others and other orgs. | pgTAP (existing `budget_whole_project_roles` coverage cited; no new file unless a gap is found) |

## Out of scope

Activation from the CLI; ERP push changes; the app import wizard (spreadsheet rows stay per-year lines; the
app grid already splits whole-project Drafts); month-by-month spread; converting existing per-year budgets;
schedule-based or category-pattern splits; any migration.

## Open questions

Three one-line owner questions are listed at the end of the plan.
