-- crew_tools.test.sql — #2581 (docs/specs/crew-tools-register.spec.md). Migrations under test: 1157..1160.
-- AC-CTR-001 usable quantity and the refused third report · AC-CTR-002 serial unique among live lines ·
-- AC-CTR-003 one report, one task, one notification · AC-CTR-004 idempotent on the report id ·
-- AC-CTR-005 no coordinator: Admin and Project Manager are notified · AC-CTR-006 a damaged report needs a photo ·
-- AC-CTR-007 close resolutions · AC-CTR-008 field controller scope · AC-CTR-009 another organisation ·
-- AC-CTR-010 crew archive guard · AC-CTR-013 correction with a reason · AC-CTR-014 no direct Done.
begin;
create extension if not exists pgtap;
select plan(84);

insert into organizations (id, name, default_currency) values
  ('25810000-0000-0000-0000-00000000000a', 'CTR Org', 'IDR'),
  ('25810000-0000-0000-0000-00000000000b', 'CTR Other Org', 'IDR');
insert into auth.users (id, email) values
  ('25810000-0000-0000-0000-0000000000a1', 'ctr-admin@example.com'),
  ('25810000-0000-0000-0000-0000000000a2', 'ctr-pm@example.com'),
  ('25810000-0000-0000-0000-0000000000a3', 'ctr-fc-a@example.com'),
  ('25810000-0000-0000-0000-0000000000a4', 'ctr-fc-b@example.com'),
  ('25810000-0000-0000-0000-0000000000a5', 'ctr-coord@example.com'),
  ('25810000-0000-0000-0000-0000000000a6', 'ctr-eng@example.com'),
  ('25810000-0000-0000-0000-0000000000b1', 'ctr-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status, locale) values
  ('25810000-0000-0000-0000-0000000000a1', '25810000-0000-0000-0000-00000000000a', 'CTR Admin', 'ctr-admin@example.com', 'Admin', 'active', null),
  ('25810000-0000-0000-0000-0000000000a2', '25810000-0000-0000-0000-00000000000a', 'CTR PM', 'ctr-pm@example.com', 'Project Manager', 'active', 'id'),
  ('25810000-0000-0000-0000-0000000000a3', '25810000-0000-0000-0000-00000000000a', 'CTR FC A', 'ctr-fc-a@example.com', 'Engineer', 'active', null),
  ('25810000-0000-0000-0000-0000000000a4', '25810000-0000-0000-0000-00000000000a', 'CTR FC B', 'ctr-fc-b@example.com', 'Engineer', 'active', null),
  ('25810000-0000-0000-0000-0000000000a5', '25810000-0000-0000-0000-00000000000a', 'CTR Coordinator', 'ctr-coord@example.com', 'Engineer', 'active', null),
  ('25810000-0000-0000-0000-0000000000a6', '25810000-0000-0000-0000-00000000000a', 'CTR Engineer', 'ctr-eng@example.com', 'Engineer', 'active', null),
  ('25810000-0000-0000-0000-0000000000b1', '25810000-0000-0000-0000-00000000000b', 'CTR XOrg', 'ctr-xorg@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25810000-0000-0000-0000-0000000000d1', '25810000-0000-0000-0000-00000000000a', 'CTR Site', 'Ongoing Project', '25810000-0000-0000-0000-0000000000a2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25810000-0000-0000-0000-000000000401', '25810000-0000-0000-0000-00000000000a', '25810000-0000-0000-0000-0000000000d1', 'CTR WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('25810000-0000-0000-0000-000000000c01', '25810000-0000-0000-0000-00000000000a', 'CA', 'Crew A', '25810000-0000-0000-0000-0000000000a3'),
  ('25810000-0000-0000-0000-000000000c02', '25810000-0000-0000-0000-00000000000a', 'CB', 'Crew B', '25810000-0000-0000-0000-0000000000a4'),
  ('25810000-0000-0000-0000-000000000c03', '25810000-0000-0000-0000-00000000000a', 'CC', 'Crew C', null),
  ('25810000-0000-0000-0000-000000000c0b', '25810000-0000-0000-0000-00000000000b', 'XB', 'Other org crew', null);
-- crew B is rostered on the work order today (OQ-CTR-2); crew A is not.
insert into work_order_crews (work_order_id, crew_id, org_id, valid_from) values
  ('25810000-0000-0000-0000-000000000401', '25810000-0000-0000-0000-000000000c02', '25810000-0000-0000-0000-00000000000a', current_date - 30);
insert into crew_tool_lines (id, org_id, crew_id, name, serial, held_qty) values
  ('25810000-0000-0000-0000-000000000101', '25810000-0000-0000-0000-00000000000a', '25810000-0000-0000-0000-000000000c01', 'Hammer', null, 6),
  ('25810000-0000-0000-0000-000000000102', '25810000-0000-0000-0000-00000000000a', '25810000-0000-0000-0000-000000000c01', 'Spanner', 'S-1', 1),
  ('25810000-0000-0000-0000-000000000103', '25810000-0000-0000-0000-00000000000a', '25810000-0000-0000-0000-000000000c01', 'Drill', null, 5),
  ('25810000-0000-0000-0000-000000000104', '25810000-0000-0000-0000-00000000000a', '25810000-0000-0000-0000-000000000c02', 'Saw', null, 2),
  ('25810000-0000-0000-0000-000000000105', '25810000-0000-0000-0000-00000000000a', '25810000-0000-0000-0000-000000000c03', 'Level', null, 3),
  ('25810000-0000-0000-0000-000000000106', '25810000-0000-0000-0000-00000000000b', '25810000-0000-0000-0000-000000000c0b', 'Other org tool', null, 4);
-- report ids r01..r14, each with one uploaded photo object {org}/{report}/{file}/p.jpg
insert into storage.objects (bucket_id, name)
  select 'crew-tool-files', '25810000-0000-0000-0000-00000000000a/25810000-0000-0000-0000-0000000005' || lpad(n::text, 2, '0')
         || '/25810000-0000-0000-0000-0000000f00' || lpad(n::text, 2, '0') || '/p.jpg'
    from generate_series(1, 14) n;
create function pg_temp.rid(n int) returns uuid language sql as $$ select ('25810000-0000-0000-0000-0000000005' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.photo(n int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('path', '25810000-0000-0000-0000-00000000000a/' || pg_temp.rid(n) || '/25810000-0000-0000-0000-0000000f00' || lpad(n::text, 2, '0') || '/p.jpg', 'title', 'photo')) $$;
create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create function pg_temp.n_upd(q text) returns int language plpgsql as $$ declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
create function pg_temp.usable(p_line uuid) returns int language sql as $$ select usable_qty from public.crew_tool_line_summary where id = p_line $$;
-- FR-CTR-006 / NFR-CTR-003: the organisation's calendar date (0275's own expression), never the database's current_date —
-- in the 17:00-24:00 UTC window the org (Asia/Jakarta, UTC+7) is already a day ahead and the two clocks differ.
create function pg_temp.org_today() returns date language sql stable as $$
  select (now() at time zone coalesce(
            (select o.default_timezone from public.organizations o where o.id = '25810000-0000-0000-0000-00000000000a'),
            'UTC'))::date $$;
grant execute on all functions in schema pg_temp to public;

set local role authenticated;

-- coordinator: a PM configures; a field controller cannot (FR-CTR-016 configure)
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.set_crew_tool_settings('25810000-0000-0000-0000-0000000000a5', 3) $$, '42501', null,
  'FR-CTR-016 a field controller cannot set the coordinator');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.set_crew_tool_settings('25810000-0000-0000-0000-0000000000a5', 3) $$, 'FR-CTR-012 a Project Manager sets the coordinator');
