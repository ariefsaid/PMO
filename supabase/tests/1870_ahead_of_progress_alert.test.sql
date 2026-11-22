-- 1870_ahead_of_progress_alert.test.sql — material-vs-progress (spec docs/specs/material-vs-progress.spec.md, REVISION). Migrations under test: 1870-1872.
-- AC-MVP-001 opens + tells the responsible person · 002 once per episode, replay-safe · 003 resolves; a new episode tells again · 004 strict,
-- a submitted report adds nothing · 005 threshold cleared · 006 recipient rule (responsible person, else project manager, else nobody recorded) ·
-- 007 a system actor's posting still posts and writes no alert · 008 who reads · 010 first run after release is quiet ·
-- 017 a light-account responsible person is skipped, the manager is told, a light account's needs-you read is refused ·
-- 015 a failing check never blocks a posting or a validation · 016 an installed-usage row (1862) and an ahead row coexist for one item.
-- MUTATION CHECKS (the orchestrator breaks the rule, the named assertions MUST go red, then restores):
--   (1) 1871 `-- mut:once` : delete the `continue when exists (...)` -> AC-MVP-002 red.
--   (2) 1871 `-- mut:system_actor` : drop `v_actor is null or` and the org test -> AC-MVP-007 red.
--   (3) 1871 `-- mut:resolve` : delete the closing update -> AC-MVP-003, AC-MVP-004 red.
--   (4) 1871 `-- mut:unset` : drop the null-threshold early return -> AC-MVP-005 red.
--   (5) 1871 `-- mut:ahead_never_blocks` : delete the exception block of usage_ahead_check_safe -> AC-MVP-015 red.
--   (6) 1870 `-- mut:usage_once` : drop the unique index -> AC-MVP-002 red (and usage_warning.test.sql AC-UW-003).
--   (8) 1871 `-- mut:light_recipient` : change `= 'light'` to `= 'none'` -> AC-MVP-017 red.
--   (7) 1862 usage_warning_recipient: return the project manager first -> AC-MVP-001, 006 red.
-- Fixture: WO one (project d1, manager a2, responsible person a3) has line L1 (rate 10, qty 100), rod allowance 100, so each rod issued is that many
-- percent; progress is 0 until a validated daily report says otherwise. WO two (project d2, no manager, no responsible person) is the nobody case.
begin;
create extension if not exists pgtap;
select plan(49);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('26870000-0000-0000-0000-00000000010a', 'AHD Org', 'IDR', 'UTC', true), ('26870000-0000-0000-0000-00000000010b', 'AHD Other', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('26870000-0000-0000-0000-0000000001a1', 'ahd-admin@example.com'), ('26870000-0000-0000-0000-0000000001a2', 'ahd-pm@example.com'), ('26870000-0000-0000-0000-0000000001a3', 'ahd-eng@example.com'),
  ('26870000-0000-0000-0000-0000000001a4', 'ahd-foreman@example.com'), ('26870000-0000-0000-0000-0000000001a5', 'ahd-gone@example.com'), ('26870000-0000-0000-0000-0000000001b1', 'ahd-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('26870000-0000-0000-0000-0000000001a1', '26870000-0000-0000-0000-00000000010a', 'AHD Admin', 'ahd-admin@example.com', 'Admin', 'active', null),
  ('26870000-0000-0000-0000-0000000001a2', '26870000-0000-0000-0000-00000000010a', 'AHD PM',    'ahd-pm@example.com',    'Project Manager', 'active', null),
  ('26870000-0000-0000-0000-0000000001a3', '26870000-0000-0000-0000-00000000010a', 'AHD Eng',   'ahd-eng@example.com',   'Engineer', 'active', null),
  ('26870000-0000-0000-0000-0000000001a4', '26870000-0000-0000-0000-00000000010a', 'AHD Foreman', 'ahd-foreman@example.com', 'Engineer', 'active', 'foreman'),
  ('26870000-0000-0000-0000-0000000001a5', '26870000-0000-0000-0000-00000000010a', 'AHD Gone',  'ahd-gone@example.com',  'Engineer', 'active', null),
  ('26870000-0000-0000-0000-0000000001b1', '26870000-0000-0000-0000-00000000010b', 'AHD XAdmin','ahd-xadmin@example.com','Admin', 'active', null);
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26870000-0000-0000-0000-0000000001d1', '26870000-0000-0000-0000-00000000010a', 'AHD P1', 'Ongoing Project', '26870000-0000-0000-0000-0000000001a2'), ('26870000-0000-0000-0000-0000000001d2', '26870000-0000-0000-0000-00000000010a', 'AHD P2', 'Ongoing Project', null);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, responsible_person_id) values
  ('26870000-0000-0000-0000-000000001401', '26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-0000000001d1', 'AHD WO one', 'Issued', 10000, 'exclusive', 0, '26870000-0000-0000-0000-0000000001a3'),
  ('26870000-0000-0000-0000-000000001402', '26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-0000000001d2', 'AHD WO two', 'Issued', 10000, 'exclusive', 0, null);
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
  select count(*)::int from public.material_installed_usage_alerts where work_order_id = p_wo and kind = 'issued_ahead' and resolved_at is null $$;
create or replace function pg_temp._rows(p_wo uuid) returns int language sql security definer as $$
  select count(*)::int from public.material_installed_usage_alerts where work_order_id = p_wo and kind = 'issued_ahead' $$;
create or replace function pg_temp._told(p_wo uuid) returns text language sql security definer as $$
  select coalesce(string_agg(coalesce(notified_user_id::text, 'nobody'), ';' order by created_at, id), '') from public.material_installed_usage_alerts
   where work_order_id = p_wo and kind = 'issued_ahead' and resolved_at is null $$;
create or replace function pg_temp._notes(p_user uuid, p_like text) returns int language sql security definer as $$
  select count(*)::int from public.notifications where owner_id = p_user and title = 'Material issued ahead of progress' and body like p_like $$;
grant execute on function pg_temp._open(uuid), pg_temp._rows(uuid), pg_temp._told(uuid), pg_temp._notes(uuid, text) to authenticated;

set local role authenticated;
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.create_stock_document('{"kind":"receive","warehouse_id":"26870000-0000-0000-0000-000000001801"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":400,"unit_cost":3}]'::jsonb, true) $$, 'stock is received centrally');
select public.set_work_order_issue_threshold(10);

-- ── AC-MVP-001 an issue ahead of progress opens one alert and tells the responsible person (not the manager, not the actor) ─
select set_config('ahd.iss1', public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":60,"boq_item_id":"26870000-0000-0000-0000-000000001201"}]'::jsonb, true)::text, true);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 0, 'AC-MVP-001 an issue not yet attributed to a work order raises nothing');
select public.set_cost_attribution('stock_document', array[current_setting('ahd.iss1')::uuid], '26870000-0000-0000-0000-000000001401', null);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-001 attributing the issue to the work order opens one alert');
select is(pg_temp._told('26870000-0000-0000-0000-000000001401'), '26870000-0000-0000-0000-0000000001a3', 'AC-MVP-006 the work order''s responsible person is the one told');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a3', '%AHD WO one%'), 1, 'AC-MVP-001 they have one notification naming the work order');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%'), 0, 'AC-MVP-006 the project manager is not told while a responsible person exists');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a1', '%AHD WO one%'), 0, 'AC-MVP-001 the actor is not told');

