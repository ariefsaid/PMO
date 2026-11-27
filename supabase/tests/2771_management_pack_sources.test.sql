begin;
create extension if not exists pgtap;
select no_plan();

insert into organizations (id, name, default_currency, built_in_roles_enabled) values
  ('27510000-0000-0000-0000-00000000000a', 'PS3 Org',       'IDR', true),
  ('27510000-0000-0000-0000-00000000000b', 'PS3 Other Org', 'IDR', true);
insert into auth.users (id, email)
select ('27510000-0000-0000-0000-0000000000' || k)::uuid, 'ps3-' || k || '@example.test'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1','b2','b3','b4','c1','c2']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27510000-0000-0000-0000-0000000000a1', '27510000-0000-0000-0000-00000000000a', 'PS3 Admin',   'ps3-a1@example.test', 'Admin',           'active', null),
  ('27510000-0000-0000-0000-0000000000a2', '27510000-0000-0000-0000-00000000000a', 'PS3 Fin',     'ps3-a2@example.test', 'Finance',         'active', null),
  ('27510000-0000-0000-0000-0000000000a3', '27510000-0000-0000-0000-00000000000a', 'PS3 PM A',    'ps3-a3@example.test', 'Project Manager', 'active', 'project_manager'),
  ('27510000-0000-0000-0000-0000000000a4', '27510000-0000-0000-0000-00000000000a', 'PS3 PM B',    'ps3-a4@example.test', 'Project Manager', 'active', null),
  ('27510000-0000-0000-0000-0000000000a5', '27510000-0000-0000-0000-00000000000a', 'PS3 Deputy A','ps3-a5@example.test', 'Project Manager', 'active', 'deputy_project_manager'),
  ('27510000-0000-0000-0000-0000000000a6', '27510000-0000-0000-0000-00000000000a', 'PS3 Deputy 0','ps3-a6@example.test', 'Project Manager', 'active', 'deputy_project_manager'),
  ('27510000-0000-0000-0000-0000000000a7', '27510000-0000-0000-0000-00000000000a', 'PS3 Buyer M', 'ps3-a7@example.test', 'Project Manager', 'active', 'procurement_manager'),
  ('27510000-0000-0000-0000-0000000000a8', '27510000-0000-0000-0000-00000000000a', 'PS3 Equip M', 'ps3-a8@example.test', 'Project Manager', 'active', 'equipment_manager'),
  ('27510000-0000-0000-0000-0000000000a9', '27510000-0000-0000-0000-00000000000a', 'PS3 HR M',    'ps3-a9@example.test', 'Project Manager', 'active', 'hr_manager'),
  ('27510000-0000-0000-0000-0000000000b1', '27510000-0000-0000-0000-00000000000a', 'PS3 PCM',     'ps3-b1@example.test', 'Project Manager', 'active', 'project_control_manager'),
  ('27510000-0000-0000-0000-0000000000b2', '27510000-0000-0000-0000-00000000000a', 'PS3 Exec',    'ps3-b2@example.test', 'Executive',       'active', null),
  ('27510000-0000-0000-0000-0000000000b3', '27510000-0000-0000-0000-00000000000a', 'PS3 Stand-in','ps3-b3@example.test', 'Project Manager', 'active', 'project_manager'),
  ('27510000-0000-0000-0000-0000000000b4', '27510000-0000-0000-0000-00000000000a', 'PS3 Old SI',  'ps3-b4@example.test', 'Project Manager', 'active', 'project_manager'),
  ('27510000-0000-0000-0000-0000000000c1', '27510000-0000-0000-0000-00000000000b', 'PS3 XOrg',    'ps3-c1@example.test', 'Admin',           'active', null),
  ('27510000-0000-0000-0000-0000000000c2', '27510000-0000-0000-0000-00000000000b', 'PS3 XOrg PM', 'ps3-c2@example.test', 'Project Manager', 'active', 'project_manager');
