-- #2286 benchmark: times every database call of a whole-org purchase-capture preview at ten times today's volume,
-- then one new batch call, its resume and an unchanged GL upsert. Evidence only, never a CI gate; nothing persists.
-- Run from the repo root (see docs/plans/2026-11-15-purchase-capture-volume.md §3):
--   scripts/with-db-lock.sh bash -c 'for i in 1 2 3 4 5; do psql "$DB_URL" -X -q -f scripts/bench/2286-capture-volume.sql; done'
-- Add `-v explain=1` for one run with the EXPLAIN (ANALYZE, BUFFERS) plans (auto_explain, nested statements).
\set ON_ERROR_STOP on
\ir 2286-local-only.sql
\if :{?explain}
\else
\set explain 0
\endif
begin;
set local track_functions = 'all';
\ir 2286-capture-volume-seed.sql
create temp table bench_times (seq serial primary key, call text not null, ms numeric not null, detail text);
grant insert, select on bench_times to authenticated, service_role;
grant usage on sequence bench_times_seq_seq to authenticated, service_role;
create temp table bench_calls as select funcname, calls from pg_stat_xact_user_functions where false;
-- A scoped ledger read exists once the 4-argument page is deployed (#2286); before that the bench reads every line.
select set_config('bench.scoped', exists(select 1 from pg_proc where proname = 'purchase_capture_ledger_page' and pronargs = 4)::text, true) as scoped;
insert into bench_calls select funcname, calls from pg_stat_xact_user_functions;

\if :explain
\else
set local role authenticated;
set local request.jwt.claims = '{"sub":"22860000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare v_cursor text; v_page jsonb; v_t timestamptz; v_n integer := 0; v_scoped boolean := current_setting('bench.scoped')::boolean; v_rev text;
begin
  -- Source pages (the census).
  v_cursor := null;
  loop
    v_t := clock_timestamp();
    v_page := public.purchase_capture_source_page(v_cursor::uuid, null, 500);
    v_n := v_n + 1;
    insert into pg_temp.bench_times(call, ms, detail) values ('source_page', extract(epoch from clock_timestamp() - v_t) * 1000, jsonb_array_length(v_page->'sources')::text);
    v_rev := coalesce(v_rev, v_page->>'revision');
    v_cursor := v_page->>'next_cursor';
    exit when v_cursor is null;
  end loop;
  perform set_config('bench.revision', v_rev, false);
  -- Ledger pages.
  v_cursor := null;
  loop
    v_t := clock_timestamp();
    if v_scoped then
      execute 'select public.purchase_capture_ledger_page($1::uuid, 500, null, $2)' into v_page using v_cursor, 'capture';
    else
      v_page := public.purchase_capture_ledger_page(v_cursor::uuid, 500, null);
    end if;
    insert into pg_temp.bench_times(call, ms, detail) values ('ledger_page', extract(epoch from clock_timestamp() - v_t) * 1000, jsonb_array_length(v_page->'lines')::text);
    if v_page->>'revision' is distinct from v_rev then raise exception 'bench: ledger revision moved'; end if;
    v_cursor := v_page->>'next_cursor';
    exit when v_cursor is null;
  end loop;
  v_t := clock_timestamp();
  perform public.purchase_capture_feed_health();
  insert into pg_temp.bench_times(call, ms) values ('feed_health', extract(epoch from clock_timestamp() - v_t) * 1000);
  v_t := clock_timestamp();
  v_page := public.purchase_capture_source_page(null, null, 1);
  insert into pg_temp.bench_times(call, ms) values ('witness', extract(epoch from clock_timestamp() - v_t) * 1000);
  v_t := clock_timestamp();
  perform public.purchase_capture_assignment_report(null);
  insert into pg_temp.bench_times(call, ms) values ('assignment_report', extract(epoch from clock_timestamp() - v_t) * 1000);
end $$;
reset role;
select 'preview_calls,' || string_agg(s.funcname || '=' || (s.calls - coalesce(b.calls, 0)), ';' order by s.funcname) as counts
  from pg_stat_xact_user_functions s left join bench_calls b using (funcname)
 where s.funcname in ('capture_revision', 'purchase_capture_source_page', 'purchase_capture_ledger_page', 'purchase_capture_feed_health') \gset
\echo :counts

-- capture_revision alone (internal; owner call).
select set_config('bench.t0', clock_timestamp()::text, true) as t0 \gset
select length(public.capture_revision('22860000-0000-0000-0000-000000000001')) as rev_len \gset
insert into bench_times(call, ms) values ('capture_revision', extract(epoch from clock_timestamp() - current_setting('bench.t0')::timestamptz) * 1000);

-- One new batch of 25 groups (of 30), then the resume that takes the last 5. Each call holds the exclusive fence throughout.
delete from bench_calls; insert into bench_calls select funcname, calls from pg_stat_xact_user_functions;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
do $$
declare v_t timestamptz; v_r jsonb; v_g jsonb := current_setting('bench.groups')::jsonb;
begin
  v_t := clock_timestamp();
  v_r := public.capture_history_batch('22860000-0000-0000-0000-000000000002','22860000-0000-0000-0000-000000000004','22860000-0000-0000-0000-000000000012',
    current_setting('bench.revision'),'{"order":2,"supplier_invoice":2}'::jsonb, v_g);
  insert into pg_temp.bench_times(call, ms, detail) values ('batch_new', extract(epoch from clock_timestamp() - v_t) * 1000, (v_r->>'next_index') || '/' || coalesce(v_r->>'complete', v_r->>'reason'));
  v_t := clock_timestamp();
  v_r := public.capture_history_batch('22860000-0000-0000-0000-000000000002','22860000-0000-0000-0000-000000000004','22860000-0000-0000-0000-000000000012',
    current_setting('bench.revision'),'{"order":2,"supplier_invoice":2}'::jsonb, v_g);
  insert into pg_temp.bench_times(call, ms, detail) values ('batch_resume', extract(epoch from clock_timestamp() - v_t) * 1000, (v_r->>'next_index') || '/' || coalesce(v_r->>'complete', v_r->>'reason'));
end $$;
reset role;
select 'batch_calls,' || string_agg(s.funcname || '=' || (s.calls - coalesce(b.calls, 0)), ';' order by s.funcname) as counts
  from pg_stat_xact_user_functions s left join bench_calls b using (funcname)
 where s.funcname in ('capture_revision', 'purchase_capture_source_page', 'purchase_capture_feed_health', 'capture_history_apply_internal') \gset
\echo :counts

-- An unchanged 15,000-row GL upsert: the fence trigger's cost (Trigger capture_census_fence line).
create temp table bench_upsert as select org_id, erp_name, company, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_modified
  from erp_gl_entry_mirror where org_id = '22860000-0000-0000-0000-000000000001' order by erp_name limit 15000;
explain (analyze, buffers, format text)
insert into erp_gl_entry_mirror(org_id, erp_name, company, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_modified)
select * from bench_upsert
on conflict (org_id, erp_name) do update set debit = excluded.debit, credit = excluded.credit, erp_modified = excluded.erp_modified;

-- Results: one line per call, then the totals.
select call || ',' || round(ms, 1) || coalesce(',' || detail, '') as line from bench_times order by seq;
select 'total,' || call || ',' || count(*) || ',' || round(sum(ms), 1) || ',max=' || round(max(ms), 1) from bench_times group by call order by call;
select 'preview_db_total,' || round(sum(ms), 1) from bench_times where call in ('source_page', 'ledger_page', 'feed_health', 'witness', 'assignment_report');

\endif
\if :explain
-- EXPLAIN-only run plans of every statement inside: the first source page, the first ledger page, capture_revision and one batch call.
set local auto_explain.log_min_duration = 5;  -- ms: only the statements that cost something
set local auto_explain.log_analyze = on;
set local auto_explain.log_buffers = on;
set local auto_explain.log_nested_statements = on;
set local auto_explain.log_level = notice;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22860000-0000-0000-0000-000000000002","role":"authenticated"}';
\echo '=== EXPLAIN first source page'
select length(public.purchase_capture_source_page(null, null, 500)::text);
\echo '=== EXPLAIN first ledger page'
select case when current_setting('bench.scoped')::boolean then 'public.purchase_capture_ledger_page(null, 500, null, ''capture'')'
  else 'public.purchase_capture_ledger_page(null, 500, null)' end as ledger_call \gset
select length((:ledger_call)::text);
reset role;
\echo '=== EXPLAIN capture_revision'
select length(public.capture_revision('22860000-0000-0000-0000-000000000001'));
\echo '=== EXPLAIN batch, new 25 groups'
select set_config('bench.revision', public.capture_revision('22860000-0000-0000-0000-000000000001'), true) is not null as rev_set;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.capture_history_batch('22860000-0000-0000-0000-000000000002','22860000-0000-0000-0000-000000000004','22860000-0000-0000-0000-000000000013',
  current_setting('bench.revision'),'{"order":2,"supplier_invoice":2}'::jsonb, current_setting('bench.groups')::jsonb)->>'next_index' as batch_next;
reset role;
\endif
rollback;