select throws_ok($$ select public.set_crew_tool_settings('25810000-0000-0000-0000-0000000000b1', 3) $$, '23514', null,
  'FR-CTR-012 a coordinator of another organisation is refused');

-- ── AC-CTR-001 / 003 / 004 / 006: the hammer example ───────────────────────────────────────────────────────────
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a3');
select is(pg_temp.usable('25810000-0000-0000-0000-000000000101'), 6, 'AC-CTR-001 six hammers are usable');
select lives_ok($$ select public.report_crew_tool(pg_temp.rid(1), '25810000-0000-0000-0000-000000000101', 'damaged', 1, 'handle split', pg_temp.photo(1)) $$,
  'AC-CTR-001 the field controller reports 1 damaged hammer with a photo');
select is(pg_temp.usable('25810000-0000-0000-0000-000000000101'), 5, 'AC-CTR-001 usable is 5');
select lives_ok($$ select public.report_crew_tool(pg_temp.rid(2), '25810000-0000-0000-0000-000000000101', 'lost', 2, null, null) $$,
  'AC-CTR-006 a lost report needs no photo');
select is(pg_temp.usable('25810000-0000-0000-0000-000000000101'), 3, 'AC-CTR-001 usable is 3');
select throws_ok($$ select public.report_crew_tool(pg_temp.rid(3), '25810000-0000-0000-0000-000000000101', 'damaged', 4, null, pg_temp.photo(3)) $$,
  '23514', 'CTR_QTY_EXCEEDS_USABLE: only 3 usable', 'AC-CTR-001 a fourth report of 4 is refused with the usable count');
