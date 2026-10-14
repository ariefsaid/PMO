# 1008 Project finances — verification evidence (plan Task 45)

Synthetic fixtures only (org `02900000-…-0001`, projects `…0d1/0d2/0d7`, invoice ids `…60001+`),
inserted in one transaction against `supabase db reset`, all queries as an authenticated Finance
profile via JWT claims, transaction rolled back afterwards. No real client data anywhere.

## What this evidences (AC-PFIN-011 / AC-PFIN-018)

Required properties and where each is visible:

| Property | Evidence |
|---|---|
| Project-scoped invoice selection | EXPLAIN 2: one `Index Scan using sales_invoices_vat_project_idx` with `Index Cond: (org_id = …) AND (project_id = …)` — the same index shape appears inside the full-RPC plan |
| No per-invoice subquery / HTTP fetch | EXPLAIN 1/5: the whole reading is ONE statement; the 1050 invoices are aggregated in a single `Hash Join` + `GroupAggregate` (no `loops=1050` inner scans); `pg_get_functiondef` (captured below) shows set-based CTEs only — no per-row loop, no HTTP |
| One generation | EXPLAIN 3: `Index Only Scan using erp_actuals_snapshot_latest_read_idx … Limit rows=1` — the current generation is selected once, not per category |
| All mapped accounts | EXPLAIN 4: snapshot rows join `budget_category_account_map` on `(org_id, erp_account)` in one index nested loop; pgTAP AC-PFIN-011 asserts both mapped accounts of a category sum together |

## Headline numbers (post-ANALYZE, i.e. the production steady state)

| Query | Execution time | Buffers |
|---|---|---|
| EXPLAIN 1 — full `get_project_finances('…0d7')` over **1050 submitted invoices** | **89.1 ms** | shared hit 12 324 |
| EXPLAIN 5 — same body as a prepared statement (parameter planning) | **88.2 ms** | — |
| EXPLAIN 2 — project-scoped submitted-invoice sum | 30.6 ms | 4 231 |
| EXPLAIN 3 — latest-generation selection | 0.98 ms | 13 |
| EXPLAIN 4 — mapped-account category aggregate | 1.8 ms | 54 |

Completeness companions (pgTAP, `0290_project_finances_reads.test.sql`, 43/43 green): the RPC returns
`invoiced 2100.00 / outstanding 1050.00 / settled 1050.00`, `invoice_count 1050` — the exact known
sums of the full >1000-row set, i.e. nothing is truncated to a PostgREST page and nothing is
computed client-side.

## Honest caveat: the zero-stats window

The same fixtures, queried **before** `ANALYZE` (freshly-inserted data with no planner statistics,
as happens inside a test transaction), plan the `work` CTE as a nested loop that re-scans the org's
invoices once per CTE row — 15–25 s and ~2.23 M buffer hits. After `ANALYZE public.sales_invoices`
(the production steady state maintained by autovacuum) the identical call is 89 ms. Operational
consequence: a project-finance read in the seconds right after a bulk import may run against stale
statistics until autovacuum analyzes. No SQL change is made for this: the plan binds the indexes
(SQL A) and forbids speculative caches/denormalization, the SQL text has no per-invoice subquery,
and the degenerate plan is a statistics artifact, not a statement-shape defect.

## Captured plans (abridged)

