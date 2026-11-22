-- 1870_work_order_ahead_alert.test.sql — material-vs-progress (spec docs/specs/material-vs-progress.spec.md). Migrations under test: 1870-1873.
-- AC-MVP-001 opens + notifies · 002 once per episode, replay-safe · 003 resolves and re-opens as a new episode · 004 strict, draft adds nothing ·
-- 005 threshold unset/cleared · 006 recipients (project manager, listed roles, Admin fallback, never the actor, inactive or light) ·
-- 007 a system-actor posting still posts and writes no alert · 008 light/other-org reads · 009 roles save (Admin only, known keys, audit) ·
-- 010 first run after release opens quietly.
-- MUTATION CHECKS (the orchestrator breaks the rule, the named assertions MUST go red, then restores):
--   (1) 1872 `-- mut:once` : delete the update-then-`continue` (an open alert re-raises)  -> AC-MVP-002 red.
--   (2) 1872 `-- mut:system_actor` : drop `v_actor is null or` and the org test -> AC-MVP-007 red (or the posting errors).
--   (3) 1872 `-- mut:resolve` : delete the final resolving update -> AC-MVP-003, AC-MVP-004 red.
--   (4) 1872 `-- mut:unset` : drop the null-threshold early return -> AC-MVP-005 red.
--   (5) 1870 `-- mut:admin` : delete the Admin test -> AC-MVP-009 red.   (6) 1870 `-- mut:known_roles` : delete the key test -> AC-MVP-009 red.
--   (7) 1872 recipients: delete `array_remove(..., v_actor)` -> AC-MVP-001 / 006 red (the actor is told).
-- Fixture: WO one (project d1, manager a2) has line L1 (rate 10, qty 100), rod allowance 100, so each rod issued is that many percent; progress is
-- 0 until a validated daily report says otherwise. WO two (project d2, NO manager) is the Admin-fallback case. Threshold 10 points.
begin;
create extension if not exists pgtap;
select plan(51);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('26870000-0000-0000-0000-00000000010a', 'AHD Org', 'IDR', 'UTC', true), ('26870000-0000-0000-0000-00000000010b', 'AHD Other', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('26870000-0000-0000-0000-0000000001a1', 'ahd-admin@example.com'), ('26870000-0000-0000-0000-0000000001a2', 'ahd-pm@example.com'), ('26870000-0000-0000-0000-0000000001a3', 'ahd-eng@example.com'), ('26870000-0000-0000-0000-0000000001a4', 'ahd-foreman@example.com'),
  ('26870000-0000-0000-0000-0000000001a5', 'ahd-gone@example.com'), ('26870000-0000-0000-0000-0000000001a6', 'ahd-admin2@example.com'), ('26870000-0000-0000-0000-0000000001b1', 'ahd-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('26870000-0000-0000-0000-0000000001a1', '26870000-0000-0000-0000-00000000010a', 'AHD Admin',   'ahd-admin@example.com',   'Admin', 'active', null),
  ('26870000-0000-0000-0000-0000000001a2', '26870000-0000-0000-0000-00000000010a', 'AHD PM',      'ahd-pm@example.com',      'Project Manager', 'active', null),
  ('26870000-0000-0000-0000-0000000001a3', '26870000-0000-0000-0000-00000000010a', 'AHD Eng',     'ahd-eng@example.com',     'Engineer', 'active', 'site_supervisor'),
  ('26870000-0000-0000-0000-0000000001a4', '26870000-0000-0000-0000-00000000010a', 'AHD Foreman', 'ahd-foreman@example.com', 'Engineer', 'active', 'foreman'),
  ('26870000-0000-0000-0000-0000000001a5', '26870000-0000-0000-0000-00000000010a', 'AHD Gone',    'ahd-gone@example.com',    'Engineer', 'disabled', 'site_supervisor'),
  ('26870000-0000-0000-0000-0000000001a6', '26870000-0000-0000-0000-00000000010a', 'AHD Admin 2', 'ahd-admin2@example.com',  'Admin', 'active', null),
  ('26870000-0000-0000-0000-0000000001b1', '26870000-0000-0000-0000-00000000010b', 'AHD XAdmin',  'ahd-xadmin@example.com',  'Admin', 'active', null);
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26870000-0000-0000-0000-0000000001d1', '26870000-0000-0000-0000-00000000010a', 'AHD P1', 'Ongoing Project', '26870000-0000-0000-0000-0000000001a2'), ('26870000-0000-0000-0000-0000000001d2', '26870000-0000-0000-0000-00000000010a', 'AHD P2', 'Ongoing Project', null);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26870000-0000-0000-0000-000000001401', '26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-0000000001d1', 'AHD WO one', 'Issued', 10000, 'exclusive', 0),
  ('26870000-0000-0000-0000-000000001402', '26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-0000000001d2', 'AHD WO two', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26870000-0000-0000-0000-000000001201', '26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-0000000001d1', 'L1', 'Line one', 'm3', 100, 10), ('26870000-0000-0000-0000-000000001202', '26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-0000000001d2', 'L1', 'Line one', 'm3', 100, 10);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('26870000-0000-0000-0000-000000001211', '26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-000000001401', '26870000-0000-0000-0000-000000001201', 100), ('26870000-0000-0000-0000-000000001212', '26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-000000001402', '26870000-0000-0000-0000-000000001202', 100);
insert into stock_units (id, org_id, code, name, whole_only) values ('26870000-0000-0000-0000-000000001301', '26870000-0000-0000-0000-00000000010a', 'KG', 'Kilogram', false);
insert into stock_items (id, org_id, code, name, unit_id) values ('26870000-0000-0000-0000-000000001311', '26870000-0000-0000-0000-00000000010a', 'ROD', 'Welding rod', '26870000-0000-0000-0000-000000001301');
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity) values
  ('26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-000000001201', '26870000-0000-0000-0000-000000001311', 100), ('26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-000000001202', '26870000-0000-0000-0000-000000001311', 100);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values ('26870000-0000-0000-0000-000000001801', '26870000-0000-0000-0000-00000000010a', 'CEN', 'Central', 'central', null);

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create or replace function pg_temp._open(p_wo uuid) returns int language sql security definer as $$
  select count(*)::int from public.work_order_material_alerts where work_order_id = p_wo and resolved_at is null $$;
create or replace function pg_temp._rows(p_wo uuid) returns int language sql security definer as $$
  select count(*)::int from public.work_order_material_alerts where work_order_id = p_wo $$;
create or replace function pg_temp._gap(p_wo uuid) returns text language sql security definer as $$
  select gap_pp::text || '/' || issued_pct::text || '/' || progress_pct::text from public.work_order_material_alerts where work_order_id = p_wo and resolved_at is null $$;
create or replace function pg_temp._notes(p_user uuid, p_like text) returns int language sql security definer as $$
  select count(*)::int from public.notifications where owner_id = p_user and title = 'Material issued ahead of progress' and body like p_like $$;
create or replace function pg_temp._told(p_wo uuid) returns text language sql security definer as $$
  select coalesce(string_agg(array_to_string(notified_user_ids, ','), ';'), '') from public.work_order_material_alerts where work_order_id = p_wo and resolved_at is null $$;
grant execute on function pg_temp._open(uuid), pg_temp._rows(uuid), pg_temp._gap(uuid), pg_temp._notes(uuid, text), pg_temp._told(uuid) to authenticated;

set local role authenticated;
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.create_stock_document('{"kind":"receive","warehouse_id":"26870000-0000-0000-0000-000000001801"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":400,"unit_cost":3}]'::jsonb, true) $$, 'stock is received centrally');
select public.set_work_order_issue_threshold(10);

