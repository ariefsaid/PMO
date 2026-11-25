-- 2680_wo_capture_checks.test.sql — a captured Draft work order gets the organisation's standard checks as tasks, and
-- cancelling a work order records why (#2898). Ids 26800000-… (synthetic).
-- MUTATION: drop the `v_reason is null or ...` refusal in cancel_work_order and 'a blank reason is refused' goes red;
-- drop the `archived_at is null` filter in copy_work_order_checks and 'an archived check is not copied' goes red;
-- set either function's search path back to `public` alone and 'every function ... pg_temp last' goes red;
-- drop the is_light_role_key refusal and 'a field job role cannot own a check' goes red;
-- drop `having count(*) = 1` and 'two holders ... unassigned' goes red.
begin;
create extension if not exists pgtap;
select plan(24);
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('26800000-0000-0000-0000-0000000000a1', 'WC Org A', 'IDR', 'UTC', true), ('26800000-0000-0000-0000-0000000000a2', 'WC Org B', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('26800000-0000-0000-0000-0000000000b1', 'wc-pm@example.com'), ('26800000-0000-0000-0000-0000000000b2', 'wc-eng@example.com'), ('26800000-0000-0000-0000-0000000000b3', 'wc-fin@example.com'),
  ('26800000-0000-0000-0000-0000000000b0', 'wc-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('26800000-0000-0000-0000-0000000000b1', '26800000-0000-0000-0000-0000000000a1', 'WC Manager', 'wc-pm@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('26800000-0000-0000-0000-0000000000b2', '26800000-0000-0000-0000-0000000000a1', 'WC Engineer', 'wc-eng@example.com', 'Engineer', 'active', 'engineer'),
  ('26800000-0000-0000-0000-0000000000b3', '26800000-0000-0000-0000-0000000000a1', 'WC Finance', 'wc-fin@example.com', 'Finance', 'active', 'finance_officer'),
  ('26800000-0000-0000-0000-0000000000b0', '26800000-0000-0000-0000-0000000000a2', 'WC Foreign', 'wc-foreign@example.com', 'Project Manager', 'active', 'project_manager');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount) values
  ('26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-0000000000a1', 'WC project', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0),
  ('26800000-0000-0000-0000-0000000000c2', '26800000-0000-0000-0000-0000000000a2', 'WC foreign project', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0);
insert into work_order_checklist_items (id, org_id, label, position, required, archived_at, owner_job_role, target_days) values
  ('26800000-0000-0000-0000-000000000061', '26800000-0000-0000-0000-0000000000a1', 'Check the drawings', 1, true, null, 'engineer', 3),
  ('26800000-0000-0000-0000-000000000062', '26800000-0000-0000-0000-0000000000a1', 'Check the material', 2, false, null, 'material_coordinator', 5),
  ('26800000-0000-0000-0000-000000000063', '26800000-0000-0000-0000-0000000000a1', 'Old check', 3, true, now(), 'engineer', 1),
  ('26800000-0000-0000-0000-000000000064', '26800000-0000-0000-0000-0000000000a2', 'Foreign check', 1, true, null, 'engineer', 2);
create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"26800000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare m text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics m = message_text; return sqlstate || ' ' || split_part(m, ':', 1); end $$;

-- The issuer captures a Draft: the organisation's live standard checks arrive as unassigned tasks on it.
select pg_temp.as_user('b1');
insert into work_orders (id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('26800000-0000-0000-0000-000000000031', '26800000-0000-0000-0000-0000000000c1', 'WC captured', 0, 'exclusive', 0),
  ('26800000-0000-0000-0000-000000000032', '26800000-0000-0000-0000-0000000000c1', 'WC withdrawn', 0, 'exclusive', 0);
select is((select array_agg(name order by name) from tasks where work_order_id = '26800000-0000-0000-0000-000000000031'),
  array['Check the drawings', 'Check the material'], 'AC-WOC-001 a new Draft carries the organisation''s live standard checks as tasks');
select is((select count(*)::int from tasks where work_order_id = '26800000-0000-0000-0000-000000000031' and name = 'Old check'), 0, 'AC-WOC-001 an archived check is not copied');
select is((select count(*)::int from tasks where work_order_id = '26800000-0000-0000-0000-000000000031' and name = 'Foreign check'), 0, 'AC-WOC-001 another organisation''s check is not copied');
select is((select bool_and(status = 'To Do' and project_id = '26800000-0000-0000-0000-0000000000c1')
  from tasks where work_order_id = '26800000-0000-0000-0000-000000000031'), true, 'AC-WOC-001 a copied check is open, on the work order''s project');
select is((select assignee_id::text || ' ' || (end_date - current_date)::text from tasks where work_order_id = '26800000-0000-0000-0000-000000000031' and name = 'Check the drawings'),
  '26800000-0000-0000-0000-0000000000b2 3', 'AC-WOC-001 the one holder of the line''s job role owns it, due the line''s days after capture');
select is((select coalesce(assignee_id::text, 'none') || ' ' || (end_date - current_date)::text from tasks where work_order_id = '26800000-0000-0000-0000-000000000031' and name = 'Check the material'),
  'none 5', 'AC-WOC-001 with nobody holding the job role the check waits for the issuer to give it an owner');
reset role;
select pg_temp.as_user('b0');
insert into work_orders (id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('26800000-0000-0000-0000-000000000033', '26800000-0000-0000-0000-0000000000c2', 'WC foreign', 0, 'exclusive', 0);
reset role;
select is((select array_agg(name) from tasks where work_order_id = '26800000-0000-0000-0000-000000000033'), array['Foreign check'], 'AC-WOC-001 each organisation copies only its own list');

-- A Finance creator's Draft gets the checks too (the copy is server authority); a direct link by a non-manager is still refused.
select pg_temp.as_user('b3');
select is(pg_temp.err($$insert into work_orders (id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('26800000-0000-0000-0000-000000000034', '26800000-0000-0000-0000-0000000000c1', 'WC by finance', 0, 'exclusive', 0)$$), 'ok', 'AC-WOC-001 a Finance creator captures a Draft and it gets the standard checks');
select pg_temp.as_user('b2');
select is(pg_temp.err($$insert into tasks (project_id, work_order_id, name, status) values
  ('26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000031', 'Sneaky link', 'To Do')$$), '42501 only a manager may link a task to a work order or require proof', 'AC-WOC-001 a non-manager still cannot link a task to a work order directly');

-- The standard checks are saved whole by an Admin; each line names a job role and days.
reset role;
insert into auth.users (id, email) values ('26800000-0000-0000-0000-0000000000b4', 'wc-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('26800000-0000-0000-0000-0000000000b4', '26800000-0000-0000-0000-0000000000a1', 'WC Admin', 'wc-admin@example.com', 'Admin', 'active', 'administrator');
select pg_temp.as_user('b1');
select is(pg_temp.err($$select set_work_order_check_template('[{"label":"Permit","owner_job_role":"engineer","target_days":2}]')$$), '42501 only an administrator can edit the standard checks', 'AC-WOC-001 only an Admin edits the standard checks');
select pg_temp.as_user('b4');
select is(pg_temp.err($$select set_work_order_check_template('[{"label":"Permit","owner_job_role":"someone","target_days":2}]')$$), '22023 WOC_TEMPLATE', 'AC-WOC-001 a line must name a job role');
select is(pg_temp.err($$select set_work_order_check_template('[{"id":"26800000-0000-0000-0000-000000000062","label":"Material reserved","owner_job_role":"storekeeper","target_days":4},{"label":"Permit arranged","owner_job_role":"engineer","target_days":2}]')$$), 'ok', 'AC-WOC-001 an Admin saves the list with job roles and days');
select is((select string_agg(label || ':' || owner_job_role || ':' || target_days, ',' order by position) from work_order_checklist_items where org_id = '26800000-0000-0000-0000-0000000000a1' and archived_at is null),
  'Material reserved:storekeeper:4,Permit arranged:engineer:2', 'AC-WOC-001 the saved list replaces the old one in order; lines left out are archived');
select is(pg_temp.err($$select set_work_order_check_template('[{"label":"Site walk","owner_job_role":"foreman","target_days":2}]')$$), '22023 WOC_TEMPLATE', 'AC-WOC-001 a field job role cannot own a check');
select is(pg_temp.err($$select set_work_order_check_template('[{"label":"Site walk","owner_job_role":"field_user","target_days":2}]')$$), '22023 WOC_TEMPLATE', 'AC-WOC-001 a field user job role cannot own a check');

-- Two active holders of a line's job role: the check is created unassigned for the issuer to give an owner.
reset role;
insert into auth.users (id, email) values ('26800000-0000-0000-0000-0000000000b5', 'wc-store1@example.com'), ('26800000-0000-0000-0000-0000000000b6', 'wc-store2@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('26800000-0000-0000-0000-0000000000b5', '26800000-0000-0000-0000-0000000000a1', 'WC Store One', 'wc-store1@example.com', 'Engineer', 'active', 'storekeeper'),
  ('26800000-0000-0000-0000-0000000000b6', '26800000-0000-0000-0000-0000000000a1', 'WC Store Two', 'wc-store2@example.com', 'Engineer', 'active', 'storekeeper');
select pg_temp.as_user('b1');
insert into work_orders (id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('26800000-0000-0000-0000-000000000035', '26800000-0000-0000-0000-0000000000c1', 'WC two holders', 0, 'exclusive', 0);
select is((select string_agg(name || ':' || coalesce(assignee_id::text, 'none'), ',' order by name) from tasks where work_order_id = '26800000-0000-0000-0000-000000000035'),
  'Material reserved:none,Permit arranged:26800000-0000-0000-0000-0000000000b2', 'AC-WOC-001 two holders of the line''s job role leave the check unassigned');

-- Cancelling asks for a reason.
select pg_temp.as_user('b1');
select is(pg_temp.err($$select cancel_work_order('26800000-0000-0000-0000-000000000032', '   ')$$), '23514 WOC_REASON', 'AC-WOC-002 a blank reason is refused');
select is(pg_temp.err($$select cancel_work_order('26800000-0000-0000-0000-000000000032', 'ab')$$), '23514 WOC_REASON', 'AC-WOC-002 a two-character reason is refused');
select pg_temp.as_user('b2');
select is(pg_temp.err($$select cancel_work_order('26800000-0000-0000-0000-000000000032', 'Client withdrew the order')$$), '42501 not authorized', 'AC-WOC-002 a role that may not cancel a work order still may not');
select pg_temp.as_user('b0');
select is(pg_temp.err($$select cancel_work_order('26800000-0000-0000-0000-000000000032', 'Client withdrew the order')$$), '42501 not authorized', 'AC-WOC-002 another organisation cannot cancel it');
select pg_temp.as_user('b1');
select is(pg_temp.err($$select cancel_work_order('26800000-0000-0000-0000-000000000032', '  Client withdrew the order  ')$$), 'ok', 'AC-WOC-002 the issuer cancels a Draft with a reason');
select is((select status::text || ' ' || cancel_reason from work_orders where id = '26800000-0000-0000-0000-000000000032'),
  'Cancelled Client withdrew the order', 'AC-WOC-002 the work order is Cancelled and its reason reads back trimmed');
reset role;
select is(has_column_privilege('authenticated', 'public.work_orders', 'cancel_reason', 'UPDATE'), false, 'AC-WOC-002 the reason is written only by the cancel step');
select is((select string_agg(proname || ':' || coalesce((proconfig[array_upper(proconfig, 1)] ~ '^search_path=.*pg_temp$')::text, 'false'), ',' order by proname)
  from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('check_task_work_order', 'copy_work_order_checks', 'set_work_order_check_template', 'cancel_work_order')),
  'cancel_work_order:true,check_task_work_order:true,copy_work_order_checks:true,set_work_order_check_template:true',
  'AC-WOC-001 every function this migration creates sets its search path with pg_temp last');
select * from finish();
rollback;
