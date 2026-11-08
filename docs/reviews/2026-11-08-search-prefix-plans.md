# Search Reference-Prefix Query Plans (Evidence for #1164)

Date: 2026-11-08  
Context: Follow-up from issue #1159 (bounded record reference search).  
Scope: Read-only `EXPLAIN (ANALYZE, BUFFERS)` execution plans and dataset row counts captured against the local rich seed database (`supabase_db_pmo-portal`) under `scripts/with-db-lock.sh`. No queries or indexes were modified.

---

## 1. Dataset Row Counts (Local Rich Seed)

Row counts captured from the local seeded database instance (`Default Organization`, `org_id = 00000000-0000-0000-0000-000000000001`):

| Dataset / Column Scope | Row Count |
| :--- | :--- |
| `public.projects` (total) | 17 |
| `public.projects` (`customer_contract_ref` non-null) | 6 |
| `public.projects` (`code` non-null) | 17 |
| `public.projects` (`pmo_project_number` non-null) | 17 |
| `public.sales_invoices` (total) | 1 |
| `public.sales_invoices` (`si_number` non-null) | 1 |
| `public.sales_invoices` (`pmo_number` non-null) | 0 |
| `public.sales_invoices` (`reference_number` non-null) | 0 |
| `public.incoming_payments` (total) | 0 |
| `public.incoming_payments` (`ip_number` non-null) | 0 |
| `public.incoming_payments` (`pmo_number` non-null) | 0 |
| `public.incoming_payments` (`reference_number` non-null) | 0 |

### Sample Reference Values in Seed Data

- `projects.customer_contract_ref`: `MSW-PO-2501`, `CFP-PO-2506`, `ACP-PO-2502`
- `projects.code`: `SP-2405`, `SP-2406`, `SP-2407`
- `projects.pmo_project_number`: `PRJ-26-0005`, `PRJ-26-0006`, `PRJ-26-0007`
- `sales_invoices.si_number`: `DEMO-SI-2402-001`

---

## 2. Indexed Reference-Prefix Query Branches

Migration `0329_record_reference_search.sql` established 9 org-scoped B-tree indexes with `text_pattern_ops` to support exact and prefix queries in `public.search_record_references`:

1. `uxs40_projects_order_ref_idx` on `public.projects (org_id, lower(customer_contract_ref) text_pattern_ops)`
2. `uxs40_projects_code_ref_idx` on `public.projects (org_id, lower(code) text_pattern_ops)`
3. `uxs40_projects_number_ref_idx` on `public.projects (org_id, lower(pmo_project_number) text_pattern_ops)`
4. `uxs40_invoices_si_ref_idx` on `public.sales_invoices (org_id, lower(si_number) text_pattern_ops)`
5. `uxs40_invoices_pmo_ref_idx` on `public.sales_invoices (org_id, lower(pmo_number) text_pattern_ops)`
6. `uxs40_invoices_customer_ref_idx` on `public.sales_invoices (org_id, lower(reference_number) text_pattern_ops)`
7. `uxs40_receipts_ip_ref_idx` on `public.incoming_payments (org_id, lower(ip_number) text_pattern_ops)`
8. `uxs40_receipts_pmo_ref_idx` on `public.incoming_payments (org_id, lower(pmo_number) text_pattern_ops)`
9. `uxs40_receipts_payment_ref_idx` on `public.incoming_payments (org_id, lower(reference_number) text_pattern_ops)`

---

## 3. Query Plans and Planner Choice

Due to small dataset cardinality on the local seed (17 projects, 1 sales invoice, 0 incoming payments fitting into a single disk page), all candidate B-tree indexes leading with `org_id` evaluate to near-identical minimal cost estimates (`cost=0.14..8.17`). PostgreSQL chooses an Index Scan on an org-scoped index and resolves the prefix filter within memory/buffer cache.

### Branch 1: `projects.customer_contract_ref` prefix

- **Supporting Index:** `uxs40_projects_order_ref_idx`
- **Query:**
  ```sql
  SELECT 'project'::text, p.id, false
    FROM public.projects p
   WHERE p.org_id = '00000000-0000-0000-0000-000000000001' AND p.archived_at IS NULL
     AND lower(p.customer_contract_ref) LIKE 'msw%' ESCAPE E'\\'
     AND lower(p.customer_contract_ref) <> 'msw'
   ORDER BY p.id LIMIT 9;
  ```