select throws_ok($$ select public.report_crew_tool(pg_temp.rid(4), '25810000-0000-0000-0000-000000000103', 'damaged', 1, null, null) $$,
  '23514', 'CTR_PHOTO_REQUIRED: add a photo of the damaged tool', 'AC-CTR-006 a damaged report without a photo is refused');
select throws_ok($$ select public.report_crew_tool(pg_temp.rid(4), '25810000-0000-0000-0000-000000000103', 'damaged', 1, null, pg_temp.photo(5)) $$,
  '23514', 'CTR_PHOTO: a photo path is not an uploaded file of this report', 'AC-CTR-006 a photo of another report is refused');

select is((select count(*)::int from crew_tool_reports where id = pg_temp.rid(1)), 1, 'AC-CTR-003 exactly one report');
select is((select count(*)::int from tasks where crew_tool_report_id = pg_temp.rid(1)), 1, 'AC-CTR-003 exactly one task');
select is((select assignee_id from tasks where crew_tool_report_id = pg_temp.rid(1)), '25810000-0000-0000-0000-0000000000a5'::uuid,
  'AC-CTR-003 the task is assigned to the coordinator');
select is((select name from tasks where crew_tool_report_id = pg_temp.rid(1)), 'Replace: Hammer x1 (Crew A)', 'FR-CTR-011 the task is named from the tool and crew');
select is((select end_date from tasks where crew_tool_report_id = pg_temp.rid(1)), pg_temp.org_today() + 3, 'FR-CTR-011 due in task_due_days');
select is((select project_id from tasks where crew_tool_report_id = pg_temp.rid(1)), null, 'FR-CTR-011 a crew with no roster leaves the project empty');
select is((select count(*)::int from crew_tool_report_files where report_id = pg_temp.rid(1) and org_id = '25810000-0000-0000-0000-00000000000a'), 1,
  'FR-CTR-017 the photo row is the report''s and carries its organisation');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from notifications where owner_id = '25810000-0000-0000-0000-0000000000a5'), 2,
  'AC-CTR-003 one notification per report (two reports so far), not two per task');
select ok(exists (select 1 from notifications where owner_id = '25810000-0000-0000-0000-0000000000a5' and title = 'Tool damaged: Hammer x1 (Crew A)'),
  'FR-CTR-013 the notification names kind, tool, quantity and crew');

-- AC-CTR-004: the same id again returns the report and creates nothing
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a3');
select is(public.report_crew_tool(pg_temp.rid(1), '25810000-0000-0000-0000-000000000101', 'damaged', 1, 'handle split', pg_temp.photo(1)), pg_temp.rid(1),
  'AC-CTR-004 a retry returns the existing report');
select is((select count(*)::int from crew_tool_reports where line_id = '25810000-0000-0000-0000-000000000101'), 2, 'AC-CTR-004 no second report');
select is((select count(*)::int from tasks where crew_tool_report_id = pg_temp.rid(1)), 1, 'AC-CTR-004 no second task');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from notifications where owner_id = '25810000-0000-0000-0000-0000000000a5'), 2, 'AC-CTR-004 no second notification');

-- ── AC-CTR-005: no coordinator, Admin and Project Manager are notified once ────────────────────────────────────
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a2');
select public.set_crew_tool_settings(null, 3);
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a3');
select public.report_crew_tool(pg_temp.rid(5), '25810000-0000-0000-0000-000000000102', 'lost', 1, null, null);
select is((select assignee_id from tasks where crew_tool_report_id = pg_temp.rid(5)), null, 'AC-CTR-005 the task is unassigned');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from notifications where owner_id = '25810000-0000-0000-0000-0000000000a1'), 1, 'AC-CTR-005 the Admin is notified once');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a2');
select is((select title from notifications where owner_id = '25810000-0000-0000-0000-0000000000a2'), 'Alat hilang: Spanner x1 (Crew A)',
  'FR-CTR-013 the Project Manager is notified once, in their language (Bahasa Indonesia)');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from notifications where owner_id = '25810000-0000-0000-0000-0000000000a5'), 2, 'AC-CTR-005 the former coordinator is not notified');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a2');
