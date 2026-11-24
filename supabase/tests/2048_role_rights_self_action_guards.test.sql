-- 2048_role_rights_self_action_guards.test.sql — separation of duties on the job-role rights (migration 2048), and the
-- operations of 2040–2042 exercised through the public calls a signed-in person makes.
-- MUTATION NOTES (remove the condition tagged in 2048; the named assertion must go red; restore):
--   mut:rr_own_writeoff ...... 'RR-SD-01 a crew manager cannot write off a tool report it made'
--   mut:rr_ss_task_current ... 'RR-SD-05 a Site Supervisor whose crew''s roster on the work order has ended makes no task there'
--                              and 'RR-SD-05 ... has not started yet ...'
--   mut:rr_clear_own_all ..... 'RR-SD-07 a Project Manager cannot tick their own cleared-for-site item'
--   mut:rr_identity_self ..... 'RR-SD-09 the HR Officer cannot unlink their own person record (the first step of unlink, tick, relink)'
begin;
create extension if not exists pgtap;
select plan(34);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('20480000-0000-0000-0000-00000000000a', 'RR SD Org', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('20480000-0000-0000-0000-0000000000' || k)::uuid, 'rrsd-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1','b2']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20480000-0000-0000-0000-0000000000a1', '20480000-0000-0000-0000-00000000000a', 'Admin',       'rrsd-a1@example.com', 'Admin', 'active', null),
  ('20480000-0000-0000-0000-0000000000a2', '20480000-0000-0000-0000-00000000000a', 'Store keeps', 'rrsd-a2@example.com', 'Engineer', 'active', 'storekeeper'),
  ('20480000-0000-0000-0000-0000000000a3', '20480000-0000-0000-0000-00000000000a', 'Store other', 'rrsd-a3@example.com', 'Engineer', 'active', 'storekeeper'),
  ('20480000-0000-0000-0000-0000000000a4', '20480000-0000-0000-0000-00000000000a', 'Supervisor',  'rrsd-a4@example.com', 'Engineer', 'active', 'site_supervisor'),
  ('20480000-0000-0000-0000-0000000000a5', '20480000-0000-0000-0000-00000000000a', 'Inspector',   'rrsd-a5@example.com', 'Engineer', 'active', 'quality_inspector'),
  ('20480000-0000-0000-0000-0000000000a6', '20480000-0000-0000-0000-00000000000a', 'PM',          'rrsd-a6@example.com', 'Project Manager', 'active', null),
  ('20480000-0000-0000-0000-0000000000a7', '20480000-0000-0000-0000-00000000000a', 'PM two',      'rrsd-a7@example.com', 'Project Manager', 'active', null),
  ('20480000-0000-0000-0000-0000000000a8', '20480000-0000-0000-0000-00000000000a', 'HR officer',  'rrsd-a8@example.com', 'Engineer', 'active', 'hr_officer'),
  ('20480000-0000-0000-0000-0000000000a9', '20480000-0000-0000-0000-00000000000a', 'Planner',     'rrsd-a9@example.com', 'Engineer', 'active', 'planner'),
  ('20480000-0000-0000-0000-0000000000b1', '20480000-0000-0000-0000-00000000000a', 'Materials',   'rrsd-b1@example.com', 'Engineer', 'active', 'material_coordinator'),
  ('20480000-0000-0000-0000-0000000000b2', '20480000-0000-0000-0000-00000000000a', 'Engineer',    'rrsd-b2@example.com', 'Engineer', 'active', null);
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('20480000-0000-0000-0000-0000000000c1', '20480000-0000-0000-0000-00000000000a', 'RRSD project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '20480000-0000-0000-0000-0000000000a6');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('20480000-0000-0000-0000-000000002001', '20480000-0000-0000-0000-00000000000a', 'SITE-A', 'Site A', 'site', '20480000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-000000002001', '20480000-0000-0000-0000-0000000000a2'),
  ('20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-000000002001', '20480000-0000-0000-0000-0000000000a5');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, site_warehouse_id) values
  ('20480000-0000-0000-0000-000000000031', '20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-0000000000c1', 'WO current', 'Draft', 10000, 'exclusive', 0, '20480000-0000-0000-0000-000000002001'),
  ('20480000-0000-0000-0000-000000000032', '20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-0000000000c1', 'WO ended', 'Draft', 10000, 'exclusive', 0, null),
  ('20480000-0000-0000-0000-000000000033', '20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-0000000000c1', 'WO later', 'Draft', 10000, 'exclusive', 0, null);
