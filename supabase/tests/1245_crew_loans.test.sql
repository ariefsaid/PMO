-- 1245_crew_loans.test.sql — #2704 (docs/specs/crew-loan.spec.md). Migrations under test: 1245 to 1249.
-- AC-LOAN-001 effective crew by date · AC-LOAN-002 roster · AC-LOAN-003 attendance follows the host crew ·
-- AC-LOAN-004 overlap refused · AC-LOAN-005 approved hours never move · AC-LOAN-006 no loan, no change ·
-- AC-LOAN-007 crew and placement validity · AC-LOAN-008 who writes, who reads · AC-LOAN-009 archive blocked ·
-- setting crew_loans_enabled (on by default, Admin only).
begin;
create extension if not exists pgtap;
select plan(49);

insert into organizations (id, name, default_currency) values
  ('27040000-0000-0000-0000-00000000000a', 'LOAN Org',       'IDR'),
  ('27040000-0000-0000-0000-00000000000b', 'LOAN Other Org', 'IDR');
create temp table loan_today as select public.equipment_org_today('27040000-0000-0000-0000-00000000000a') as d;
grant select on loan_today to authenticated;
create or replace function pg_temp.today() returns date language sql stable as $$ select d from loan_today $$;
insert into auth.users (id, email) values
  ('27040000-0000-0000-0000-0000000000a1', 'loan-admin@example.com'),
  ('27040000-0000-0000-0000-0000000000a2', 'loan-exec@example.com'),
  ('27040000-0000-0000-0000-0000000000a3', 'loan-pm@example.com'),
  ('27040000-0000-0000-0000-0000000000a4', 'loan-fca@example.com'),
  ('27040000-0000-0000-0000-0000000000a5', 'loan-fcb@example.com'),
  ('27040000-0000-0000-0000-0000000000a6', 'loan-eng@example.com'),
  ('27040000-0000-0000-0000-0000000000b1', 'loan-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27040000-0000-0000-0000-0000000000a1', '27040000-0000-0000-0000-00000000000a', 'LOAN Admin', 'loan-admin@example.com', 'Admin', 'active'),
  ('27040000-0000-0000-0000-0000000000a2', '27040000-0000-0000-0000-00000000000a', 'LOAN Exec',  'loan-exec@example.com',  'Executive', 'active'),
  ('27040000-0000-0000-0000-0000000000a3', '27040000-0000-0000-0000-00000000000a', 'LOAN PM',    'loan-pm@example.com',    'Project Manager', 'active'),
  ('27040000-0000-0000-0000-0000000000a4', '27040000-0000-0000-0000-00000000000a', 'LOAN FC A',  'loan-fca@example.com',   'Engineer', 'active'),
  ('27040000-0000-0000-0000-0000000000a5', '27040000-0000-0000-0000-00000000000a', 'LOAN FC B',  'loan-fcb@example.com',   'Engineer', 'active'),
  ('27040000-0000-0000-0000-0000000000a6', '27040000-0000-0000-0000-00000000000a', 'LOAN Eng',   'loan-eng@example.com',   'Engineer', 'active'),
  ('27040000-0000-0000-0000-0000000000b1', '27040000-0000-0000-0000-00000000000b', 'LOAN XOrg',  'loan-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('27040000-0000-0000-0000-0000000000d1', '27040000-0000-0000-0000-00000000000a', 'LOAN Site', 'Ongoing Project', '27040000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27040000-0000-0000-0000-000000000401', '27040000-0000-0000-0000-00000000000a', '27040000-0000-0000-0000-0000000000d1', 'LOAN WO home', 'Issued', 1000, 'exclusive', 0),
  ('27040000-0000-0000-0000-000000000402', '27040000-0000-0000-0000-00000000000a', '27040000-0000-0000-0000-0000000000d1', 'LOAN WO host', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('27040000-0000-0000-0000-000000000c01', '27040000-0000-0000-0000-00000000000a', 'LN-A', 'Home crew',  '27040000-0000-0000-0000-0000000000a4'),
  ('27040000-0000-0000-0000-000000000c02', '27040000-0000-0000-0000-00000000000a', 'LN-B', 'Host crew',  '27040000-0000-0000-0000-0000000000a5'),
  ('27040000-0000-0000-0000-000000000c03', '27040000-0000-0000-0000-00000000000a', 'LN-C', 'Third crew', null),
  ('27040000-0000-0000-0000-000000000c04', '27040000-0000-0000-0000-00000000000a', 'LN-D', 'Fourth crew', null),
  ('27040000-0000-0000-0000-000000000c05', '27040000-0000-0000-0000-00000000000a', 'LN-E', 'Fifth crew', null),
  ('27040000-0000-0000-0000-0000000000c0', '27040000-0000-0000-0000-00000000000b', 'LN-X', 'Foreign crew', null);
update crews set archived_at = now() where id = '27040000-0000-0000-0000-000000000c05';
insert into people (id, org_id, kind, name, profile_id) values
  ('27040000-0000-0000-0000-000000000f01', '27040000-0000-0000-0000-00000000000a', 'vendor', 'Lent Worker',  null),
  ('27040000-0000-0000-0000-000000000f02', '27040000-0000-0000-0000-00000000000a', 'vendor', 'Stays Worker', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('27040000-0000-0000-0000-00000000000a', '27040000-0000-0000-0000-000000000c01', '27040000-0000-0000-0000-000000000f01', pg_temp.today() - 40),
  ('27040000-0000-0000-0000-00000000000a', '27040000-0000-0000-0000-000000000c01', '27040000-0000-0000-0000-000000000f02', pg_temp.today() - 40);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('27040000-0000-0000-0000-00000000000a', '27040000-0000-0000-0000-000000000401', '27040000-0000-0000-0000-000000000c01', pg_temp.today() - 40),
  ('27040000-0000-0000-0000-00000000000a', '27040000-0000-0000-0000-000000000402', '27040000-0000-0000-0000-000000000c02', pg_temp.today() - 40);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.d(p int) returns date language sql stable as $$ select pg_temp.today() + p $$;

-- Before any loan: nothing changes (AC-LOAN-006).
set local role authenticated;
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a3');
select is(worker_effective_crew('27040000-0000-0000-0000-000000000f01', pg_temp.d(-4)), '27040000-0000-0000-0000-000000000c01'::uuid,
  'AC-LOAN-006 with no loan the effective crew is the placement');
select is((select m::text from work_order_roster('27040000-0000-0000-0000-000000000401', pg_temp.d(-4)) r, jsonb_array_elements(r.members) m
            where m->>'display_name' = 'Lent Worker'), '{"worker_id": "27040000-0000-0000-0000-000000000f01", "display_name": "Lent Worker", "off_rotation": false, "standard_role_id": null}',
  'AC-LOAN-006 with no loan a roster member has exactly the pre-loan shape (no on_loan key)');
select is(worker_effective_crew('27040000-0000-0000-0000-000000000f01', pg_temp.d(-60)), null::uuid, 'a date before any placement has no crew');

-- AC-LOAN-001: loan days -5 to -3 to the host crew.
select lives_ok($$ insert into crew_loans (id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-0000000001a1', '27040000-0000-0000-0000-000000000f01', '27040000-0000-0000-0000-000000000c01',
   '27040000-0000-0000-0000-000000000c02', pg_temp.d(-5), pg_temp.d(-3)) $$, 'AC-LOAN-001 a manager lends a worker to another crew');
select is(worker_effective_crew('27040000-0000-0000-0000-000000000f01', pg_temp.d(-4)), '27040000-0000-0000-0000-000000000c02'::uuid,
  'AC-LOAN-001 inside the loan the effective crew is the host');
select is(worker_effective_crew('27040000-0000-0000-0000-000000000f01', pg_temp.d(-5)), '27040000-0000-0000-0000-000000000c02'::uuid, 'AC-LOAN-001 the first day is on loan');
select is(worker_effective_crew('27040000-0000-0000-0000-000000000f01', pg_temp.d(-3)), '27040000-0000-0000-0000-000000000c02'::uuid, 'AC-LOAN-001 the last day is on loan');
select is(worker_effective_crew('27040000-0000-0000-0000-000000000f01', pg_temp.d(-6)), '27040000-0000-0000-0000-000000000c01'::uuid, 'AC-LOAN-001 the day before is the home crew');
select is(worker_effective_crew('27040000-0000-0000-0000-000000000f01', pg_temp.d(-2)), '27040000-0000-0000-0000-000000000c01'::uuid, 'AC-LOAN-001 the day after is the home crew');
select is(worker_effective_crew('27040000-0000-0000-0000-000000000f02', pg_temp.d(-4)), '27040000-0000-0000-0000-000000000c01'::uuid, 'AC-LOAN-001 another worker is unaffected');

-- AC-LOAN-002: the roster.
select is((select count(*)::int from work_order_roster('27040000-0000-0000-0000-000000000402', pg_temp.d(-4)) r, jsonb_array_elements(r.members) m
            where m->>'worker_id' = '27040000-0000-0000-0000-000000000f01' and m->>'on_loan' = 'true'
              and m->'standard_role_id' = 'null'::jsonb), 1,
  'AC-LOAN-002 the host crew roster lists the worker, on loan, with no standard role');
select is((select count(*)::int from work_order_roster('27040000-0000-0000-0000-000000000401', pg_temp.d(-4)) r, jsonb_array_elements(r.members) m
            where m->>'worker_id' = '27040000-0000-0000-0000-000000000f01'), 0, 'AC-LOAN-002 the home crew roster does not list the worker on a loan day');
select is((select count(*)::int from work_order_roster('27040000-0000-0000-0000-000000000401', pg_temp.d(-4)) r, jsonb_array_elements(r.members) m
            where m->>'worker_id' = '27040000-0000-0000-0000-000000000f02'), 1, 'AC-LOAN-002 the home crew keeps its other worker');
select is((select count(*)::int from work_order_roster('27040000-0000-0000-0000-000000000401', pg_temp.d(-6)) r, jsonb_array_elements(r.members) m
            where m->>'worker_id' = '27040000-0000-0000-0000-000000000f01'), 1, 'AC-LOAN-002 outside the loan the home roster lists the worker again');
select is((select count(*)::int from work_order_roster('27040000-0000-0000-0000-000000000402', pg_temp.d(-6)) r, jsonb_array_elements(r.members) m
            where m->>'worker_id' = '27040000-0000-0000-0000-000000000f01'), 0, 'AC-LOAN-002 outside the loan the host roster does not list the worker');

-- AC-LOAN-003: attendance follows the host crew.
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a4');
select throws_ok($$ select attendance_record('27040000-0000-0000-0000-000000000401', pg_temp.d(-4), 'roster_tick',
  '[{"worker_id": "27040000-0000-0000-0000-000000000f01", "status": "present", "hours": 8}]') $$,
  '23514', 'ATT_NOT_ROSTERED: this person is not in a crew rostered on this work order that day',
  'AC-LOAN-003 hours cannot be recorded on the home crew''s work order on a loan day');
select throws_ok($$ select attendance_record('27040000-0000-0000-0000-000000000402', pg_temp.d(-4), 'roster_tick',
  '[{"worker_id": "27040000-0000-0000-0000-000000000f01", "status": "present", "hours": 8}]') $$,
  '42501', 'not authorized', 'AC-LOAN-003 the home crew''s controller cannot record the loaned worker on the host crew');
select lives_ok($$ select attendance_record('27040000-0000-0000-0000-000000000401', pg_temp.d(-6), 'roster_tick',
  '[{"worker_id": "27040000-0000-0000-0000-000000000f01", "status": "present", "hours": 8}]') $$,
  'AC-LOAN-003 outside the loan the home crew records the worker as before');
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a5');
select is(attendance_record('27040000-0000-0000-0000-000000000402', pg_temp.d(-4), 'roster_tick',
  '[{"worker_id": "27040000-0000-0000-0000-000000000f01", "status": "present", "hours": 7}]'), 1,
  'AC-LOAN-003 the host crew''s controller records the loaned worker on the host work order');
select is((select crew_id from attendance_days where worker_id = '27040000-0000-0000-0000-000000000f01' and work_date = pg_temp.d(-4)),
  '27040000-0000-0000-0000-000000000c02'::uuid, 'AC-LOAN-003 the record carries the host crew and its work order');
select throws_ok($$ select attendance_record('27040000-0000-0000-0000-000000000402', pg_temp.d(-6), 'roster_tick',
  '[{"worker_id": "27040000-0000-0000-0000-000000000f01", "status": "present", "hours": 7}]') $$,
  '23514', 'ATT_NOT_ROSTERED: this person is not in a crew rostered on this work order that day',
  'AC-LOAN-003 outside the loan the host work order does not take the worker');

-- AC-LOAN-004 / 008: overlap, roles.
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a2');
select throws_ok($$ insert into crew_loans (worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-000000000f01', '27040000-0000-0000-0000-000000000c01', '27040000-0000-0000-0000-000000000c03', pg_temp.d(-3), pg_temp.d(-1)) $$,
  '23P01', null, 'AC-LOAN-004 a loan overlapping another loan of the worker is refused, to any crew');
select lives_ok($$ insert into crew_loans (id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-0000000001a2', '27040000-0000-0000-0000-000000000f01', '27040000-0000-0000-0000-000000000c01',
   '27040000-0000-0000-0000-000000000c03', pg_temp.d(-2), pg_temp.d(-1)) $$, 'AC-LOAN-004 the next day is accepted (and an Executive may lend)');
select throws_ok($$ update crew_loans set valid_to = pg_temp.d(-2) where id = '27040000-0000-0000-0000-0000000001a1' $$ ,
  '23P01', null, 'AC-LOAN-004 a change that makes two loans overlap is refused');
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a6');
select throws_ok($$ insert into crew_loans (worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-000000000f02', '27040000-0000-0000-0000-000000000c01', '27040000-0000-0000-0000-000000000c02', pg_temp.d(2), pg_temp.d(3)) $$,
  '42501', null, 'AC-LOAN-008 an Engineer cannot lend');
select is((select count(*)::int from crew_loans), 2, 'AC-LOAN-008 every active member reads the loans');
select pg_temp.act_as('27040000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from crew_loans), 0, 'AC-LOAN-008 another organisation reads nothing');
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a3');
select lives_ok($$ delete from crew_loans where id = '27040000-0000-0000-0000-0000000001a2' $$, 'a Project Manager''s delete runs');
select is((select count(*)::int from crew_loans where id = '27040000-0000-0000-0000-0000000001a2'), 1, 'AC-LOAN-008 but deletes nothing: delete is Admin only');
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a1');
select lives_ok($$ delete from crew_loans where id = '27040000-0000-0000-0000-0000000001a2' $$, 'AC-LOAN-008 an Admin deletes a loan');

-- AC-LOAN-007: crew and placement validity.
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into crew_loans (worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-000000000f02', '27040000-0000-0000-0000-000000000c01', '27040000-0000-0000-0000-000000000c01', pg_temp.d(2), pg_temp.d(3)) $$,
  '23514', null, 'AC-LOAN-007 host equal to home is refused');
select throws_ok($$ insert into crew_loans (worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-000000000f02', '27040000-0000-0000-0000-000000000c03', '27040000-0000-0000-0000-000000000c02', pg_temp.d(2), pg_temp.d(3)) $$,
  '23514', 'LOAN_HOME: the person must be placed in the home crew for the whole loan period', 'AC-LOAN-007 a home crew the worker is not placed in is refused');
select throws_ok($$ insert into crew_loans (worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-000000000f02', '27040000-0000-0000-0000-000000000c01', '27040000-0000-0000-0000-000000000c05', pg_temp.d(2), pg_temp.d(3)) $$,
  '23514', 'LOAN_CREW: both crews must be live crews of this organisation', 'AC-LOAN-007 an archived host crew is refused');
select throws_ok($$ insert into crew_loans (worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-000000000f02', '27040000-0000-0000-0000-000000000c01', '27040000-0000-0000-0000-0000000000c0', pg_temp.d(2), pg_temp.d(3)) $$,
  '23514', 'LOAN_CREW: both crews must be live crews of this organisation', 'AC-LOAN-007 another organisation''s crew is refused');
select throws_ok($$ insert into crew_loans (worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-000000000f02', '27040000-0000-0000-0000-000000000c01', '27040000-0000-0000-0000-000000000c02', pg_temp.d(3), pg_temp.d(2)) $$,
  '23514', null, 'AC-LOAN-007 an end before the start is refused');

-- AC-LOAN-009: a crew with a current or future loan is not archived.
select lives_ok($$ insert into crew_loans (id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-0000000001a3', '27040000-0000-0000-0000-000000000f02', '27040000-0000-0000-0000-000000000c01',
   '27040000-0000-0000-0000-000000000c04', pg_temp.d(2), pg_temp.d(4)) $$, 'a future loan to the fourth crew');
select throws_ok($$ update crews set archived_at = now() where id = '27040000-0000-0000-0000-000000000c04' $$,
  '23514', 'CRW_ARCHIVE_IN_USE: end this crew''s current and future loans first', 'AC-LOAN-009 the host crew cannot be archived while it has a loan');

-- AC-LOAN-005: hours already submitted or approved never move (rows written by the owner, as the approval path does).
reset role;
insert into attendance_days (org_id, worker_id, work_order_id, project_id, crew_id, work_date, status, hours, source, approved_at, locked_at)
  values ('27040000-0000-0000-0000-00000000000a', '27040000-0000-0000-0000-000000000f01', '27040000-0000-0000-0000-000000000401',
          '27040000-0000-0000-0000-0000000000d1', '27040000-0000-0000-0000-000000000c01', pg_temp.d(-20), 'present', 8, 'roster_tick', now(), now());
set local role authenticated;
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into crew_loans (worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-000000000f01', '27040000-0000-0000-0000-000000000c01', '27040000-0000-0000-0000-000000000c02', pg_temp.d(-21), pg_temp.d(-19)) $$,
  '23514', null, 'AC-LOAN-005 a loan cannot be made over an approved day');
select lives_ok($$ insert into crew_loans (id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('27040000-0000-0000-0000-0000000001a4', '27040000-0000-0000-0000-000000000f01', '27040000-0000-0000-0000-000000000c01',
   '27040000-0000-0000-0000-000000000c02', pg_temp.d(-12), pg_temp.d(-10)) $$, 'a loan over days with no approved hours is accepted');
select throws_ok($$ update crew_loans set valid_from = pg_temp.d(-20) where id = '27040000-0000-0000-0000-0000000001a4' $$,
  '23514', null, 'AC-LOAN-005 extending a loan over an approved day is refused');
reset role;
insert into attendance_days (org_id, worker_id, work_order_id, project_id, crew_id, work_date, status, hours, source, submitted_at)
  values ('27040000-0000-0000-0000-00000000000a', '27040000-0000-0000-0000-000000000f01', '27040000-0000-0000-0000-000000000402',
          '27040000-0000-0000-0000-0000000000d1', '27040000-0000-0000-0000-000000000c02', pg_temp.d(-11), 'present', 8, 'roster_tick', now());
set local role authenticated;
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a3');
select lives_ok($$ update crew_loans set valid_to = pg_temp.d(-11) where id = '27040000-0000-0000-0000-0000000001a4' $$,
  'AC-LOAN-005 shortening a loan so that no submitted day changes crew is accepted');
select throws_ok($$ update crew_loans set valid_from = pg_temp.d(-10), valid_to = pg_temp.d(-10) where id = '27040000-0000-0000-0000-0000000001a4' $$,
  '23514', null, 'AC-LOAN-005 a change that moves a submitted day to another crew is refused');
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a1');
select throws_ok($$ delete from crew_loans where id = '27040000-0000-0000-0000-0000000001a4' $$,
  '23514', null, 'AC-LOAN-005 deleting a loan over a submitted day is refused');
reset role;
select is((select count(*)::int from attendance_days where worker_id = '27040000-0000-0000-0000-000000000f01' and work_date in (pg_temp.d(-20), pg_temp.d(-11))
             and hours = 8), 2, 'AC-LOAN-005 the approved and submitted hours are unchanged');

-- The setting: off by default; only an Admin turns it on.
select is((select crew_loans_enabled from organizations where id = '27040000-0000-0000-0000-00000000000a'), true, 'crew_loans_enabled is on by default');
update organizations set crew_loans_enabled = false where id = '27040000-0000-0000-0000-00000000000a';
select is((select crew_loans_enabled from organizations where id = '27040000-0000-0000-0000-00000000000a'), false, 'crew_loans_enabled reads off once switched off');
set local role authenticated;
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a3');
select throws_ok($$ select set_org_crew_loans_enabled(true) $$, '42501', 'only an Admin can change crew loans', 'a Project Manager cannot change the setting');
select pg_temp.act_as('27040000-0000-0000-0000-0000000000a1');
select is(set_org_crew_loans_enabled(true), true, 'an Admin turns crew loans on');
select is((select crew_loans_enabled from organizations where id = '27040000-0000-0000-0000-00000000000a'), true, 'the setting reads back');

select * from finish();
rollback;
