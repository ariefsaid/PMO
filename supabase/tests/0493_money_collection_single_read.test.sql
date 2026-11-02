-- 0493 — get_projects_money_collection: same output as the 0396 definition, each project's
-- finances / mapped actuals read once. The 0396 body is copied below as a reference oracle (test-only).
begin;
create extension if not exists pgtap;
select plan(21);

create or replace function public.t12_old_money_collection(p_project_ids uuid[])
returns table(project_id uuid, actuals jsonb, ledger_basis text, active_budget_amount text, active_budget_currency text, has_active_budget boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role := public.auth_role();
  v_project_id uuid;
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project_ids is null or cardinality(p_project_ids) = 0 or cardinality(p_project_ids) > 500 then
    raise exception 'project selection is invalid' using errcode = '22023';
  end if;

  for v_project_id in
    select distinct requested.id
    from unnest(p_project_ids) requested(id)
    join public.projects p on p.id = requested.id and p.org_id = public.auth_org_id()
    order by requested.id
  loop
    return query
      select v_project_id,
             case when public.org_reads_erp_ledger()
               then jsonb_set(public.get_project_finances(v_project_id)->'actuals','{complete}',to_jsonb(
                 coalesce((select count(distinct li.category) > 0 and count(distinct li.category) = count(distinct li.category) filter
                   (where exists (select 1 from public.project_mapped_actuals(v_project_id,null) x
                     where x.category=li.category and x.mapped and x.actuals_to_date is not null))
                   from public.budget_versions b join public.budget_line_items li on li.budget_version_id=b.id
                   where b.project_id=v_project_id and b.status='Active'),false)
                 and not coalesce((public.get_project_finances(v_project_id)->'actuals'->>'excludes_restricted_rows')::boolean,true)
               ))
               else jsonb_build_object(
                 'currency', (select p.currency from public.projects p where p.id = v_project_id),
                 'total', (select amount::text from public.project_pmo_commitment_position(v_project_id)),
                 'as_of', null,
                 'excludes_restricted_rows', false,
                 'complete', (select complete from public.project_pmo_commitment_position(v_project_id)),
                 'categories', '[]'::jsonb
               )
             end,
             case when public.org_reads_erp_ledger() then 'erp' else 'pmo' end,
             case
               when not exists (
                 select 1 from public.budget_versions b
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
               ) then null
               when exists (
                 select 1 from public.budget_versions b
                 join public.budget_line_items li on li.budget_version_id = b.id and li.org_id = b.org_id
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
                   and (li.budgeted_amount is null or li.budgeted_amount::text in ('NaN','Infinity','-Infinity'))
               ) then null
               else coalesce((
                 select sum(li.budgeted_amount)
                 from public.budget_versions b
                 join public.budget_line_items li on li.budget_version_id = b.id and li.org_id = b.org_id
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
               ), 0::numeric)::text
             end,
             (select b.currency from public.budget_versions b
              where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
              order by b.version desc, b.created_at desc, b.id desc limit 1),
             exists (
               select 1 from public.budget_versions b
               where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
             );
  end loop;
end $$;

insert into public.organizations (id,name,default_currency) values
 ('04930000-0000-0000-0000-000000000001','Money collection single-read org','USD'),
 ('04930000-0000-0000-0000-000000000002','Other single-read org','USD');
insert into auth.users (id,email) values
 ('04930000-0000-0000-0000-0000000000a1','sr-admin@example.test'),
 ('04930000-0000-0000-0000-0000000000a2','sr-finance@example.test'),
 ('04930000-0000-0000-0000-0000000000a3','sr-exec@example.test'),
 ('04930000-0000-0000-0000-0000000000a4','sr-pm@example.test'),
 ('04930000-0000-0000-0000-0000000000a5','sr-engineer@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('04930000-0000-0000-0000-0000000000a1','04930000-0000-0000-0000-000000000001','Admin','sr-admin@example.test','Admin','active'),
 ('04930000-0000-0000-0000-0000000000a2','04930000-0000-0000-0000-000000000001','Finance','sr-finance@example.test','Finance','active'),
 ('04930000-0000-0000-0000-0000000000a3','04930000-0000-0000-0000-000000000001','Executive','sr-exec@example.test','Executive','active'),
 ('04930000-0000-0000-0000-0000000000a4','04930000-0000-0000-0000-000000000001','Project Manager','sr-pm@example.test','Project Manager','active'),
 ('04930000-0000-0000-0000-0000000000a5','04930000-0000-0000-0000-000000000001','Engineer','sr-engineer@example.test','Engineer','active');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref,project_manager_id)
select ('04930000-0000-0000-0000-0000000000d'||n)::uuid,'04930000-0000-0000-0000-000000000001','Single-read project '||n,
       'Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'SINGLE-READ-'||n,'04930000-0000-0000-0000-0000000000a4'
from generate_series(1,4) n;
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref)
values ('04930000-0000-0000-0000-0000000000d9','04930000-0000-0000-0000-000000000002','Foreign project','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'SINGLE-READ-FOREIGN');
insert into public.procurements (id,org_id,title,status,total_value,project_id,requested_by_id,currency) values
 ('04930000-0000-0000-0000-0000000000f1','04930000-0000-0000-0000-000000000001','Committed PO','Ordered',45,'04930000-0000-0000-0000-0000000000d1','04930000-0000-0000-0000-0000000000a4','USD');
insert into public.external_org_bindings (org_id,external_tier,site_url,secret_ref,status,connected_by,connected_at)
values ('04930000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','test-ref','active','04930000-0000-0000-0000-0000000000a1',now());
set local request.jwt.claims='{}';
set local role service_role;
insert into public.budget_category_account_map (org_id,category,erp_account,is_push_target) values
 ('04930000-0000-0000-0000-000000000001','Labor','SR-LABOR',true),
 ('04930000-0000-0000-0000-000000000001','Equipment','SR-EQUIP',true);
insert into public.erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at) values
 ('04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-0000000000d1','SR-LABOR','FY-2026',125,'2026-10-01','04930000-0000-0000-0000-0000000000b1','2026-10-02'),
 ('04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-0000000000d2','SR-LABOR','FY-2026',60,'2026-10-01','04930000-0000-0000-0000-0000000000b1','2026-10-02'),
 ('04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-0000000000d2','SR-EQUIP','FY-2026',30,'2026-10-01','04930000-0000-0000-0000-0000000000b1','2026-10-02');
