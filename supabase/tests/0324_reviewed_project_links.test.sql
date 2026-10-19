-- AC-S09-004 — reviewed ERP project matches are service-only, org/site/stage checked,
-- compare-and-set persisted, and audited in the same transaction.
begin;
select to_regprocedure('public.confirm_erp_project_link(uuid,uuid,uuid,text,jsonb,text,text)') is not null as s09_rpc_present \gset
\if :s09_rpc_present
select plan(25);

insert into public.organizations (id,name) values
  ('03240000-0000-0000-0000-000000000001','S09 match Org A'),
  ('03240000-0000-0000-0000-000000000002','S09 match Org B');
insert into auth.users (id,email) values
  ('03240000-0000-0000-0000-0000000000a1','s09-admin@example.test'),
  ('03240000-0000-0000-0000-0000000000a2','s09-engineer@example.test'),
  ('03240000-0000-0000-0000-0000000000a3','s09-disabled@example.test'),
  ('03240000-0000-0000-0000-0000000000b1','s09-foreign-admin@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
  ('03240000-0000-0000-0000-0000000000a1','03240000-0000-0000-0000-000000000001','S09 Admin','s09-admin@example.test','Admin','active'),
  ('03240000-0000-0000-0000-0000000000a2','03240000-0000-0000-0000-000000000001','S09 Engineer','s09-engineer@example.test','Engineer','active'),
  ('03240000-0000-0000-0000-0000000000a3','03240000-0000-0000-0000-000000000001','S09 Disabled Admin','s09-disabled@example.test','Admin','disabled'),
  ('03240000-0000-0000-0000-0000000000b1','03240000-0000-0000-0000-000000000002','S09 Foreign Admin','s09-foreign-admin@example.test','Admin','active');
insert into public.projects (id,org_id,name,status,archived_at) values
  ('03240000-0000-0000-0000-0000000000d1','03240000-0000-0000-0000-000000000001','S09 Delivery','Ongoing Project',null),
  ('03240000-0000-0000-0000-0000000000d2','03240000-0000-0000-0000-000000000001','S09 Pre-win','Leads',null),
  ('03240000-0000-0000-0000-0000000000d3','03240000-0000-0000-0000-000000000001','S09 Archived','Ongoing Project','2026-10-01T00:00:00Z'),
  ('03240000-0000-0000-0000-0000000000d5','03240000-0000-0000-0000-000000000001','S09 Delivery Two','Ongoing Project',null),
  ('03240000-0000-0000-0000-0000000000d6','03240000-0000-0000-0000-000000000001','S09 Internal','Internal Project',null),
  ('03240000-0000-0000-0000-0000000000d4','03240000-0000-0000-0000-000000000002','S09 Foreign','Ongoing Project',null);
insert into public.external_org_bindings (org_id,external_tier,site_url,secret_ref,status,config)
values ('03240000-0000-0000-0000-000000000001','erpnext','https://erp.s09.example.test','synthetic-s09-ref','active',
        '{"company":"S09 Company","project_map":{"other-project":"ERP-KEEP"}}'::jsonb);

-- The psql dependency guard above keeps this entire installed-behavior section out of the
-- pre-migration parse path. Once present, these assertions exercise the actual shipped RPC.
create function pg_temp.confirm_erp_project_link(
  p_org_id uuid,p_actor_id uuid,p_project_id uuid,p_erp_project text,
  p_expected_config jsonb,p_site_url text,p_expected_erp_project text
) returns boolean language plpgsql as $$
declare v_result boolean;
begin
  execute 'select public.confirm_erp_project_link($1,$2,$3,$4,$5,$6,$7)'
    into v_result using p_org_id,p_actor_id,p_project_id,p_erp_project,
      p_expected_config,p_site_url,p_expected_erp_project;
  return v_result;
exception when undefined_function then
  return null;
end;
$$;

select ok(to_regprocedure('public.confirm_erp_project_link(uuid,uuid,uuid,text,jsonb,text,text)') is not null,
  'AC-S09-004 reviewed-link RPC is installed');
select ok(coalesce((select has_function_privilege('service_role',p.oid,'EXECUTE')
                      from pg_proc p where p.oid=to_regprocedure('public.confirm_erp_project_link(uuid,uuid,uuid,text,jsonb,text,text)')),false),
  'AC-S09-004 service_role can execute reviewed-link RPC');
select ok(not coalesce((select has_function_privilege('authenticated',p.oid,'EXECUTE')
                          from pg_proc p where p.oid=to_regprocedure('public.confirm_erp_project_link(uuid,uuid,uuid,text,jsonb,text,text)')),false),
  'AC-S09-004 authenticated cannot execute reviewed-link RPC');
select ok(not coalesce((select has_function_privilege('anon',p.oid,'EXECUTE')
                          from pg_proc p where p.oid=to_regprocedure('public.confirm_erp_project_link(uuid,uuid,uuid,text,jsonb,text,text)')),false),
  'AC-S09-004 anon cannot execute reviewed-link RPC');

set local request.jwt.claims='{"role":"service_role"}';
set local role service_role;
select is(pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d1','ERP-SELECTED',
  '{"company":"S09 Company","project_map":{"other-project":"ERP-KEEP"}}'::jsonb,
  'https://erp.s09.example.test',null), true,
  'AC-S09-004 active Admin can confirm an eligible project');
reset role;

