-- Volume for scripts/perf/hot_shell_explain.sh: ONE scratch transaction (never committed).
-- 2 orgs x 500 profiles, 20,000 procurements, 20,000 timesheets, 2,000 user_views (5 KB spec each).
set local session_replication_role = replica;
insert into public.profiles (id, org_id, full_name, email, role, manager_id)
  select gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Perf User ' || n, 'perf' || n || '@x.test',
         (array['Engineer','Project Manager','Finance','Executive'])[1 + n % 4]::user_role,
         '00000000-0000-0000-0000-0000000000a2'
    from generate_series(1, 500) n;
insert into public.organizations (id, name) values ('99999999-0000-0000-0000-000000000002', 'Perf Org B') on conflict do nothing;
insert into public.profiles (id, org_id, full_name, email, role)
  select gen_random_uuid(), '99999999-0000-0000-0000-000000000002', 'Perf B ' || n, 'perfb' || n || '@x.test', 'Engineer'
    from generate_series(1, 500) n;
insert into public.procurements (org_id, title, project_id, requested_by_id, status, total_value, vendor_id, currency)
  select '00000000-0000-0000-0000-000000000001', 'Perf PR ' || n,
         (select id from public.projects order by id limit 1 offset n % 10),
         (select id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' order by id limit 1 offset n % 400),
         'Draft', n, null, 'IDR'
    from generate_series(1, 20000) n;
insert into public.timesheets (org_id, user_id, week_start_date)
  select '00000000-0000-0000-0000-000000000001', p.id, date '2020-01-06' + (w * 7)
    from (select id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' order by id limit 400) p
    cross join generate_series(0, 49) w;
insert into public.user_views (org_id, user_id, name, spec, scope)
  select '00000000-0000-0000-0000-000000000001', p.id, 'View ' || n, jsonb_build_object('blob', repeat('x', 5000)), case when n % 5 = 0 then 'shared_org' else 'private' end
    from generate_series(1, 2000) n
    join lateral (select id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' order by id limit 1 offset n % 400) p on true;
set local session_replication_role = origin;
analyze public.profiles; analyze public.procurements; analyze public.timesheets; analyze public.user_views;