-- ── AC-MVP-002 once per episode; replay safe ────────────────────────────────────────────────────────────────────────
select set_config('ahd.iss2', public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":5,"boq_item_id":"26870000-0000-0000-0000-000000001201"}]'::jsonb, true)::text, true);
select public.set_cost_attribution('stock_document', array[current_setting('ahd.iss2')::uuid], '26870000-0000-0000-0000-000000001401', null);
select public.set_cost_attribution('stock_document', array[current_setting('ahd.iss2')::uuid], '26870000-0000-0000-0000-000000001401', null);
select is(pg_temp._rows('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-002 another posting and a replay leave one alert row');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a3', '%AHD WO one%'), 1, 'AC-MVP-002 and no second notification');

-- ── AC-MVP-006 nobody to tell: the alert is still recorded ──────────────────────────────────────────────────────────
select public.set_cost_attribution('stock_document',
  array[public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d2"}'::jsonb,
        '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":60,"boq_item_id":"26870000-0000-0000-0000-000000001202"}]'::jsonb, true)], '26870000-0000-0000-0000-000000001402', null);
select is(pg_temp._open('26870000-0000-0000-0000-000000001402'), 1, 'AC-MVP-006 a work order with no responsible person and no manager still records its alert');
select is(pg_temp._told('26870000-0000-0000-0000-000000001402'), 'nobody', 'AC-MVP-006 recording that nobody could be told');

-- ── AC-MVP-004 a submitted report adds nothing; AC-MVP-003 a validated one resolves ──────────────────────────────
reset role;
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id) values ('26870000-0000-0000-0000-000000001601', '26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-0000000001d1', '26870000-0000-0000-0000-000000001401', '2026-03-10', 'draft', '26870000-0000-0000-0000-0000000001a3');
insert into dsr_progress_lines (org_id, report_id, position, work_order_line_id, quantity, unit) values ('26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-000000001601', 1, '26870000-0000-0000-0000-000000001211', 60, 'm3');
update daily_site_reports set status = 'submitted', submitted_at = now() where id = '26870000-0000-0000-0000-000000001601';
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-004 a submitted report adds nothing to progress, so the alert stays open');
update daily_site_reports set status = 'validated', validated_by = '26870000-0000-0000-0000-0000000001a1', validated_at = now() where id = '26870000-0000-0000-0000-000000001601';
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 0, 'AC-MVP-003 a validated report lifts progress to 60 (gap 5, under 10) and the alert resolves');
select is((select count(*)::int from material_installed_usage_alerts where work_order_id = '26870000-0000-0000-0000-000000001401' and kind = 'issued_ahead' and resolved_at is not null), 1, 'AC-MVP-003 it is kept as a resolved row');

