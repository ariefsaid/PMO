# Whole-project category budgets and yearly distribution

Status: Draft for review; captures the decision on #1444, with #1423 and #1425 context.
Date: 2026-10-28. This document specifies future behavior; it does not claim implementation.
Requirement IDs are local to this spec; tests must prefix titles with `budget-whole-project AC-###`.

## Problem and job story

When a project spans several fiscal years, its project manager needs to enter each category's
approved total once, choose its timing, and compare that total with recorded spending across
the project. Repeating each category for each year makes the approval total harder to enter and
check. A yearly ERP enforcement limit is also a different business decision from a limit for
the whole contract.

**Job story:** When preparing a multi-year project budget, I want to approve one total per
category and review its yearly distribution, so that ERP enforces the whole-project amount and
I can inspect both whole-project and yearly budget consumption without adding years myself.

## Deciding artifacts and prior art

The following is the owner's decision **verbatim**, from
[#1444, decision comment](https://github.com/ariefsaid/PMO/issues/1444#issuecomment-6468900367):

> **Owner decision (2026-10-28):**
> 1. A project budget is entered **per category for the whole project** by default; budgeting **per year** stays available when needed (e.g. annual approval). PMO sends ERPNext v16 one Budget per account spanning the project's first to last fiscal year (`from_fiscal_year`/`to_fiscal_year`), so the ERP limit is the whole-project total.
> 2. The user picks how the total spreads over time: **evenly across the project's days** (default), **% per year**, or **amount per year**; one choice for the whole budget, overridable per category. A 0% / zero year is valid when the user sets it.
> 3. PMO sends a **yearly** distribution (one figure per year) computed from that choice — no month-by-month spread.
> 4. Existing per-year budgets are not converted automatically. A project moves by activating a **new version** in whole-project mode; the old per-year ERP budgets are cancelled through the archive-cancellation path (#1460).
>
> Supersedes the per-line hand-phasing in #1423.

The owner additionally confirms the ERP range capability in the
[#1423 comment](https://github.com/ariefsaid/PMO/issues/1423#issuecomment-6468947167).
[#1425](https://github.com/ariefsaid/PMO/issues/1425) requests the whole-project category
comparison and the `All years (project to date)` selector; that issue has no owner decision
comment at specification time. Its comparison scope is included here as requested context;
it does not change #1444's approved budget authority.

Read-only discovery ran `scripts/prior-art.sh` for `budget`, `distribution`, `whole-project`,
and `fiscal-year`. Relevant rulings and their treatment:

- `docs/decisions.md` **OD-BUDGET-1**: Active-version line amounts remain the budget authority.
  Yearly distributions partition those amounts; they are not additional budget lines to add again.
- `docs/specs/budget-fiscal-year-phasing.spec.md` **FR-BFY-010/030** and
  `docs/adr/0055-external-system-adapters-sot-enhancement.md` §6 describe per-year phasing/push.
  #1444 supersedes that required grain for whole-project v16 mode only. Existing per-year mode
  retains its contract. User-selected distribution replaces #1423's proposed materialization as
  repeated phased lines; do not treat its superseded proposal as a second requirement.
- `docs/adr/0048-erpnext-headless-accounting-engine.md`: ERP remains the accounting engine;
  recorded spending remains ledger-sourced. A user-reviewed budget distribution is a plan,
  never a fabricated accounting actual.
- `docs/adr/0087-budget-v16-account-units.md` (marked proposed): account-qualified v16 units
  inform the existing code. Whole-project units must additionally distinguish their fiscal-year
  range from legacy single-year units; legacy identities stay compatible.
- `docs/adr/0010-test-strategy-pyramid.md`, ADR-0016/0017/0019: lowest-sufficient test ownership,
  repository seam, real-role UX permission checks and server enforcement remain binding.
- [#1460](https://github.com/ariefsaid/PMO/pull/1460) and migrations `0387`/`0388` provide
  archive cancellation and lifecycle fencing. Reuse their durable cancellation workflow.

These are references to existing repository artifacts, not a new ADR or authority change.

## Vocabulary and calculation contract

- **Budget mode:** `whole_project` or `per_year`, persisted per budget version. The mode is
  independent of distribution method. Whole-project mode defaults only for new budgets;
  historical records remain per-year, and clones preserve their source mode until explicitly changed.
- **Category total:** sum of the version's source line amounts for that category, counted once.
  Existing descriptions/details may remain; users do not need a line per category-year.
- **Distribution:** a budget-wide method (`by_days`, `percent_by_year`, `amount_by_year`)
  with category overrides. An inherited percentage vector applies to every inheriting category;
  an amount vector is denominated in the category's own total and must validate for each category.
  Categories with different totals can use overrides. Method, inputs and resolved figures are
  persisted; recalculation must not silently overwrite explicit entries.
- **Year:** the organisation's actual ERP fiscal-year name and dates, not a calendar-year guess.
  The range includes every fiscal year intersecting the project date span, in date order.
- **By-days proposal:** inclusive civil dates at both ends; weight for a year is the number of
  days in the intersection of the project and that fiscal year divided by total project days.
  Leap days and partial years count as real days, independent of browser timezone.
- **Exact totals:** use the existing currency precision/exact money convention, not binary float
  summation. For calculated splits, floor to currency minor units and distribute remaining units
  by largest fractional remainder, ties by fiscal-year start date then name. This deterministic
  proposal preserves the total exactly. Explicit amount rows must sum exactly; invalid inputs
  are not silently repaired. Percentage rows sum to 100 before monetary rounding; a zero entry
  remains zero and is excluded from remainder allocation.
- **Whole-project comparison:** the Active category total versus the project's ledger-derived
  recorded spending to date across fiscal years, including attributed spending under the existing
  mapping rules. Do not sum overlapping snapshots or add ERP amounts to PMO budget amounts.
  It is not estimate-to-complete (ETC) or estimate-at-completion (EAC).

The day-boundary and remainder rules above are proposed deterministic implementation conventions,
not additional quotations from the owner. Open product choices are listed below.

## Functional requirements (EARS)

| ID | Requirement |
|---|---|
| FR-001 | When a user creates a new budget, the system shall default to whole-project mode and accept a category total without requiring a fiscal year on each source line. |
| FR-002 | When a user selects per-year mode, the system shall retain explicit annual approval totals and the existing per-year push behavior. |
| FR-003 | While a whole-project version is Draft, the system shall offer by-days distribution by default and percentage-per-year and amount-per-year alternatives, with a budget-wide choice and category overrides. |
| FR-004 | When a distribution is previewed, the system shall show category totals and a fiscal-year × category grid, with each category's yearly sum equal to its total and a visible inherited/overridden method. |
| FR-005 | When by-days distribution is selected, the system shall compute the yearly figures using the civil-day intersections and deterministic rounding contract above. |
| FR-006 | When explicit percentages or amounts are entered, the system shall preserve intentional zero years, reject negative/non-finite values and out-of-range years, and require complete in-range rows whose percentages sum to 100 or whose amounts equal the category total. |
| FR-007 | While a distribution or date span is invalid or unresolved, when activation is requested, the system shall present actionable readiness findings and prevent confirmation of definite invalid input; an ERP outage shall remain informational under the existing activation-readiness contract, with unresolved calendar validation repeated before push. |
| FR-008 | When distribution changes are saved, the system shall persist the method, category overrides, explicit inputs, resolved yearly amounts and date/calendar basis atomically for the Draft version, and record the human editor for the existing activation rules. |
| FR-009 | While a version is Active or Archived, the system shall prevent changes to its budget mode, source amounts and approved distribution; revisions shall use a new Draft version. |
| FR-010 | When a whole-project version is activated for ERPNext v16, the system shall send one Budget per mapped account with its whole-project amount, first and last fiscal-year references, and an explicit yearly distribution aggregated from its mapped categories. |
| FR-011 | When a v16 whole-project body is built, the system shall select yearly distribution rather than monthly auto-distribution, preserve explicit zero-year entries, reconcile the yearly amounts with the account header total, and retain the organisation's existing overspend-control choices. |
| FR-012 | When a whole-project push is dispatched, retried, reconciled or observed inbound, the system shall use a consistent account-and-range unit identity and generation-fenced outbox/mirror lifecycle, without treating a legacy single-year document as a whole-range document. |
| FR-013 | When a new whole-project version replaces existing per-year budgets, the system shall archive the predecessor and record cancellation of its exact ERP targets through the archive-cancellation path, preserving visible pending/failed cancellation state and recovery until settled. |
| FR-014 | When the feature is introduced, the system shall leave existing annual versions, line phasing, ERP references and amounts unchanged; only explicit creation and activation of a whole-project successor shall transition a project. |
| FR-015 | When the user opens Forecast for a multi-year project, the system shall default to `All years (project to date)` and offer individual fiscal years alongside it; single-year projects shall retain their existing default. |
| FR-016 | While All years is selected, the system shall show each category's Active total budget, recorded spending, remaining/over amount and percent used without requiring a successful ERP budget push to establish PMO's own approved total. |
| FR-017 | When the user selects a fiscal year, the system shall compare that year's approved distribution (or legacy phased total) with that year's ledger-derived recorded spending, without changing the whole-project ERP enforcement limit. |
| FR-018 | While a comparison input is unavailable, the system shall preserve the existing unknown-value/provenance contract instead of converting it to zero; percent used on a zero budget shall be unavailable, while a known zero distribution shall remain distinct from absent attribution. |
| FR-019 | When a new version is cloned, the system shall copy mode and distribution configuration with its source amounts into a Draft; a switch of mode shall require explicit preview and validation before activation. |
| FR-020 | When any supported write entry point saves or activates a version, the system shall apply the same server-side mode, totals, Draft-only and activation rules; unsupported entry points shall explicitly refuse rather than silently create a different budget interpretation. |
| FR-021 | While an ERP binding lacks whole-project range/yearly-distribution support, when a whole-project push is requested, the system shall report the incompatibility without silently splitting the enforcement total into annual budgets or changing existing v15 behavior. |
| FR-022 | When project dates or fiscal-calendar coverage differ from the saved distribution basis, the system shall identify the stale plan and require a validated Draft revision before pushing a changed span; it shall not mutate an Active plan during a read or retry. |

## Non-functional requirements

- **NFR-001 — Money correctness:** category, year, account and header sums must reconcile exactly
  at supported currency precision. Distribution must be deterministic across browser/server/retry.
  Budget source totals must never count both source lines and derived yearly rows.
- **NFR-002 — Access and tenancy:** preserve real-role authorization, organisation isolation,
  Draft-only writes, editor attribution and current activation policy for all new fields/rows.
  The server stamps organisation scope; callers do not choose it.
- **NFR-003 — Compatibility and durability:** existing per-year and v15 fixtures remain valid.
  A foreground failure and sweep retry must reuse the same unit, preserve predecessor cancellation
  intent and show partial account/cancellation outcomes honestly.
- **NFR-004 — Presentation:** use existing form primitives and DESIGN.md tokens; controls and grid
  have keyboard access, labels and English/Indonesian copy. Loading/error/empty states retain meaning.
- **NFR-005 — Bounded reads:** distribution calculation is O(categories × fiscal years); comparison
  aggregates on the server using the current complete snapshot generation. No per-cell remote calls,
  default API row-limit truncation or browser summation of paginated raw ledger rows.
- **NFR-006 — Verification:** changed-code coverage is at least 80%; deterministic money/date
  tests, targeted database contracts, and one curated cross-stack journey own the ACs below.
  Actual ERP yearly-body acceptance requires an isolated integration rehearsal before release;
  a mocked body assertion alone cannot prove ERP applies the intended limit.

## Acceptance criteria and canonical owning layers

Each row is one canonical acceptance scenario; test titles include its AC identifier and spec slug.
Test paths listed below are proposed additions or extensions, not claims that tests exist today.

| ID | Given / When / Then | Owning layer and planned proof |
|---|---|---|
| AC-001 | Given a new budget, when the user enters category totals, then whole-project and by-days are selected and no source-line fiscal year is required. | unit — `pmo-portal/pages/ProjectBudget.test.tsx` |
| AC-002 | Given a span from 2027-12-31 through 2028-01-02 and calendar-aligned fiscal years, when a category total of 300 minor units is distributed by days, then the grid contains 100 and 200 and totals 300. | unit — new `pmo-portal/src/lib/budget/budgetDistribution.test.ts` |
| AC-003 | Given a leap day, a single-day project, non-calendar fiscal years and a rounding tie, when by-days is computed, then civil-day weights and stable remainder allocation follow the stated contract in each case. | unit — new `pmo-portal/src/lib/budget/budgetDistribution.test.ts` |
| AC-004 | Given three in-range years and a category total of 1000 minor units, when percentages 0/40/60 are selected, then yearly amounts are 0/400/600 and zero survives save/body construction. | unit — new `pmo-portal/src/lib/budget/budgetDistribution.test.ts` |
| AC-005 | Given two categories with different totals, when the budget-wide method is set and one category overridden, then each inherits or overrides as shown and each reconciles independently; an inherited amount vector that does not fit a category is rejected. | unit — `pmo-portal/pages/ProjectBudget.test.tsx` |
| AC-006 | Given incomplete years, an out-of-span year, negative/non-finite input, percentages not totaling 100 or amounts not totaling the category, when preview/activation is requested, then the relevant field is identified and definite invalid input blocks activation without changing totals. | unit — `pmo-portal/pages/ProjectBudget.test.tsx` |
| AC-007 | Given a Draft with source lines and distribution, when it is saved and cloned, then reload and clone preserve mode, inputs, totals, override inheritance and date basis atomically without duplicating the budget. | pgTAP — new `supabase/tests/budget_whole_project_storage.test.sql` |
| AC-008 | Given disallowed roles, another organisation, Active/Archived versions, recorded editors, a distinct eligible activator and the existing sole-operator case, when new-field writes or activation are attempted, then server results preserve current role/org/Draft/activation contracts. | pgTAP — new `supabase/tests/budget_whole_project_roles.test.sql` |
| AC-009 | Given two years and categories mapping to an account, when a whole-project v16 body is built, then exactly one account body has the whole total, different first/last fiscal years and matching explicit yearly entries, with no monthly auto-distribution. | unit — `pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.v16.test.ts` |
| AC-010 | Given a whole-project range unit and an interrupted push, when retries and reconciliation run, then they preserve its range/account identity and do not adopt a legacy annual unit or mint a duplicate. | unit — `supabase/functions/adapter-dispatch/budgetV16Replay.test.ts` (Deno unit) |
| AC-011 | Given legacy annual versions, when the schema is upgraded and those versions read/retried, then their mode, approved totals, fiscal years and unit identities remain unchanged. | pgTAP — new `supabase/tests/budget_whole_project_compatibility.test.sql` |
| AC-012 | Given a per-year Active predecessor with ERP targets, when a whole-project successor is activated, then exact predecessor targets enter the existing cancellation workflow and a failed cancellation stays recoverable and visible rather than being reported as complete. | pgTAP — `supabase/tests/budget_archive_cancel_intents.test.sql` |
| AC-013 | Given a multi-year project, when Forecast opens and the user switches between All years and a year, then All years is the default and the selected scope is clearly labelled. | unit — `pmo-portal/pages/BudgetProjection.test.tsx` |
| AC-014 | Given Active category totals and ledger readings across years in the current snapshot, when All years is queried, then totals count each source amount and recorded cost once and remaining/percent reflect recorded spending rather than EAC. | pgTAP — new `supabase/tests/budget_whole_project_comparison.test.sql` |
| AC-015 | Given explicit zero, absent budget, missing ledger reading and unmapped category cases, when comparison renders, then zero and unknown stay distinct, provenance is visible, and unavailable/zero denominators never yield an invented percentage. | unit — `pmo-portal/pages/BudgetProjection.test.tsx` |
| AC-016 | Given a saved whole-project plan, when dates change or calendar resolution fails, then validation identifies stale/unresolved basis and retries do not silently replace the approved distribution. | unit — `pmo-portal/src/lib/budget/budgetGate.fiscalYear.test.ts` |
| AC-017 | Given a legacy v15 binding and annual version, when the legacy push runs, then its pinned body is unchanged; given whole-project mode on that binding, when push is requested, then incompatibility is explicit with no annual fallback. | unit — `pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.test.ts` |
| AC-018 | Given an annual Active predecessor and eligible independent approver, when a user prepares a whole-project Draft, previews its yearly grid and obtains activation, then real ERP v16 receives one range Budget per account with yearly distribution, predecessor cancellation settles, and Forecast displays the approved category totals against recorded spending. | e2e — new `pmo-portal/e2e/serial/AC-018-budget-whole-project.spec.ts` using isolated ERP fixture and served handlers |

AC-018's real ERP oracle must inspect the returned document's range, yearly entries, total and
predecessor cancellation state, not merely HTTP success or a success toast. Unit edge tests must
import shipped handlers under the repository binding convention. AC-008 includes direct RPC/write
attempts; UI hiding alone is not the role proof.

## Affected implementation surfaces (read from this worktree)

| Concern | Exact existing paths / tables and required consideration |
|---|---|
| Budget authoring and hooks | `pmo-portal/pages/ProjectBudget.tsx`, `pmo-portal/src/hooks/useBudget.ts`, `pmo-portal/pages/project-detail/tabs/BudgetTab.tsx`: mode, category totals, distribution grid, readiness and revision controls. |
| Data seam | `pmo-portal/src/lib/repositories/index.ts` (existing `budget` repository), `pmo-portal/src/lib/db/budgets.ts`, `pmo-portal/src/lib/supabase/database.types.ts`: typed version/distribution operations; hooks continue through repositories. |
| Forecast | `pmo-portal/pages/BudgetProjection.tsx`, `pmo-portal/src/lib/repositories/budgetProjection.ts`, `pmo-portal/src/lib/budget/budgetProjection.ts`: explicit all-years scope and recorded-spending columns distinct from ETC/EAC. |
| Calculation and readiness | `pmo-portal/src/lib/budget/budgetAmount.ts`, `pmo-portal/src/lib/budget/budgetGate.ts`, `pmo-portal/src/lib/budget/categoryAccountMap.ts`: exact-money distribution, fiscal ranges, account reconciliation. Add a shared pure `budgetDistribution.ts` beside these. |
| Body, identity, recovery | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.ts`, `pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountPlan.ts`, `pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts`, `pmo-portal/src/lib/adapterSeam/erpnext/budgetPushKey.ts`, `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts`: add whole-range grain without reinterpreting annual units. |
| Foreground and background | `supabase/functions/adapter-dispatch/index.ts`, `supabase/functions/adapter-dispatch/readModelWriters.ts`, `supabase/functions/erpnext-sweep/index.ts`, `supabase/functions/erpnext-sweep/budgetBackstop.ts`, `supabase/functions/_shared/erpnextFeedDeps.ts`: carry mode/range/distribution consistently. |
| Cancellation | `supabase/functions/erpnext-sweep/budgetArchiveBackstop.ts`, `supabase/migrations/0387_budget_archive_cancel_intents.sql`, `supabase/migrations/0388_budget_archive_lifecycle_fence.sql`: reuse existing predecessor target snapshots and recovery/fences. |
| Roles and writes | `pmo-portal/src/auth/policy.ts`, `supabase/migrations/0005_budget_mutation_rpc.sql`, `supabase/migrations/0280_budget_version_editors.sql`, `supabase/migrations/0298_budget_sole_operator_activation.sql`: preserve server policy and apply it to distribution edits. |
| Projection SQL | `supabase/migrations/0293_budget_v16_accounts.sql` defines the account mirror/status/projection shape; `supabase/migrations/0376_cost_attribution.sql` defines `project_mapped_actuals` with nullable fiscal-year scope and attributed costs. Extend through new migrations, not edits to shipped migrations. |
| Other write consumers | `pmo-portal/src/lib/import/budgetDescriptor.ts`, `scripts/pmo.mjs`: legacy imports retain annual meaning; explicitly support or refuse new mode. The CLI's existing activation refusal does not authorize enabling it in this feature. |

Current tables involved: `projects`, `budget_versions`, `budget_line_items`,
`budget_version_editors`, `budget_category_account_map`, `budget_projections`,
`budget_version_erp_mirror`, `budget_version_account_erp_mirror`, `external_command_outbox`,
`external_refs`, `budget_archive_requests`, `budget_archive_cancel_intents`, and
`erp_actuals_snapshot`. Existing RPCs include `activate_budget_version`, `budget_activation_mode`,
`clone_budget_version`, `get_project_budget`, `get_budget_projection`, `list_budget_fiscal_years`,
`get_budget_push_status`, `project_mapped_actuals`, and `archive_budget_version_with_cancel_intent`.
Read the current definitions again at implementation time; this inventory is not a cloud-schema audit.

## Migration and authorization contract

New reversible migrations are required. Persist version mode with an explicit historical backfill
of `per_year`; new-budget creation chooses `whole_project` explicitly rather than retroactively
reinterpreting NULL fiscal-year lines. Persist budget/category distribution configuration and
resolved category-year rows (proposed new table `budget_year_distributions`) without placing
those derived rows in `budget_line_items`. Include version/category/year uniqueness, exact numeric
amounts, date/calendar witnesses and transactional validation. The plan must settle the physical
schema and next free migration numbers; no migration number is reserved here.

Extend range-aware account mirror/outbox identities and read RPCs, preserving annual pointers and
reverse-reference uniqueness. Persist range endpoints explicitly; do not hide a range in a field
whose consumers still assume a single year. Extend clone/editor-history and cancellation
integration in the same design. Rollback may restore the old shape only when no whole-project
records or unsettled range commands would be lost; otherwise refuse with a safe prerequisite.
Do not down-convert an approved range into annual documents as a rollback side effect.

New distribution rows require RLS, `org_id` stamping and parent-version/project scope checks.
Authoring roles remain Admin, Executive, Project Manager and Finance under the existing
`budgetLine` permissions; use `can()`/the existing server-backed activation mode for affordances.
The server owns activation and preserves drafter/editor separation plus the existing sole-operator
exception (`activation_basis`); new edits count as authorship. Follow ADR-0016/0019 and current
RPC role checks rather than adding an independent frontend permission interpretation. Machine-only
mirror/cancellation writes remain on their established service paths. Authenticated direct writes
must not bypass the same Draft, scope, total and lifecycle validation that UI writes use.

## Errors and operational states

| Condition | Required result |
|---|---|
| Totals, percentages, years or dates invalid | Show affected category/year and required correction; preserve entered values; do not confirm invalid activation. |
| Fiscal calendar unavailable | Distinguish external outage from definite invalid input; retain PMO activation semantics and show pending/refused push honestly. |
| Calendar/date basis changed | Explain that a revised distribution is needed; retain approved historical plan. |
| Account mapping unresolved | Use existing readiness/mapping correction flow; do not omit the category from the ERP total. |
| Partial account push / predecessor cancellation failure | Show each unresolved outcome and retry/recovery state; do not announce completed migration. |
| Unknown recorded spending | Keep unavailable/provenance presentation; never show fabricated zero remaining/usage. |
| Unsupported ERP capability | Explain unsupported whole-project push; offer explicit mode choice only on a Draft. |

## Implementation checklist for the subsequent plan

- [ ] Resolve the open choices below and validate the actual v16 yearly child-row field contract
  using an isolated schema/body rehearsal before freezing payload field names.
- [ ] Design additive mode/distribution/range migration, rollback, clone and editor attribution;
  trace each AC to one owning test and preserve legacy fixtures.
- [ ] Build shared exact-money/calendar distribution and readiness rules, then authoring/repository UI.
- [ ] Update dispatch, body, mirror, identity, sweep/feed and predecessor cancellation as one
  coherent money-path change with generation/retry tests.
- [ ] Add server all-years comparison and scope selection without folding ETC into recorded spending.
- [ ] Run applicable targeted gates and isolated ERP journey; obtain spec sign-off before build.

## Out of scope

Automatic conversion of historical annual budgets; monthly distribution; mandatory per-line hand
phasing; schedule-derived or category-pattern allocation; changes to currency/FX, tax, account-map
history or spending attribution policy; creating an accounting ledger; enabling CLI activation;
AI document extraction/import redesign; production data changes or deployment. This docs-only task
runs no DB or browser and does not implement or validate runtime behavior.

## Owner resolutions (2026-10-29)

These close the open questions raised while drafting; they override any proposal above that conflicts.

1. **No project end date:** a project without an end date gets a whole-project budget covering **only its start fiscal year** (a one-year project by default). PMO sends ERPNext one Budget per account for that single year.
2. **Budget-wide amount per year:** the per-year amounts are converted to percentages of their total, and every category without its own override follows those percentages.
3. **When the project dates change:** PMO never changes a live ERPNext budget on its own. It flags the mismatch on the budget ("the project now runs to <date>; this budget covers <years>") and offers a ready new Draft version with the new span, carrying the lines and re-spreading by the chosen rule. Activating it cancels the old ERP budgets through the archive-cancellation path (#1460) and sends the new ones. The same applies when dates shrink.

The ERP child-row names/percentage-versus-amount representation are a technical discovery item,
not an unanswered owner decision: the required externally observable result is one explicit
figure per year reconciling to the whole-range account total, proven against ERPNext v16.