- **Planner Choice:** Index Scan (`uxs40_projects_number_ref_idx` on `org_id`, cost `0.14..8.17`).
- **Plan:**
  ```text
  Limit  (cost=8.18..8.19 rows=1 width=49) (actual time=0.120..0.121 rows=1 loops=1)
    Buffers: shared hit=23
    ->  Sort  (cost=8.18..8.19 rows=1 width=49) (actual time=0.119..0.120 rows=1 loops=1)
          Sort Key: id
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=23
          ->  Index Scan using uxs40_projects_number_ref_idx on projects p  (cost=0.14..8.17 rows=1 width=49) (actual time=0.083..0.101 rows=1 loops=1)
                Index Cond: (org_id = '00000000-0000-0000-0000-000000000001'::uuid)
                Filter: ((archived_at IS NULL) AND (lower(customer_contract_ref) ~~ 'msw%'::text) AND (lower(customer_contract_ref) <> 'msw'::text))
                Rows Removed by Filter: 16
                Buffers: shared hit=20
  Planning Time: 0.397 ms
  Execution Time: 0.148 ms
  ```

---

### Branch 2: `projects.code` prefix

- **Supporting Index:** `uxs40_projects_code_ref_idx`
- **Query:**
  ```sql
  SELECT 'project'::text, p.id, false
    FROM public.projects p
   WHERE p.org_id = '00000000-0000-0000-0000-000000000001' AND p.archived_at IS NULL
     AND lower(p.code) LIKE 'sp%' ESCAPE E'\\'
     AND lower(p.code) <> 'sp'
   ORDER BY p.id LIMIT 9;
  ```
- **Planner Choice:** Index Scan (`uxs40_projects_number_ref_idx` on `org_id`, cost `0.14..8.17`).
- **Plan:**
  ```text
  Limit  (cost=8.18..8.19 rows=1 width=49) (actual time=0.043..0.045 rows=9 loops=1)
    Buffers: shared hit=8
    ->  Sort  (cost=8.18..8.19 rows=1 width=49) (actual time=0.042..0.043 rows=9 loops=1)
          Sort Key: id
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=8
          ->  Index Scan using uxs40_projects_number_ref_idx on projects p  (cost=0.14..8.17 rows=1 width=49) (actual time=0.017..0.036 rows=9 loops=1)
                Index Cond: (org_id = '00000000-0000-0000-0000-000000000001'::uuid)
                Filter: ((archived_at IS NULL) AND (lower(code) ~~ 'sp%'::text) AND (lower(code) <> 'sp'::text))
                Rows Removed by Filter: 8
                Buffers: shared hit=8
  Planning Time: 0.213 ms
  Execution Time: 0.069 ms
  ```

---

### Branch 3: `projects.pmo_project_number` prefix

- **Supporting Index:** `uxs40_projects_number_ref_idx`
- **Query:**
  ```sql
  SELECT 'project'::text, p.id, false
    FROM public.projects p
   WHERE p.org_id = '00000000-0000-0000-0000-000000000001' AND p.archived_at IS NULL
     AND lower(p.pmo_project_number) LIKE 'pmo%' ESCAPE E'\\'
     AND lower(p.pmo_project_number) <> 'pmo'
   ORDER BY p.id LIMIT 9;
  ```
- **Planner Choice:** Index Scan (`uxs40_projects_code_ref_idx` on `org_id`, cost `0.14..8.17`).
- **Plan:**
  ```text
  Limit  (cost=8.18..8.19 rows=1 width=49) (actual time=0.071..0.071 rows=0 loops=1)
    Buffers: shared hit=21
    ->  Sort  (cost=8.18..8.19 rows=1 width=49) (actual time=0.070..0.070 rows=0 loops=1)
          Sort Key: id
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=21
          ->  Index Scan using uxs40_projects_code_ref_idx on projects p  (cost=0.14..8.17 rows=1 width=49) (actual time=0.066..0.067 rows=0 loops=1)
                Index Cond: (org_id = '00000000-0000-0000-0000-000000000001'::uuid)
                Filter: ((archived_at IS NULL) AND (lower(pmo_project_number) ~~ 'pmo%'::text) AND (lower(pmo_project_number) <> 'pmo'::text))
                Rows Removed by Filter: 17
                Buffers: shared hit=21
  Planning Time: 0.197 ms
  Execution Time: 0.094 ms
  ```

---

### Branch 4: `sales_invoices.si_number` prefix

- **Supporting Index:** `uxs40_invoices_si_ref_idx`
- **Query:**
  ```sql
  SELECT 'invoice'::text, si.id, false
    FROM public.sales_invoices si
   WHERE si.org_id = '00000000-0000-0000-0000-000000000001'
     AND lower(si.si_number) LIKE 'si%' ESCAPE E'\\'
     AND lower(si.si_number) <> 'si'
   ORDER BY si.id LIMIT 9;
  ```
