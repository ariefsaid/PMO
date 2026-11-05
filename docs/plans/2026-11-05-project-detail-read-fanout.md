# Plan: project detail read fan-out (33 → ~5 requests)

Owner rule: performance is P0 app-wide (50-user load, measured before/after). Scope: `/projects/:projectId` (Overview, the
default tab). Identical data, identical access rules. Plan only; no code written.

## Method and honesty note

Inventory below is **static** (hooks → repositories → `src/lib/db/*` → PostgREST call), read from the tree at `a7083324d`.
`node_modules` is absent in this worktree, so the measured 33 was **not** re-captured here. Static count of route-specific
requests = **22** (23 when a work order has incomplete billing figures). The other ~10–11 of the 33 are presumed shell chrome
(org features, approvals count, finance position, saved views…), outside this route; **Task 0 pins the split** with the capture
script before any code lands. If the shell share differs, the per-step deltas below still hold; only the totals shift.

Counted case (the worst, most-used): finance-lens role (Admin / Executive / Finance / Project Manager), on-hand project,
desktop, Overview tab. Delivery-lens roles fire fewer (~10 → ~4); Task 0 captures both.

## Inventory: requests fired on mount (Overview)

"Fold" = needed for first paint above the fold. Shared query keys are one request regardless of consumers.