```
=== EXPLAIN 1: full RPC call, post-ANALYZE (1050 submitted invoices) ===
Function Scan on get_project_finances  (actual time=89.095..89.096 rows=1 loops=1)
  Buffers: shared hit=12324 read=3
Planning Time: 0.615 ms
Execution Time: 89.127 ms

=== EXPLAIN 2: project-scoped submitted-invoice selection ===
GroupAggregate  (actual time=30.415..30.606 rows=1 loops=1)
  ->  Sort (rows=1050)
        ->  Index Scan using sales_invoices_vat_project_idx on sales_invoices si
              Index Cond: ((org_id = '02900000-…-0001') AND (project_id = '02900000-…-0d7'))
              Filter: ((status = ANY ('{Submitted,Unpaid,Paid}')) AND is_active_member())
Execution Time: 30.609 ms

=== EXPLAIN 3: one-generation selection ===
Limit  (actual time=0.943..0.944 rows=1 loops=1)
  ->  Index Only Scan using erp_actuals_snapshot_latest_read_idx on erp_actuals_snapshot s
        Index Cond: (org_id = '02900000-…-0001')
Execution Time: 0.975 ms

=== EXPLAIN 4: mapped-account category aggregate ===
GroupAggregate  (actual time=1.747..1.822 rows=2 loops=1)
  ->  Nested Loop  (rows=4)
        ->  Index Scan using erp_actuals_snapshot_latest_read_idx on erp_actuals_snapshot r
              Filter: ((project_id = '…0d1') AND (snapshot_id = '…0b2') AND is_active_member())
        ->  Index Scan using budget_category_account_map_org_id_erp_account_key on budget_category_account_map m
              Index Cond: ((org_id = '…0001') AND (erp_account = r.account))
Execution Time: 1.825 ms

=== EXPLAIN 5: function body as prepared statement (uuid param) ===
Nested Loop Left Join … Hash Join … GroupAggregate (rows=1050, single scan of the project's invoices)
Execution Time: 88.238 ms
```