- **Planner Choice:** Index Scan (`uxs40_invoices_customer_ref_idx` on `org_id`, cost `0.14..8.17`).
- **Plan:**
  ```text
  Limit  (cost=8.18..8.19 rows=1 width=49) (actual time=0.063..0.064 rows=0 loops=1)
    Buffers: shared hit=2
    ->  Sort  (cost=8.18..8.19 rows=1 width=49) (actual time=0.063..0.063 rows=0 loops=1)
          Sort Key: id
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=2
          ->  Index Scan using uxs40_invoices_customer_ref_idx on sales_invoices si  (cost=0.14..8.17 rows=1 width=49) (actual time=0.060..0.060 rows=0 loops=1)
                Index Cond: (org_id = '00000000-0000-0000-0000-000000000001'::uuid)
                Filter: ((lower(si_number) ~~ 'si%'::text) AND (lower(si_number) <> 'si'::text))
                Rows Removed by Filter: 1
                Buffers: shared hit=2
  Planning Time: 0.200 ms
  Execution Time: 0.081 ms
  ```

---

### Branch 5: `sales_invoices.pmo_number` prefix

- **Supporting Index:** `uxs40_invoices_pmo_ref_idx`
- **Query:**
  ```sql
  SELECT 'invoice'::text, si.id, false
    FROM public.sales_invoices si
   WHERE si.org_id = '00000000-0000-0000-0000-000000000001'
     AND lower(si.pmo_number) LIKE 'pmo%' ESCAPE E'\\'
     AND lower(si.pmo_number) <> 'pmo'
   ORDER BY si.id LIMIT 9;
  ```
- **Planner Choice:** Index Scan (`sales_invoices_org_pmo_number_uidx` on `org_id`, cost `0.12..8.15`).
- **Plan:**
  ```text
  Limit  (cost=8.16..8.17 rows=1 width=49) (actual time=0.006..0.007 rows=0 loops=1)
    Buffers: shared hit=2
    ->  Sort  (cost=8.16..8.17 rows=1 width=49) (actual time=0.006..0.006 rows=0 loops=1)
          Sort Key: id
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=2
          ->  Index Scan using sales_invoices_org_pmo_number_uidx on sales_invoices si  (cost=0.12..8.15 rows=1 width=49) (actual time=0.003..0.003 rows=0 loops=1)
                Index Cond: (org_id = '00000000-0000-0000-0000-000000000001'::uuid)
                Filter: ((lower(pmo_number) ~~ 'pmo%'::text) AND (lower(pmo_number) <> 'pmo'::text))
                Buffers: shared hit=2
  Planning Time: 0.148 ms
  Execution Time: 0.030 ms
  ```

---

### Branch 6: `sales_invoices.reference_number` prefix

- **Supporting Index:** `uxs40_invoices_customer_ref_idx`
- **Query:**
  ```sql
  SELECT 'invoice'::text, si.id, false
    FROM public.sales_invoices si
   WHERE si.org_id = '00000000-0000-0000-0000-000000000001'
     AND lower(si.reference_number) LIKE 'ref%' ESCAPE E'\\'
     AND lower(si.reference_number) <> 'ref'
   ORDER BY si.id LIMIT 9;
  ```
- **Planner Choice:** Index Scan (`uxs40_invoices_pmo_ref_idx` on `org_id`, cost `0.14..8.17`).
- **Plan:**
  ```text
  Limit  (cost=8.18..8.19 rows=1 width=49) (actual time=0.042..0.042 rows=0 loops=1)
    Buffers: shared hit=2
    ->  Sort  (cost=8.18..8.19 rows=1 width=49) (actual time=0.041..0.041 rows=0 loops=1)
          Sort Key: id
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=2
          ->  Index Scan using uxs40_invoices_pmo_ref_idx on sales_invoices si  (cost=0.14..8.17 rows=1 width=49) (actual time=0.036..0.036 rows=0 loops=1)
                Index Cond: (org_id = '00000000-0000-0000-0000-000000000001'::uuid)
                Filter: ((lower(reference_number) ~~ 'ref%'::text) AND (lower(reference_number) <> 'ref'::text))
                Rows Removed by Filter: 1
                Buffers: shared hit=2
  Planning Time: 0.171 ms
  Execution Time: 0.069 ms
  ```

---

### Branch 7: `incoming_payments.ip_number` prefix

- **Supporting Index:** `uxs40_receipts_ip_ref_idx`
- **Query:**
  ```sql
  SELECT 'receipt'::text, ip.id, false
    FROM public.incoming_payments ip
   WHERE ip.org_id = '00000000-0000-0000-0000-000000000001'
     AND lower(ip.ip_number) LIKE 'ip%' ESCAPE E'\\'
     AND lower(ip.ip_number) <> 'ip'
   ORDER BY ip.id LIMIT 9;
  ```
