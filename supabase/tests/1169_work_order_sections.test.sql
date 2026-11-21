-- 1169_work_order_sections.test.sql — #2576 work-order sections (docs/specs/work-order-sections.spec.md).
-- Migrations under test: 1169_work_order_sections.sql, 1096_work_order_section_plan_lines.sql,
-- 1097_work_order_section_children.sql, 1098_work_order_section_reads.sql.
-- AC-WOS-001 a work order with no sections reads as before · AC-WOS-002 the roll-up invariant (400 + 350 + 250 = 1,000) ·
-- AC-WOS-003 a child naming a section of another work order is refused by the composite key · AC-WOS-004 a code is
-- reserved for the work order's life · AC-WOS-005 cancelled/closed work orders · AC-WOS-006 an archive is blocked by an
-- open task · AC-WOS-007 delete is Admin only and blocked while referenced · AC-WOS-012 a figure moves between
-- sections, the total does not · AC-WOS-013 readiness history · AC-WOS-014 the readiness roll-up · AC-WOS-015 the
-- foreman's column limit · AC-WOS-016 another organisation / no permission · AC-WOS-017 a crew on two sections the same day.
-- Every denial asserts the errcode AND the message.
begin;
create extension if not exists pgtap;
select plan(86);

-- ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency) values
  ('25760000-0000-0000-0000-00000000000a', 'WOS Org',       'IDR'),
  ('25760000-0000-0000-0000-00000000000b', 'WOS Other Org', 'IDR');