-- ── AC-MVP-001 an issue ahead of progress opens one alert and tells the manager (not the actor) ─────────────────────
select set_config('ahd.iss1', public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":60,"boq_item_id":"26870000-0000-0000-0000-000000001201"}]'::jsonb, true)::text, true);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 0, 'AC-MVP-001 an issue not yet attributed to a work order raises nothing');
select public.set_cost_attribution('stock_document', array[current_setting('ahd.iss1')::uuid], '26870000-0000-0000-0000-000000001401', null);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-001 attributing the issue to the work order opens one alert');
select is(pg_temp._gap('26870000-0000-0000-0000-000000001401'), '60.0/60.0/0.0', 'AC-MVP-001 it records gap, issued share and progress share');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%'), 1, 'AC-MVP-001 the project manager is told once, naming the work order');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a1', '%AHD WO one%'), 0, 'AC-MVP-001 the actor is not told');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a6', '%AHD WO one%'), 0, 'AC-MVP-006 an Admin is not told while a manager exists');

-- ── AC-MVP-002 once per episode; replay safe ────────────────────────────────────────────────────────────────────────
select set_config('ahd.iss2', public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":5,"boq_item_id":"26870000-0000-0000-0000-000000001201"}]'::jsonb, true)::text, true);
select public.set_cost_attribution('stock_document', array[current_setting('ahd.iss2')::uuid], '26870000-0000-0000-0000-000000001401', null);
select public.set_cost_attribution('stock_document', array[current_setting('ahd.iss2')::uuid], '26870000-0000-0000-0000-000000001401', null);
select is(pg_temp._rows('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-002 another posting and a replay leave one alert row');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%'), 1, 'AC-MVP-002 and no second notification');
select is(pg_temp._gap('26870000-0000-0000-0000-000000001401'), '65.0/65.0/0.0', 'AC-MVP-002 the open alert shows the refreshed figures');

-- ── AC-MVP-006 no manager: the Admins except the actor are told ─────────────────────────────────────────────────────
select public.set_cost_attribution('stock_document',
  array[public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d2"}'::jsonb,
        '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":60,"boq_item_id":"26870000-0000-0000-0000-000000001202"}]'::jsonb, true)], '26870000-0000-0000-0000-000000001402', null);
select is(pg_temp._open('26870000-0000-0000-0000-000000001402'), 1, 'AC-MVP-006 the work order without a manager also opens an alert');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a6', '%AHD WO two%'), 1, 'AC-MVP-006 with nobody else to tell, the other Admin is told');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a1', '%AHD WO two%'), 0, 'AC-MVP-006 the acting Admin is not');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO two%'), 0, 'AC-MVP-006 a manager of another project is not');

