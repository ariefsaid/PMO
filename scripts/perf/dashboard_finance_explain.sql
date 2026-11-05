-- Q12 perf record: get_executive_dashboard() and get_finance_budget_review() as real authenticated users.
-- NOT part of `supabase test db`. LOCAL stack only, under the lock, one scratch transaction that rolls back:
--   scripts/with-db-lock.sh bash -c 'docker exec -i supabase_db_pmo-portal psql -U postgres -d postgres < scripts/perf/dashboard_finance_explain.sql'
-- EXPLAIN (ANALYZE, BUFFERS) of the bodies: psql as supabase_admin, run each function's prosrc as `authenticated` (auto_explain is not allowed here).
-- :scale (default 0) adds that many extra projects (each with an Active budget of 3 lines).
\set ON_ERROR_STOP on
\if :{?scale} \else \set scale 0 \endif
begin;
select set_config('perf.scale', :'scale', false);
do $$
declare n int := current_setting('perf.scale')::int;
begin
  if n > 0 then
    create temp table perf_p as select gen_random_uuid() as id, g from generate_series(1, n) g;
    insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, client_id)
      select id, '00000000-0000-0000-0000-000000000001', 'PERF-' || g,
             (array['Ongoing Project','Tender Submitted','Leads','Close Out','Won, Pending KoM'])[1 + g % 5]::project_status,
             'IDR', 1000000 * g, 'exclusive', 0, (select id from public.companies limit 1) from perf_p;
    create temp table perf_v as select gen_random_uuid() as vid, id as pid from perf_p;
    insert into public.budget_versions (id, org_id, project_id, version, name, status, currency)
      select vid, '00000000-0000-0000-0000-000000000001', pid, 1, 'perf', 'Draft', 'IDR' from perf_v;
    insert into public.budget_line_items (org_id, budget_version_id, category, budgeted_amount)
      select '00000000-0000-0000-0000-000000000001', vid, c::public.budget_category, 100000
      from perf_v cross join (values ('Labor'),('Materials'),('Equipment')) cats(c);
    update public.budget_versions set status = 'Active' where id in (select vid from perf_v);
    analyze public.projects; analyze public.budget_line_items; analyze public.budget_versions;
  end if;
end $$;
select count(*) as projects from public.projects;
set local role authenticated;
do $$
declare u record; t timestamptz; ms numeric[]; fn text;
begin
  for u in select * from (values ('00000000-0000-0000-0000-0000000000a1'::uuid,'exec'),('00000000-0000-0000-0000-0000000000a2','pm'),('00000000-0000-0000-0000-0000000000a3','finance'),('00000000-0000-0000-0000-0000000000a4','engineer'),('00000000-0000-0000-0000-0000000000a5','admin')) v(id,email) loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    foreach fn in array array['get_executive_dashboard','get_finance_budget_review'] loop
      ms := '{}';
      for n in 1..11 loop
        t := clock_timestamp();
        execute 'select public.' || fn || '()';
        if n > 1 then ms := ms || extract(epoch from clock_timestamp() - t) * 1000; end if;  -- run 1 = cold, dropped
      end loop;
      raise notice '% % p50=% ms max=% ms', rpad(u.email, 20), rpad(fn, 26),
        round((select percentile_cont(0.5) within group (order by x) from unnest(ms) x)::numeric, 1), round((select max(x) from unnest(ms) x), 1);
    end loop;
  end loop;
end $$;
rollback;
