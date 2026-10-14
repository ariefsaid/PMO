# 1008 Project finances — verification evidence (plan Task 45)

Synthetic fixtures only (org `02870000-…-0001`, projects `…0d1/0d2/0d7`, invoice ids `…60001+`),
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

Completeness companions (pgTAP, `0287_project_finances_reads.test.sql`, 43/43 green): the RPC returns
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
              Index Cond: ((org_id = '02870000-…-0001') AND (project_id = '02870000-…-0d7'))
              Filter: ((status = ANY ('{Submitted,Unpaid,Paid}')) AND is_active_member())
Execution Time: 30.609 ms

=== EXPLAIN 3: one-generation selection ===
Limit  (actual time=0.943..0.944 rows=1 loops=1)
  ->  Index Only Scan using erp_actuals_snapshot_latest_read_idx on erp_actuals_snapshot s
        Index Cond: (org_id = '02870000-…-0001')
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

Also run in the final targeted pgTAP set per the plan: `0278_invoice_change_history.test.sql` and
`record_changes_catalog_gate.test.sql` (invoice history + record-history inventory).