-- ── AC-MVP-009 the roles setting ────────────────────────────────────────────────────────────────────────────────────
select is(public.set_work_order_ahead_alert_roles(array['site_supervisor', 'foreman', 'site_supervisor']), array['foreman', 'site_supervisor'],
  'AC-MVP-009 an Admin saves listed roles (deduplicated, built-in keys)');
select is((select count(*)::int from audit_events where action = 'work_order_ahead_alert_roles.set' and org_id = '26870000-0000-0000-0000-00000000010a'), 1, 'AC-MVP-009 one audit row');
select throws_ok($$ select public.set_work_order_ahead_alert_roles(array['no_such_role']) $$, '22023', null, 'AC-MVP-009 an unknown role is refused');
select pg_temp._as('26870000-0000-0000-0000-0000000001a2');
select throws_ok($$ select public.set_work_order_ahead_alert_roles(array['engineer']) $$, '42501', null, 'AC-MVP-009 a Project Manager is refused');
select pg_temp._as('26870000-0000-0000-0000-0000000001a3');
select throws_ok($$ select public.set_work_order_ahead_alert_roles(array['engineer']) $$, '42501', null, 'AC-MVP-009 an Engineer is refused');
select is((select ahead_alert_roles from work_order_stock_settings), array['foreman', 'site_supervisor'], 'AC-MVP-009 the refused saves changed nothing');
reset role;
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
select is(public.wo_material_alert_recipients('26870000-0000-0000-0000-000000001401'), array['26870000-0000-0000-0000-0000000001a2'::uuid, '26870000-0000-0000-0000-0000000001a3'::uuid]::uuid[], 'AC-MVP-006 recipients: the manager and the active holder of a listed role; not the foreman (light) nor the disabled holder');

-- ── AC-MVP-004 a draft or submitted report adds nothing; AC-MVP-003 a validated one resolves ──────────────────────
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id) values ('26870000-0000-0000-0000-000000001601', '26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-0000000001d1', '26870000-0000-0000-0000-000000001401', '2026-03-10', 'draft', '26870000-0000-0000-0000-0000000001a3');
insert into dsr_progress_lines (org_id, report_id, position, work_order_line_id, quantity, unit) values ('26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-000000001601', 1, '26870000-0000-0000-0000-000000001211', 60, 'm3');
update daily_site_reports set status = 'submitted', submitted_at = now() where id = '26870000-0000-0000-0000-000000001601';
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-004 a submitted report adds nothing to progress, so the alert stays open');
update daily_site_reports set status = 'validated', validated_by = '26870000-0000-0000-0000-0000000001a1', validated_at = now() where id = '26870000-0000-0000-0000-000000001601';
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 0, 'AC-MVP-003 a validated report lifts progress to 60 (gap 5, under 10) and the alert resolves');
select is((select count(*)::int from work_order_material_alerts where work_order_id = '26870000-0000-0000-0000-000000001401' and resolved_at is not null), 1, 'AC-MVP-003 it is kept as a resolved row');
set local role authenticated;

-- a new episode notifies again, now also the listed role
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
select public.set_cost_attribution('stock_document', array[public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":20,"boq_item_id":"26870000-0000-0000-0000-000000001201"}]'::jsonb, true)], '26870000-0000-0000-0000-000000001401', null);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-003 issuing past the threshold again opens a new episode');
select is(pg_temp._rows('26870000-0000-0000-0000-000000001401'), 2, 'AC-MVP-003 as a second row');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%'), 2, 'AC-MVP-003 the manager is told again for the new episode');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a3', '%AHD WO one%'), 1, 'AC-MVP-006 the holder of a listed role is told');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a4', '%AHD WO one%'), 0, 'AC-MVP-006 a light account is never told, even with its role listed');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a5', '%AHD WO one%'), 0, 'AC-MVP-006 a disabled member is never told');