-- a new episode tells again; with no responsible person the project manager is told (fallback)
update work_orders set responsible_person_id = null where id = '26870000-0000-0000-0000-000000001401';
set local role authenticated;
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
select public.set_cost_attribution('stock_document', array[public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":20,"boq_item_id":"26870000-0000-0000-0000-000000001201"}]'::jsonb, true)], '26870000-0000-0000-0000-000000001401', null);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-003 issuing past the threshold again opens a new episode');
select is(pg_temp._rows('26870000-0000-0000-0000-000000001401'), 2, 'AC-MVP-003 as a second row');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%'), 1, 'AC-MVP-006 with no responsible person the project manager is told');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a3', '%AHD WO one%'), 1, 'AC-MVP-003 and the first episode''s recipient was not told again');

-- ── AC-MVP-008 who reads ────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp._as('26870000-0000-0000-0000-0000000001a2');
select is((select count(*)::int from public.my_open_ahead_alerts()), 1, 'AC-MVP-008 the manager''s needs-you shows the work order they are told about');
select is((select item_count from public.my_open_ahead_alerts() limit 1), 1, 'AC-MVP-008 with the number of items ahead');
select pg_temp._as('26870000-0000-0000-0000-0000000001a3');
select is((select count(*)::int from public.my_open_ahead_alerts()), 0, 'AC-MVP-008 a person who is not the recipient has nothing waiting');
select pg_temp._as('26870000-0000-0000-0000-0000000001b1');
select is((select count(*)::int from material_installed_usage_alerts), 0, 'AC-MVP-008 another organisation reads none');
select is((select count(*)::int from public.my_open_ahead_alerts()), 0, 'AC-MVP-008 and has none waiting');