-- A: managed by PM A, deputy Deputy A. B: managed by PM B (no job role).
insert into projects (id, org_id, name, status, project_manager_id, deputy_manager_id, currency) values
  ('27510000-0000-0000-0000-0000000000d1', '27510000-0000-0000-0000-00000000000a', 'PS3 Project A', 'Ongoing Project', '27510000-0000-0000-0000-0000000000a3', '27510000-0000-0000-0000-0000000000a5', 'IDR'),
  ('27510000-0000-0000-0000-0000000000d2', '27510000-0000-0000-0000-00000000000a', 'PS3 Project B', 'Ongoing Project', '27510000-0000-0000-0000-0000000000a4', null, 'IDR');
-- Stand-ins for PM B: b3 today, b4 revoked, a6 ended yesterday.
insert into approval_stand_ins (org_id, delegator_id, stand_in_id, starts_on, ends_on, created_by, revoked_at) values
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000a4', '27510000-0000-0000-0000-0000000000b3', native_org_today('27510000-0000-0000-0000-00000000000a') - 1, native_org_today('27510000-0000-0000-0000-00000000000a') + 1, '27510000-0000-0000-0000-0000000000a1', null),
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000a4', '27510000-0000-0000-0000-0000000000b4', native_org_today('27510000-0000-0000-0000-00000000000a') - 1, native_org_today('27510000-0000-0000-0000-00000000000a') + 1, '27510000-0000-0000-0000-0000000000a1', now()),
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000a4', '27510000-0000-0000-0000-0000000000a6', native_org_today('27510000-0000-0000-0000-00000000000a') - 5, native_org_today('27510000-0000-0000-0000-00000000000a') - 1, '27510000-0000-0000-0000-0000000000a1', null);
-- B carries money: an active 1000 Labor budget and an 800 Labor purchase, paid (B's spend is 1030 with the hire charge
-- of 200 and the stock issue of 30 seeded below). PM A approves spend org-wide; PM B is
-- B's named approver (so B is not on the flat matrix, which routes to every holder of approval rank).
insert into budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('27510000-0000-0000-0000-000000000101', '27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000d2', 1, 'v1', 'Draft', 'IDR');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-000000000101', 'Labor', 1000);
update budget_versions set status = 'Active' where id = '27510000-0000-0000-0000-000000000101';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('27510000-0000-0000-0000-00000000000a', null, '27510000-0000-0000-0000-0000000000a3'),
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000d2', '27510000-0000-0000-0000-0000000000a4'),
  ('27510000-0000-0000-0000-00000000000b', null, '27510000-0000-0000-0000-0000000000c2');
insert into procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, requested_by_id) values
  ('27510000-0000-0000-0000-000000000601', '27510000-0000-0000-0000-00000000000a', 'PS3 buy B', 'Ordered', 800, '27510000-0000-0000-0000-0000000000d2', 'IDR', 'Labor', '27510000-0000-0000-0000-0000000000a4');
insert into payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('27510000-0000-0000-0000-000000000701', '27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-000000000601', 'Paid', '2026-10-10', 800, 'IDR');

-- B also carries one row of every other shared read, so each "no row" case below would show B's money without the rule:
-- an issue of stock costed to it, an equipment hire charge, an attributed overhead, and a billing claim. A request on B
-- waits for a decision (an approver reads its figures while it waits). C has no named approver and nothing waiting.
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('27510000-0000-0000-0000-0000000000d3', '27510000-0000-0000-0000-00000000000a', 'PS3 Project C', 'Ongoing Project', '27510000-0000-0000-0000-0000000000a1', 'IDR');
insert into stock_issue_cost_settings (org_id, effective_on) values ('27510000-0000-0000-0000-00000000000a', '2026-01-01');
insert into erp_account_mirror (org_id, company, erp_name, account_name, root_type, report_type, parent_account, is_group, account_currency, lft, rgt, refresh_id) values
  ('27510000-0000-0000-0000-00000000000a', 'PS3', 'Rent - PS3', 'Rent', 'Expense', 'Profit and Loss', null, false, 'IDR', 1, 2, '27510000-0000-0000-0000-0000000000f0');
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values ('27510000-0000-0000-0000-00000000000a', 'Equipment', 'Rent - PS3', false);
insert into erp_gl_entry_mirror (id, org_id, erp_name, company, account, cost_center, fiscal_year, project, party_type, party, posting_date, debit, credit, is_cancelled, erp_modified) values
  ('27510000-0000-0000-0000-0000000001a1', '27510000-0000-0000-0000-00000000000a', 'PS3-GL-1', 'PS3', 'Rent - PS3', 'Main - PS3', '2026', null, null, null, '2026-09-30', 1000, 0, false, '1');