| # | Request | Hook (src/hooks) → DAL | Consumers | Above fold? |
|---|---|---|---|---|
| 1 | `GET projects?id=eq.` (+refs) | `useProjects.useProject` → `db/projects.getProject` | `ProjectDetail` | yes |
| 2 | `rpc get_project_vat_editability` | `useProjectVatEditability` → `db/projects` | `ProjectDetailHeader` (only the contract-value editor reads it) | **no** |
| 3 | `rpc get_project_milestones` | `useMilestones` → `db/milestones` | header facts (progress), attention, delivery block, S-curve | yes |
| 4 | `GET project stage entries` | `useProjectStageEntries` → `repositories.projectStage.list` | `StageHistory` inside a **collapsed** `<details>` | **no** |
| 5 | `GET sales_invoices?project_id=` (paged) | `useRevenue.useSalesInvoices` | primary action (overdue), money block | yes |
| 6 | `GET organizations` (currency, tz) | `useFxOrgDay` → `db/fxRates.fxContext` | attention, primary action | yes (org constant) |
| 7 | `rpc get_project_finances` | `useProjectFinances` | money block, cost block, primary action, attention | yes |
| 8 | `rpc get_project_billing` | `useProgressBilling.useProjectBilling` | money block, primary action | yes |
| 9 | `GET tasks?project_id=` | `useTasks` | attention, delivery block, S-curve | yes |
| 10–13 | `GET budget_versions` · `budget_line_items` · `budget_version_editors` · `rpc budget_version_read_totals` | `useBudget.useBudgetVersions` → `db/budgets.listBudgetVersions` (4 requests) | `useBudgetPosition` → cost block + attention; reads only the **Active** version's lines | yes, but 3 of 4 unused here |
| 14 | `GET procurements?project_id=` | `useProcurements.useProjectProcurements` | cost block, attention (approvers) | yes |
| 15 | `GET boq_items?project_id=` | `useProgressBilling.useBoqItems` | money block | yes |
| 16 | `rpc project_committed_spend` | `useProjectCommittedSpend` | cost block | yes |
| 17 | `GET external_domain_ownership` | `useExternalDomainOwnership` (inside #16) | cost block commitment source | yes (org constant; may already be shared with shell key, Task 0 checks) |
| 18 | `rpc org_reads_erp_ledger` | inside #16 | cost block ledger basis | yes (org constant) |
| 19 | `GET work_orders?project_id=` | `useWorkOrders.useProjectWorkOrders` | `BillingMilestonesBlock` (Overview foot) | **no** (below fold) |
| 20 | `GET work_order_billing` (+ `work_order_billing_lines` when a row is incomplete) | `useWorkOrderBilling` | same | **no** |
| 21 | `GET work_order_uninvoiced_acceptance` | `useWorkOrderAcceptanceAge` | same | **no** |
| 22 | `GET comments?entity=project` | `useComments` | `ActivityFooter` (count only; drawer closed) | **no** (foot) |

Finding: `useProjectBudget` (`rpc get_project_budget`) is **not** fired. It lives in `ProjectFinancialSummary`, which the
compact header used here never mounts. No action needed; recorded so nobody "fixes" it.

Duplicates (same data, different keys): none that double-fetch on this route. `project-finances`, `milestones`, `tasks`,
`project-billing`, `salesInvoices`, `procurements/by-project` are single shared keys. The real waste is **over-fetching**
(#10–13 pull editors, totals and every version to read one Active version) and **non-first-paint** reads (#2, #4, #19–22).

## Steps and targets (route-specific request count)

| Step | Change | Removes | Left |
|---|---|---|---|
| 0 | Baseline capture + request-count harness | – | 22 (23) |
| 1 | Defer non-first-paint reads | #2, #4, #19–21 (and the conditional lines request) | **17** |
| 2 | Lean Active-budget read | 3 of #10–13 | **14** |
| 3 | `get_project_overview_read` read-model RPC | 10 reads → 1 | **5** |

Step 3 leaves: project (#1), overview read (new), invoices (#5), tasks (#9), procurements (#14). Project and overview read
fire **in parallel** from the URL id (no waterfall). Add the presumed ~10 shell requests for page totals (33 → 27 → 24 → 15);
shell trimming is a separate lane, not in this plan.

## Task 0: baseline and harness (~5 min each)

- **T0.1** Capture: with the local stack up and `npm run dev` running, `cd pmo-portal && PERF_VERBOSE=1 node ../scripts/perf/measure.mjs /projects/<on-hand-id>` as a finance user (default `exec@acme.test`) and again with `PERF_USER=` an engineer. Save the by-endpoint tally under the PR description. Confirms 22/23 vs shell split.
- **T0.2** New RTL test `pmo-portal/pages/project-detail/__tests__/ProjectDetail.requestCount.test.tsx`: mock `@/src/lib/supabase/client` with a recording stub (`from(table)` and `rpc(name)` push to a log and return empty-but-valid builders), mount `ProjectDetail` in `QueryClientProvider` + `MemoryRouter` for a Finance user, await idle, assert the **set of endpoints** and the **total**. Initially asserts today's 22 (documents the baseline, goes red→updated per step). Verify: `npx vitest run pages/project-detail/__tests__/ProjectDetail.requestCount.test.tsx`.

## Step 1: defer what is not first paint

**1a. VAT editability on demand.** `ProjectDetailHeader.tsx:304` calls `useProjectVatEditability(project.id)` on mount; only the editor (`vatLocked`, lines 305/615–641) uses it, and `beginValueEdit` (line 358) already calls `vatCheck.refetch()`.
- Files: `pmo-portal/src/hooks/useProjectVatEditability.ts` (add `enabled` param, default `true` for other callers), `pmo-portal/pages/project-detail/ProjectDetailHeader.tsx` (pass `valueEditing`).
- Test: requestCount test asserts no `get_project_vat_editability` on mount; existing header tests that open the editor still pass. Add one: opening the editor fires it once and PPN stays locked until it resolves.
- Risk: low. `refetch()` ignores `enabled`, so the begin-edit path is unchanged; the stale-save path (line 422) is unchanged.

**1b. Stage history on open.** `ProjectDetail.tsx` `SalesHistoryDisclosure` renders `StageHistory` inside a closed `<details>`, which fires #4 on mount (both desktop and phone placements).
- Files: `pmo-portal/pages/project-detail/ProjectDetail.tsx` (track first `onToggle` open, mount `StageHistory` after), `pmo-portal/src/hooks/useProjectStageEntries.ts` unchanged.
- Test: requestCount asserts no stage-entries read on mount; `ProjectDetail.history.test.tsx` updated to open the disclosure first (deliberate UX-neutral step change, goal oracle intact: history shows after open).
- Risk: low. Flash of loading on first open; acceptable (it is a closed disclosure).

**1c. Work-order billing block when it nears the viewport.** `BillingMilestonesBlock` (Overview foot) fires 3–4 reads (#19–21).
- Files: new `pmo-portal/src/components/ui/WhenNearViewport.tsx` (IntersectionObserver, `rootMargin: 300px`, renders children once seen; **renders children immediately when `IntersectionObserver` is absent**, so jsdom/unit tests are unchanged; reserves the block's min-height to avoid layout shift), used in `ProjectSections.tsx` `OverviewContent` around the two `<BillingMilestonesBlock>` sites.
- Test: unit for the wrapper (stub IO: not intersecting → children absent; intersect → present); requestCount asserts no `work_orders` / `work_order_billing` on mount in jsdom only if IO stub is installed.
- Risk: **medium**. Playwright specs that assert the block without scrolling would see it absent. Run `node scripts/affected-e2e.mjs --run` on the specs that visit `/projects/:id`; fix by scrolling in the journey only if the real user would scroll (BDD rule: goal oracle unchanged). Fallback if too many specs break: replace the observer with a post-first-paint idle mount.

Local gate for Step 1: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest files, `node scripts/affected-e2e.mjs --run`, `scripts/ux-proof.sh` on `/projects/:id`.

## Step 2: lean Active-budget read

`useBudgetPosition` (`useProjectPosition.ts:25`) only needs the Active version's line items by category, but calls `useBudgetVersions` (4 requests: versions, all lines, editors, read totals). The Budget tab keeps the full read.

- Files: `pmo-portal/src/lib/db/budgets.ts` (new `getActiveBudgetLines(projectId)`: one `budget_versions` select with `.eq('status','Active')` and embedded `budget_line_items(category,budgeted_amount)`; uniqueness is guaranteed by `budget_versions_one_active_idx`), `pmo-portal/src/lib/repositories/budget.ts` (+ contract type), `pmo-portal/src/hooks/useBudget.ts` (`useActiveBudgetLines`, key `['budget-active-lines', orgId, projectId]`; add it to the same invalidation lists as `budget-versions` so activate/edit/archive refresh it), `pmo-portal/pages/project-detail/useProjectPosition.ts` (swap the source; `hasBudget`, `rows`, `budget` outputs unchanged).
- Test: unit for the DAL (one request, Active only, none → `[]`); a parity test feeding the same fixtures to old and new derivation and asserting identical `rows/budget/hasBudget`; requestCount asserts exactly one budget request. Invalidation test: activating a version refreshes the position.
- Risk: **medium**. The only way to break it is a missed invalidation (stale Overview after a budget change). Grep every `invalidateQueries` on `budget-versions` (`useBudget.ts`, `projectQueryKeys.ts`) and mirror each.
- RLS: same tables, same caller; no access change.

## Step 3: read-model RPC `get_project_overview_read`

One call returning every above-fold summary the Overview renders, so ten reads (#6, #7, #8, #15–18, #3, the Step-2 read, #22's count) become one. Remaining separate reads are row lists that are not summaries (invoices, tasks, procurements) plus the project record.

**Function** (new migration, number allocated at build time, next after `0642`; use `scripts/renumber-migration.sh` on collision; paired `supabase/migrations/rollback/<n>_..._down.sql`):

```
public.get_project_overview_read(
  p_project_id uuid,
  p_include_money boolean,        -- caller passes can('view','salesInvoice'); gates finances/billing/boq
  p_include_commitments boolean,  -- caller passes can('view','procurement'); gates committed/ownership/ledger
  p_include_budget boolean        -- false for delivery lens (matches today's disabled hook)
) returns table (
  project_id                       uuid,
  finances                         jsonb,    -- = get_project_finances(p_project_id); null unless p_include_money
  billing                          jsonb,    -- = get_project_billing(p_project_id); null unless p_include_money
  boq_items                        jsonb,    -- array of boq_items rows for the project (same columns the DAL selects today); null unless p_include_money
  active_budget_lines              jsonb,    -- [{category text, budgeted_amount numeric}] of the Active version; [] none; null unless p_include_budget
  has_active_budget                boolean,  -- null unless p_include_budget
  committed_spend                  jsonb,    -- array of {currency text, amount numeric, is_project_currency boolean} = project_committed_spend rows; null unless p_include_commitments
  procurement_externally_owned     boolean,  -- exists external_domain_ownership row, domain='procurement'; null unless p_include_commitments
  reads_erp_ledger                 boolean,  -- = org_reads_erp_ledger(); null unless p_include_commitments
  milestones                       jsonb,    -- array of get_project_milestones rows, ordered (sort_order, id)
  comment_count                    integer,  -- count of comments, entity_type='project', entity_id=p_project_id
  org_default_currency             text,     -- organizations.default_currency (fx context)
  org_default_timezone             text      -- organizations.default_timezone, 'UTC' fallback as today
)
language plpgsql stable security invoker set search_path = public, pg_temp
```

- **Access rules identical, nothing new to trust:** SECURITY INVOKER, no definer. Every part calls the same function or table the page reads today under the caller's role: `get_project_finances` / `get_project_billing` / `project_committed_spend` / `get_project_milestones` (already invoker with their own role gates), `org_reads_erp_ledger()` (same definer function the page already calls), and tables under RLS. A caller who is refused today is refused identically (the inner function raises the same error and the whole call fails the same way, which the FE already treats as "section unavailable"). The `p_include_*` flags only *skip* work the FE already skips; they cannot widen access because the inner gates re-check the caller's real role.
- Grants: revoke from `public`/`anon`, grant execute to `authenticated` only (house rule for new RPCs).
- Not included on purpose: invoice rows, task rows, procurement rows (list data with its own pagination, and the invoice/task hooks are used by the tabs), project header (its embedded refs are a different shape; fetched in parallel, no waterfall).

**FE wiring (seed, don't rewrite consumers):**
- `pmo-portal/src/lib/db/projectOverview.ts` (new): `getProjectOverviewRead(projectId, flags)`; reuse the existing parsers (`parseProjectReceiptCash`, `parseContractExcess`, `isProjectFinances`, billing/boq/milestone mappers). Export the payload-level parsers from `db/revenue.ts`, `db/progressBilling.ts`, `db/milestones.ts`, `db/procurements.ts` so RPC and per-endpoint paths share one parser (no copies).
- `pmo-portal/src/lib/repositories/projectOverview.ts` (new) + register in `repositories/index.ts` (ADR-0017 seam).
- `pmo-portal/src/hooks/useProjectOverviewRead.ts` (new): `useQuery` keyed `['project-overview-read', orgId, projectId, flags]`. In its `queryFn`, after parsing, `queryClient.setQueryData` the existing keys: `project-finances`, `project-billing`, `boq-items`, `milestones`, `project-committed-spend`, `externalDomainOwnership`, `org-reads-erp-ledger`, `fx-context`, `budget-active-lines`. Leaf hooks are untouched, so the tabs and every other consumer keep working and invalidations keep working.
- `pmo-portal/pages/project-detail/ProjectDetail.tsx`: call `useProjectOverviewRead(projectId, flags)` beside `useProject`; the existing loading skeleton shows until **both** settle (success **or** error). On error the leaf hooks fetch individually (graceful degradation to today's behaviour). Without this gate leaf hooks would mount first and fire their own reads.
- `ProjectActivity.tsx` `ActivityFooter`: show `comment_count` from the read; fetch the comment list only when the drawer opens (`useComments(..., { enabled: open })`). Visible text unchanged ("Activity · N comments").
- Seeded values get `dataUpdatedAt = now`, so with the app's 30 s `staleTime` leaf hooks do not refetch on mount.

**Tests:**
- pgTAP `supabase/tests/project_overview_read.test.sql` (run only this file under `scripts/with-db-lock.sh`): for each of Admin, Executive, Finance, Project Manager, Engineer, and a user from a second org: (a) the function's `finances`, `billing`, `committed_spend`, `milestones`, `active_budget_lines`, `reads_erp_ledger` equal the individual calls' output; (b) a role the inner function refuses is refused with the same SQLSTATE; (c) second-org caller sees nothing of the first org's project; (d) flags false → nulls and no inner call. **Mutation check:** change `security invoker` to a definer or drop a flag gate, the access tests must go red.
- Vitest: DAL parser parity (RPC fixture vs per-endpoint fixtures produce deeply equal objects); hook test that a successful read seeds each key and that leaf hooks mounted afterwards issue no request; error path test that leaf hooks fetch on their own; requestCount test now asserts the five endpoints exactly.
- Existing suites to keep green: `ProjectFinancesSection.test.tsx`, `ProjectDetail.*.test.tsx`, `OverviewTab.test.tsx`, `BillingMilestonesBlock.test.tsx`, `useProjectFinances*.test.tsx`.

**Risk:** **high-ish (money numbers on screen).** Mitigations: parsers shared not copied; parity tests per role; shape comes from the same SQL functions, not re-implemented SQL; leaf hooks untouched; one release gate: owner-visible before/after screenshots of Money/Cost blocks on seeded projects (`scripts/ux-proof.sh`) must be pixel-identical in figures. Money-path files are touched (finance/billing readers only, no writes): ship this step **alone**, per the batch rule. Deploy order is back to front: migration, then FE; the FE must tolerate the function being absent (error → individual reads), so a FE deployed first degrades rather than breaks.

## AC table (ADR-0010: one owning test each, lowest sufficient layer)

| AC | Statement (Given/When/Then) | Layer | Owning test |
|---|---|---|---|
| AC-PERF-001 | Given a finance-lens user on an on-hand project, when `/projects/:id` mounts, then no VAT-editability read fires until the contract-value editor opens | Unit (RTL) | `ProjectDetail.requestCount.test.tsx` |
| AC-PERF-002 | Given the sales-history disclosure is closed, when the page mounts, then no stage-entries read fires; opening it loads and shows the history | Unit (RTL) | `ProjectDetail.history.test.tsx` |
| AC-PERF-003 | Given the work-order billing block is outside the viewport, when the page mounts, then no work-order reads fire; when it nears the viewport they fire once | Unit (RTL, IO stub) | `WhenNearViewport.test.tsx` + `ProjectDetail.requestCount.test.tsx` |
| AC-PERF-004 | Given an Active budget version, when the Overview mounts, then exactly one budget read fires and the category positions equal the full-read derivation | Unit | `useProjectPosition.activeBudget.test.tsx` |
| AC-PERF-005 | Given any role, when the overview read runs, then each section equals the corresponding individual RPC output and a refused role gets the same refusal | pgTAP | `supabase/tests/project_overview_read.test.sql` |
| AC-PERF-006 | Given a user in another org, when they call the overview read for this project, then nothing of the project is returned | pgTAP | same file |
| AC-PERF-007 | Given the overview read succeeded, when leaf hooks mount, then they issue no request and render the same figures as the per-endpoint path | Unit | `useProjectOverviewRead.test.tsx` |
| AC-PERF-008 | Given the overview read fails, when the page renders, then each section falls back to its own read and the page still loads | Unit | same file |
| AC-PERF-009 | Given a finance-lens user, when `/projects/:id` cold-loads, then route-specific requests are ≤ 5 (project, overview read, invoices, tasks, procurements) | Unit (RTL) + route capture | `ProjectDetail.requestCount.test.tsx`, `scripts/perf/measure.mjs` |

Traceability: each test names its `AC-PERF-###` in the `it(...)` / pgTAP description per the repo convention.

## Order, batching, verify

Order: T0 → Step 1 (1a, 1b, 1c as three branches) → Step 2 → Step 3. Steps 1 and 2 batch into one PR to `dev` (3–5 related branches, `--no-ff`); Step 3 ships alone (money readers). Workers push branches only; no PR without the owner's say.

Per-branch local gate (CLAUDE.md): `npm run check:guards`; `npm run typecheck`; `npx eslint --max-warnings=0 <touched>`; the directly touched test files only; `node scripts/affected-e2e.mjs --run` for UI steps; `scripts/ux-proof.sh` on `/projects/:id`; for Step 3, `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/project_overview_read.test.sql'` (reset because a migration was added).

After-each-step measurement (the owner's before/after): rerun T0.1 and paste the by-endpoint tally. Then, at the end, a 50-user pass is the owner's performance gate and is out of scope for this plan beyond providing the counts.

## Open items for the Director

1. Task 0 may show a different shell share than ~10; if so, report totals again (route deltas stand).
2. Delivery-lens and phone placements are captured in T0.1 but not planned separately; they reach the same end state via the same code.
3. Comments count UX is unchanged here; if the owner prefers hiding the count until the drawer opens, Step 1 can drop #22 without the RPC.
4. Org constants (ownership, ledger basis, fx context) could also get a longer `staleTime` to help in-app navigation; it does not reduce cold-load count, so it is left out.