-- ── AC-MVP-004 a gap exactly at the threshold resolves (strict) ─────────────────────────────────────────────────────
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
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
-- the responsible person is assigned, then leaves: the manager is told (fallback for a person who is no longer active)
update work_orders set responsible_person_id = '26870000-0000-0000-0000-0000000001a5' where id = '26870000-0000-0000-0000-000000001401';
update profiles set status = 'disabled' where id = '26870000-0000-0000-0000-0000000001a5';
set local role authenticated;
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
select public.set_cost_attribution('stock_document', array[current_setting('ahd.iss4')::uuid], '26870000-0000-0000-0000-000000001401', null);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-007 control: the same state evaluated for a member opens the alert');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%'), 2, 'AC-MVP-006 a responsible person who is no longer active falls back to the manager');

-- ── AC-MVP-016 an installed-usage row (1862) and an ahead row coexist for one item ─────────────────────────────────
reset role;
select lives_ok($$ insert into material_installed_usage_alerts (org_id, work_order_id, item_id, pct, installed_qty, plan_qty, source)
  values ('26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-000000001401', '26870000-0000-0000-0000-000000001311', 80, 85, 100, 'stock_issues') $$, 'AC-MVP-016 an installed-usage warning for the same item is accepted beside the open ahead alert');
select is((select count(*)::int from material_installed_usage_alerts where work_order_id = '26870000-0000-0000-0000-000000001401' and kind = 'installed_usage'), 1, 'AC-MVP-016 and keeps its own kind');
select throws_ok($$ insert into material_installed_usage_alerts (org_id, work_order_id, item_id, pct, installed_qty, plan_qty, source)
  values ('26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-000000001401', '26870000-0000-0000-0000-000000001311', 80, 85, 100, 'stock_issues') $$, '23505', null, 'AC-MVP-016 a second installed-usage warning for the item is still refused (told once)');
set local role authenticated;
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');