-- the supervisor leads three crews: one rostered now, one whose roster ended yesterday, one starting tomorrow
insert into crews (id, org_id, code, name, field_controller_id) values
  ('20480000-0000-0000-0000-000000000041', '20480000-0000-0000-0000-00000000000a', 'CA', 'Crew A', '20480000-0000-0000-0000-0000000000a4'),
  ('20480000-0000-0000-0000-000000000042', '20480000-0000-0000-0000-00000000000a', 'CB', 'Crew B', '20480000-0000-0000-0000-0000000000a4'),
  ('20480000-0000-0000-0000-000000000043', '20480000-0000-0000-0000-00000000000a', 'CC', 'Crew C', '20480000-0000-0000-0000-0000000000a4');
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from, valid_to) values
  ('20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-000000000031', '20480000-0000-0000-0000-000000000041', current_date - 10, null),
  ('20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-000000000032', '20480000-0000-0000-0000-000000000042', current_date - 10, current_date - 1),
  ('20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-000000000033', '20480000-0000-0000-0000-000000000043', current_date + 1, null);
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, work_order_id, reported_by)
select ('20480000-0000-0000-0000-0000000000' || n)::uuid, '20480000-0000-0000-0000-00000000000a', current_date, 'Safety', 'Low',
       '20480000-0000-0000-0000-0000000000c1', ('20480000-0000-0000-0000-0000000000' || w)::uuid, '20480000-0000-0000-0000-0000000000b2'
  from (values ('61', '31'), ('62', '32'), ('63', '33')) v(n, w);
insert into org_crew_tool_settings (org_id, coordinator_id) values
  ('20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-0000000000a2')
  on conflict (org_id) do update set coordinator_id = excluded.coordinator_id;
insert into crew_tool_lines (id, org_id, crew_id, name, held_qty) values
  ('20480000-0000-0000-0000-000000000051', '20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-000000000041', 'Grinder', 5);
-- people: three linked to a login, one worker with none
insert into people (id, org_id, code, name, profile_id) values
  ('20480000-0000-0000-0000-000000000081', '20480000-0000-0000-0000-00000000000a', 'PA', 'Admin self',   '20480000-0000-0000-0000-0000000000a1'),
  ('20480000-0000-0000-0000-000000000082', '20480000-0000-0000-0000-00000000000a', 'PP', 'PM self',      '20480000-0000-0000-0000-0000000000a6'),
  ('20480000-0000-0000-0000-000000000083', '20480000-0000-0000-0000-00000000000a', 'PH', 'HR self',      '20480000-0000-0000-0000-0000000000a8'),
  ('20480000-0000-0000-0000-000000000084', '20480000-0000-0000-0000-00000000000a', 'PW', 'Worker',       null);
insert into clearance_items (id, org_id, name, is_required) values
  ('20480000-0000-0000-0000-000000000091', '20480000-0000-0000-0000-00000000000a', 'Site induction', true);
-- a submitted timesheet with one identifiable entry
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('20480000-0000-0000-0000-0000000000e1', '20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-0000000000b2', '2026-11-16', 'Submitted');
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values
  ('20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-0000000000e1', '20480000-0000-0000-0000-0000000000c1', '2026-11-17', 7.25);
-- a client requisition line, for the reservation and release calls
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('20480000-0000-0000-0000-000000000f01', '20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-0000000000c1', 'B1', 'Slab', 'm3', 10, 1000);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('20480000-0000-0000-0000-000000000f11', '20480000-0000-0000-0000-00000000000a', '20480000-0000-0000-0000-000000000031', '20480000-0000-0000-0000-000000000f01', 10);
update work_orders set status = 'Issued', issued_at = now() where id = '20480000-0000-0000-0000-000000000031';
insert into stock_units (id, org_id, code, name, whole_only) values
  ('20480000-0000-0000-0000-000000000f21', '20480000-0000-0000-0000-00000000000a', 'BAG', 'Bag', true);
insert into stock_tags (id, org_id, name, zero_cost) values
  ('20480000-0000-0000-0000-000000000f31', '20480000-0000-0000-0000-00000000000a', 'Client supplied', true);