insert into auth.users (id, email) values
  ('25760000-0000-0000-0000-0000000000a1', 'wos-admin@example.com'),
  ('25760000-0000-0000-0000-0000000000a2', 'wos-fin@example.com'),
  ('25760000-0000-0000-0000-0000000000a3', 'wos-pm@example.com'),
  ('25760000-0000-0000-0000-0000000000a4', 'wos-eng@example.com'),
  ('25760000-0000-0000-0000-0000000000a5', 'wos-foreman@example.com'),
  ('25760000-0000-0000-0000-0000000000a6', 'wos-foreman2@example.com'),
  ('25760000-0000-0000-0000-0000000000a7', 'wos-gone@example.com'),
  ('25760000-0000-0000-0000-0000000000b1', 'wos-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25760000-0000-0000-0000-0000000000a1', '25760000-0000-0000-0000-00000000000a', 'WOS Admin',    'wos-admin@example.com',    'Admin', 'active'),
  ('25760000-0000-0000-0000-0000000000a2', '25760000-0000-0000-0000-00000000000a', 'WOS Fin',      'wos-fin@example.com',      'Finance', 'active'),
  ('25760000-0000-0000-0000-0000000000a3', '25760000-0000-0000-0000-00000000000a', 'WOS PM',       'wos-pm@example.com',       'Project Manager', 'active'),
  ('25760000-0000-0000-0000-0000000000a4', '25760000-0000-0000-0000-00000000000a', 'WOS Eng',      'wos-eng@example.com',      'Engineer', 'active'),
  ('25760000-0000-0000-0000-0000000000a5', '25760000-0000-0000-0000-00000000000a', 'WOS Foreman',  'wos-foreman@example.com',  'Engineer', 'active'),
  ('25760000-0000-0000-0000-0000000000a6', '25760000-0000-0000-0000-00000000000a', 'WOS Foreman2', 'wos-foreman2@example.com', 'Engineer', 'active'),
  ('25760000-0000-0000-0000-0000000000a7', '25760000-0000-0000-0000-00000000000a', 'WOS Gone',     'wos-gone@example.com',     'Engineer', 'disabled'),
  ('25760000-0000-0000-0000-0000000000b1', '25760000-0000-0000-0000-00000000000b', 'WOS XOrg',     'wos-xorg@example.com',     'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-00000000000a', 'WOS Site', 'Ongoing Project', '25760000-0000-0000-0000-0000000000a3', 'IDR'),
  ('25760000-0000-0000-0000-0000000000d9', '25760000-0000-0000-0000-00000000000b', 'WOS Other Site', 'Ongoing Project', null, 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('25760000-0000-0000-0000-000000000401', '25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-0000000000d1', 'WO-W',  'WOS W',  'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('25760000-0000-0000-0000-000000000402', '25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-0000000000d1', 'WO-W2', 'WOS W2', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('25760000-0000-0000-0000-000000000409', '25760000-0000-0000-0000-00000000000b', '25760000-0000-0000-0000-0000000000d9', 'WO-X',  'WOS X',  'Issued', 10000, 'exclusive', 0, 'IDR');
-- Closed / cancelled work orders and their pre-existing sections are written with triggers off (a section cannot be
-- created on them any more): this file proves the rules about them, not their create path.
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, cancelled_at, currency) values
  ('25760000-0000-0000-0000-000000000403', '25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-0000000000d1', 'WO-Z',  'WOS cancelled', 'Cancelled', 0, 'exclusive', 0, now(), 'IDR'),
  ('25760000-0000-0000-0000-000000000404', '25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-0000000000d1', 'WO-C',  'WOS closed',    'Closed',    0, 'exclusive', 0, null,  'IDR');
insert into work_order_sections (id, org_id, project_id, work_order_id, code, name, foreman_id) values
  ('25760000-0000-0000-0000-000000000b01', '25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-000000000403', 'Z1', 'Frozen',  null),
  ('25760000-0000-0000-0000-000000000b02', '25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-000000000404', 'C1', 'Closed one', '25760000-0000-0000-0000-0000000000a5'),
  ('25760000-0000-0000-0000-000000000b03', '25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-000000000404', 'C2', 'Closed two', null);
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create temp table wos_ids (k text primary key, v uuid);
grant all on wos_ids to authenticated;

-- ── AC-WOS-001: no sections, no section rows ─────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('25760000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.work_order_section_rollup('25760000-0000-0000-0000-000000000401')), 0,
  'AC-WOS-001 a work order with no sections reads no section row (not even a remainder row)');
select is((select count(*)::int from public.work_order_section_readiness where work_order_id = '25760000-0000-0000-0000-000000000401'), 0,
  'AC-WOS-001 and has no readiness roll-up');

-- ── FR-WOS-001/002: add sections ─────────────────────────────────────────────────────────────────────────
select lives_ok($$ insert into public.work_order_sections (work_order_id, code, name, location_note, foreman_id, sort_order)
  values ('25760000-0000-0000-0000-000000000401', 'A', 'North block', 'levels 1 to 3', '25760000-0000-0000-0000-0000000000a5', 1) $$,
  'FR-WOS-001 a Project Manager adds a section with a foreman');
select lives_ok($$ insert into public.work_order_sections (work_order_id, code, name, sort_order)
  values ('25760000-0000-0000-0000-000000000401', 'B', 'South block', 2) $$, 'FR-WOS-002 a foreman is optional');
select lives_ok($$ insert into public.work_order_sections (work_order_id, code, name, sort_order)
  values ('25760000-0000-0000-0000-000000000401', 'D', 'Yard', 3) $$, 'a third section');
insert into wos_ids select 'A', id from public.work_order_sections where code = 'A' and work_order_id = '25760000-0000-0000-0000-000000000401';
insert into wos_ids select 'B', id from public.work_order_sections where code = 'B' and work_order_id = '25760000-0000-0000-0000-000000000401';
insert into wos_ids select 'D', id from public.work_order_sections where code = 'D' and work_order_id = '25760000-0000-0000-0000-000000000401';
select is((select project_id from public.work_order_sections where id = (select v from wos_ids where k = 'A')),
  '25760000-0000-0000-0000-0000000000d1'::uuid, 'FR-WOS-007 the project is the work order''s, set by the database');
select is((select org_id from public.work_order_sections where id = (select v from wos_ids where k = 'A')),
  '25760000-0000-0000-0000-00000000000a'::uuid, 'FR-WOS-024 the org is stamped, never taken from the client');
select is((select readiness from public.work_order_sections where id = (select v from wos_ids where k = 'A')), 'not_ready',
  'AC-WOS-013 a section starts not ready');
select throws_ok($$ insert into public.work_order_sections (work_order_id, code, name, foreman_id)
  values ('25760000-0000-0000-0000-000000000401', 'E', 'Gone foreman', '25760000-0000-0000-0000-0000000000a7') $$,
  '23514', 'WOS_FOREMAN: the foreman must be an active user of this organisation', 'FR-WOS-002 a disabled user cannot be the foreman');
select throws_ok($$ insert into public.work_order_sections (work_order_id, code, name, foreman_id)
  values ('25760000-0000-0000-0000-000000000401', 'E', 'Other org foreman', '25760000-0000-0000-0000-0000000000b1') $$,
  '23514', 'WOS_FOREMAN: the foreman must be an active user of this organisation', 'FR-WOS-002 a user of another organisation cannot be the foreman');

-- ── AC-WOS-004: codes ────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ insert into public.work_order_sections (work_order_id, code, name)
  values ('25760000-0000-0000-0000-000000000401', ' a ', 'Duplicate') $$,
  '23505', 'duplicate key value violates unique constraint "work_order_sections_code_uniq"',
  'AC-WOS-004 a code is unique per work order (case and padding ignored)');