insert into cost_attribution_rules (id, org_id, rule_key, version, name, match_account, effective_from, specificity) values
  ('27510000-0000-0000-0000-0000000002a1', '27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000003a1', 1, 'PS3 rent', 'Rent - PS3', '2026-01-01', 2);
insert into cost_attribution_rule_targets (rule_id, org_id, position, project_id, percent) values ('27510000-0000-0000-0000-0000000002a1', '27510000-0000-0000-0000-00000000000a', 0, '27510000-0000-0000-0000-0000000000d2', 100);
insert into equipment_assets (id, org_id, code, name, default_unit) values ('27510000-0000-0000-0000-0000000000e1', '27510000-0000-0000-0000-00000000000a', 'PS3-GEN', 'Generator', 'hours');
insert into equipment_costing_settings (org_id, asset_id, setting_key, version, basis, work_rate, rate_unit, charge_category, effective_from) values
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000e1', '27510000-0000-0000-0000-0000000003c2', 1, 'hire_rate', 50, 'hours', 'Equipment', '2026-01-01');
set local session_replication_role = replica;
insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, status, author_id, approver_id, approved_at) values
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000e1', '27510000-0000-0000-0000-0000000000d2', '2026-09-11', 4, 'hours', 'work', 'Approved', '27510000-0000-0000-0000-0000000000a1', '27510000-0000-0000-0000-0000000000a4', now());
insert into stock_units (id, org_id, code, name) values ('27510000-0000-0000-0000-000000000851', '27510000-0000-0000-0000-00000000000a', 'm', 'metre');
insert into stock_items (id, org_id, code, name, unit_id) values ('27510000-0000-0000-0000-000000000852', '27510000-0000-0000-0000-00000000000a', 'CBL', 'Cable', '27510000-0000-0000-0000-000000000851');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values ('27510000-0000-0000-0000-000000000801', '27510000-0000-0000-0000-00000000000a', 'PS3-C', 'Central', 'central', null);
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, occurred_on, created_by, posted_by, posted_at) values
  ('27510000-0000-0000-0000-000000000811', '27510000-0000-0000-0000-00000000000a', 'SI-PS3-1', 'issue', 'Posted', '27510000-0000-0000-0000-000000000801', '27510000-0000-0000-0000-0000000000d2', '2026-11-16', '27510000-0000-0000-0000-0000000000a1', '27510000-0000-0000-0000-0000000000a1', now());
insert into stock_document_lines (id, org_id, document_id, line_no, item_id, quantity, direction) values ('27510000-0000-0000-0000-000000000821', '27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-000000000811', 1, '27510000-0000-0000-0000-000000000852', 3, 'out');
insert into stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, kind, qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by) values
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-000000000811', '27510000-0000-0000-0000-000000000821', '27510000-0000-0000-0000-000000000852', '27510000-0000-0000-0000-000000000801', '27510000-0000-0000-0000-0000000000d2', 'issue', -3, -30, 0, 0, '2026-11-16', '27510000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('27510000-0000-0000-0000-000000000401', '27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000d2', 'WO-B', 'PS3 WO B', 'Issued', 900, 'exclusive', 0, 'IDR');
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, created_by) values ('27510000-0000-0000-0000-000000000a01', '27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000d2', '27510000-0000-0000-0000-000000000401', 'progress', 'IDR', 500, '27510000-0000-0000-0000-0000000000a4');
insert into procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, requested_by_id) values
  ('27510000-0000-0000-0000-000000000602', '27510000-0000-0000-0000-00000000000a', 'PS3 ask B', 'Requested', 100, '27510000-0000-0000-0000-0000000000d2', 'IDR', 'Labor', '27510000-0000-0000-0000-0000000000a4');
