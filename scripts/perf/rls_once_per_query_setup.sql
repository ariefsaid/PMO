-- Volume for scripts/perf/rls_once_per_query_explain.sh (#1254): ONE scratch transaction, never committed.
-- 20,000 ledger rows (10% Employee), 20,000 notifications / expense claims spread over the seed org's users, 2,000 shared views.
set local session_replication_role = replica;
insert into public.erp_gl_entry_mirror (org_id, erp_name, account, party_type, erp_modified, posting_date, debit)
  select '00000000-0000-0000-0000-000000000001', 'PERF-GL-' || n, '1100', case when n % 10 = 0 then 'Employee' else 'Supplier' end, '2026-01-01', date '2026-01-01' + (n % 300), n
    from generate_series(1, 20000) n;
insert into public.notifications (org_id, owner_id, title)
  select '00000000-0000-0000-0000-000000000001', (select id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' order by id limit 1 offset n % 11), 'perf ' || n
    from generate_series(1, 20000) n;
insert into public.expense_claims (org_id, claimant_id, title, amount, currency)
  select '00000000-0000-0000-0000-000000000001', (select id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' order by id limit 1 offset n % 11), 'perf claim ' || n, n, 'IDR'
    from generate_series(1, 20000) n;
insert into public.user_views (org_id, user_id, name, spec, scope)
  select '00000000-0000-0000-0000-000000000001', (select id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' order by id limit 1 offset n % 11), 'View ' || n, jsonb_build_object('blob', repeat('x', 500)), case when n % 5 = 0 then 'shared_org' else 'private' end
    from generate_series(1, 2000) n;
set local session_replication_role = origin;
analyze public.erp_gl_entry_mirror; analyze public.notifications; analyze public.expense_claims; analyze public.user_views;
