begin;
create extension if not exists pgtap;
select plan(13);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('20410000-0000-0000-0000-00000000000a', 'RR CR Org', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('20410000-0000-0000-0000-0000000000' || k)::uuid, 'rrcr-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20410000-0000-0000-0000-0000000000a1', '20410000-0000-0000-0000-00000000000a', 'Admin',       'rrcr-a1@example.com', 'Admin', 'active', null),
  ('20410000-0000-0000-0000-0000000000a2', '20410000-0000-0000-0000-00000000000a', 'Store keeps', 'rrcr-a2@example.com', 'Engineer', 'active', 'storekeeper'),
  ('20410000-0000-0000-0000-0000000000a3', '20410000-0000-0000-0000-00000000000a', 'Store other', 'rrcr-a3@example.com', 'Engineer', 'active', 'storekeeper'),
  ('20410000-0000-0000-0000-0000000000a4', '20410000-0000-0000-0000-00000000000a', 'Supervisor',  'rrcr-a4@example.com', 'Engineer', 'active', 'site_supervisor'),
  ('20410000-0000-0000-0000-0000000000a5', '20410000-0000-0000-0000-00000000000a', 'Supervisor2', 'rrcr-a5@example.com', 'Engineer', 'active', 'site_supervisor'),
  ('20410000-0000-0000-0000-0000000000a6', '20410000-0000-0000-0000-00000000000a', 'Inspector',   'rrcr-a6@example.com', 'Engineer', 'active', 'quality_inspector'),
  ('20410000-0000-0000-0000-0000000000a7', '20410000-0000-0000-0000-00000000000a', 'Engineer',    'rrcr-a7@example.com', 'Engineer', 'active', null),
  ('20410000-0000-0000-0000-0000000000a8', '20410000-0000-0000-0000-00000000000a', 'Field',       'rrcr-a8@example.com', 'Engineer', 'active', 'field_user'),
  ('20410000-0000-0000-0000-0000000000a9', '20410000-0000-0000-0000-00000000000a', 'PM',          'rrcr-a9@example.com', 'Project Manager', 'active', null);
-- the quality inspector keeps the same store as the storekeeper: keeping alone is not the storekeeper's right
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('20410000-0000-0000-0000-0000000000c1', '20410000-0000-0000-0000-00000000000a', 'RRCR project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '20410000-0000-0000-0000-0000000000a9');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('20410000-0000-0000-0000-000000002001', '20410000-0000-0000-0000-00000000000a', 'SITE-A', 'Site A', 'site', '20410000-0000-0000-0000-0000000000c1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, site_warehouse_id) values
  ('20410000-0000-0000-0000-000000000031', '20410000-0000-0000-0000-00000000000a', '20410000-0000-0000-0000-0000000000c1', 'WO on site A', 'Draft', 10000, 'exclusive', 0, '20410000-0000-0000-0000-000000002001'),
  ('20410000-0000-0000-0000-000000000032', '20410000-0000-0000-0000-00000000000a', '20410000-0000-0000-0000-0000000000c1', 'WO elsewhere', 'Draft', 10000, 'exclusive', 0, null);
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('20410000-0000-0000-0000-00000000000a', '20410000-0000-0000-0000-000000002001', '20410000-0000-0000-0000-0000000000a2'),
  ('20410000-0000-0000-0000-00000000000a', '20410000-0000-0000-0000-000000002001', '20410000-0000-0000-0000-0000000000a6');
insert into crews (id, org_id, code, name, field_controller_id) values
  ('20410000-0000-0000-0000-000000000041', '20410000-0000-0000-0000-00000000000a', 'CA', 'Crew A', '20410000-0000-0000-0000-0000000000a4'),
  ('20410000-0000-0000-0000-000000000042', '20410000-0000-0000-0000-00000000000a', 'CB', 'Crew B', null);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('20410000-0000-0000-0000-00000000000a', '20410000-0000-0000-0000-000000000031', '20410000-0000-0000-0000-000000000041', current_date - 10),
  ('20410000-0000-0000-0000-00000000000a', '20410000-0000-0000-0000-000000000032', '20410000-0000-0000-0000-000000000042', current_date - 10);