select public.set_crew_tool_settings('25810000-0000-0000-0000-0000000000a5', 3);

-- ── OQ-CTR-2: a crew rostered on exactly one work order today links its task to the project ───────────────────
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a4');
select public.report_crew_tool(pg_temp.rid(6), '25810000-0000-0000-0000-000000000104', 'damaged', 1, null, pg_temp.photo(6));
select is((select project_id from tasks where crew_tool_report_id = pg_temp.rid(6)), '25810000-0000-0000-0000-0000000000d1'::uuid,
  'FR-CTR-011 the task takes the rostered project');

-- ── AC-CTR-008 / 009: who may not ───────────────────────────────────────────────────────────────────────────
select throws_ok($$ select public.report_crew_tool(pg_temp.rid(7), '25810000-0000-0000-0000-000000000101', 'lost', 1, null, null) $$, '42501', null,
  'AC-CTR-008 the field controller of crew B cannot report on crew A''s line');
select is(pg_temp.n_upd($q$update crew_tool_lines set held_qty = 99 where id = '25810000-0000-0000-0000-000000000104'$q$), 0,
  'AC-CTR-008 a field controller cannot edit a line');
select throws_ok($$ select public.close_crew_tool_report(pg_temp.rid(1), 'repaired') $$, '42501', null,
  'AC-CTR-008 a field controller who is neither assignee nor manager cannot close a report');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.close_crew_tool_report(pg_temp.rid(1), 'repaired') $$, '42501', null,
  'AC-CTR-008 the reporter cannot close their own report');
select throws_ok($$ select public.correct_crew_tool_report(pg_temp.rid(1), 'damaged', 1, 'why') $$, '42501', null,
  'AC-CTR-008 only a crew manager corrects a report');
select throws_ok($$ insert into crew_tool_reports (id, line_id, kind, qty, reported_on, due_on) values (gen_random_uuid(), '25810000-0000-0000-0000-000000000101', 'lost', 1, current_date, current_date) $$,
  '42501', null, 'FR-CTR-008 a report cannot be written outside the report call');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a6');
select throws_ok($$ select public.report_crew_tool(pg_temp.rid(7), '25810000-0000-0000-0000-000000000101', 'lost', 1, null, null) $$, '42501', null,
  'AC-CTR-008 a user who is not a field controller cannot report');

select pg_temp.act_as('25810000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from crew_tool_lines where org_id = '25810000-0000-0000-0000-00000000000a'), 0, 'AC-CTR-009 another organisation reads no lines');
select is((select count(*)::int from crew_tool_reports), 0, 'AC-CTR-009 another organisation reads no reports');
select is((select count(*)::int from org_crew_tool_settings), 0, 'AC-CTR-009 another organisation reads no setting');
select throws_ok($$ select public.report_crew_tool(pg_temp.rid(8), '25810000-0000-0000-0000-000000000101', 'lost', 1, null, null) $$, 'P0002', null,
  'AC-CTR-009 another organisation cannot report on the line');
select throws_ok($$ select public.close_crew_tool_report(pg_temp.rid(1), 'replaced') $$, 'P0002', null, 'AC-CTR-009 another organisation cannot close a report');
select is(pg_temp.n_upd($q$update crew_tool_lines set held_qty = 99 where id = '25810000-0000-0000-0000-000000000101'$q$), 0,
  'AC-CTR-009 another organisation cannot write a line');

-- ── AC-CTR-014: a tool task cannot be set Done behind its report ───────────────────────────────────────────────
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a2');
select throws_ok($$ update tasks set status = 'Done' where crew_tool_report_id = pg_temp.rid(1) $$, '23514', null,
  'AC-CTR-014 a direct Done on the tool task is refused (CTR_RESOLVE_REQUIRED)');
select is((select status::text from tasks where crew_tool_report_id = pg_temp.rid(1)), 'To Do', 'AC-CTR-014 the task is unchanged');
select throws_ok($$ insert into tasks (name, crew_tool_report_id) values ('forged', pg_temp.rid(1)) $$, '42501', null,
  'AC-CTR-014 a task cannot be linked to a report outside the report call');
select throws_ok($$ update tasks set crew_tool_report_id = null where crew_tool_report_id = pg_temp.rid(1) $$, '42501', null,
  'AC-CTR-014 the link cannot be removed');

-- ── AC-CTR-007: closing ─────────────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.close_crew_tool_report(pg_temp.rid(2), 'repaired') $$, '23514', null, 'AC-CTR-007 repaired on a lost report is refused');
select lives_ok($$ select public.close_crew_tool_report(pg_temp.rid(1), 'repaired') $$, 'AC-CTR-007 the assignee closes the damaged report as repaired');
select is((select held_qty from crew_tool_lines where id = '25810000-0000-0000-0000-000000000101'), 6, 'AC-CTR-007 repaired: held stays 6');
select is(pg_temp.usable('25810000-0000-0000-0000-000000000101'), 4, 'AC-CTR-007 repaired: usable is 4');
select is((select status::text from tasks where crew_tool_report_id = pg_temp.rid(1)), 'Done', 'FR-CTR-014 the close call set the task Done');
select throws_ok($$ select public.close_crew_tool_report(pg_temp.rid(1), 'replaced') $$, '23514', null, 'AC-CTR-007 a second close is refused');
select lives_ok($$ select public.close_crew_tool_report(pg_temp.rid(2), 'replaced') $$, 'AC-CTR-007 the lost report closes as replaced');
select is(pg_temp.usable('25810000-0000-0000-0000-000000000101'), 6, 'AC-CTR-007 replaced: held 6 and usable 6');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a3');
select public.report_crew_tool(pg_temp.rid(9), '25810000-0000-0000-0000-000000000101', 'lost', 2, null, null);
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.close_crew_tool_report(pg_temp.rid(9), 'written_off') $$, 'AC-CTR-007 a crew manager closes a report as written off');
select is((select held_qty from crew_tool_lines where id = '25810000-0000-0000-0000-000000000101'), 4, 'AC-CTR-007 written off: held falls to 4');
select is(pg_temp.usable('25810000-0000-0000-0000-000000000101'), 4, 'AC-CTR-007 written off: usable is 4');
select lives_ok($$ select public.close_crew_tool_report(pg_temp.rid(5), 'written_off') $$, 'AC-CTR-007 a one-unit serial line can be written off');
select is((select held_qty from crew_tool_lines where id = '25810000-0000-0000-0000-000000000102'), 0, 'FR-CTR-014 written off takes held to 0');