-- ── AC-MVP-005 threshold cleared closes everything and stays quiet ──────────────────────────────────────────────────
select public.set_work_order_issue_threshold(null);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401') + pg_temp._open('26870000-0000-0000-0000-000000001402'), 0, 'AC-MVP-005 clearing the threshold resolves every open alert');
select set_config('ahd.n', (pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%') + pg_temp._notes('26870000-0000-0000-0000-0000000001a3', '%AHD WO one%'))::text, true);
select public.set_cost_attribution('stock_document', array[public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":5,"boq_item_id":"26870000-0000-0000-0000-000000001201"}]'::jsonb, true)], '26870000-0000-0000-0000-000000001401', null);
select is(pg_temp._rows('26870000-0000-0000-0000-000000001401'), 3, 'AC-MVP-005 with no threshold a further issue opens nothing');
select is((pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%') + pg_temp._notes('26870000-0000-0000-0000-0000000001a3', '%AHD WO one%'))::text, current_setting('ahd.n'), 'AC-MVP-005 and tells no one');

-- ── AC-MVP-010 the first run after release is quiet ─────────────────────────────────────────────────────────────────
select public.set_work_order_issue_threshold(10);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 0, 'AC-MVP-010 setting the threshold again does not itself open alerts');
reset role;
select ok(public.usage_ahead_backfill() >= 1, 'AC-MVP-010 the release backfill evaluates the work orders with issues');
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-010 it opens the alert for an item already ahead');
select is(pg_temp._told('26870000-0000-0000-0000-000000001401'), 'nobody', 'AC-MVP-010 recording that nobody was told');
select is((pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%') + pg_temp._notes('26870000-0000-0000-0000-0000000001a3', '%AHD WO one%'))::text, current_setting('ahd.n'), 'AC-MVP-010 and writing no notification');

-- ── AC-MVP-017 a responsible person who has become a light account is skipped: the manager is told; a light account's needs-you is refused ─────
update material_installed_usage_alerts set resolved_at = now() where work_order_id = '26870000-0000-0000-0000-000000001401' and kind = 'issued_ahead' and resolved_at is null;
update work_orders set responsible_person_id = '26870000-0000-0000-0000-0000000001a3' where id = '26870000-0000-0000-0000-000000001401';
-- the realistic path (the database refuses naming a field account directly): an office member is named, then becomes a field account
update profiles set built_in_role = 'foreman' where id = '26870000-0000-0000-0000-0000000001a3';
set local role authenticated;
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
select public.set_cost_attribution('stock_document', array[public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":2,"boq_item_id":"26870000-0000-0000-0000-000000001201"}]'::jsonb, true)], '26870000-0000-0000-0000-000000001401', null);
select is(pg_temp._open('26870000-0000-0000-0000-000000001401'), 1, 'AC-MVP-017 a new episode opens with a light account as the responsible person');
select is(pg_temp._told('26870000-0000-0000-0000-000000001401'), '26870000-0000-0000-0000-0000000001a2', 'AC-MVP-017 the project manager is the one told');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a3', '%AHD WO one%'), 1, 'AC-MVP-017 the light account is not notified again (it holds only the first episode''s notification)');
select is(pg_temp._notes('26870000-0000-0000-0000-0000000001a2', '%AHD WO one%'), 3, 'AC-MVP-017 the manager has the notification');
select pg_temp._as('26870000-0000-0000-0000-0000000001a3');
select throws_ok($$ select count(*) from public.my_open_ahead_alerts() $$, '42501', null, 'AC-MVP-017 a light account is refused the needs-you read');
select pg_temp._as('26870000-0000-0000-0000-0000000001a2');
select is((select count(*)::int from public.my_open_ahead_alerts()), 1, 'AC-MVP-017 and the manager sees the work order in needs-you');
reset role;

-- ── AC-MVP-015 a failing check never blocks a posting or a validation ──────────────────────────────────────────────
create or replace function public.usage_ahead_check_work_order(p_work_order_id uuid, p_quiet boolean default false) returns void language plpgsql as $$
begin raise exception 'forced check failure'; end $$;
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id) values ('26870000-0000-0000-0000-000000001602', '26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-0000000001d1', '26870000-0000-0000-0000-000000001401', '2026-03-11', 'draft', '26870000-0000-0000-0000-0000000001a3');
insert into dsr_progress_lines (org_id, report_id, position, work_order_line_id, quantity, unit) values ('26870000-0000-0000-0000-00000000010a', '26870000-0000-0000-0000-000000001602', 1, '26870000-0000-0000-0000-000000001211', 5, 'm3');
update daily_site_reports set status = 'submitted', submitted_at = now() where id = '26870000-0000-0000-0000-000000001602';
select lives_ok($$ update daily_site_reports set status = 'validated', validated_by = '26870000-0000-0000-0000-0000000001a1', validated_at = now() where id = '26870000-0000-0000-0000-000000001602' $$, 'AC-MVP-015 a report validates although the check fails');
select is((select status from daily_site_reports where id = '26870000-0000-0000-0000-000000001602'), 'validated', 'AC-MVP-015 and is validated');
set local role authenticated;
select pg_temp._as('26870000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.set_cost_attribution('stock_document', array[public.create_stock_document('{"kind":"issue","warehouse_id":"26870000-0000-0000-0000-000000001801","project_id":"26870000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26870000-0000-0000-0000-000000001311","quantity":1,"boq_item_id":"26870000-0000-0000-0000-000000001201"}]'::jsonb, true)], '26870000-0000-0000-0000-000000001401', null) $$, 'AC-MVP-015 an issue posts and is attributed although the check fails');

select * from finish();
rollback;
