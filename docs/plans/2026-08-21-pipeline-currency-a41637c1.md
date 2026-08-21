# Plan: per-record currency in Sales Pipeline cards (#530 item 2)

**Source requirement:** issue prompt, with `docs/specs/i18n-framework.spec.md` FR-L10N-020 and AC-L10N-020.

## Verified design and scope correction

The latest *definition* of `public.get_sales_pipeline()` is `supabase/migrations/0044_dashboard_status_helpers.sql`, not `0020`. The prompt's prescribed `grep -rln … | sort | tail -1` currently returns `0185_revoke_anon_authenticated_definer_writers.sql`, but that file only names the RPC in an ACL-maintenance list; it does not define it. The live definition is a zero-argument, `security invoker`, `stable` SQL function returning one `json` value. Its `projects` array is constructed with `json_build_object`; it does **not** have a `RETURNS TABLE (...)` signature.

Therefore the migration must follow the requested drop/recreate-and-regrant discipline, but recreate the verified `returns json` contract and add `currency` to the JSON CTE/projection. Inventing a `RETURNS TABLE` signature would break the existing Supabase RPC consumer and is not compatible with the repository's actual contract. Dropping is conservative here (the JSON return type itself is unchanged) and requires reapplying its three ACL statements exactly.

`PipelineProject` is deliberately a hand-written API-payload interface because generated Supabase types model this RPC only as `Returns: Json`; regeneration cannot expose nested JSON keys. Add its required `currency: string` field after regenerating the generated file; do not add a cast. The same interface feeds both open RPC deals and `useLostDeals`, so the lost-deal mapping must pass through `r.currency` too.

There are two row-backed pipeline renderers, not one: the board cards and the table's Value/Weighted cells. Both must use `r.currency`; stage/funnel/column totals remain org-default-denominated because they aggregate multiple records. This closes the actual per-record defect without changing the mixed-currency aggregate posture.

No ADR is needed: this implements the existing OD-CR-5 / FR-L10N-020 currency-source rule. No business table, RLS policy, index, or `org_id` predicate changes; the recreated RPC remains `security invoker`, takes no `org_id`, and continues to rely on existing RLS for its tenancy seam.

## Data flow