insert into stock_items (id, org_id, code, name, unit_id, tag_id) values
  ('20480000-0000-0000-0000-000000000f41', '20480000-0000-0000-0000-00000000000a', 'CEM', 'Cement', '20480000-0000-0000-0000-000000000f21', '20480000-0000-0000-0000-000000000f31');

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20480000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', '{"sub":"20480000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$;
create function pg_temp.report(p_id text) returns text language sql as $$
  select format('select report_crew_tool(%L, %L, ''lost'', 1, ''gone'', null)', '20480000-0000-0000-0000-0000000000' || p_id,
                '20480000-0000-0000-0000-000000000051') $$;
create function pg_temp.close(p_id text, p_resolution text) returns text language sql as $$
  select format('select close_crew_tool_report(%L, %L)', '20480000-0000-0000-0000-0000000000' || p_id, p_resolution) $$;
create function pg_temp.tick(p_person text) returns text language sql as $$
  select format('insert into person_clearances (person_id, item_id, done_on) values (%L, %L, current_date)',
                '20480000-0000-0000-0000-0000000000' || p_person, '20480000-0000-0000-0000-000000000091') $$;

-- ── crew tool reports: nobody writes off their own ───────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a6', pg_temp.report('71')), 'ok', 'RR-SD-01 (a crew manager reports a lost tool)');
select is(pg_temp.err('a6', pg_temp.report('72')), 'ok', 'RR-SD-01 (and a second one)');
select is(pg_temp.err('a2', pg_temp.report('73')), 'ok', 'RR-SD-01 (the Storekeeper reports one too)');
select is(pg_temp.err('a6', pg_temp.close('71', 'written_off')), '42501 CTR_OWN_REPORT', 'RR-SD-01 a crew manager cannot write off a tool report it made');
select is(pg_temp.err('a6', pg_temp.close('72', 'replaced')), 'ok', 'RR-SD-02 it still closes its own report as replaced');
select is(pg_temp.err('a7', pg_temp.close('71', 'written_off')), 'ok', 'RR-SD-02 another crew manager writes it off');
select is(pg_temp.err('a2', pg_temp.close('73', 'written_off')), '42501 CTR_OWN_REPORT', 'RR-SD-01 the Storekeeper cannot write off its own report either');
select is((select held_qty from crew_tool_lines where id = '20480000-0000-0000-0000-000000000051')::numeric, 4::numeric,
  'RR-SD-02 only the other manager''s write-off reduced the held quantity');

-- ── correcting a report: only inside the Storekeeper's scope ─────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a5', $$select correct_crew_tool_report('20480000-0000-0000-0000-000000000073', 'lost', 2, 'recount')$$), '42501 CTR_NOT_ALLOWED',
  'RR-SD-03 a Quality Inspector keeping the same store cannot correct the report');
select is(pg_temp.err('a3', $$select correct_crew_tool_report('20480000-0000-0000-0000-000000000073', 'lost', 2, 'recount')$$), '42501 CTR_NOT_ALLOWED',
  'RR-SD-03 a Storekeeper who keeps no store of the crew cannot correct it');
select is((select qty from crew_tool_reports where id = '20480000-0000-0000-0000-000000000073')::numeric, 1::numeric, 'RR-SD-03 the report is unchanged');
select is(pg_temp.err('a7', pg_temp.close('73', 'written_off')), 'ok', 'RR-SD-02 a crew manager writes off the Storekeeper''s report');

-- ── tasks from an issue: the supervisor's crew must be rostered on the work order today ──────────────────────────────────────────
select is(pg_temp.err('a4', $$select add_task_to_incident('20480000-0000-0000-0000-000000000061', 'Fence the trench', null, null)$$), 'ok',
  'RR-SD-04 the Site Supervisor makes a task where its crew is rostered today');
select is(pg_temp.err('a4', $$select add_task_to_incident('20480000-0000-0000-0000-000000000062', 'Fence it', null, null)$$),
  '42501 only a manager, or the site supervisor of its work order, may add a task to an issue',
  'RR-SD-05 a Site Supervisor whose crew''s roster on the work order has ended makes no task there');
select is(pg_temp.err('a4', $$select add_task_to_incident('20480000-0000-0000-0000-000000000063', 'Fence it', null, null)$$),
  '42501 only a manager, or the site supervisor of its work order, may add a task to an issue',
  'RR-SD-05 a Site Supervisor whose crew''s roster on the work order has not started yet makes no task there');

-- ── the cleared-for-site checklist: no one but an Admin ticks their own ──────────────────────────────────────────────────────────
select is(pg_temp.err('a6', pg_temp.tick('84')), 'ok', 'RR-SD-06 a Project Manager ticks a worker''s item');
select is(pg_temp.err('a6', pg_temp.tick('82')), '42501 new row violates row-level security policy for table "person_clearances"',
  'RR-SD-07 a Project Manager cannot tick their own cleared-for-site item');
select is(pg_temp.err('a8', pg_temp.tick('83')), '42501 new row violates row-level security policy for table "person_clearances"',
  'RR-SD-07 the HR Officer cannot tick their own');