select lives_ok($$ insert into public.work_order_sections (work_order_id, code, name)
  values ('25760000-0000-0000-0000-000000000402', 'A', 'Same code, another work order') $$,
  'AC-WOS-004 the same code on another work order is fine');
select lives_ok($$ insert into public.work_order_sections (work_order_id, code, name, sort_order)
  values ('25760000-0000-0000-0000-000000000401', 'T', 'To archive', 9) $$, 'fixture: a section to archive');
update public.work_order_sections set archived_at = now() where work_order_id = '25760000-0000-0000-0000-000000000401' and code = 'T';
select throws_ok($$ insert into public.work_order_sections (work_order_id, code, name)
  values ('25760000-0000-0000-0000-000000000401', 'T', 'Reuse') $$,
  '23505', 'duplicate key value violates unique constraint "work_order_sections_code_uniq"',
  'AC-WOS-004 an archived section frees nothing: its code stays reserved');

-- ── AC-WOS-002 / 012: plan figures per section and the roll-up invariant ──────────────────────────────────
select pg_temp.act_as('25760000-0000-0000-0000-0000000000a2');
select is(public.set_work_order_plan('25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-000000000401', jsonb_build_array(
    jsonb_build_object('kind', 'direct_budget', 'value', '400.00', 'section_id', (select v from wos_ids where k = 'A')),
    jsonb_build_object('kind', 'direct_budget', 'value', '350.00', 'section_id', (select v from wos_ids where k = 'B')),
    jsonb_build_object('kind', 'direct_budget', 'value', '250.00'))), 3,
  'FR-WOS-008 Finance writes one figure per section and one unsectioned, in one call');
select is((select count(*)::int from public.work_order_section_rollup('25760000-0000-0000-0000-000000000401')), 5,
  'FR-WOS-021 four sections (one archived, still counted) and the remainder row');
select is((select array_agg(coalesce(code, '<remainder>') order by (section_id is null), sort_order, code)
             from public.work_order_section_rollup('25760000-0000-0000-0000-000000000401')),
  array['A', 'B', 'D', 'T', '<remainder>'], 'the remainder row is last, sections follow their sort order');
select is((select array_agg(direct_budget order by (section_id is null), sort_order)
             from public.work_order_section_rollup('25760000-0000-0000-0000-000000000401')),
  array[400.00, 350.00, null, null, 250.00]::numeric[], 'AC-WOS-002 A 400.00, B 350.00, D and T none, remainder 250.00');
select is((select sum(direct_budget) from public.work_order_section_rollup('25760000-0000-0000-0000-000000000401')),
  (select sum(value) from public.work_order_plan_lines where work_order_id = '25760000-0000-0000-0000-000000000401' and kind = 'direct_budget'),
  'AC-WOS-002 sum(sections) + remainder = the work-order total, exactly');
