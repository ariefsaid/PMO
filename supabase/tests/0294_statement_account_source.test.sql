-- AC-003/005 support: account master shape and machine-only status controls.
begin;
select plan(16);

insert into public.organizations(id, name) values ('a2940000-0000-0000-0000-000000000002', 'Synthetic Chart Org');

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
select ok(not has_function_privilege('anon','public.replace_erp_account_chart(uuid,text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.replace_erp_account_chart(uuid,text,jsonb)','EXECUTE'), 'chart replacement is not executable by anon or authenticated');
select ok(has_function_privilege('service_role','public.replace_erp_account_chart(uuid,text,jsonb)','EXECUTE'), 'service role can replace chart');

insert into public.erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id)
values ('a2940000-0000-0000-0000-000000000002','Synthetic Co','Obsolete','Old','Asset','Balance Sheet',false,'IDR',1,2,gen_random_uuid());
set local role service_role;
select is(public.replace_erp_account_chart('a2940000-0000-0000-0000-000000000002','Synthetic Co', jsonb_build_array(jsonb_build_object(
  'org_id','a2940000-0000-0000-0000-000000000002','company','Synthetic Co','erp_name','Cash','account_name','Cash','root_type','Asset','report_type','Balance Sheet','parent_account',null,'is_group',false,'account_number',null,'account_currency','IDR','lft',1,'rgt',2,'account_type',null,'include_in_gross',false,'disabled',false,'erp_modified','2026-01-01T00:00:00Z','as_of','2026-01-02T00:00:00Z','refresh_id','b2940000-0000-0000-0000-000000000001'
))), '{"upserted": 1, "deleted": 1}'::jsonb, 'atomic replacement upserts current rows and removes obsolete identities');
reset role;
select is((select array_agg(erp_name order by erp_name) from public.erp_account_mirror where org_id='a2940000-0000-0000-0000-000000000002' and company='Synthetic Co'), array['Cash']::text[], 'obsolete chart identity is removed');
do $$ begin
  perform public.replace_erp_account_chart('a2940000-0000-0000-0000-000000000002','Synthetic Co', jsonb_build_array(
    jsonb_build_object('org_id','a2940000-0000-0000-0000-000000000002','company','Synthetic Co','erp_name','Cash','account_name','Changed','root_type','Asset','report_type','Balance Sheet','is_group',false,'account_currency','IDR','lft',1,'rgt',2,'include_in_gross',false,'disabled',false,'as_of','2026-01-03T00:00:00Z','refresh_id','b2940000-0000-0000-0000-000000000002'),
    jsonb_build_object('org_id','a2940000-0000-0000-0000-000000000002','company','Synthetic Co','erp_name','Broken','account_name','Broken','root_type','Invalid','report_type','Balance Sheet','is_group',false,'account_currency','IDR','lft',3,'rgt',4,'include_in_gross',false,'disabled',false,'as_of','2026-01-03T00:00:00Z','refresh_id','b2940000-0000-0000-0000-000000000002')
  ));
  raise exception 'bad chart unexpectedly succeeded';
exception when check_violation then null; end $$;
select is((select account_name from public.erp_account_mirror where org_id='a2940000-0000-0000-0000-000000000002' and company='Synthetic Co' and erp_name='Cash'), 'Cash', 'bad chart rolls back every upsert');
select is((select count(*) from public.erp_account_mirror where org_id='a2940000-0000-0000-0000-000000000002' and company='Synthetic Co'), 1::bigint, 'bad chart does not add partial rows');
select * from finish();
rollback;
