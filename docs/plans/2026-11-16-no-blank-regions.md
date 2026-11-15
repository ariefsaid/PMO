# No blank regions while the slowest read lands — implementation plan (#2197)

**Status:** draft for Director review. No build has started. FE-only phases (0, A) can start once the
plan is approved. Phase B adds server reads; see the Director answers at the end (Q4, Q5).
**Ticket:** #2197 (map #806). **Spec:** the ticket is the spec. Its "Where, by screen" tables are the
requirement list, and this plan re-measures them against `origin/dev` @ `1e98c792` (2026-11-16).
**Executor:** Orca workers, one per slice (`docs/orca-dispatch.md`). No slice is on the money/SoD/auth
write path: every change here is read timing only. The Phase B server reads expose money aggregates,
so each Phase B slice gets the security-auditor (RLS + `org_id`) and a pgTAP proof.

## The shared pattern (binding for every slice)

1. **Each region renders its own loading state from its own query.** A region that draws from reads
   R1..Rn shows each sub-region as soon as that read answers. No `if (a.isPending || b.isPending)
   return <Skeleton/>` spans more than one sub-region. Use `ListState variant="loading"` (or the
   region's existing skeleton) for the pending part only (`src/components/ui/ListState.tsx`).
2. **No page-level gate on the slowest read.** A page shell (title, header, tabs, toolbar, selectors)
   renders as soon as the read it actually needs answers. Only one read that truly decides the whole
   page may gate it (see "Adjacent" in the ticket).
3. **Error flags split with loading flags.** Each sub-region owns `pending | error | ready`. A failed
   read shows that sub-region's honest error/unavailable state with its retry, and siblings keep their
   figures. Never an eternal skeleton, never silently missing.
4. **Decision unions stay intact.** A conclusion ("nothing here", "all caught up", "not available", a
   settled-empty check, an enabled primary action that needs every input) still waits for every source
   it concludes from. Split the *loading props*, never the *decision*.
5. **Disabled ≠ loading.** A query switched off for this viewer (`enabled: false`) is not pending.
   Gate on `isPending && fetchStatus !== 'idle'` (or the hook's existing `eligible`/`enabled` flag),
   never bare `isPending`, when a query can be disabled.
6. **Reserve the space.** A late sub-region (a column, a button) holds its slot with a disabled or
   skeleton state so the layout does not reflow when it lands.
7. **Share, don't unwind.** Where sub-regions need the same data, collapse N reads into one round
   trip by extending the existing shared read (`src/hooks/useProjectOverviewRead.ts`, which seeds the
   leaf hooks' cache keys) or one new narrow read. Never split the overview read back up.

**House references to copy:** `src/components/dashboard/hub/company/CompanyDashboard.loading.test.tsx`
(per-region pending/failed matrix, mocks reads at the hook boundary). `pages/ManagementPack.tsx`
(table gates on its own read; per-row enrichment carries its own status). The per-source rows in
`pages/project-detail/tabs/BillingTab.tsx:498` and the per-group gates in `pages/Approvals.tsx:206`.

## What must not change

- **No figure, no calculation, no rounding, no currency handling.** Every number a region shows after
  all reads land is identical to today. A Phase B server read returns the same values the N client
  reads produced. pgTAP proves equivalence on seed (AC-NBR-092).
- **No permission.** No `can()` / `usePermission` / RLS / grant changes. A new RPC uses the caller's
  role (security invoker) or re-checks the same gates as the reads it replaces. The FE flags passed
  stay the ones `useProjectOverviewRead` already derives.
- **No copy and no word growth.** Loading/error states reuse existing strings. `scripts/ux-proof.sh`
  word budget must not rise.
- **No removed affordance** (screen-rules "Feature floor"). The out-of-scope-record and no-access
  branches keep their behaviour.
- The decision unions listed in pattern rule 4. The query-key shape of every seeded leaf hook.

## Measurement (re-measured on `origin/dev` @ `1e98c792`)

Lines drifted since the ticket was filed. These are the gates at head (`pmo-portal/` relative):

| Route | Gate (file:line) | Waits on | Fix | Slice |
|---|---|---|---|---|
| `/sales` | `pages/sales/useSalesModel.ts:102-103`, consumed `pages/SalesPipeline.tsx:66,80,93-100` | open + won + lost → whole body **and** toolbar | split | A1 |
| `/projects/:id/budget` | `pages/ProjectBudget.tsx:481-482` | budget + versions → whole tab | split | A2 |
| `/projects/:id/budget` | `pages/ProjectBudget.tsx:505` | procurements → commitments column appears late | split (reserve column) | A2 |
| `/finance/receivables` | `pages/SalesInvoices.tsx:399` | invoices + revenue mode → list body | split | A3 |
| `/finance/receivables` | `pages/IncomingPayments.tsx:185,212` | receipts + revenue mode → list body | split | A3 |
| `/sales-invoices/:id` | `pages/SalesInvoices.tsx:164,423` | by-id read `enabled` only after the whole list resolves | parallel | A4 |
| `/projects/:id` | `src/hooks/useProjectPosition.ts:170-171` → `pages/project-detail/ProjectSections.tsx:67,126` | org day + milestones + budget(+actuals, +position) + receivables + procurements → "Needs attention" | split per item | A5 |
| `/projects/:id` | `pages/project-detail/ProjectSections.tsx:295,303` | receivables / finances + billing → primary and chase actions render `null` | split (reserve slot) | A5 |
| `/projects/:id` | `pages/project-detail/ProjectDetail.tsx` (single-read page gate) | project read → header too | render shell | A6 |
| `/projects/:id/billing` | `pages/project-detail/tabs/BillingTab.tsx:155-162` | five sources → "New claim" enabled | split | A7 |
| `/projects/:id/work-orders` | `pages/project-detail/tabs/WorkOrderCustomerOrderCard.tsx:156,290-294` | card re-reads invoices + billing the parent holds | share (prop down, FE) | A8 |
| `/approvals` | `pages/Approvals.tsx:132` | five reads → "All pending" scope | split per group | A9 |
| `/projects` | `pages/Projects.tsx:63,163` | at-risk filter waits on the batched money read | split | A10 |
| `/stock/documents/:id/edit` | `pages/stock/StockCount.tsx:180,273` | warehouses + keepers + items + units → form | split | A11 |
| `/stock/new/:kind` | `pages/stock/StockMovementForm.tsx:102,188` | the same four reads → form | split | A12 |
| any (palette) | `src/hooks/useRecordSearch.ts:218-226` → `src/components/shell/CommandPalette.tsx:192` | six list reads → result list | split per source | A13 |
| `/companies/:id` | `src/hooks/useCompanyCollections.ts:62,75-78` | ageing → party refs chain also blanks ageing figures | split | A14 |
| `/administration/usage` | `pages/Administration.tsx:204-205` | usage + run stats → whole panel | split | A15 |
| `/administration/features` | `pages/AdministrationFeatures.tsx:268-269` | five reads → whole console | split | A16 |
| `/administration/plan` | `pages/YourPlan.tsx:92-93` | plan + features → whole page | split | A17 |
| `/finance/statements` | `pages/FinancialStatements.tsx:78,156,182,240,267` | catalogue → selection → statement (serial) | parallel + cache | A18 |
| `/projects/:id/budget` | `pages/project-detail/ProjectProfitLossSection.tsx:77,85,109` | the same chain + its own catalogue instance | share + parallel | A19 |
| `/procurement/:id` | `pages/procurement/DecisionSupportPanel.tsx:93-95,119-123` and `pages/procurement/detail/ProcurementDetailPanels.tsx:169` | budget + committed + reserved (one deduped set of three round trips across both places) | share (one read) | B1 |
| `/procurement/:id` | `src/components/procurement/ProcurementBlock.tsx:245` | position + its separate actuals read | share | B2 |
| `/projects/:id`, `/contract` | `pages/project-detail/ProjectBlocks.tsx:452`, `pages/project-detail/ContractCascade.tsx:58` | milestones + tasks; boq + billing + work orders | share (extend overview read) | B3 |
| `/projects/:id` (delivery) | `pages/project-detail/BillingMilestonesBlock.tsx:29` | orders + billing + acceptance age | share | B4 |
| `/projects/:id/work-orders` | `pages/project-detail/tabs/WorkOrdersTab.tsx:312,505` | boq + project billing + order lines | share | B5 |
| `/approvals` | `src/hooks/useExpenseClaims.ts:113-114` | claims list, then routes (serial in one query) | parallel (embed) | B6 |
| `/companies/:id` | `pages/company/AccountActivityCard.tsx:66,73,146,252` | contacts → activities (structural chain) | share (server join) | B7 |

**Verified done, no slice:** `pages/ProcurementDetails.tsx:340-352`. The record now takes its manager
from its own project embed (#2107), so no second read gates the body. The only body gate is
`detailQuery.isPending` (`:273`), a single by-id read. **Recorded correct, no change:**
`pages/ProjectBlocks.tsx:87` (money block, served from the overview seed; fallbacks already parallel),
`pages/ManagementPack.tsx`, `pages/Projects.tsx` engineer filter and calendar read,
`src/components/integrations/ConnectProposalReview.tsx`, and the company home
(`CompanyDashboard.loading.test.tsx` A1–A15 already proves per-region loading). The home timings in the
ticket (4.0–9.0 s to first position figure) therefore come from request concurrency or the bundle, not
from a union gate. Slice P0's measure records it as the baseline and does not fix it here. It is open
question Q6.

## Test discipline (every slice)

Per slice: write the failing `*.loading.test.tsx` first, run it and see it fail on today's gate,
implement the minimum change, rerun, then run the slice's existing colocated tests unchanged. Mock reads at the
**hook boundary** with `vi.mock` returning `{ data, isPending, isError, fetchStatus, refetch }` exactly
as `CompanyDashboard.loading.test.tsx` does, so the real gating code in the component runs. Each slice's
test carries the two ticket assertions:
**(P) one read pending:** the siblings show their values and only that sub-region shows loading.
**(F) one read failed:** the siblings keep their figures and the failed sub-region states it could not load.
Local final gate per slice (from `pmo-portal/`): `npm run check:guards && npm run typecheck`,
`npx eslint --max-warnings=0 <touched files>`, `npx vitest run <touched test files>`, then
`node ../scripts/affected-e2e.mjs` and `../scripts/ux-proof.sh <route>` for each touched route. Phase B
also runs `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <new pgTAP file>'`
from repo root, plus `node scripts/check-isolation-denominator.mjs --write` for any new function.
Never weaken an existing assertion. If an existing test pins the all-or-nothing skeleton (e.g.
`data-testid="budget-loading"` covering the whole tab), it pins a look the ticket removes. Replace it
with the (P)/(F) pair in the same PR and say so in the PR body.

## Phase 0 — the perf measure (shared primitive)

### P0 — region-timing measure (`scripts/perf/region-timing.mjs`)
1. (3 min) Create `scripts/perf/region-timing.mjs`, modelled on `scripts/perf/measure.mjs` (same
   login, `SHOT_BASE`, `PERF_USER`). Args: `--route /path --delay '<url substring>=<ms>' --region
   <testId>...`. Use `page.route()` to hold every matching request for `<ms>` and then `route.continue()`.
   Record `performance.now()` at navigation and at the moment each `[data-testid=<region>]` first holds
   non-loading content (`:not([aria-busy="true"])`, no `ListState` loading child). Print a markdown
   table: region, ms to content, and whether it beat the delayed read.
2. (2 min) Add `scripts/perf/region-timing.test.mjs` (pattern: `scripts/perf-load-run.test.mjs`) that unit-tests the
   argument parser and the table formatter only (no browser). Verify: `node --test scripts/perf/region-timing.test.mjs`.
3. (3 min) Record the **before** baseline for each Phase A route into
   `docs/research/2026-11-16-no-blank-regions-baseline.md`, with one row per gate in the measurement table: the
   delayed read, a 3000 ms delay, and per-region ms. Run under `scripts/with-db-lock.sh` against the
   local stack only. Each slice's PR appends its **after** row to the same file.

## Phase A — FE-only split / parallel (no schema)

### A1 — Sales pipeline (`/sales`)
1. (3 min) Create `pages/sales/useSalesModel.loading.test.tsx`. Mock `useSalesPipeline`'s three
   scoped reads. (P) open ready, won pending: assert the board/table body and the toolbar (search,
   filters, view toggle, export) render, and only the Won badge/count shows loading. (F) lost failed:
   body renders and the Lost scope says it could not load. Run it: red.
2. (4 min) In `pages/sales/useSalesModel.ts:102-106`, derive `state` from `open` only ('loading' on
   `open.isPending`, 'error' on `open.isError`). Expose `wonState` and `lostState` as `pending|error|ready`.
   Keep the `'empty'` conclusion requiring all three settled (rule 4).
3. (3 min) In `pages/SalesPipeline.tsx:80-100`, the toolbar props stay on `m.state !== 'loading'`
   (now the open read only). Scope badges read `wonState`/`lostState`. Rerun the new and existing
   `pages/SalesPipeline.test.tsx`: green.

### A2 — Project budget tab (`/projects/:id/budget`)

> **Not shipped:** no gain measured; the single-user run could not exercise A18/A19 and the 50-user replay cannot see client-side request order. A19 adds a request. Branch dropped; re-open only with a before/after region-timing run.
1. (3 min) Create `pages/ProjectBudget.loading.test.tsx`. (P) versions ready, budget pending: header +
   version switcher render, and the summary/forecast figures show `ListState` loading. (P2) procurements
   pending: the commitments column header is present with a loading cell. (F) budget failed: the
   switcher still renders and the figures region shows the error with retry. Red.
2. (4 min) Replace `pages/ProjectBudget.tsx:481-482` with a `versionsQuery.isPending` gate for the
   shell only. Move the budget pending/error into the summary + forecast region (keep `budget-loading`
   test id on that region only, with `authoringRecoveryNotice` unchanged above it).
3. (3 min) `pages/ProjectBudget.tsx:505`: split `canSeeCommitments` into `commitmentsAllowed`
   (permission, unchanged) and `commitmentsState`. Render the column whenever allowed, with cells in a
   loading/error state until ready. Rerun the new test + `ProjectBudget.test.tsx` +
   `ProjectBudget.restructure.test.tsx`.

### A3 — Receivables lists (`/finance/receivables`)
1. (3 min) Create `pages/SalesInvoices.loading.test.tsx` and `pages/IncomingPayments.loading.test.tsx`.
   (P) list ready, revenue mode pending: rows render and only the action cells show a loading state.
   (F) mode failed: rows render and the action cells show unavailable. Red.
2. (3 min) `pages/SalesInvoices.tsx:399`: `state` from `isPending`/`isError` of the invoice read only.
   Pass `mode === undefined` as an action-column pending flag into the column builder (`:392` comment
   block lists the column dependencies; add the flag there).
3. (3 min) The same change at `pages/IncomingPayments.tsx:185,212`. Rerun both new tests.

### A4 — Invoice deep link (`/sales-invoices/:id`)
1. (3 min) Add to `pages/SalesInvoices.loading.test.tsx`: (P) list pending and the by-id read ready.
   Assert `SalesInvoiceDetail` renders the record. (F) by-id failed and the list ready but unlisted: assert the
   detail error state. Red.
2. (3 min) `pages/SalesInvoices.tsx:164`: set `enabled: Boolean(invoiceId && currentUser?.org_id)`
   while `!listedTarget || isPending`. Once the list lands with the target, the by-id result is
   unused (the list stays an optimisation). `:423`: `isPending={!viewTarget && unlisted.isPending}`,
   `isError={!viewTarget && unlisted.isError}`. The list error must not mask a loaded by-id record.
3. (4 min) Create e2e `e2e/AC-NBR-020-invoice-deep-link.spec.ts` (`// @e2e-isolation: read-only`).
   Sign in as Finance and route-delay the `sales_invoices` list request 3000 ms. Open
   `/sales-invoices/<seeded id>` and assert the invoice number heading is visible before the delay
   ends. Verify: `scripts/e2e-local.sh AC-NBR-020`.

### A5 — Project overview: attention + primary action (`/projects/:id`)
1. (4 min) Create `src/hooks/useProjectAttention.loading.test.tsx`: mock the six inputs. (P) milestones
   ready, receivables pending: the milestone items are returned and `pendingSources` contains `receivables`.
   (F) budget failed: other items returned, `errors` names budget. Red.
2. (4 min) `src/hooks/useProjectPosition.ts:152-285`: keep `isPending` (union, for the "nothing needs
   attention" conclusion) and add `pendingSources: string[]` and `failedSources: string[]`. Each item is built
   only from its own settled source. No item logic changes.
3. (3 min) `pages/project-detail/ProjectAttention` (consumer at `ProjectSections.tsx:67,126`): render
   ready items and add one loading row while `pendingSources.length > 0`. The empty state still needs
   `!isPending`.
4. (3 min) Create `pages/project-detail/ProjectSections.loading.test.tsx`. (P) finances pending: the
   primary action slot renders a disabled button of the same label (not `null`). The same holds for the chase
   action at `:295`. (F) billing failed: the disabled button carries the existing unavailable tooltip.
   Change `:295,:303` from `return null` to the disabled state. `!canInvoice` / `!canRaise` /
   `chaseOnly` keep `return null` (permission, rule: no permission change).

### A6 — Project overview shell (`/projects/:id`)
1. (3 min) Create `pages/project-detail/ProjectDetail.loading.test.tsx`: project ready, overview read
   pending → header (title, status pill, tabs) visible, and the overview content region shows
   `project-detail-panel-loading`. Red only if the header is gated today. If it already renders, record
   that in the baseline file and close the slice with the test only.
2. (3 min) Move the single gate so it wraps the overview content only. Keep the tab-switch stability
   the gate was added for (assert no unmount of the header on tab switch in the same test).

### A7 — Billing tab "New claim" (`/projects/:id/billing`)
1. (3 min) Create `pages/project-detail/tabs/BillingTab.loading.test.tsx`. (P) claims pending: the
   "New claim" button is enabled and the dialog lists claims as pending (existing per-source row, `:498`).
   (F) work orders failed: the button is enabled and the dialog shows that source's error. Red.
2. (3 min) `BillingTab.tsx:162`: the button gate uses only the sources the claim scope needs (open
   question Q1 names which two). The dialog's submit keeps `claimDataReady` (all five), so no claim
   is created from partial data (rule 4).

### A8 — Customer-order card reads (`/projects/:id/work-orders`)
1. (3 min) Create `pages/project-detail/tabs/WorkOrderCustomerOrderCard.loading.test.tsx`. Render the card with
   `invoicesRead`/`billingRead` props from the parent and assert it issues no read of its own (the hook
   mocks are not called). Red.
2. (4 min) Thread `WorkOrdersTab.tsx`'s `invoicesQuery` (`:241`) and its billing query into the card
   as props. Delete the card's own two hooks. The settlement logic at `:156` is unchanged. Rerun.

### A9 — Approvals "All pending" (`/approvals`)
1. (3 min) Add to `pages/Approvals.test.tsx` a `describe('AC-NBR-030 per-group loading')`. (P)
   invoices pending, others ready: the procurement, timesheet and expense groups render rows and the
   invoice group shows its skeleton. (F) expenses failed: the other groups render and the expense group shows its
   error. "All caught up" is never shown while any group is pending. Red.
2. (4 min) `pages/Approvals.tsx:132`: stop using `allScopePending` as a whole-list gate. Render each
   group with the per-scope gate already used at `:206`. Keep `allScopePending` and `allCaughtUp` for
   the empty/caught-up conclusion only.

### A10 — Projects list at-risk (`/projects`)
1. (3 min) Add to `pages/Projects.test.tsx` `AC-NBR-031`. (P) at-risk filter active, money pending:
   rows render and the risk cell shows loading. (F) money failed: rows render and the risk cell is unavailable.
   Red.
2. (4 min) In the list model (`pages/Projects.tsx:57-94`), when `riskScopeRead && moneyPending`,
   show the unfiltered population with risk cells pending instead of withholding rows. Sort and
   filter apply when the money lands (open question Q2: whether rows may reorder on arrival). The
   cached-risk path at `:79` stays first.

### A11 — Stock count form (`/stock/documents/:id/edit`)
1. (3 min) Add to `pages/stock/StockCount.test.tsx` `AC-NBR-032`. (P) warehouses + keepers ready,
   items pending: header fields are editable and the line editor shows loading. (F) units failed: header
   editable and the line editor shows the error with retry. Red.
2. (3 min) `StockCount.tsx:180,273`: `headerPending = warehouses.isPending || keepers.isPending` gates
   the header. `linesPending = items.isPending || units.isPending` gates the line editor only. Submit
   still needs all four settled.

### A12 — Stock movement form (`/stock/new/:kind`)
1. (3 min) Same test as A11 in `pages/stock/StockMovementForm.test.tsx` (`AC-NBR-033`). Red.
2. (3 min) Same split at `StockMovementForm.tsx:102,188`. Rerun both stock suites, including
   `StockCount.renderIsolation.test.tsx` and `StockMovementForm.floor.test.tsx`.

### A13 — Command palette (any route)
1. (3 min) Create `src/hooks/useRecordSearch.loading.test.tsx`. (P) projects ready, contacts
   pending: projects' records are returned and `pendingSources` contains contacts. (F) incidents failed:
   others returned. A source disabled for the viewer is never pending (rule 5). Red.
2. (4 min) `src/hooks/useRecordSearch.ts:218-226`: keep `isPending` = "no source has answered yet".
   Add `pendingSources`. Return each source's rows as they land. `CommandPalette.tsx:192`: show the
   loading row only while `pendingSources.length > 0` *below* the results, not instead of them.

### A14 — Company collections (`/companies/:id`)
1. (3 min) Add to `src/hooks/useCompanyCollections.test.tsx` `AC-NBR-034`: ageing ready, party refs
   pending: ageing figures are returned with `isPending: false` and `linksPending: true`. Red.
2. (3 min) `useCompanyCollections.ts:76-78`: `isPending` = ageing only. Add `linksPending` for the
   refs query. The consumer renders the link column loading on `linksPending`.

### A15 — Admin usage (`/administration/usage`)
1. (3 min) Create `pages/Administration.usage.loading.test.tsx`: usage ready, run stats pending → the
   usage table + summary render and the run-stats column shows loading. (F) run stats failed: the table renders and the column is
   unavailable. Red.
2. (3 min) `pages/Administration.tsx:204-205`: pass `usagePending/usageError` and
   `runStatsPending/runStatsError` separately into the panel and gate each part on its own.

### A16 — Admin features console (`/administration/features`)
1. (3 min) Add to `pages/AdministrationFeatures.test.tsx` `AC-NBR-036`: orgs + catalogue ready → the
   header and selectors render, and the switch table shows `operator-console-loading`. Red.
2. (3 min) `AdministrationFeatures.tsx:268-269`: gate the page on `orgs` + `catalogue`, and the switch table on
   `resolved` + `orgPlan` + `orgOverrides`. No toggle is enabled until its row's reads settle.

### A17 — Your plan (`/administration/plan`)
1. (3 min) Add to `pages/YourPlan.test.tsx` `AC-NBR-037`: plan ready, features pending → the plan card
   renders and the features card shows loading. (F) the reverse. Red.
2. (3 min) `YourPlan.tsx:92-93`: one gate per card. Keep `your-plan-loading` on the features card.

### A18 — Financial statements (`/finance/statements`)

> **Not shipped:** no gain measured; the single-user run could not exercise A18/A19 and the 50-user replay cannot see client-side request order. A19 adds a request. Branch dropped; re-open only with a before/after region-timing run.
1. (4 min) Create `pages/FinancialStatements.loading.test.tsx`: URL carries `period`, `kind` and
   `statement`, and the catalogue is pending. Assert `useFinancialStatement` was called enabled with the
   URL-derived selection. When the catalogue lands and disagrees, the selection re-keys and the
   first result is discarded (no figure from the wrong selection is shown). Red.
2. (4 min) `FinancialStatements.tsx:156,182`: when the URL names a complete selection, build
   `selection` from it before the catalogue answers. Render the statement body on `readQuery`. Keep
   the catalogue-driven correction (open question Q3). Without URL params, behaviour is unchanged.
3. (3 min) Add a case to the same test: unmount and remount the page within `LIST_STALE_TIME`
   (`src/lib/queryPolicies.ts:3`). Assert the catalogue repository mock is not called again. If it is
   called again, give the catalogue query `staleTime: LIST_STALE_TIME` in
   `src/hooks/useFinancialStatements.ts`. Keep its access-retire path (`:88-93`, `:208`) unchanged, so a
   retired viewer never reads a cached catalogue.

### A19 — Project P&L section (`/projects/:id/budget`)

> **Not shipped:** no gain measured; the single-user run could not exercise A18/A19 and the 50-user replay cannot see client-side request order. A19 adds a request. Branch dropped; re-open only with a before/after region-timing run.
1. (3 min) Create `pages/project-detail/ProjectProfitLossSection.loading.test.tsx`: two mounted
   consumers share one catalogue request (assert the repository mock was called once). The statement
   read starts on the default period before the catalogue answers. Red.
2. (3 min) Use the same catalogue query key as A18 (`useFinancialStatementCatalogue` with the project
   kind) and the A18 early-selection helper. Extract that helper to `src/hooks/useFinancialStatements.ts`
   in A18 so this slice only imports it.

## Phase B — share (server reads; see Director answers Q4/Q5)

Each slice: new migration (next free number, `scripts/renumber-migration.sh` on collision), a reversible
`rollback/` file, a security-invoker SQL function or an added field on `project_overview_read`
(`supabase/migrations/0652_project_overview_read.sql`), a pgTAP file
`supabase/tests/<nnn>_nbr_<slug>.test.sql`, the isolation denominator entry, a repository method, and
the hook switched to it, seeding the existing leaf keys so other consumers are unaffected.

### B1 — Budget impact aggregate (`/procurement/:id`)
1. (4 min) pgTAP: on seed, for each org's projects, `project_budget_impact(project_id)` returns
   budget, committed and reserved equal to what the three existing reads return
   (`AC-NBR-092` equivalence). Another org's project returns no row (`org_id` seam). Red.
2. (5 min) Write the function from the bodies of the three existing reads (no new arithmetic).
3. (3 min) Create `src/hooks/useProjectBudgetImpact.ts`, used by `DecisionSupportPanel.tsx:93-95` and
   `ProcurementDetailPanels.tsx:169`, seeding `useProjectBudget`/`useProjectCommittedSpend`/
   `useProjectReservedSpend` keys. RTL (P)/(F) in `pages/procurement/DecisionSupportPanel.loading.test.tsx`.

### B2 — Category position with actuals (`/procurement/:id`)
1. (4 min) pgTAP equivalence for the budget-position read, extended with the actuals it currently fetches
   separately. Red.
2. (4 min) Extend the read. `ProcurementBlock.tsx:245`: `loading = position.isPending` only.

### B3 — Overview read: tasks + work orders (`/projects/:id`, `/contract`)
1. (4 min) pgTAP: `project_overview_read` with the new keys returns the same rows as the tasks and
   work-orders list reads for the caller's role. Red.
2. (4 min) Add the keys, seed `['tasks', …]` and the work-orders key in `useProjectOverviewRead.ts`.
   `ProjectBlocks.tsx:452` and `ContractCascade.tsx:58` resolve from one read.

### B4 — Billing milestones projection (delivery lens)
1. (4 min) pgTAP equivalence for orders + billing + acceptance age in one function. Red.
2. (4 min) `BillingMilestonesBlock.tsx:29` reads the new hook. RTL (F) per-row unavailable.

### B5 — Work-order lines with quantities (`/projects/:id/work-orders`)
1. (4 min) pgTAP equivalence for boq + project billing + order lines. Red.
2. (4 min) `WorkOrdersTab.tsx:312,505` reads the one hook. `lineReadsPending` becomes that hook's
   `isPending`.

### B6 — Expense routes with the claims list (`/approvals`)
1. (3 min) Discovery: `grep -n "expense_claim_routes\|routes" pmo-portal/src/lib/db/expenseClaims.ts`
   and read the routes table FK in `supabase/migrations`. If routes reference claims by FK, embed them in
   the list `select` (no migration) and delete the second call at `useExpenseClaims.ts:114`. If not,
   stop and add it to Q5.
2. (3 min) RTL in `src/hooks/useExpenseClaims.test.tsx`: one repository call per refetch, and the routes
   are present on each row.

### B7 — Account activity join (`/companies/:id`)
1. (4 min) pgTAP: a company-activities function returns the same activities as contacts → activities
   for the caller, paged identically. Red.
2. (4 min) `AccountActivityCard.tsx:66-73,146`: one infinite query and no `return null` while contacts load.

## Acceptance criteria

All in Given/When/Then. "Owning layer" = the one test that proves it (ADR-0010).

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-NBR-001 | **Given** the pipeline's won read is pending (or lost failed) **When** `/sales` renders **Then** the board/table and toolbar show the open deals, and only the Won (Lost) scope shows loading (unavailable). | RTL `useSalesModel.loading.test.tsx` |
| AC-NBR-002 | **Given** budget versions have loaded and the budget read is pending or failed **When** the budget tab renders **Then** the header and version switcher are usable, and only the figures region shows loading or its error with retry. | RTL `ProjectBudget.loading.test.tsx` |
| AC-NBR-003 | **Given** procurements are pending **When** the budget table renders **Then** the commitments column is present with loading cells and the table does not reflow when it lands. | RTL `ProjectBudget.loading.test.tsx` |
| AC-NBR-004 | **Given** the invoice (receipt) list has loaded and revenue mode is pending or failed **When** the list renders **Then** rows show and only the action cells are loading or unavailable. | RTL `SalesInvoices.loading.test.tsx`, `IncomingPayments.loading.test.tsx` |
| AC-NBR-020 | **Given** a Finance user and a slow invoice-list request **When** they open an invoice deep link **Then** the invoice record is shown before the list request finishes. | e2e `AC-NBR-020-invoice-deep-link.spec.ts` |
| AC-NBR-005 | **Given** one attention source is pending or failed **When** the project overview renders **Then** items from settled sources show, one loading row marks the rest, and "nothing needs attention" appears only when all sources have settled empty. | RTL `useProjectAttention.loading.test.tsx` |
| AC-NBR-006 | **Given** finances or billing are pending or failed **When** the overview renders **Then** the primary and chase actions hold their slot as disabled buttons (unavailable tooltip on failure), and a viewer without permission still sees none. | RTL `ProjectSections.loading.test.tsx` |
| AC-NBR-007 | **Given** the project has loaded and the overview read is pending **When** `/projects/:id` renders **Then** the header and tabs show and only the content shows loading. | RTL `ProjectDetail.loading.test.tsx` |
| AC-NBR-008 | **Given** a non-scope claim source is pending or failed **When** the billing tab renders **Then** "New claim" is enabled, the dialog marks that source, and submit stays disabled until all sources settle. | RTL `BillingTab.loading.test.tsx` |
| AC-NBR-009 | **Given** the work-orders tab has loaded invoices and billing **When** a customer-order card renders **Then** it shows the same settlement figures and issues no read of its own. | RTL `WorkOrderCustomerOrderCard.loading.test.tsx` |
| AC-NBR-030 | **Given** one approval queue is pending or failed **When** "All pending" renders **Then** the other groups show their rows, that group shows its skeleton or error, and "all caught up" never shows while any group is pending. | RTL `Approvals.test.tsx` |
| AC-NBR-031 | **Given** the at-risk filter is active and the money read is pending or failed **When** `/projects` renders **Then** rows show with the risk cell loading or unavailable. | RTL `Projects.test.tsx` |
| AC-NBR-032 | **Given** warehouses and keepers have loaded and items or units are pending or failed **When** the count form renders **Then** header fields are editable, the line editor shows loading or error, and submit waits for all four. | RTL `StockCount.test.tsx` |
| AC-NBR-033 | Same as AC-NBR-032 for the movement form. | RTL `StockMovementForm.test.tsx` |
| AC-NBR-010 | **Given** one search source is pending or failed and one is disabled for the viewer **When** the palette is open **Then** answered sources' records list, a loading row sits below them, and the disabled source is never pending. | RTL `useRecordSearch.loading.test.tsx` |
| AC-NBR-034 | **Given** the ageing snapshot has loaded and party references are pending **When** the company record renders **Then** the ageing figures show and only the link column is loading. | RTL `useCompanyCollections.test.tsx` |
| AC-NBR-035 | **Given** usage has loaded and run stats are pending or failed **When** the usage panel renders **Then** the table and summary show and only the run column is loading or unavailable. | RTL `Administration.usage.loading.test.tsx` |
| AC-NBR-036 | **Given** orgs and catalogue have loaded **When** the operator console renders **Then** header and selectors show, and only the switch table is loading. | RTL `AdministrationFeatures.test.tsx` |
| AC-NBR-037 | **Given** one of plan or features is pending or failed **When** "Your plan" renders **Then** the other card shows its content. | RTL `YourPlan.test.tsx` |
| AC-NBR-011 | **Given** the URL names a complete statement selection **When** `/finance/statements` loads **Then** the statement read starts without waiting for the catalogue, and a catalogue correction never shows a figure from the wrong selection. | RTL `FinancialStatements.loading.test.tsx` |
| AC-NBR-012 | **Given** the project P&L section and another consumer mount **When** the budget tab loads **Then** one catalogue request serves both and the statement read starts on the default period. | RTL `ProjectProfitLossSection.loading.test.tsx` |
| AC-NBR-040 | **Given** a procurement record on a budgeted project **When** the budget impact and header budget line render **Then** one round trip feeds both, and each figure equals today's. | RTL `DecisionSupportPanel.loading.test.tsx`; figures by AC-NBR-092 |
| AC-NBR-041 | **Given** a category position **When** "Budget left in category" renders **Then** it needs one read. | RTL `ProcurementBlock` test |
| AC-NBR-042 | **Given** the overview read succeeds **When** the phase timeline and contract cascade render **Then** neither issues its own tasks/work-orders/boq/billing read. | RTL `useProjectOverviewRead` test |
| AC-NBR-043 | **Given** the delivery lens **When** billing milestones render **Then** one read feeds them, and a failure shows unavailable per block. | RTL `BillingMilestonesBlock` test |
| AC-NBR-044 | **Given** the work-orders tab **When** line/billing columns render **Then** one read feeds them. | RTL `WorkOrdersTab` test |
| AC-NBR-045 | **Given** submitted expense claims **When** the approvals page loads **Then** claims and their routes arrive in one request. | RTL `useExpenseClaims.test.tsx` |
| AC-NBR-046 | **Given** a company with contacts **When** account activity renders **Then** one paged read returns the timeline and the card never renders nothing while contacts load. | RTL `AccountActivityCard` test |
| AC-NBR-090 | **Given** a query disabled for the current viewer **When** any touched region renders **Then** it is not shown as loading. | RTL, the per-slice tests (one case each where a disable path exists) |
| AC-NBR-091 | **Given** some sources still pending **When** a region would conclude empty / caught-up / not-available **Then** it does not conclude until every source has settled. | RTL, per-slice (A1, A5, A9 cases) |
| AC-NBR-092 | **Given** rich seed in two orgs **When** each Phase B function is called as each role **Then** its values equal the replaced reads' values for the caller's org, and another org's rows are absent. | pgTAP `supabase/tests/*_nbr_*.test.sql` |
| AC-NBR-093 | **Given** one region's read is delayed 3000 ms **When** the route loads **Then** every other region on that route shows content before the delay ends (after-row in the baseline file versus the before-row). | perf `scripts/perf/region-timing.mjs`, recorded in `docs/research/2026-11-16-no-blank-regions-baseline.md` |

**Count:** 32 ACs.

## Sequencing and batching

P0 first (the baseline must exist before any after-row). Phase A slices are independent and can run
in parallel worktrees. Batch 3–5 per PR to `dev` (e.g. A1+A3+A4 sales/receivables; A2+A18+A19 finance
reads; A5+A6+A7+A8 project detail; A9+A10+A13 lists/palette; A11+A12+A14–A17 forms/admin). Phase B
follows the Director answers (Q4, Q5). Each B slice is its own PR because each carries a migration and a
security-auditor pass. Reviews: spec-reviewer, code-quality-reviewer and security-auditor on every PR, with
Discover (design-reviewer on rich seed) for the FE slices.

## Open owner questions (not answered here)

- **Q1 (A7):** Which claim sources must have answered before "New claim" is enabled? The ticket says
  "the first two". The code's own comment (`BillingTab.tsx:150`) says scope comes from *allocations*,
  which is fifth in the list. Which two are they?
- **Q2 (A10):** With the at-risk filter on, may rows show unfiltered and then reorder/filter when the money
  read lands? The alternative is to keep withholding rows but render the table shell.
- **Q3 (A18):** When the URL selection and the catalogue disagree, which one is the authority? The
  options are to silently re-key to the catalogue's choice, or to keep the URL's and say it is not
  available.
- **Q4 (Phase B):** Are new server read functions acceptable for B1–B5 and B7, given each adds a
  migration, a pgTAP proof and a denominator entry? The alternative is to stop at Phase A.
- **Q5 (B6):** If expense routes cannot be embedded through an FK, is a server function acceptable,
  or should the serial call stay?
- **Q6 (home):** The ticket's headline measurement is the home screen (4.0–9.0 s to the first
  position figure), but the home already loads per region. Should a separate ticket chase request
  concurrency or the bundle there? It is out of this plan's scope.
- **Q7 (perf target):** Is there a numeric before/after target per route, or is AC-NBR-093 ("other regions
  beat the delayed read") the bar?

## Director answers (2026-11-16)

Q1: derive from the code, not the ticket. 'New claim' enables only when every read that its enabled-condition and its form's defaults depend on has answered (allocations included, since they decide scope). Nothing else on the tab gates it. The builder lists those reads in READY.

Q2: no. Never show unfiltered rows under an active filter. Keep withholding the rows; render the table shell (toolbar, headers, skeleton rows) at once.

Q3: no behaviour change. Render the shell with the URL's selection and a loading body; never re-key before the catalogue has answered; after it answers, do exactly what the app does today.

Q4: yes, but data-driven: a phase B slice starts only when the phase 0 measure, re-run after phase A, shows its region still more than 1 second behind its siblings. Each alone, security invoker, pgTAP equivalence, security-auditor.

Q5: a server function is acceptable under the same rule.

Q6: filed as #2359; out of this plan.

Q7: AC-NBR-093 is the bar; plus every slice reports before/after from the phase 0 measure and no region's time may get worse.