select is((select sum(direct_budget) from public.work_order_section_rollup('25760000-0000-0000-0000-000000000401')), 1000.00::numeric,
  'AC-WOS-002 which is 1,000.00');
-- AC-WOS-012: move 100 from A to B in one call.
select is(public.set_work_order_plan('25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-000000000401', jsonb_build_array(
    jsonb_build_object('kind', 'direct_budget', 'value', '300.00', 'section_id', (select v from wos_ids where k = 'A')),
    jsonb_build_object('kind', 'direct_budget', 'value', '450.00', 'section_id', (select v from wos_ids where k = 'B')))), 2,
  'AC-WOS-012 a figure moves between sections');
select is((select sum(direct_budget) from public.work_order_section_rollup('25760000-0000-0000-0000-000000000401')), 1000.00::numeric,
  'AC-WOS-012 the work order''s total is unchanged');
select is((select array_agg(direct_budget order by (section_id is null), sort_order)
             from public.work_order_section_rollup('25760000-0000-0000-0000-000000000401')),
  array[300.00, 450.00, null, null, 250.00]::numeric[], 'AC-WOS-012 each section''s figure moved by exactly that amount');
select is(public.set_work_order_plan('25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-000000000401', jsonb_build_array(
    jsonb_build_object('kind', 'direct_budget', 'value', '250.00'))), 1,
  'the unsectioned call addresses the unsectioned figure exactly as before 1096');
select is((select count(*)::int from public.work_order_plan_lines where work_order_id = '25760000-0000-0000-0000-000000000401'
             and kind = 'direct_budget' and section_id is null), 1, 'still one unsectioned direct-budget figure');
select throws_ok($$ select public.set_work_order_plan('25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-000000000402', jsonb_build_array(
    jsonb_build_object('kind', 'direct_budget', 'value', '10.00', 'section_id', (select v from wos_ids where k = 'A')))) $$,
  '23503', 'insert or update on table "work_order_plan_lines" violates foreign key constraint "work_order_plan_lines_section_wo_fk"',
  'AC-WOS-003 a plan figure of W2 naming a section of W is refused by the composite key');
select throws_ok($$ select public.set_work_order_plan('25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-000000000401', jsonb_build_array(
    jsonb_build_object('kind', 'direct_budget', 'value', '5.00', 'section_id', '25760000-0000-0000-0000-00000000dead'))) $$,
  '23503', null, 'AC-WOS-003 a section that does not exist is refused');

-- ── AC-WOS-003: the other children, written as the table owner under a Project Manager's claims ─────────────
reset role;
select pg_temp.act_as('25760000-0000-0000-0000-0000000000a3');
insert into crews (id, code, name) values ('25760000-0000-0000-0000-000000000c01', 'CR1', 'WOS crew') on conflict do nothing;
update crews set org_id = '25760000-0000-0000-0000-00000000000a' where id = '25760000-0000-0000-0000-000000000c01';
select lives_ok($$ insert into tasks (id, org_id, project_id, work_order_id, section_id, name)
  values ('25760000-0000-0000-0000-000000000e01', '25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-0000000000d1',
          '25760000-0000-0000-0000-000000000401', (select v from wos_ids where k = 'A'), 'Pour slab') $$,
  'AC-WOS-003 a task of W naming its own work order''s section is accepted');
select throws_ok($$ insert into tasks (org_id, project_id, work_order_id, section_id, name)
  values ('25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-0000000000d1',
          '25760000-0000-0000-0000-000000000402', (select v from wos_ids where k = 'A'), 'Wrong work order') $$,
  '23503', 'insert or update on table "tasks" violates foreign key constraint "tasks_section_wo_fk"',
  'AC-WOS-003 a task of W2 naming a section of W is refused');
select throws_ok($$ insert into tasks (org_id, project_id, section_id, name)
  values ('25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-0000000000d1', (select v from wos_ids where k = 'A'), 'No work order') $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_section_needs_work_order"',
  'AC-WOS-003 a section with no work order slips past a null-matching key, so a check refuses it');
