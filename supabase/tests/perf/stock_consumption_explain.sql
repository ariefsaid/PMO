-- NFR-STK-003 record (#1512 S5.6): the consumption report at 200,000 ledger rows over 20 projects x 10 work items x 12 items x 24 months.
-- NOT part of `supabase test db`. Run on the LOCAL stack only, under the lock:
--   scripts/with-db-lock.sh bash -c 'psql "$DB_URL" -f supabase/tests/perf/stock_consumption_explain.sql'
-- One scratch transaction that rolls back. Bulk rows go in with session_replication_role = replica (FK and guard triggers off,
-- CHECK constraints still on), so the load needs no documents; the report only joins boq_items, stock_items, stock_units, profiles.
\timing on
begin;
set local session_replication_role = replica;
-- 19 extra (FK-less) projects + P001 (the seeded project the report is asked about); 10 work items each.
create temp table perf_p as
  select case when n = 1 then '40000000-0000-0000-0000-000000000001'::uuid else gen_random_uuid() end as project_id, n from generate_series(1, 20) n;
create temp table perf_b as
  select gen_random_uuid() as boq_id, p.project_id, w from perf_p p cross join generate_series(1, 10) w;
insert into public.boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate)
  select boq_id, '00000000-0000-0000-0000-000000000001', project_id, 'PERF-' || w, 'perf work item ' || w, 'm3', 100, 1 from perf_b;
create temp table perf_i as
  select id as item_id, row_number() over (order by code) as k from public.stock_items where org_id = '00000000-0000-0000-0000-000000000001' order by code limit 12;
-- 20 x 10 x 12 x 24 = 57,600 cells; 3.5 rows per cell (three issues, a return on half) = 201,600 rows.
insert into public.stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, boq_item_id, kind,
                                 qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by)
  select '00000000-0000-0000-0000-000000000001', gen_random_uuid(), gen_random_uuid(), i.item_id, '15121000-0000-0000-0000-000000002002',
         b.project_id, b.boq_id, r.kind, r.q, r.v, 1000, 1000, (date '2025-01-01' + (m * interval '1 month') + (r.d * interval '1 day'))::date,
         '00000000-0000-0000-0000-0000000000a5'
    from perf_b b cross join perf_i i cross join generate_series(0, 23) m
    cross join lateral (values ('issue', -5::numeric, -50::numeric, 3), ('issue', -3, -30, 14), ('issue', -2, -20, 24), ('return', 1, 10, 20)) r(kind, q, v, d)
   where r.kind = 'issue' or (m + i.k) % 2 = 0;
set local session_replication_role = origin;
analyze public.stock_ledger;
select count(*) as ledger_rows, count(distinct project_id) as projects from public.stock_ledger where org_id = '00000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
explain (analyze, buffers) select public.get_project_consumption('40000000-0000-0000-0000-000000000001', '2025-01-01', '2026-12-31');
-- p95 over 20 runs (milliseconds).
do $$
declare t timestamptz; ms numeric[] := '{}'; r jsonb;
begin
  for n in 1..20 loop
    t := clock_timestamp();
    r := public.get_project_consumption('40000000-0000-0000-0000-000000000001', '2025-01-01', '2026-12-31');
    ms := ms || extract(epoch from clock_timestamp() - t) * 1000;
  end loop;
  raise notice 'NFR-STK-003 runs=20 months_rows=% p50=% ms p95=% ms max=% ms', jsonb_array_length(r -> 'months'),
    round((select percentile_cont(0.5) within group (order by x) from unnest(ms) x)::numeric, 1),
    round((select percentile_cont(0.95) within group (order by x) from unnest(ms) x)::numeric, 1),
    round((select max(x) from unnest(ms) x), 1);
end $$;
rollback;