- **Planner Choice:** Index Scan (`uxs40_receipts_payment_ref_idx` on `org_id`, cost `0.14..8.17`).
- **Plan:**
  ```text
  Limit  (cost=8.18..8.19 rows=1 width=49) (actual time=0.006..0.006 rows=0 loops=1)
    Buffers: shared hit=2
    ->  Sort  (cost=8.18..8.19 rows=1 width=49) (actual time=0.005..0.005 rows=0 loops=1)
          Sort Key: id
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=2
          ->  Index Scan using uxs40_receipts_payment_ref_idx on incoming_payments ip  (cost=0.14..8.17 rows=1 width=49) (actual time=0.003..0.003 rows=0 loops=1)
                Index Cond: (org_id = '00000000-0000-0000-0000-000000000001'::uuid)
                Filter: ((lower(ip_number) ~~ 'ip%'::text) AND (lower(ip_number) <> 'ip'::text))
                Buffers: shared hit=2
  Planning Time: 0.131 ms
  Execution Time: 0.026 ms
  ```

---

### Branch 8: `incoming_payments.pmo_number` prefix

- **Supporting Index:** `uxs40_receipts_pmo_ref_idx`
- **Query:**
  ```sql
  SELECT 'receipt'::text, ip.id, false
    FROM public.incoming_payments ip
   WHERE ip.org_id = '00000000-0000-0000-0000-000000000001'
     AND lower(ip.pmo_number) LIKE 'pmo%' ESCAPE E'\\'
     AND lower(ip.pmo_number) <> 'pmo'
   ORDER BY ip.id LIMIT 9;
  ```
- **Planner Choice:** Index Scan (`incoming_payments_org_pmo_number_uidx` on `org_id`, cost `0.12..8.15`).
- **Plan:**
  ```text
  Limit  (cost=8.16..8.17 rows=1 width=49) (actual time=0.004..0.004 rows=0 loops=1)
    Buffers: shared hit=2
    ->  Sort  (cost=8.16..8.17 rows=1 width=49) (actual time=0.003..0.003 rows=0 loops=1)
          Sort Key: id
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=2
          ->  Index Scan using incoming_payments_org_pmo_number_uidx on incoming_payments ip  (cost=0.12..8.15 rows=1 width=49) (actual time=0.002..0.002 rows=0 loops=1)
                Index Cond: (org_id = '00000000-0000-0000-0000-000000000001'::uuid)
                Filter: ((lower(pmo_number) ~~ 'pmo%'::text) AND (lower(pmo_number) <> 'pmo'::text))
                Buffers: shared hit=2
  Planning Time: 0.072 ms
  Execution Time: 0.014 ms
  ```

---

### Branch 9: `incoming_payments.reference_number` prefix

- **Supporting Index:** `uxs40_receipts_payment_ref_idx`
- **Query:**
  ```sql
  SELECT 'receipt'::text, ip.id, false
    FROM public.incoming_payments ip
   WHERE ip.org_id = '00000000-0000-0000-0000-000000000001'
     AND lower(ip.reference_number) LIKE 'pay%' ESCAPE E'\\'
     AND lower(ip.reference_number) <> 'pay'
   ORDER BY ip.id LIMIT 9;
  ```
- **Planner Choice:** Index Scan (`uxs40_receipts_pmo_ref_idx` on `org_id`, cost `0.14..8.17`).
- **Plan:**
  ```text
  Limit  (cost=8.18..8.19 rows=1 width=49) (actual time=0.004..0.004 rows=0 loops=1)
    Buffers: shared hit=2
    ->  Sort  (cost=8.18..8.19 rows=1 width=49) (actual time=0.003..0.004 rows=0 loops=1)
          Sort Key: id
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=2
          ->  Index Scan using uxs40_receipts_pmo_ref_idx on incoming_payments ip  (cost=0.14..8.17 rows=1 width=49) (actual time=0.002..0.002 rows=0 loops=1)
                Index Cond: (org_id = '00000000-0000-0000-0000-000000000001'::uuid)
                Filter: ((lower(reference_number) ~~ 'pay%'::text) AND (lower(reference_number) <> 'pay'::text))
                Buffers: shared hit=2
  Planning Time: 0.072 ms
  Execution Time: 0.015 ms
  ```

---

## 4. Observations & Conclusions

1. **Planner Cost Equivalence on Small Datasets:** On the local seed environment with low table cardinalities (17 projects, 1 invoice, 0 payments), every table fits in a single page. Every org-scoped index has the identical base cost of 0.14 to read the root page and traverse the B-tree for `org_id`.
2. **Buffer Hits and Latency:** All 9 branches execute entirely in memory (`shared hit=2..23`), with execution latency strictly bounded under 0.15 ms per branch.
3. **No Query or Index Changes:** Verified that all 9 indexes remain as defined by migration `0329_record_reference_search.sql`. No database migrations, queries, or index configurations were altered.
