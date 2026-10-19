-- AC-005: changing the bound company schedules a full statement source replay.
begin;
select plan(3);
insert into public.organizations(id,name) values ('00000000-0000-0000-0000-000000000005','Synthetic Statement Org') on conflict (id) do nothing;
insert into public.external_org_bindings(org_id,external_tier,site_url,secret_ref,config)
values ('00000000-0000-0000-0000-000000000005','erpnext','https://erp.example.test','synthetic-ref','{"company":"First Co"}')
on conflict (org_id,external_tier) do update set config=excluded.config;
update public.external_org_bindings set statement_full_ledger_replay_needed=false, statement_update_delayed=false
where org_id='00000000-0000-0000-0000-000000000005' and external_tier='erpnext';
update public.external_org_bindings set config='{"company":"Second Co"}'
where org_id='00000000-0000-0000-0000-000000000005' and external_tier='erpnext';
select ok((select statement_full_ledger_replay_needed from public.external_org_bindings where org_id='00000000-0000-0000-0000-000000000005' and external_tier='erpnext'),'company change schedules full replay');
select ok((select statement_update_delayed from public.external_org_bindings where org_id='00000000-0000-0000-0000-000000000005' and external_tier='erpnext'),'company change marks statement status delayed');
update public.external_org_bindings set config='{"company":"Second Co","other":"safe"}'
where org_id='00000000-0000-0000-0000-000000000005' and external_tier='erpnext';
select ok((select statement_full_ledger_replay_needed from public.external_org_bindings where org_id='00000000-0000-0000-0000-000000000005' and external_tier='erpnext'),'non-company config change preserves replay flag');
select * from finish();
rollback;