insert into people (id, org_id, code, name) values
  ('20410000-0000-0000-0000-000000000051', '20410000-0000-0000-0000-00000000000a', 'W1', 'Worker one');
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('20410000-0000-0000-0000-00000000000a', '20410000-0000-0000-0000-000000000041', '20410000-0000-0000-0000-000000000051', current_date - 10);
insert into org_crew_tool_settings (org_id, coordinator_id) values
  ('20410000-0000-0000-0000-00000000000a', '20410000-0000-0000-0000-0000000000a2')
  on conflict (org_id) do update set coordinator_id = excluded.coordinator_id;
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, work_order_id, reported_by) values
  ('20410000-0000-0000-0000-000000000061', '20410000-0000-0000-0000-00000000000a', current_date, 'Safety', 'Low',
   '20410000-0000-0000-0000-0000000000c1', '20410000-0000-0000-0000-000000000031', '20410000-0000-0000-0000-0000000000a7'),
  ('20410000-0000-0000-0000-000000000062', '20410000-0000-0000-0000-00000000000a', current_date, 'Safety', 'Low',
   '20410000-0000-0000-0000-0000000000c1', '20410000-0000-0000-0000-000000000032', '20410000-0000-0000-0000-0000000000a7');


update crews set field_controller_id = null;
update work_orders set responsible_person_id = '20410000-0000-0000-0000-0000000000a4',
 start_date = current_date - 1, end_date = current_date + 1;
insert into attendance_days(org_id,worker_id,crew_id,work_order_id,work_date,status,hours,source,project_id,recorded_by) values ('20410000-0000-0000-0000-00000000000a','20410000-0000-0000-0000-000000000051','20410000-0000-0000-0000-000000000041','20410000-0000-0000-0000-000000000031',current_date,'present',8,'roster_tick','20410000-0000-0000-0000-0000000000c1','20410000-0000-0000-0000-0000000000a7');
select set_config('request.jwt.claims', '{"sub":"20410000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from attendance_days),1::bigint,'AC-SITE-004 supervisor reads attendance recorded by foreman');
select ok(actor_may_lend_workers('20410000-0000-0000-0000-000000000041',current_date,current_date), 'AC-SITE-006 supervisor lends from a roster with a separate controller');
select ok(actor_may_task_issue('20410000-0000-0000-0000-000000000031'), 'AC-SITE-017 assigned supervisor may task');
select lives_ok($$insert into crew_loans(worker_id,home_crew_id,host_crew_id,valid_from,valid_to) values('20410000-0000-0000-0000-000000000051','20410000-0000-0000-0000-000000000041','20410000-0000-0000-0000-000000000042',current_date,current_date)$$,'AC-SITE-006 supervisor records the loan');
select is((select created_by from crew_loans limit 1),'20410000-0000-0000-0000-0000000000a4'::uuid,'AC-SITE-006 loan retains its author');
select ok(not supervisor_may_lend_crew(gen_random_uuid()),'AC-SITE-006 unknown or foreign crew refused');
reset role;
update incident_reports set work_order_id=null where id='20410000-0000-0000-0000-000000000061';
set local role authenticated;
select ok(actor_may_task_incident('20410000-0000-0000-0000-000000000061'),'AC-SITE-017 project-only issue in assigned project allowed');

reset role;
update work_orders set end_date = current_date - 1;
set local role authenticated;
select ok(not actor_may_task_issue('20410000-0000-0000-0000-000000000031'), 'AC-SITE-017 expired assignment refused');
reset role;
update work_orders set start_date = current_date + 1, end_date = current_date + 2;
set local role authenticated;
select ok(not actor_may_task_issue('20410000-0000-0000-0000-000000000031'), 'AC-SITE-017 future assignment refused');
reset role;
update work_orders set start_date = current_date - 1;
select set_config('request.jwt.claims', '{"sub":"20410000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from attendance_days),0::bigint,'AC-SITE-004 unrelated supervisor cannot read attendance');
select ok(not actor_may_lend_workers('20410000-0000-0000-0000-000000000041',current_date,current_date), 'AC-SITE-006 same-level unassigned supervisor refused');
select ok(not actor_may_task_incident('20410000-0000-0000-0000-000000000061'),'AC-SITE-017 project-only issue outside scope refused');
select ok(not actor_may_task_issue('20410000-0000-0000-0000-000000000031'), 'AC-SITE-017 same-level unassigned supervisor refused');
select * from finish();
rollback;
