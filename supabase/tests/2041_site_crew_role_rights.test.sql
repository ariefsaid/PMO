-- 2041_site_crew_role_rights.test.sql — Storekeeper crew tools, Site Supervisor worker loans and tasks from issues (migration 2041).
-- Each right: the named job role is allowed in its scope; the same job role outside its scope and a person at the same access level
-- with another job role are refused; a person with no job role is judged by access level as before; a field account is refused.
-- MUTATION NOTES (remove the condition tagged in 2041; the named assertion must go red; restore):
--   mut:rr_store_tools .... 'RR-CR-01 the Storekeeper of the crew''s site store adds a tool line' and 'RR-CR-04 ... reports a lost tool'
--   (the own-report refusal is proven in 2048: nobody writes off a report they made; mut:rr_own_writeoff)
--   mut:rr_ss_loan ........ 'RR-CR-07 the Site Supervisor of the home crew lends a worker for one day'
--   mut:rr_ss_task ........ 'RR-CR-11 the Site Supervisor makes a task from an issue on its work order'
begin;
create extension if not exists pgtap;
select plan(25);

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
  ('20410000-0000-0000-0000-000000000042', '20410000-0000-0000-0000-00000000000a', 'CB', 'Crew B', null),
  ('20410000-0000-0000-0000-000000000043', '20410000-0000-0000-0000-00000000000a', 'CH', 'Loan host', '20410000-0000-0000-0000-0000000000a4');
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

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20410000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;
create function pg_temp.tool(p_name text, p_crew text default '41') returns text language sql as $$
  select format('insert into crew_tool_lines (crew_id, name, held_qty) values (%L, %L, 2)',
                '20410000-0000-0000-0000-0000000000' || p_crew, p_name) $$;
create function pg_temp.loan(p_days int) returns text language sql as $$
  select format('insert into crew_loans (worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values (%L, %L, %L, current_date, current_date + %s)',
                '20410000-0000-0000-0000-000000000051', '20410000-0000-0000-0000-000000000041',
                '20410000-0000-0000-0000-000000000043', p_days) $$;

-- ── crew tools ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a2', pg_temp.tool('Grinder')), 'ok', 'RR-CR-01 the Storekeeper of the crew''s site store adds a tool line');
select is(pg_temp.err('a2', $$update crew_tool_lines set held_qty = 3 where name = 'Grinder'$$), 'ok', 'RR-CR-01 and edits it');
select is((select held_qty from crew_tool_lines where name = 'Grinder'), 3, 'RR-CR-01 the edit is stored');
select is(pg_temp.err('a2', pg_temp.tool('Drill', '42')), '42501 new row violates row-level security policy for table "crew_tool_lines"',
  'RR-CR-02 the Storekeeper cannot add a tool to a crew whose site store it does not keep');
select is(pg_temp.err('a3', pg_temp.tool('Drill')), '42501 new row violates row-level security policy for table "crew_tool_lines"',
  'RR-CR-02 a Storekeeper who keeps no store of the crew cannot add a tool');
select is(pg_temp.err('a6', pg_temp.tool('Drill')), '42501 new row violates row-level security policy for table "crew_tool_lines"',
  'RR-CR-03 a Quality Inspector who keeps the same store cannot add a tool');
select is(pg_temp.err('a7', pg_temp.tool('Drill')), '42501 new row violates row-level security policy for table "crew_tool_lines"',
  'RR-CR-03 an Engineer with no job role still cannot add a tool');
select is(pg_temp.err('a8', pg_temp.tool('Drill')), '42501 new row violates row-level security policy for table "crew_tool_lines"',
  'RR-CR-03 a field account cannot add a tool');
select is(pg_temp.err('a9', pg_temp.tool('Drill')), 'ok', 'RR-CR-03 a Project Manager with no job role still adds a tool');