-- d1: one mapped + one unmapped category (incomplete); d2: every budgeted category mapped and read;
-- d3: Active budget with no readings; d4: no budget at all.
insert into public.budget_versions (id,org_id,project_id,version,name,status,currency,created_at) values
 ('04930000-0000-0000-0000-0000000000c1','04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-0000000000d1',1,'v1','Draft','USD','2026-01-01'),
 ('04930000-0000-0000-0000-0000000000c2','04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-0000000000d2',1,'v1','Draft','USD','2026-01-01'),
 ('04930000-0000-0000-0000-0000000000c3','04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-0000000000d3',1,'v1','Draft','USD','2026-01-01');
insert into public.budget_line_items (org_id,budget_version_id,category,description,budgeted_amount,fiscal_year) values
 ('04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-0000000000c1','Labor','mapped',500,'FY-2026'),
 ('04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-0000000000c1','Materials','unmapped',100,'FY-2026'),
 ('04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-0000000000c2','Labor','mapped',200,'FY-2026'),
 ('04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-0000000000c2','Equipment','mapped',80,'FY-2026'),
 ('04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-0000000000c3','Equipment','no reading',10,'FY-2026');
update public.budget_versions set status='Active' where id in
 ('04930000-0000-0000-0000-0000000000c1','04930000-0000-0000-0000-0000000000c2','04930000-0000-0000-0000-0000000000c3');
reset role;

grant execute on function public.t12_old_money_collection(uuid[]) to authenticated;
set local track_functions = 'all';

create temp table t12_ids as select array_agg(id order by id) ids from public.projects
  where org_id in ('04930000-0000-0000-0000-000000000001','04930000-0000-0000-0000-000000000002');
grant select on t12_ids to authenticated;

-- ERP-bound org: new output equals the 0396 output for every allowed role.
set local role authenticated;
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq(
  $$select * from public.get_projects_money_collection((select ids from t12_ids)) order by project_id$$,
  $$select * from public.t12_old_money_collection((select ids from t12_ids)) order by project_id$$,
  'T12 ERP collection output matches the 0396 output for Admin');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$select * from public.get_projects_money_collection((select ids from t12_ids)) order by project_id$$,
  $$select * from public.t12_old_money_collection((select ids from t12_ids)) order by project_id$$,
  'T12 ERP collection output matches the 0396 output for Finance');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select results_eq(
  $$select * from public.get_projects_money_collection((select ids from t12_ids)) order by project_id$$,
  $$select * from public.t12_old_money_collection((select ids from t12_ids)) order by project_id$$,
  'T12 ERP collection output matches the 0396 output for Executive');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select results_eq(
  $$select * from public.get_projects_money_collection((select ids from t12_ids)) order by project_id$$,
  $$select * from public.t12_old_money_collection((select ids from t12_ids)) order by project_id$$,
  'T12 ERP collection output matches the 0396 output for Project Manager');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.get_projects_money_collection((select ids from t12_ids))),4,
  'T12 duplicate-free own-org projects only: foreign project excluded');
