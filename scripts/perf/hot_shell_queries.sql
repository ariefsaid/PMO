-- One pass of the hot shell/list reads as an authenticated user. Each EXPLAIN reports its own Execution Time.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
\echo == profiles self (select *, id=me)
explain (analyze, buffers) select * from public.profiles where id = '00000000-0000-0000-0000-0000000000a2';
\echo == profiles org list (assignee picker)
explain (analyze, buffers) select * from public.profiles order by full_name;
\echo == user_views list (select *)
explain (analyze, buffers) select * from public.user_views where archived_at is null order by updated_at desc;
\echo == external_domain_ownership
explain (analyze, buffers) select id, org_id, external_tier, domain from public.external_domain_ownership order by external_tier;
\echo == external_project_bindings
explain (analyze, buffers) select * from public.external_project_bindings;
\echo == rpc is_operator
explain (analyze, buffers) select public.is_operator();
\echo == rpc resolved_org_features
explain (analyze, buffers) select * from public.resolved_org_features();
\echo == procurements list + requested_by profile embed
explain (analyze, buffers) select p.*, (select row_to_json(r) from (select pr.full_name from public.profiles pr where pr.id = p.requested_by_id) r) requested_by
  from public.procurements p order by p.id limit 1000;
\echo == timesheets list (own)
explain (analyze, buffers) select * from public.timesheets where user_id = '00000000-0000-0000-0000-0000000000a2' order by week_start_date desc;
\echo == timesheets awaiting approval (all, as PM)
explain (analyze, buffers) select * from public.timesheets where status = 'Submitted' order by week_start_date desc;
\echo == rpc get_executive_dashboard
explain (analyze, buffers) select * from public.get_executive_dashboard();
\echo == rpc get_win_rate
explain (analyze, buffers) select * from public.get_win_rate();
\echo == rpc get_finance_budget_review
explain (analyze, buffers) select * from public.get_finance_budget_review();
reset role;