select is(pg_temp.err('a2', format($$select report_crew_tool(%L, (select id from crew_tool_lines where name = 'Grinder'), 'lost', 1, 'gone', null)$$,
  '20410000-0000-0000-0000-000000000071')), 'ok', 'RR-CR-04 the Storekeeper of the crew''s site store reports a lost tool');
select is(pg_temp.err('a6', format($$select report_crew_tool(%L, (select id from crew_tool_lines where name = 'Grinder'), 'lost', 1, 'gone', null)$$,
  '20410000-0000-0000-0000-000000000072')), '42501 CTR_NOT_ALLOWED', 'RR-CR-04 a Quality Inspector cannot report a crew''s tool');
select is(pg_temp.err('a2', $$select correct_crew_tool_report('20410000-0000-0000-0000-000000000071', 'lost', 1, 'counted again')$$), 'ok',
  'RR-CR-04 the Storekeeper corrects that report');
select is(pg_temp.err('a2', $$select close_crew_tool_report('20410000-0000-0000-0000-000000000071', 'written_off')$$),
  '42501 CTR_OWN_REPORT', 'RR-CR-05 the Storekeeper cannot write off a tool report it made');
select is(pg_temp.err('a9', $$select close_crew_tool_report('20410000-0000-0000-0000-000000000071', 'replaced')$$), 'ok',
  'RR-CR-06 a crew manager closes the report');

-- ── crew loans ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a5', pg_temp.loan(0)), '42501 new row violates row-level security policy for table "crew_loans"',
  'RR-CR-08 a Site Supervisor who does not control the home crew cannot lend its worker');
select is(pg_temp.err('a4', pg_temp.loan(1)), '42501 new row violates row-level security policy for table "crew_loans"',
  'RR-CR-08 the Site Supervisor lends for one day only');
select is(pg_temp.err('a6', pg_temp.loan(0)), '42501 new row violates row-level security policy for table "crew_loans"',
  'RR-CR-09 a Quality Inspector cannot lend a worker');
select is(pg_temp.err('a7', pg_temp.loan(0)), '42501 new row violates row-level security policy for table "crew_loans"',
  'RR-CR-09 an Engineer with no job role still cannot lend a worker');
select is(pg_temp.err('a8', pg_temp.loan(0)), '42501 new row violates row-level security policy for table "crew_loans"',
  'RR-CR-09 a field account cannot lend a worker');
select is(pg_temp.err('a4', pg_temp.loan(0)), 'ok', 'RR-CR-07 the Site Supervisor of the home crew lends a worker for one day');

-- ── tasks from an issue ──────────────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a4', $$select add_task_to_incident('20410000-0000-0000-0000-000000000061', 'Fence the trench', null, current_date + 2)$$), 'ok',
  'RR-CR-11 the Site Supervisor makes a task from an issue on its work order');
select is(pg_temp.err('a4', $$select add_task_to_incident('20410000-0000-0000-0000-000000000062', 'Fence it', null, null)$$),
  '42501 only a manager, or the site supervisor of its work order, may add a task to an issue', 'RR-CR-12 but not on a work order it is not assigned to');
select is(pg_temp.err('a6', $$select add_task_to_incident('20410000-0000-0000-0000-000000000061', 'Fence it', null, null)$$),
  '42501 only a manager, or the site supervisor of its work order, may add a task to an issue', 'RR-CR-12 a Quality Inspector cannot make a task from an issue');
select is(pg_temp.err('a7', $$select add_task_to_incident('20410000-0000-0000-0000-000000000061', 'Fence it', null, null)$$),
  '42501 only a manager, or the site supervisor of its work order, may add a task to an issue', 'RR-CR-12 an Engineer with no job role still cannot');
select is(pg_temp.err('a8', $$select add_task_to_incident('20410000-0000-0000-0000-000000000061', 'Fence it', null, null)$$),
  '42501 LIGHT_ACCOUNT', 'RR-CR-12 a field account cannot');

select * from finish();
rollback;