set local session_replication_role = origin;


insert into auth.users(id,email) values ('27510000-0000-0000-0000-0000000000e1','q9-engineer@example.test'), ('27510000-0000-0000-0000-0000000000e2','q9-light@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('27510000-0000-0000-0000-0000000000e1','27510000-0000-0000-0000-00000000000a','Q9 Engineer','q9-engineer@example.test','Engineer','active'),
 ('27510000-0000-0000-0000-0000000000e2','27510000-0000-0000-0000-00000000000a','Q9 Light','q9-light@example.test','Admin','active');

update profiles set role='Engineer', built_in_role = 'field_user' where id = '27510000-0000-0000-0000-0000000000e2';
set local session_replication_role = replica;
insert into work_order_plan_lines(org_id,project_id,work_order_id,kind,value) values
 ('27510000-0000-0000-0000-00000000000a','27510000-0000-0000-0000-0000000000d2','27510000-0000-0000-0000-000000000401','direct_budget',1234.56);
insert into project_shared_cost_splits(org_id,project_id,work_order_id,percent) values
 ('27510000-0000-0000-0000-00000000000a','27510000-0000-0000-0000-0000000000d2','27510000-0000-0000-0000-000000000401',100);
set local session_replication_role = origin;
create function pg_temp.single_money(p_id uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(c) order by c.record_id,c.source),'[]'::jsonb) into v from public.work_order_cost_amounts(p_id) c;
  return jsonb_build_object('data',v);
exception when others then return jsonb_build_object('error',jsonb_build_object('code',sqlstate,'message',sqlerrm));
end $$;
create function pg_temp.single_finances(p_id uuid) returns jsonb language plpgsql as $$
begin return jsonb_build_object('data',public.get_project_finances(p_id));
exception when others then return jsonb_build_object('error',jsonb_build_object('code',sqlstate,'message',sqlerrm));
end $$;
create function pg_temp.single_structure(p_id uuid, p_source text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  case p_source
  when 'orders' then
    select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'wo_number',w.wo_number,'title',w.title,'status',w.status,'currency',w.currency) order by w.id),'[]'::jsonb) into v from work_orders w where w.project_id=p_id;
  when 'plans' then
    select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'work_order_id',l.work_order_id,'section_id',l.section_id,'discipline_id',l.discipline_id,'kind',l.kind,'value',l.value::text,'note',l.note) order by l.id),'[]'::jsonb) into v from work_order_plan_lines l where l.project_id=p_id;
  when 'split' then
    select coalesce(jsonb_agg(jsonb_build_object('work_order_id',s.work_order_id,'percent',s.percent) order by s.work_order_id),'[]'::jsonb) into v from project_shared_cost_splits s where s.project_id=p_id;
  when 'billing' then
    select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v from (select work_order_id,project_id,status,currency,order_net,invoiced,pending,paid,remaining,figures_complete,line_count,unpaid_count from work_order_billing where project_id=p_id limit 501) q;
  end case;
  return jsonb_build_object('data',v);