-- ── AC-CTR-013: correction ───────────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a3');
select public.report_crew_tool(pg_temp.rid(10), '25810000-0000-0000-0000-000000000103', 'damaged', 2, null, pg_temp.photo(10));
select is(pg_temp.usable('25810000-0000-0000-0000-000000000103'), 3, 'AC-CTR-013 drill usable is 3 after a report of 2');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.correct_crew_tool_report(pg_temp.rid(10), 'damaged', 1, '  ') $$, '23514', null, 'AC-CTR-013 a correction without a reason is refused');
select lives_ok($$ select public.correct_crew_tool_report(pg_temp.rid(10), 'damaged', 1, 'miscounted') $$, 'AC-CTR-013 a crew manager corrects the quantity with a reason');
select is(pg_temp.usable('25810000-0000-0000-0000-000000000103'), 4, 'AC-CTR-013 usable rises by 1');
select is((select name from tasks where crew_tool_report_id = pg_temp.rid(10)), 'Replace: Drill x1 (Crew A)', 'FR-CTR-010 the task name follows the corrected quantity');
reset role;
select is((select count(*)::int from audit_events where action = 'crew_tool.correct' and entity_id = pg_temp.rid(10)), 1, 'AC-CTR-013 the correction is audited');
set local role authenticated;
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a2');
select public.close_crew_tool_report(pg_temp.rid(10), 'replaced');
select throws_ok($$ select public.correct_crew_tool_report(pg_temp.rid(10), 'damaged', 2, 'late') $$, '23514', null, 'AC-CTR-013 a closed report cannot be corrected');

-- ── FR-CTR-003: move, quantity, history ──────────────────────────────────────────────────────────────────────
select lives_ok($$ update crew_tool_lines set crew_id = '25810000-0000-0000-0000-000000000c02' where id = '25810000-0000-0000-0000-000000000105' $$,
  'FR-CTR-003 a line moves to another crew of the same organisation');
select throws_ok($$ update crew_tool_lines set crew_id = '25810000-0000-0000-0000-000000000c0b' where id = '25810000-0000-0000-0000-000000000105' $$, '23514', null,
  'FR-CTR-003 a move to a crew of another organisation is refused');
select throws_ok($$ insert into crew_tool_lines (crew_id, name, held_qty) values ('25810000-0000-0000-0000-000000000c01', 'Zero', 0) $$, '23514', null,
  'FR-CTR-001 a line is created with at least 1');