`projects.currency` (0187's trigger-stamped, per-record ISO-4217 field) → `get_sales_pipeline()` CTE `p.currency` → JSON `projects[].currency` → `getSalesPipeline()` payload → `PipelineProject.currency` → `SalesKanbanBoard` `DealCard` and `SalesPipeline` table row formatters. Lost deals take the parallel repository route → `useLostDeals()` mapping → the same required `PipelineProject.currency` field. Aggregates deliberately continue through `useOrgCurrency()`.

## Test and AC traceability

| Requirement / AC | Owning layer | Canonical proof | #530 supporting proof |
|---|---|---|---|
| FR-L10N-020 / AC-L10N-020 | Unit (Vitest), as recorded in the spec | `pmo-portal/src/lib/format.test.ts` currency-argument case | `pmo-portal/components/SalesKanbanBoard.test.tsx` proves the pipeline card supplies each row's value rather than an org/default literal; `pmo-portal/pages/SalesPipeline.test.tsx` covers the table counterpart. |
| FR-L10N-020 RPC payload and existing NFR-SPD-SEC-001 posture | Integration (pgTAP) | `supabase/tests/0057_sales_pipeline_attention.test.sql` | The added IDR payload assertion runs under the existing authenticated org-A fixture; its existing org-B assertions retain the RLS/tenancy proof. |

## Implementation tasks

All repository-root commands below run from the worktree root unless a task explicitly changes to `pmo-portal/`. Do not commit while a test is red. For every DB-driving verification, keep reset and pgTAP in **one** shared-DB lock hold and read the `supabase db reset` output before trusting the test result; a seed failure can otherwise leave a stale schema.

### Task 1 — Add the failing RPC payload proof first

**Files:**
- Modify `supabase/tests/0057_sales_pipeline_attention.test.sql`

**TDD RED change (FR-L10N-020):**
1. Raise `select plan(6);` to `select plan(7);`.
2. In the Org-A `projects` fixture insert, explicitly set the pipeline deal's `currency` to `'IDR'` while the organization retains its default USD. Include `currency` in the insert column list so the fixture proves a record currency rather than the org fallback.
3. After the existing `pm_name` assertion, add a pgTAP `is(...)` assertion that extracts `proj->>'currency'` for `Test Pipeline Deal` from `get_sales_pipeline()->'projects'` and equals `'IDR'`. Start its description with `FR-L10N-020` and state that the pipeline payload preserves the deal's own currency.

**Verify RED:**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
```
Read the reset output first. The new assertion must fail because `0044` currently omits the JSON key; do not change the expectation or delete the assertion.

### Task 2 — Recreate the latest RPC with the additive currency payload

**Files:**
- Create `supabase/migrations/0200_sales_pipeline_currency.sql`

**Implementation (FR-L10N-020, NFR-SPD-SEC-001):**
1. Start the migration with a manual reversal note: drop `public.get_sales_pipeline()` and restore the pre-change `0044` body and its three ACL statements; pre-production reversal remains `supabase db reset`.
2. `drop function if exists public.get_sales_pipeline();` before recreation. Although the verified JSON return type does not change, this honors the requested drop/recreate procedure and makes ACL restoration explicit.
3. Recreate `public.get_sales_pipeline()` from `0044` verbatim with its existing `returns json`, `language sql`, `stable`, `security invoker`, and `set search_path = public` clauses. Preserve `pipeline_project_statuses()`, the status grouping, ordering, joins, aggregate payload, and all current JSON keys.
4. Add `p.currency` to the `pl` CTE selection and add `'currency', pl.currency` to every JSON object in the `projects` array. Do not add currency to stage totals: cross-record totals have no single record currency.
5. Reapply exactly the latest definition's ACLs after the new function: `revoke all on function public.get_sales_pipeline() from public;`, `grant execute ... to authenticated;`, and `revoke execute ... from anon;`. Do not grant `anon`, add an `org_id` argument, or change to `security definer`.

**Verify GREEN:**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
```
Read reset output and require the command to exit 0. This reruns the whole pgTAP suite, including Task 1's IDR payload and retained cross-org/RLS assertions.

### Task 3 — Regenerate generated Supabase types from the migrated local DB

**Files:**
- Regenerate `pmo-portal/src/lib/supabase/database.types.ts` only through the generator

**Implementation:** With the Task 2 migration applied, run:
```bash
scripts/with-db-lock.sh supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts
```
Do not hand-edit generated output and do not introduce a cast to work around it. `get_sales_pipeline` remains `Returns: Json` because the database contract is JSON; this regeneration is still mandatory and is the authoritative schema snapshot.

**Verify:**
```bash
cd pmo-portal && npm run typecheck
```
Require exit 0 before continuing. Inspect the generated-file diff before staging; preserve generator output rather than manually pruning it.

### Task 4 — Add required payload typing and maintain the lost-deal path

**Files:**
- Modify `pmo-portal/src/lib/db/dashboard.ts`
- Modify `pmo-portal/src/hooks/useDashboard.ts`
- Modify typed `PipelineProject` fixture factories/lists in:
  - `pmo-portal/components/salesPipeline.test.ts`
  - `pmo-portal/components/SalesKanbanBoard.test.tsx`
  - `pmo-portal/pages/__tests__/coherence-cw-cleanup.test.tsx`
  - `pmo-portal/src/components/ui/__tests__/mobile.pr3.test.tsx`

**TDD/implementation (FR-L10N-020):**
1. Add required `currency: string` to `PipelineProject`, documented as the record's ISO-4217 value returned by the open-deal RPC or carried from the full lost-project row.
2. Add `currency: r.currency` to the `useLostDeals()` `PipelineProject` projection, so terminal lost cards do not regress when the shared type becomes required.
3. Add explicit `currency: 'USD'` to every existing typed fixture above (including the `project()` factory's default) except the mixed-currency board fixtures introduced in Task 5. Keep fixture data honest; do not make the interface optional just to avoid fixture updates.

**Verify:**
```bash
cd pmo-portal && npm run typecheck
```
Require exit 0. This is the static completeness sweep for all `PipelineProject` construction sites.

### Task 5 — Write the card and table mixed-currency regressions before renderer changes

**Files:**
- Modify `pmo-portal/components/SalesKanbanBoard.test.tsx`
- Modify `pmo-portal/pages/SalesPipeline.test.tsx`

**TDD RED tests (FR-L10N-020 / AC-L10N-020):**
1. Keep `useOrgCurrency()` mocked to `'USD'` because column totals are still aggregate/org values.
2. In `SalesKanbanBoard.test.tsx`, make the shared `projects` list contain at least two deal records with explicit different currencies: an IDR deal whose `contract_value` is `1_234` and a USD deal. Add a test titled `#530 / AC-L10N-020: cards render each deal in its own currency, not the USD org default` that scopes assertions to each card. Assert the IDR card contains the literal `IDR\u00A01,234` (U+00A0 NBSP, not a plain space) and does not contain `$`; assert the USD card contains its dollar value and does not contain `IDR`. Do not call `formatCurrency` to construct this oracle.
3. In `SalesPipeline.test.tsx`, add a table-view regression with both an IDR (`1_234`) and USD record. Switch to Table, scope to the IDR row, and assert `IDR\u00A01,234` with no `$`; scope to the USD row and assert its dollar amount with no `IDR`. This covers the second row-backed renderer discovered in the current code.

**Verify RED:**
```bash
cd pmo-portal && npm test -- components/SalesKanbanBoard.test.tsx pages/SalesPipeline.test.tsx
```
The card and table IDR assertions must fail while both surfaces still feed `orgCurrency` to the formatter.

### Task 6 — Thread record currency through both row renderers

**Files:**
- Modify `pmo-portal/components/SalesKanbanBoard.tsx`
- Modify `pmo-portal/pages/SalesPipeline.tsx`

**Implementation (FR-L10N-020 / AC-L10N-020):**
1. In `DealCard`, delete the stale limitation comment and remove its `currency` prop. Render both gross and weighted values with `project.currency`.
2. At the `DealCard` call site, remove `currency={orgCurrency}`. Keep `orgCurrency` only for `ColumnTotals`; retain/shorten the comment so it accurately distinguishes per-record card values from cross-record totals.
3. In `SalesPipeline`'s `tableColumns`, change the Value and Weighted cells to use `r.currency`. Remove the obsolete claim that the row values must use the org default. Preserve `orgCurrency` for funnel-stage and total-weighted aggregates only.

**Verify GREEN:**
```bash
cd pmo-portal && npm test -- components/SalesKanbanBoard.test.tsx pages/SalesPipeline.test.tsx
```
Require both new mixed-currency tests and all existing board/table behavior tests to pass.

### Task 7 — Run the required mutation check and restore production code

**Files temporarily modified and restored:**
- `pmo-portal/components/SalesKanbanBoard.tsx`

**Mutation procedure (AC-L10N-020):**
1. Temporarily replace both `project.currency` formatter arguments in `DealCard` with the known USD org-default literal `'USD'` (the test hook's org default).
2. Run the Task 6 targeted test command. The IDR-card assertion must go red; a green result means the regression test does not distinguish a record currency from the default.
3. Revert that mutation exactly, restoring `project.currency`, then rerun the same targeted test command and require green. Do not weaken, skip, or delete an assertion to make either run pass.

**Verify:**
```bash
cd pmo-portal && npm test -- components/SalesKanbanBoard.test.tsx pages/SalesPipeline.test.tsx
```
Require exit 0 after restoration.

### Task 8 — Final locked verification and review-ready checks

**Files:** all Task 2–6 files, reviewed only; no new implementation.

1. Re-run schema/RPC verification under one DB lock and read the reset output:
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
```
2. Run the mandatory full application gate from the app directory:
```bash
cd pmo-portal && npm run verify:locked
```
3. Confirm `git diff --check` exits 0 and review that:
   - the new migration is `0200_sales_pipeline_currency.sql`, recreates the JSON RPC with the exact three ACL rules, and retains `security invoker`/`search_path`;
   - `database.types.ts` was generated, not hand-edited;
   - no `as` cast, optional `PipelineProject.currency`, altered RLS, or org-default fallback remains in a row-backed pipeline card/table;
   - only aggregate pipeline figures retain `orgCurrency`.

All commands must exit 0 before the build commit.

## Expected changed files

- `supabase/migrations/0200_sales_pipeline_currency.sql` (new)
- `supabase/tests/0057_sales_pipeline_attention.test.sql`
- `pmo-portal/src/lib/supabase/database.types.ts` (generator output)
- `pmo-portal/src/lib/db/dashboard.ts`
- `pmo-portal/src/hooks/useDashboard.ts`
- `pmo-portal/components/SalesKanbanBoard.tsx`
- `pmo-portal/pages/SalesPipeline.tsx`
- `pmo-portal/components/SalesKanbanBoard.test.tsx`
- `pmo-portal/pages/SalesPipeline.test.tsx`
- `pmo-portal/components/salesPipeline.test.ts`
- `pmo-portal/pages/__tests__/coherence-cw-cleanup.test.tsx`
- `pmo-portal/src/components/ui/__tests__/mobile.pr3.test.tsx`

No new dependency, cache, endpoint, UI primitive, or ADR.