-- ── AC-MVP-008 who can read ────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp._as('26870000-0000-0000-0000-0000000001a2');
select is((select count(*)::int from public.my_open_material_alerts()), 1, 'AC-MVP-008 the manager''s needs-you shows their work order only');
select is((select item_count from public.my_open_material_alerts() limit 1), 1, 'AC-MVP-008 with the number of items ahead');
select cmp_ok((select count(*)::int from work_order_material_alerts), '>=', 1, 'AC-MVP-008 the manager reads the alert rows');
select pg_temp._as('26870000-0000-0000-0000-0000000001a4');
select is((select count(*)::int from work_order_material_alerts), 0, 'AC-MVP-008 a light account reads no alert row');
select is((select count(*)::int from public.my_open_material_alerts()), 0, 'AC-MVP-008 and has nothing in needs-you');
select pg_temp._as('26870000-0000-0000-0000-0000000001b1');
select is((select count(*)::int from work_order_material_alerts), 0, 'AC-MVP-008 another organisation reads none');
select is((select count(*)::int from public.my_open_material_alerts()), 0, 'AC-MVP-008 and has none waiting');
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
select is((select count(*)::int from public.my_open_material_alerts()), 0, 'AC-MVP-008 an Admin who is not a controller has none waiting');

-- ── AC-MVP-004 a gap exactly at the threshold resolves (strict) ─────────────────────────────────────────────────────
select public.create_stock_document('{"kind":"return","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  jsonb_build_array(jsonb_build_object('item_id', '26870000-0000-0000-0000-000000001311', 'quantity', 15,
    'source_line_id', (select id from stock_document_lines where document_id = current_setting('ahd.iss1')::uuid and item_id = '26870000-0000-0000-0000-000000001311'))), true);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 0, 'AC-MVP-004 a return that brings the gap to exactly the threshold (70 issued, 60 done) resolves the alert');

-- ── AC-MVP-007 a system actor''s posting still posts and writes no alert ───────────────────────────────────────────
select set_config('ahd.iss4', public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":10,"boq_item_id":"26870000-0000-0000-0000-000000001201"}]'::jsonb, true)::text, true);
reset role;
select set_config('request.jwt.claims', '{}', true);
select lives_ok($$ update stock_documents set work_order_id = '26870000-0000-0000-0000-000000001401' where id = current_setting('ahd.iss4')::uuid $$, 'AC-MVP-007 an update with no organisation context succeeds');
select is((select work_order_id::text from stock_documents where id = current_setting('ahd.iss4')::uuid), '26870000-0000-0000-0000-000000001401', 'AC-MVP-007 the posting took effect');
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 0, 'AC-MVP-007 and no alert was written (issued 80, progress 60 would warn)');
set local role authenticated;
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
select public.set_cost_attribution('stock_document', array[current_setting('ahd.iss4')::uuid], '26870000-0000-0000-0000-000000001401', null);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-007 control: the same state evaluated for a member opens the alert');

-- ── AC-MVP-005 threshold cleared closes everything and stays quiet ──────────────────────────────────────────────────
select public.set_work_order_issue_threshold(null);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401') + pg_temp._open('26870000-0000-0000-0000-000000001402'), 0, 'AC-MVP-005 clearing the threshold resolves every open alert');
select set_config('ahd.n', pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%')::text, true);
select public.set_cost_attribution('stock_document', array[public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":5,"boq_item_id":"26870000-0000-0000-0000-000000001201"}]'::jsonb, true)], '26870000-0000-0000-0000-000000001401', null);
select is(pg_temp._rows('26870000-0000-0000-0000-000000001401'), 3, 'AC-MVP-005 with no threshold a further issue opens nothing');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%')::text, current_setting('ahd.n'), 'AC-MVP-005 and tells no one');

-- ── AC-MVP-010 the first run after release opens quietly ────────────────────────────────────────────────────────────
select public.set_work_order_issue_threshold(10);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 0, 'AC-MVP-010 setting the threshold again does not itself open alerts');
reset role;
select ok(public.wo_material_alerts_backfill() >= 1, 'AC-MVP-010 the release backfill evaluates the work orders with issues');
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-010 it opens the alert for an item already ahead');
select is(pg_temp._told('26870000-0000-0000-0000-000000001401'), '', 'AC-MVP-010 recording that nobody was told');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%')::text, current_setting('ahd.n'), 'AC-MVP-010 and writing no notification');

select * from finish();
rollback;