`pg_get_functiondef('public.get_project_finances(uuid)')` (full text captured in the run log) shows
one set-based SQL statement: `invoice_rows → inv / work / chosen_budget / budget_sum / gl /
contract_rows / contract_sum` CTEs aggregated into one `jsonb_build_object`. `work` reads the shared
`sales_invoice_work_billed` view (0250 DD-PFIN-9's single billed-work definition); actuals delegate
to the shared `project_mapped_actuals` (SQL E). There is no per-invoice correlated subquery and no
HTTP access of any kind.

## Reproduction

```bash
# one lock hold
scripts/with-db-lock.sh bash -c \
  'supabase db reset && docker exec -i supabase_db_pmo-portal psql -U supabase_admin -d postgres \
   < <evidence script> > evidence.txt'
```

The evidence script: fixture inserts (service role) → `ANALYZE` → `set local role authenticated` +
Finance JWT claims → EXPLAIN 1–5 → `pg_get_functiondef` → `rollback` (no fixtures persist).

## Task 46 — edge/test binding and changed-code coverage evidence

Commands run (actual outputs, 2026-10-14):

- `node scripts/check-edge-fn-test-binding.mjs` → `✓ edge-fn tests bind to shipped handlers (11/11)` —
  the guard sees the new erpnext-sweep/adapter-dispatch test imports (projectInvoiceAttribution,
  projectInvoiceBackfill, projectInvoiceMaintenance, readModelWriters) and they import the shipped
  `./index.ts` handlers.
- `deno test --allow-env --allow-net projectInvoiceAttribution.test.ts projectInvoiceBackfill.test.ts`
  → `ok | 6 passed | 0 failed`; with `projectInvoiceMaintenance.test.ts` → `ok | 9 passed | 0 failed`
  (assertions: `AC-PFIN-004 historical candidate scan is capped, keyset ordered, and scoped to
  current revenue refs`, `AC-PFIN-004 hydrates current ERP provenance with CAS before resolving and
  filling an invoice`, `AC-PFIN-004 authorized maintenance request runs one explicit repair batch…`,
  `AC-PFIN-004 invalid non-empty maintenance modes return 400…`).
- `deno test --allow-env --allow-net readModelWriters.test.ts` (adapter-dispatch) → `ok | 24 passed | 0 failed`.
- Coverage (the issue's 17 owning test files, v8 json) scored by the repo's diff-aware gate
  `node scripts/changed-lines-coverage.mjs --base <merge-base 9325eb45> --min 80`:

```
  [ok] pages/project-detail/ProjectFinancesSection.tsx: 131/131 = 100%
  [ok] pages/SalesInvoices.tsx: 49/49 = 100%
  [ok] src/auth/policy.ts: 2/2 = 100%
  [ok] src/components/InvoiceProjectModal.tsx: 89/89 = 100%
  [ok] src/hooks/useProjectFinances.ts: 8/8 = 100%
  [ok] src/hooks/useRevenue.ts: 22/22 = 100%
  [ok] src/lib/db/revenue.ts: 11/11 = 100%
  [ok] src/lib/invoiceProjectAssignment.ts: 2/2 = 100%
  [ok] src/lib/projectFinances.ts: 48/48 = 100%
  [ok] src/lib/repositories/index.ts: 2/2 = 100%
  [ok] src/lib/repositories/recordHistory.ts: 9/9 = 100%
  [LOW] pages/project-detail/tabs/OverviewTab.tsx: 0/2
  [LOW] pages/RevenueByProject.tsx: 0/38
  [LOW] src/components/history/{historyFields,RecordHistory,useHistoryRefs}: 0/2, 0/6, 0/1
  [LOW] src/hooks/useBudget.ts: 0/1
  [LOW] src/lib/adapterSeam/erpnext/{bodies/salesInvoice,projectMap}: 0/4, 0/6
changed-lines coverage: 373/433 = 86.1% (min 80%) — PASS
```

Every `[LOW]` row is a vitest-4 v8-remap attribution artifact, not an uncovered line: the coverage
json records **0 of ALL statements** for those whole files (e.g. RecordHistory.tsx 0/88,
RevenueByProject.tsx 0/50, projectMap.ts 0/6) even though their owning tests execute exactly those
lines and pass — `RevenueByProject.honesty.test.tsx` clicks `Assign project` and asserts the
`/sales-invoices?attribution=unassigned` navigation (line 160–170); `OverviewTab.test.tsx` asserts
`getAllByTestId('project-finances')` renders exactly once through the `may('view','salesInvoice') &&`
mount (line 218); `useBudget.test.ts` asserts the mutation invalidation calls (line 92–108);
`RecordHistory.test.tsx` renders project_id old/new as names (line 137/376); `projectMap.test.ts`
asserts `invertProjectMap` outputs. Tests importing modules with an explicit `.ts` suffix
(projectMap, actualsSnapshot, bodies/salesInvoice) reproducibly receive zeroed v8 counts while the
same module imported extensionless attributes correctly (policy.ts 2/2) — a vitest v4 sourcemap
quirk, recorded here so the false LOW rows are not mistaken for missing tests.

## Task 47 — mutation proof of the assign RPC role check (AC-PFIN-007)

Mutating ONLY the marked predicate (`-- PFIN_ASSIGN_ROLE_CHECK: …` → `if false then`, backup held at
`/tmp/1008-project-finances-role-check.sql`, never committed) and re-running
`supabase db reset && supabase test db 0290_assign_invoice_project.test.sql` produced the required
role-assertion failures (not a reset/parser error):

```
# Failed test 11: "AC-PFIN-007 Executive cannot assign an invoice project"  — caught: no exception, wanted: 42501
# Failed test 12: "AC-PFIN-007 Project Manager cannot assign an invoice project" — caught: no exception, wanted: 42501
# Failed test 13: "AC-PFIN-007 Engineer cannot assign an invoice project" — caught: no exception, wanted: 42501
# Failed test 26: "AC-PFIN-006 repeated assignment is a no-op" (row mutated by the now-open gate)
# Failed test 27: "AC-PFIN-008 two actual project changes create exactly two history events" (4 vs 2)
Result: FAIL  (5 of 32 failed)
```

After restoring the migration from the backup (backup unlinked, `git diff --check` clean, mutant
absent from the tree), the same file is green:

```
Files=1, Tests=32, Result: PASS
```

The suite binds to the shipped role predicate: breaking it turns the Executive/PM/Engineer denial
assertions red, and only their knock-on effects red alongside.

Also run in the final targeted pgTAP set per the plan: `0278_invoice_change_history.test.sql` and
`record_changes_catalog_gate.test.sql` (invoice history + record-history inventory).