select lives_ok($$ insert into work_order_crews (org_id, work_order_id, crew_id, section_id, valid_from, valid_to)
  values ('25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-000000000401', '25760000-0000-0000-0000-000000000c01',
          (select v from wos_ids where k = 'A'), '2026-12-01', '2026-12-10') $$,
  'AC-WOS-017 crew X is placed on section A from day 1 to day 10');
select throws_ok($$ insert into work_order_crews (org_id, work_order_id, crew_id, section_id, valid_from, valid_to)
  values ('25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-000000000401', '25760000-0000-0000-0000-000000000c01',
          (select v from wos_ids where k = 'B'), '2026-12-05', '2026-12-20') $$,
  '23P01', 'conflicting key value violates exclusion constraint "work_order_crews_no_overlap"',
  'AC-WOS-017 the same crew on section B of the same work order on day 5 is refused by the roster''s one-placement-a-day rule');
select lives_ok($$ insert into work_order_crews (org_id, work_order_id, crew_id, section_id, valid_from, valid_to)
  values ('25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-000000000401', '25760000-0000-0000-0000-000000000c01',
          (select v from wos_ids where k = 'B'), '2026-12-11', '2026-12-20') $$,
  'AC-WOS-017 from day 11, after A''s placement ends, section B is accepted');
select throws_ok($$ insert into work_order_crews (org_id, work_order_id, crew_id, section_id, valid_from, valid_to)
  values ('25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-000000000402', '25760000-0000-0000-0000-000000000c01',
          (select v from wos_ids where k = 'A'), '2027-01-01', '2027-01-05') $$,
  '23503', 'insert or update on table "work_order_crews" violates foreign key constraint "work_order_crews_section_wo_fk"',
  'AC-WOS-003 a placement on W2 naming a section of W is refused');

-- ── AC-WOS-006: archive blockers; an archived section is refused on a new or moved record ───────────────────
select throws_ok($$ update work_order_sections set archived_at = now() where id = (select v from wos_ids where k = 'A') $$,
  '23514', 'WOS_ARCHIVE_BLOCKED: 1 task(s) of this section are not done', 'AC-WOS-006 a section with a task not Done is not archived');
update tasks set status = 'Done' where id = '25760000-0000-0000-0000-000000000e01';
select lives_ok($$ update work_order_sections set archived_at = now() where id = (select v from wos_ids where k = 'D') $$,
  'AC-WOS-006 a section with nothing open archives');
select throws_ok($$ insert into tasks (org_id, project_id, work_order_id, section_id, name)
  values ('25760000-0000-0000-0000-00000000000a', '25760000-0000-0000-0000-0000000000d1',
          '25760000-0000-0000-0000-000000000401', (select v from wos_ids where k = 'D'), 'Late task') $$,
  '23514', 'WOS_SECTION_ARCHIVED: an archived section takes no new or moved records', 'AC-WOS-006 an archived section takes no new record');
set local role authenticated;
select pg_temp.act_as('25760000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.set_work_order_plan('25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-000000000401', jsonb_build_array(
    jsonb_build_object('kind', 'indirect_budget', 'value', '9.00', 'section_id', (select v from wos_ids where k = 'D')))) $$,
  '23514', 'WOS_SECTION_ARCHIVED: an archived section takes no new or moved records', 'FR-WOS-005 a plan figure on an archived section is refused');
select is((select count(*)::int from public.work_order_section_rollup('25760000-0000-0000-0000-000000000401') where section_id = (select v from wos_ids where k = 'D')), 1,
  'an archived section still appears in the roll-up (records already pointing at it keep it)');