select is((select (actuals->>'complete')::boolean from public.get_projects_money_collection(array['04930000-0000-0000-0000-0000000000d1'::uuid])),false,
  'T12 unmapped budgeted category keeps ERP Actual incomplete');
select is((select (actuals->>'complete')::boolean from public.get_projects_money_collection(array['04930000-0000-0000-0000-0000000000d2'::uuid])),true,
  'T12 fully mapped and read categories are complete for an unrestricted role');
select is((select (actuals->>'complete')::boolean from public.get_projects_money_collection(array['04930000-0000-0000-0000-0000000000d4'::uuid])),false,
  'T12 project without an Active budget is not complete');
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select (actuals->>'excludes_restricted_rows')::boolean from public.get_projects_money_collection(array['04930000-0000-0000-0000-0000000000d2'::uuid])),false,
  'T12 a Project Manager collection read reports no restricted-row exclusion');
select is((select (actuals->>'complete')::boolean from public.get_projects_money_collection(array['04930000-0000-0000-0000-0000000000d2'::uuid])),true,
  'T12 a Project Manager sees the same complete Actual as an Admin');
reset role;

-- Single read: one project, one get_project_finances call and one project_mapped_actuals call of its own.
-- Each probe runs in a fresh function-stat baseline (stats are cumulative inside the transaction).
create temp table t12_calls (label text, fn text, calls bigint);
grant all on t12_calls to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a1","role":"authenticated"}';
create temp table t12_before as select funcname, calls from pg_stat_xact_user_functions;
select count(*) from public.get_projects_money_collection(array['04930000-0000-0000-0000-0000000000d2'::uuid]);
insert into t12_calls select 'new', n.funcname, n.calls - coalesce(b.calls,0)
  from pg_stat_xact_user_functions n left join t12_before b using (funcname)
  where n.funcname in ('get_project_finances','project_mapped_actuals');
reset role;
select is((select calls from t12_calls where label='new' and fn='get_project_finances'),1::bigint,
  'T12 get_project_finances is called once per project');
select is((select calls from t12_calls where label='new' and fn='project_mapped_actuals'),2::bigint,
  'T12 project_mapped_actuals: one read inside the single finances call plus one for the collection (not one per budget line)');
select cmp_ok((select calls from t12_calls where label='new' and fn='project_mapped_actuals'),'<=',
  (select calls from t12_calls where label='new' and fn='get_project_finances')+1,
  'T12 mapped actuals is not re-read for a multi-line budget');

-- PMO-owned org: same equivalence with the committed-procurement basis.
update public.external_org_bindings set status='disconnected' where org_id='04930000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq(
  $$select * from public.get_projects_money_collection((select ids from t12_ids)) order by project_id$$,
  $$select * from public.t12_old_money_collection((select ids from t12_ids)) order by project_id$$,
  'T12 PMO collection output matches the 0396 output for Admin');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select results_eq(
  $$select * from public.get_projects_money_collection((select ids from t12_ids)) order by project_id$$,
  $$select * from public.t12_old_money_collection((select ids from t12_ids)) order by project_id$$,
  'T12 PMO collection output matches the 0396 output for Executive');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select results_eq(
  $$select * from public.get_projects_money_collection((select ids from t12_ids)) order by project_id$$,
  $$select * from public.t12_old_money_collection((select ids from t12_ids)) order by project_id$$,
  'T12 PMO collection output matches the 0396 output for Project Manager');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select ledger_basis from public.get_projects_money_collection(array['04930000-0000-0000-0000-0000000000d1'::uuid])),'pmo','T12 disconnected org returns PMO basis');
select is((select actuals->>'total' from public.get_projects_money_collection(array['04930000-0000-0000-0000-0000000000d1'::uuid])),'45.00','T12 PMO basis reads the committed procurement');
set local request.jwt.claims='{"sub":"04930000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select * from public.get_projects_money_collection(array['04930000-0000-0000-0000-0000000000d1'::uuid])$$,'42501',null,
  'T12 Engineer still cannot read collection finances');
select throws_ok($$select * from public.get_projects_money_collection(array[]::uuid[])$$,'42501',null,
  'T12 role gate precedes selection validation');
reset role;
select ok(not has_function_privilege('anon','public.get_projects_money_collection(uuid[])','EXECUTE'),
  'T12 anonymous access stays revoked');
select * from finish();
rollback;