select is(pg_temp.err('a1', pg_temp.tick('81')), 'ok', 'RR-SD-08 an Admin may tick their own (an organisation with one Admin is never stuck)');

-- ── the identity link: no unlink, tick, relink ──────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a8', $$update people set profile_id = null where id = '20480000-0000-0000-0000-000000000083'$$), '42501 PPL_PROFILE_SELF',
  'RR-SD-09 the HR Officer cannot unlink their own person record (the first step of unlink, tick, relink)');
select is((select profile_id from people where id = '20480000-0000-0000-0000-000000000083'), '20480000-0000-0000-0000-0000000000a8'::uuid,
  'RR-SD-09 the link is unchanged');
select is(pg_temp.err('a8', pg_temp.tick('83')), '42501 new row violates row-level security policy for table "person_clearances"',
  'RR-SD-09 so the own-record tick is still refused');
select is(pg_temp.err('a8', $$update people set profile_id = '20480000-0000-0000-0000-0000000000a8' where id = '20480000-0000-0000-0000-000000000084'$$),
  '42501 PPL_PROFILE_SELF', 'RR-SD-09 nor link another person record to themselves');
select is(pg_temp.err('a6', $$update people set profile_id = null where id = '20480000-0000-0000-0000-000000000082'$$), '42501 PPL_PROFILE_SELF',
  'RR-SD-09 a Project Manager cannot unlink their own either');
select is(pg_temp.err('a8', $$update people set profile_id = '20480000-0000-0000-0000-0000000000b2' where id = '20480000-0000-0000-0000-000000000084'$$), 'ok',
  'RR-SD-10 the HR Officer still links a worker to someone else''s login');
select is(pg_temp.err('a1', $$update people set profile_id = null where id = '20480000-0000-0000-0000-000000000081'$$), 'ok',
  'RR-SD-10 an Admin may change their own link');

-- ── reservation and release, through the public calls ───────────────────────────────────────────────────────────────────────────
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;
select is(pg_temp.err('b2', $$insert into t_ids values ('r', csr_create(jsonb_build_object('work_order_id', '20480000-0000-0000-0000-000000000031'),
  '[{"stock_item_id":"20480000-0000-0000-0000-000000000f41","takeoff_quantity":20,"requested_quantity":20,"work_order_line_id":"20480000-0000-0000-0000-000000000f11"}]'::jsonb,
  '20480000-0000-0000-0000-00000000c101')); select csr_send((select v from t_ids where k = 'r'), '20480000-0000-0000-0000-00000000c102')$$), 'ok',
  'RR-SD-11 (an Engineer raises and sends a requisition)');
insert into t_ids select 'l', id from client_requisition_lines where requisition_id = (select v from t_ids where k = 'r');
select is(pg_temp.err('b1', $$select csr_record_reservation((select v from t_ids where k = 'l'), 6, 'CL-1')$$), 'ok',
  'RR-SD-11 the Material Coordinator records the client''s reservation');
select is(pg_temp.err('a5', $$select csr_record_reservation((select v from t_ids where k = 'l'), 1, 'CL-2')$$), '42501 CSR_FORBIDDEN',
  'RR-SD-12 a Quality Inspector at the same access level cannot');
select is(pg_temp.err('b1', $$select csr_record_release((select v from t_ids where k = 'l'), 2, 'not needed')$$), 'ok',
  'RR-SD-11 the Material Coordinator records a release');
select is(pg_temp.err('a5', $$select csr_record_release((select v from t_ids where k = 'l'), 1, 'x')$$), '42501 CSR_FORBIDDEN',
  'RR-SD-12 a Quality Inspector cannot record a release');
select is((select reserved from csr_line_figures((select v from t_ids where k = 'l'))), 4::numeric,
  'RR-SD-11 the line holds the coordinator''s reservation less its release, and nothing of the refused calls');

-- ── timesheet entries: the HR Officer reads their content ────────────────────────────────────────────────────────────────────────
select is(pg_temp.val('a8', $$select string_agg(hours::text, ',') from timesheet_entries where timesheet_id = '20480000-0000-0000-0000-0000000000e1'$$), '7.25',
  'RR-SD-13 the HR Officer reads the hours of another person''s timesheet entry');
select is(pg_temp.val('a9', $$select count(*)::text from timesheet_entries where timesheet_id = '20480000-0000-0000-0000-0000000000e1'$$), '0',
  'RR-SD-13 a Planner at the same access level reads none');

select * from finish();
rollback;