exception when others then return jsonb_build_object('error',jsonb_build_object('code',sqlstate,'message',sqlerrm));
end $$;
create temp table q9_baseline(who text, uid uuid, project uuid, money jsonb, finances jsonb, structure jsonb);
grant all on q9_baseline to authenticated;
set local role authenticated;
do $$
declare actor record; pid uuid;
begin
  for actor in select * from (values
    ('Admin','a1'),('Finance','a2'),('PM','a3'),('Deputy','a5'),
    ('Engineer','e1'),('Light','e2'),('Other organisation','c1')) a(label,suffix) loop
    perform set_config('request.jwt.claims',json_build_object('sub','27510000-0000-0000-0000-0000000000'||actor.suffix,'role','authenticated')::text,true);
    foreach pid in array array['27510000-0000-0000-0000-0000000000d1'::uuid,'27510000-0000-0000-0000-0000000000d2'::uuid,'27510000-0000-0000-0000-0000000000ff'::uuid] loop
      insert into q9_baseline values(actor.label,('27510000-0000-0000-0000-0000000000'||actor.suffix)::uuid,pid,pg_temp.single_money(pid),pg_temp.single_finances(pid), jsonb_build_object('orders',pg_temp.single_structure(pid,'orders'),'billing',pg_temp.single_structure(pid,'billing'),'plans',pg_temp.single_structure(pid,'plans'),'split',pg_temp.single_structure(pid,'split')));
    end loop;
  end loop;
end $$;
select ok(exists(select 1 from q9_baseline where who='Admin' and jsonb_array_length(money->'data')>0), 'AC-Q9-010 populated money fixture');
select is((select money->'error'->>'code' from q9_baseline where who='PM' and project='27510000-0000-0000-0000-0000000000d2'),'P0002','AC-Q9-011 PM foreign money is unavailable');
-- Q9_MUTATION_POINT: mutation proof changes only the canonical predicate after baseline capture.
create function pg_temp.prove_batch() returns setof text language plpgsql as $$
declare actor record; b jsonb;
begin
  for actor in select distinct who, uid from q9_baseline order by who loop
    perform set_config('request.jwt.claims',json_build_object('sub',actor.uid,'role','authenticated')::text,true);
    b := public.get_projects_plan_actual_sources(array(select project from q9_baseline where who=actor.who order by project));
    return query select is(b->q.project::text->'money',q.money,'AC-Q9-002 '||q.who||' money equality '||q.project::text) from q9_baseline q where q.who=actor.who;
    return query select is(b->q.project::text->'orders',q.structure->'orders','AC-Q9-015 '||q.who||' orders equality '||q.project::text) from q9_baseline q where q.who=actor.who;
    return query select is(b->q.project::text->'billing',q.structure->'billing','AC-Q9-016 '||q.who||' billing equality '||q.project::text) from q9_baseline q where q.who=actor.who;
    return query select is(b->q.project::text->'plans',case when q.money->'error'->>'code'='42501' then jsonb_build_object('data','[]'::jsonb) else q.structure->'plans' end,'AC-Q9-017 '||q.who||' plan equality '||q.project::text) from q9_baseline q where q.who=actor.who;
    return query select is(b->q.project::text->'split',case when q.money->'error'->>'code'='42501' then jsonb_build_object('data','[]'::jsonb) else q.structure->'split' end,'AC-Q9-018 '||q.who||' split equality '||q.project::text) from q9_baseline q where q.who=actor.who;
    return query select is(b->q.project::text->'finances',q.finances,'AC-Q9-003 '||q.who||' finance equality '||q.project::text) from q9_baseline q where q.who=actor.who;
  end loop;
end $$;
select * from pg_temp.prove_batch();
select set_config('request.jwt.claims','{"sub":"27510000-0000-0000-0000-0000000000a1","role":"authenticated"}',true);
select ok((public.get_projects_plan_actual_sources(array['27510000-0000-0000-0000-0000000000d2'::uuid])->'27510000-0000-0000-0000-0000000000d2'->'orders'->'data') @> '[{"id":"27510000-0000-0000-0000-000000000401"}]'::jsonb,'AC-Q9-014 populated order source remains readable');
select is((select count(*) from jsonb_object_keys(public.get_projects_plan_actual_sources(
  array(select ('27710000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,1001) i)))),1001::bigint,'AC-Q9-004 aggregate transport retains 1001 project outcomes');
reset role;
select ok(not has_function_privilege('anon','public.get_projects_plan_actual_sources(uuid[])','execute'),'AC-Q9-005 no anonymous batch execute');
select ok(not has_function_privilege('anon','public.project_plan_actual_sources(uuid[])','execute'),'AC-Q9-005 no anonymous source execute');
select * from finish();
rollback;