-- ── AC-WOS-013 / 014 / 015: readiness ─────────────────────────────────────────────────────────────────────
select pg_temp.act_as('25760000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.work_order_sections), 8, 'the foreman reads every section of the organisation (read follows work-order read)');
select lives_ok($$ update public.work_order_sections set readiness = 'ready', readiness_note = 'rebar checked'
                   where id = (select v from wos_ids where k = 'A') $$, 'AC-WOS-015 the foreman sets readiness on their own section');
select is((select readiness_set_by from public.work_order_sections where id = (select v from wos_ids where k = 'A')),
  '25760000-0000-0000-0000-0000000000a5'::uuid, 'the readiness author is stamped by the database');
select throws_ok($$ update public.work_order_sections set name = 'Renamed' where id = (select v from wos_ids where k = 'A') $$,
  '42501', 'WOS_FOREMAN_COLUMNS: a foreman may set readiness and its note only', 'AC-WOS-015 the foreman cannot edit the section''s name');
select throws_ok($$ update public.work_order_sections set foreman_id = '25760000-0000-0000-0000-0000000000a6' where id = (select v from wos_ids where k = 'A') $$,
  '42501', 'WOS_FOREMAN_COLUMNS: a foreman may set readiness and its note only', 'AC-WOS-015 nor hand the section to someone else');
select throws_ok($$ update public.work_order_sections set archived_at = now() where id = (select v from wos_ids where k = 'A') $$,
  '42501', 'WOS_FOREMAN_COLUMNS: a foreman may set readiness and its note only', 'AC-WOS-015 nor archive it');
select throws_ok($$ update public.work_order_sections set readiness_set_by = '25760000-0000-0000-0000-0000000000a1' where id = (select v from wos_ids where k = 'A') $$,
  '42501', 'permission denied for table work_order_sections', 'the readiness author column is not writable by a client');
with u as (update public.work_order_sections set readiness = 'ready' where id = (select v from wos_ids where k = 'B') returning 1)
select is((select count(*)::int from u), 0, 'AC-WOS-015 the foreman cannot set readiness on another section');
select throws_ok($$ select public.set_work_order_plan('25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-000000000401', jsonb_build_array(
    jsonb_build_object('kind', 'direct_budget', 'value', '1.00', 'section_id', (select v from wos_ids where k = 'A')))) $$,
  '42501', 'not authorized', 'AC-WOS-015 the foreman cannot edit plans');
select throws_ok($$ insert into public.work_order_sections (work_order_id, code, name) values ('25760000-0000-0000-0000-000000000401', 'Q', 'Foreman adds') $$,
  '42501', 'new row violates row-level security policy for table "work_order_sections"', 'a foreman cannot add a section');

select pg_temp.act_as('25760000-0000-0000-0000-0000000000a3');
select lives_ok($$ update public.work_order_sections set readiness = 'blocked', readiness_note = 'no access' where id = (select v from wos_ids where k = 'B') $$,
  'a Project Manager sets readiness');
select lives_ok($$ update public.work_order_sections set readiness = 'ready', readiness_note = null where id = (select v from wos_ids where k = 'B') $$,
  'and changes it again');
select is((select array_agg(readiness || ':' || coalesce(note, '-') order by set_at, id) from public.work_order_section_readiness_events
            where section_id = (select v from wos_ids where k = 'B')),
  array['not_ready:-', 'blocked:no access', 'ready:-'], 'AC-WOS-013 history shows each change with its note, oldest first');
select is((select count(*)::int from public.work_order_section_readiness_events
            where section_id = (select v from wos_ids where k = 'A') and set_by = '25760000-0000-0000-0000-0000000000a5' and readiness = 'ready' and note = 'rebar checked'), 1,
  'AC-WOS-013 the foreman''s change names the foreman, the time and the note');
select throws_ok($$ update public.work_order_section_readiness_events set note = 'edited' $$,
  '42501', 'permission denied for table work_order_section_readiness_events', 'history is not writable by a client');
reset role;
select throws_ok($$ update public.work_order_section_readiness_events set note = 'edited' $$,
  'P0001', 'WOS_IMMUTABLE: readiness history cannot be changed', 'history is append-only even for the owner');
set local role authenticated;
select pg_temp.act_as('25760000-0000-0000-0000-0000000000a3');
-- A ready, B ready, a third live section blocked; D is archived and not counted.
select lives_ok($$ insert into public.work_order_sections (work_order_id, code, name, sort_order) values ('25760000-0000-0000-0000-000000000401', 'F', 'Fence', 4) $$, 'fixture: a fourth section');
update public.work_order_sections set readiness = 'blocked', readiness_note = 'permit' where work_order_id = '25760000-0000-0000-0000-000000000401' and code = 'F';
select is((select (ready, not_ready, blocked, live_sections, all_ready)::text from public.work_order_section_readiness where work_order_id = '25760000-0000-0000-0000-000000000401'),
  '(2,0,1,3,f)', 'AC-WOS-014 ready, ready, blocked: counts 2/0/1, all ready is false (the archived section is not counted)');
update public.work_order_sections set readiness = 'ready' where work_order_id = '25760000-0000-0000-0000-000000000401' and code = 'F';
select is((select all_ready from public.work_order_section_readiness where work_order_id = '25760000-0000-0000-0000-000000000401'), true,
  'AC-WOS-014 with every live section ready, all ready is true');
select is((select count(*)::int from public.work_order_section_readiness where work_order_id = '25760000-0000-0000-0000-000000000402'), 1,
  'a work order with a live section has a roll-up');
select lives_ok($$ update public.work_order_sections set archived_at = now() where work_order_id = '25760000-0000-0000-0000-000000000402' $$, 'fixture: W2''s only section archived');
select is((select count(*)::int from public.work_order_section_readiness where work_order_id = '25760000-0000-0000-0000-000000000402'), 0,
  'AC-WOS-014 with no live section there is no roll-up');

-- ── FR-WOS-003 / 007: edits and fixed keys ────────────────────────────────────────────────────────────────
select lives_ok($$ update public.work_order_sections set name = 'North block (renamed)', foreman_id = '25760000-0000-0000-0000-0000000000a6'
                   where id = (select v from wos_ids where k = 'A') $$, 'FR-WOS-003 a Project Manager edits name and foreman');
reset role;
select is((select count(*)::int from public.audit_events where action = 'work_order_section.update' and entity_id = (select v from wos_ids where k = 'A')
             and actor_id = '25760000-0000-0000-0000-0000000000a3' and detail->'after'->>'name' = 'North block (renamed)'), 1,
  'FR-WOS-003 the edit is in record history, with actor and the before and after');
set local role authenticated;
select pg_temp.act_as('25760000-0000-0000-0000-0000000000a3');
select throws_ok($$ update public.work_order_sections set work_order_id = '25760000-0000-0000-0000-000000000402' where id = (select v from wos_ids where k = 'A') $$,
  '42501', 'permission denied for table work_order_sections', 'FR-WOS-007 a client cannot move a section to another work order');
reset role;
select throws_ok($$ update public.work_order_sections set work_order_id = '25760000-0000-0000-0000-000000000402' where id = (select v from wos_ids where k = 'A') $$,
  '23514', 'WOS_KEY: a section keeps its work order and project', 'FR-WOS-007 and not even the owner moves it');

-- ── AC-WOS-005: cancelled and closed work orders ──────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('25760000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into public.work_order_sections (work_order_id, code, name) values ('25760000-0000-0000-0000-000000000403', 'Z2', 'New') $$,
  '23514', 'WOS_STATUS: a cancelled work order takes no new sections', 'AC-WOS-005 no section on a cancelled work order');
select throws_ok($$ update public.work_order_sections set name = 'Edit' where id = '25760000-0000-0000-0000-000000000b01' $$,
  '23514', 'WOS_CANCELLED: a cancelled work order''s sections are frozen', 'AC-WOS-005 no edit on a cancelled work order''s section');
select throws_ok($$ update public.work_order_sections set readiness = 'ready' where id = '25760000-0000-0000-0000-000000000b01' $$,
  '23514', 'WOS_CANCELLED: a cancelled work order''s sections are frozen', 'AC-WOS-005 not even readiness');
select throws_ok($$ insert into public.work_order_sections (work_order_id, code, name) values ('25760000-0000-0000-0000-000000000404', 'C3', 'New') $$,
  '23514', 'WOS_STATUS: a closed work order takes no new sections', 'AC-WOS-005 no new section on a closed work order');
select lives_ok($$ update public.work_order_sections set readiness = 'ready' where id = '25760000-0000-0000-0000-000000000b02' $$,
  'AC-WOS-005 a closed work order''s section still takes a readiness update');
select throws_ok($$ update public.work_order_sections set name = 'Edit' where id = '25760000-0000-0000-0000-000000000b02' $$,
  '23514', 'WOS_STATUS: a closed work order''s sections allow readiness and archive only', 'AC-WOS-005 but not an edit');
select lives_ok($$ update public.work_order_sections set archived_at = now() where id = '25760000-0000-0000-0000-000000000b03' $$,
  'AC-WOS-005 a closed work order''s section archives');

-- ── AC-WOS-007: delete ────────────────────────────────────────────────────────────────────────────────────
with d as (delete from public.work_order_sections where id = (select v from wos_ids where k = 'B') returning 1)
select is((select count(*)::int from d), 0, 'AC-WOS-007 a Project Manager''s delete removes nothing');
select pg_temp.act_as('25760000-0000-0000-0000-0000000000a1');
select throws_ok($$ delete from public.work_order_sections where id = (select v from wos_ids where k = 'B') $$,
  '23503', 'update or delete on table "work_order_sections" violates foreign key constraint "work_order_plan_lines_section_wo_fk" on table "work_order_plan_lines"',
  'AC-WOS-007 an Admin''s delete of a referenced section is blocked ("in use")');
select lives_ok($$ delete from public.work_order_sections where code = 'F' and work_order_id = '25760000-0000-0000-0000-000000000401' $$,
  'AC-WOS-007 an unreferenced section deletes');
select is((select count(*)::int from public.work_order_section_readiness_events where section_id is not null and section_id not in (select id from public.work_order_sections)), 0,
  'its readiness history goes with it');

-- ── AC-WOS-016: another organisation, no permission ──────────────────────────────────────────────────────
select pg_temp.act_as('25760000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.work_order_sections), 0, 'AC-WOS-016 another organisation reads no sections');
select is((select count(*)::int from public.work_order_section_rollup('25760000-0000-0000-0000-000000000401')), 0, 'AC-WOS-016 nor the roll-up');
select throws_ok($$ insert into public.work_order_sections (work_order_id, code, name) values ('25760000-0000-0000-0000-000000000401', 'X', 'Cross-org') $$,
  '23514', 'WOS_WO: the work order is not in your organisation', 'AC-WOS-016 another organisation''s Admin cannot add a section to this work order');
select throws_ok($$ select public.set_work_order_plan('25760000-0000-0000-0000-0000000000d1', '25760000-0000-0000-0000-000000000401', jsonb_build_array(
    jsonb_build_object('kind', 'direct_budget', 'value', '1.00'))) $$, 'P0002', 'work order not found', 'AC-WOS-016 nor write a plan figure');
select pg_temp.act_as('25760000-0000-0000-0000-0000000000a4');
select throws_ok($$ insert into public.work_order_sections (work_order_id, code, name) values ('25760000-0000-0000-0000-000000000401', 'X', 'Engineer') $$,
  '42501', 'new row violates row-level security policy for table "work_order_sections"', 'AC-WOS-016 an Engineer who is nobody''s foreman cannot add a section');
with u as (update public.work_order_sections set readiness = 'blocked' where id = (select v from wos_ids where k = 'A') returning 1)
select is((select count(*)::int from u), 0, 'AC-WOS-016 nor set readiness');
select is((select count(*)::int from public.work_order_sections), 8, 'but an Engineer reads the sections (read follows work-order read)');
select is((select direct_budget from public.work_order_section_rollup('25760000-0000-0000-0000-000000000401') where section_id is null), null::numeric,
  'a role that may not read plan figures sees them as absent');
reset role;
select is((select count(*)::int from information_schema.routine_privileges
            where routine_name = 'work_order_section_rollup' and grantee in ('anon', 'PUBLIC')), 0, 'anon cannot execute the roll-up');
select is((select count(*)::int from information_schema.role_table_grants
            where table_name in ('work_order_sections', 'work_order_section_readiness_events', 'work_order_section_readiness') and grantee = 'anon'), 0,
  'anon holds no grant on the section tables or view');

select * from finish();
rollback;