select is((select config #>> '{project_map,03240000-0000-0000-0000-0000000000d1}'
             from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'ERP-SELECTED','AC-S09-004 selected stable ERP identity is saved for the PMO project');
select is((select config #>> '{project_map,other-project}'
             from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'ERP-KEEP','AC-S09-004 unrelated project-map entries survive');
select ok((select count(*)=1 and bool_and(actor_id='03240000-0000-0000-0000-0000000000a1'::uuid)
                  and bool_and(entity_id='03240000-0000-0000-0000-0000000000d1'::uuid)
                  and min(detail->>'previous') is null and min(detail->>'confirmed')='ERP-SELECTED'
            from public.audit_events where org_id='03240000-0000-0000-0000-000000000001'
              and action='integration.project_link_confirmed'),
  'AC-S09-004 confirmation writes one scoped audit with actor, project, and identity');

set local role service_role;
select is(pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d1','ERP-SELECTED',
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://erp.s09.example.test','ERP-SELECTED'), true,
  'AC-S09-004 unchanged retry is idempotent');
reset role;
select is((select count(*)::int from public.audit_events where org_id='03240000-0000-0000-0000-000000000001'
             and action='integration.project_link_confirmed'),1,
  'AC-S09-004 unchanged retry does not duplicate audit');

set local role service_role;
select is(pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d5','ERP-STALE-CONFIG',
  '{"company":"S09 Company","project_map":{"other-project":"ERP-KEEP"}}'::jsonb,
  'https://erp.s09.example.test',null), false,
  'AC-S09-004 whole-config compare-and-set rejects stale config');
select is(pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d1','ERP-OTHER',
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://erp.s09.example.test',null), false,
  'AC-S09-004 stale reviewed identity cannot replace a concurrent mapping');
select is(pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d4','ERP-FOREIGN',
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://erp.s09.example.test',null), false,
  'AC-S09-004 foreign organization project is refused');
select is(pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d2','ERP-PREWIN',
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://erp.s09.example.test',null), false,
  'AC-S09-004 pre-win project is refused');
select is(pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d3','ERP-ARCHIVED',
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://erp.s09.example.test',null), false,
  'AC-S09-004 archived project is refused');
select is(pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d1','ERP-WRONG-SITE',
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://other.s09.example.test','ERP-SELECTED'), false,
  'AC-S09-004 changed ERP site is refused');
select is(pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d5','',
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://erp.s09.example.test',null), false,
  'AC-S09-004 blank candidate cannot replace a mapping');
select is(pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d1',repeat('X',141),
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://erp.s09.example.test','ERP-SELECTED'), false,
  'AC-S09-004 oversized candidate cannot replace a mapping');
select is((select count(*)::int from public.audit_events where org_id='03240000-0000-0000-0000-000000000001'
             and action='integration.project_link_confirmed'),1,
  'AC-S09-004 rejected and stale confirmations do not write audit rows');
reset role;

update public.external_org_bindings
   set config=jsonb_set(config,'{company}','"Other S09 Company"'::jsonb)
 where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext';
set local role service_role;
select is(pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d1','ERP-OTHER',
  '{"company":"S09 Company","project_map":{"other-project":"ERP-KEEP","03240000-0000-0000-0000-0000000000d1":"ERP-SELECTED"}}'::jsonb,
  'https://erp.s09.example.test','ERP-SELECTED'), false,
  'AC-S09-004 changed ERP company fails the reviewed config fence');
reset role;

set local request.jwt.claims='{"role":"service_role"}';
set local role service_role;
select throws_ok($$select public.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a2',
  '03240000-0000-0000-0000-0000000000d1','ERP-NONADMIN',
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://erp.s09.example.test','ERP-SELECTED')$$,
  '42501','active organization Admin required','AC-S09-004 non-Admin actor is refused');
select throws_ok($$select public.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a3',
  '03240000-0000-0000-0000-0000000000d1','ERP-INACTIVE',
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://erp.s09.example.test','ERP-SELECTED')$$,
  '42501','active organization Admin required','AC-S09-004 inactive Admin actor is refused');
reset role;

alter table public.audit_events add constraint s09_test_reject_project_link_audit
  check (action <> 'integration.project_link_confirmed') not valid;
set local role service_role;
select throws_ok($$select public.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d1','ERP-AUDIT-FAIL',
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://erp.s09.example.test','ERP-SELECTED')$$,
  '23514',null,'AC-S09-004 audit failure raises inside the confirmation transaction');
reset role;
select is((select config #>> '{project_map,03240000-0000-0000-0000-0000000000d1}'
             from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'ERP-SELECTED','AC-S09-004 audit failure rolls back mapping update');

alter table public.audit_events drop constraint s09_test_reject_project_link_audit;
set local role service_role;
select pg_temp.confirm_erp_project_link(
  '03240000-0000-0000-0000-000000000001','03240000-0000-0000-0000-0000000000a1',
  '03240000-0000-0000-0000-0000000000d6','ERP-INTERNAL',
  (select config from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'https://erp.s09.example.test',null);
reset role;
select is((select config #>> '{project_map,03240000-0000-0000-0000-0000000000d6}'
             from public.external_org_bindings where org_id='03240000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'ERP-INTERNAL','AC-S09-004 active Admin can confirm and persist an Internal Project mapping');

\else
select plan(1);
select ok(false, 'AC-S09-004 reviewed-link RPC is installed');
\endif
select * from finish();
rollback;