select throws_ok($$ update crew_tool_lines set held_qty = 0 where id = '25810000-0000-0000-0000-000000000105' $$, '23514', null,
  'FR-CTR-001 an edit cannot take the quantity to 0');
select throws_ok($$ update crew_tool_lines set crew_id = '25810000-0000-0000-0000-000000000c01' where id = '25810000-0000-0000-0000-000000000104' $$, '23514', null,
  'FR-CTR-003 a line with an open report cannot move');
select throws_ok($$ update crew_tool_lines set held_qty = 0 where id = '25810000-0000-0000-0000-000000000104' $$, '23514', null,
  'FR-CTR-007 the held quantity cannot go below the open reports');
reset role;
select ok((select count(*) >= 1 from record_changes where entity_type = 'crew_tool_line' and entity_id = '25810000-0000-0000-0000-000000000105' and op = 'update'),
  'FR-CTR-003 the move is kept in record history');
set local role authenticated;
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a2');

-- ── AC-CTR-002: serial uniqueness ────────────────────────────────────────────────────────────────────────────
select throws_ok($$ insert into crew_tool_lines (crew_id, name, serial, held_qty) values ('25810000-0000-0000-0000-000000000c01', 'Clone', ' s-1 ', 1) $$,
  '23505', null, 'AC-CTR-002 a live serial cannot be used twice in the organisation');
select throws_ok($$ insert into crew_tool_lines (crew_id, name, serial, held_qty) values ('25810000-0000-0000-0000-000000000c01', 'Many', 'S-9', 2) $$,
  '23514', null, 'FR-CTR-002 a line with a serial has quantity 1');
update crew_tool_lines set archived_at = now() where id = '25810000-0000-0000-0000-000000000102';
select lives_ok($$ insert into crew_tool_lines (crew_id, name, serial, held_qty) values ('25810000-0000-0000-0000-000000000c01', 'Reuse', 'S-1', 1) $$,
  'AC-CTR-002 archiving the line frees its serial');

-- ── AC-CTR-010: a crew holding live lines cannot be archived ────────────────────────────────────────────────
insert into crew_tool_lines (id, crew_id, name, held_qty) values ('25810000-0000-0000-0000-000000000107', '25810000-0000-0000-0000-000000000c03', 'Chisel', 2);
select throws_ok($$ update crews set archived_at = now() where id = '25810000-0000-0000-0000-000000000c03' $$, '23514', null,
  'AC-CTR-010 a crew with a live tool line cannot be archived');
select lives_ok($$ update crew_tool_lines set archived_at = now() where id = '25810000-0000-0000-0000-000000000107' $$ , 'AC-CTR-010 the line archives');
select lives_ok($$ update crews set archived_at = now() where id = '25810000-0000-0000-0000-000000000c03' $$, 'AC-CTR-010 an emptied crew can be archived');
select throws_ok($$ update crew_tool_lines set archived_at = now() where id = '25810000-0000-0000-0000-000000000104' $$, '23514', null,
  'FR-CTR-005 a line with an open report cannot be archived');

-- ── FR-CTR-017 photos and storage ────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a4');
select lives_ok($$ insert into crew_tool_report_files (report_id, file_path) values (pg_temp.rid(6), '25810000-0000-0000-0000-00000000000a/' || pg_temp.rid(6) || '/25810000-0000-0000-0000-0000000f0006/p.jpg') $$,
  'FR-CTR-010 the field controller adds a photo to their open report');
select throws_ok($$ insert into crew_tool_report_files (report_id, file_path) values (pg_temp.rid(10), '25810000-0000-0000-0000-00000000000a/' || pg_temp.rid(10) || '/25810000-0000-0000-0000-0000000f0010/p.jpg') $$,
  '42501', null, 'FR-CTR-017 no photo can be added to a report of another crew or a closed report');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('crew-tool-files', '25810000-0000-0000-0000-00000000000a/25810000-0000-0000-0000-0000000005ff/25810000-0000-0000-0000-0000000f00ff/n.jpg') $$,
  'OD-CTR-5 a field controller uploads a photo before the report exists');
select pg_temp.act_as('25810000-0000-0000-0000-0000000000a6');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('crew-tool-files', '25810000-0000-0000-0000-00000000000a/25810000-0000-0000-0000-0000000005fe/25810000-0000-0000-0000-0000000f00fe/n.jpg') $$,
  '42501', null, 'OD-CTR-5 a user who reports for no crew cannot upload');

select * from finish();
rollback;
