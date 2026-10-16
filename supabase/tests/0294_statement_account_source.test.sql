-- AC-003/005 support: account master shape and machine-only status controls.
begin;
select plan(10);

select ok(to_regclass('public.erp_account_mirror') is not null, 'account source table exists');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.erp_account_mirror'::regclass), 'account source forces RLS');
select ok((select count(*) = 19 from information_schema.columns where table_schema='public' and table_name='erp_account_mirror'), 'chart columns include the source contract');
select ok(has_table_privilege('authenticated','public.erp_account_mirror','SELECT'), 'authenticated has read grant');
select ok(not has_table_privilege('authenticated','public.erp_account_mirror','INSERT'), 'ordinary users cannot insert chart rows');
select ok(has_table_privilege('service_role','public.erp_account_mirror','INSERT'), 'service role can write chart rows');
select ok((select column_default like '%true%' from information_schema.columns where table_schema='public' and table_name='external_org_bindings' and column_name='statement_full_ledger_replay_needed'), 'existing bindings start with full replay required');
select ok((select column_default like '%true%' from information_schema.columns where table_schema='public' and table_name='external_org_bindings' and column_name='statement_update_delayed'), 'existing bindings start delayed');
select ok(not has_column_privilege('authenticated','public.external_org_bindings','statement_full_ledger_replay_needed','UPDATE'), 'ordinary users cannot update replay status');
select ok(not has_column_privilege('authenticated','public.external_org_bindings','statement_update_delayed','UPDATE'), 'ordinary users cannot update delayed status');
select * from finish();
rollback;
