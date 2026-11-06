-- One pass of reads on the largest per-row-policy tables, as non-admin roles (Finance a3, Project Manager a2, Engineer a4).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
\echo == Finance: erp_gl_entry_mirror count
explain (analyze, buffers) select count(*) from public.erp_gl_entry_mirror;
\echo == Finance: erp_gl_entry_mirror page (1000 rows)
explain (analyze, buffers) select * from public.erp_gl_entry_mirror order by posting_date desc limit 1000;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
\echo == PM: expense_claims (all org-visible via spend authority)
explain (analyze, buffers) select count(*) from public.expense_claims;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
\echo == Engineer: notifications list
explain (analyze, buffers) select * from public.notifications order by created_at desc limit 100;
\echo == Engineer: notifications count
explain (analyze, buffers) select count(*) from public.notifications;
\echo == Engineer: expense_claims (own)
explain (analyze, buffers) select count(*) from public.expense_claims;
\echo == Engineer: user_views list
explain (analyze, buffers) select * from public.user_views order by updated_at desc;
reset role;
