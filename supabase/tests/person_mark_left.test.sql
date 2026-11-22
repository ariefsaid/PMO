-- fix/walk-people item 1 (AC-PPL-LEFT-001..003): person_mark_left moves a person to former staff and ends their crew memberships.
-- Migration under test: 1610_person_mark_left.sql.
-- Boundary proof:
-- 1. Function definition, security definer, active-member and not-light assertions.
-- 2. Privileges: anon denied, authenticated granted.
-- 3. Authorization: only Admin may execute; Project Manager / non-Admin refused with 42501 PPL_FORBIDDEN.
-- 4. Validation: null date refused with 23514 PPL_DATE.
-- 5. Scope: person in other organisation or nonexistent person refused with 23514 PPL_NOT_FOUND.
-- 6. Date truth & exclusive crew roster boundary:
--    - Supplied concrete date sent unchanged to people.archived_at.
--    - Running placement is shortened so valid_to = p_left_on - 1:
--      on the day before, member remains active on crew roster;
--      on p_left_on (first day off roster), member is excluded from roster.
--    - Future scheduled placement (valid_from >= p_left_on) is deleted.
--    - Prior completed placement (valid_to < p_left_on) is preserved unchanged.
-- 7. Audit log: person.left event logged with left_on payload.
-- 8. Idempotency: calling person_mark_left a second time on former staff throws 23514 PPL_NOT_FOUND.
begin;
create extension if not exists pgtap;
select plan(18);

-- 1. Static checks & privileges
select has_function('public', 'person_mark_left', array['uuid', 'date'], 'AC-PPL-LEFT-001 the function exists');
select is((select prosecdef from pg_proc where proname = 'person_mark_left'), true, 'AC-PPL-LEFT-001 it is security definer');
select ok((select prosrc from pg_proc where proname = 'person_mark_left') like '%perform public.assert_is_active_member();%', 'AC-PPL-LEFT-001 it keeps the literal active-member assertion');
select ok((select prosrc from pg_proc where proname = 'person_mark_left') like '%perform public.assert_not_light();%', 'AC-PPL-LEFT-001 it keeps the light-account assertion');
select ok(not has_function_privilege('anon', 'public.person_mark_left(uuid, date)', 'execute'), 'AC-PPL-LEFT-002 anon cannot call it');
select ok(has_function_privilege('authenticated', 'public.person_mark_left(uuid, date)', 'execute'), 'AC-PPL-LEFT-002 an authenticated user can call it (the body is Admin-only)');

-- 2. Fixture setup
insert into organizations (id, name, default_currency) values
  ('16100000-0000-0000-0000-00000000000a', 'PPL Org',       'IDR'),
  ('16100000-0000-0000-0000-00000000000b', 'PPL Other Org', 'IDR');

insert into auth.users (id, email) values
  ('16100000-0000-0000-0000-0000000000a1', 'ppl-admin@example.com'),
  ('16100000-0000-0000-0000-0000000000a2', 'ppl-pm@example.com'),
  ('16100000-0000-0000-0000-0000000000b1', 'ppl-other@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('16100000-0000-0000-0000-0000000000a1', '16100000-0000-0000-0000-00000000000a', 'PPL Admin', 'ppl-admin@example.com', 'Admin',           'active'),
  ('16100000-0000-0000-0000-0000000000a2', '16100000-0000-0000-0000-00000000000a', 'PPL PM',    'ppl-pm@example.com',    'Project Manager', 'active'),
  ('16100000-0000-0000-0000-0000000000b1', '16100000-0000-0000-0000-00000000000b', 'PPL Other', 'ppl-other@example.com', 'Admin',           'active');

insert into people (id, org_id, kind, name, code) values
  ('16100000-0000-0000-0000-0000000000f1', '16100000-0000-0000-0000-00000000000a', 'own', 'Worker One',   'W-1610-1'),
  ('16100000-0000-0000-0000-0000000000f2', '16100000-0000-0000-0000-00000000000b', 'own', 'Other Worker', 'W-1610-2');

insert into crews (id, org_id, code, name) values
  ('16100000-0000-0000-0000-0000000000c1', '16100000-0000-0000-0000-00000000000a', 'CR-1610', 'Test Crew'),
  ('16100000-0000-0000-0000-0000000000c2', '16100000-0000-0000-0000-00000000000a', 'CR-1611', 'Future Crew');

-- Placements for Worker One:
-- m1: Past completed placement (Oct 1 - Oct 31, 2026)
-- m2: Running placement across left_on (Nov 1 - Dec 31, 2026)
-- m3: Future scheduled placement (Dec 10 - Dec 20, 2026)
insert into crew_members (id, org_id, crew_id, worker_id, valid_from, valid_to) values
  ('16100000-0000-0000-0000-0000000000m1', '16100000-0000-0000-0000-00000000000a', '16100000-0000-0000-0000-0000000000c1', '16100000-0000-0000-0000-0000000000f1', '2026-10-01', '2026-10-31'),
  ('16100000-0000-0000-0000-0000000000m2', '16100000-0000-0000-0000-00000000000a', '16100000-0000-0000-0000-0000000000c1', '16100000-0000-0000-0000-0000000000f1', '2026-11-01', '2026-12-31'),
  ('16100000-0000-0000-0000-0000000000m3', '16100000-0000-0000-0000-00000000000a', '16100000-0000-0000-0000-0000000000c2', '16100000-0000-0000-0000-0000000000f1', '2026-12-10', '2026-12-20');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;

-- 3. Authorization: non-Admin rejected
select pg_temp.act_as('16100000-0000-0000-0000-0000000000a2'); -- Project Manager
select throws_ok(
  $$ select public.person_mark_left('16100000-0000-0000-0000-0000000000f1', '2026-12-01'::date) $$,
  '42501',
  'PPL_FORBIDDEN: only an Admin marks a person as having left',
  'AC-PPL-LEFT-003 Project Manager cannot mark a person as left'
);

-- Switch to Admin
select pg_temp.act_as('16100000-0000-0000-0000-0000000000a1');

-- 4. Date validation
select throws_ok(
  $$ select public.person_mark_left('16100000-0000-0000-0000-0000000000f1', null::date) $$,
  '23514',
  'PPL_DATE: choose the day the person left',
  'AC-PPL-LEFT-003 null date is rejected'
);

-- 5. Scope / not found validation
select throws_ok(
  $$ select public.person_mark_left('16100000-0000-0000-0000-0000000000f2', '2026-12-01'::date) $$,
  '23514',
  'PPL_NOT_FOUND: the person was not found, or has already left',
  'AC-PPL-LEFT-003 person from another org cannot be marked as left'
);

-- 6. Execution with concrete date: '2026-12-01'
select lives_ok(
  $$ select public.person_mark_left('16100000-0000-0000-0000-0000000000f1', '2026-12-01'::date) $$,
  'AC-PPL-LEFT-003 Admin marks person as left on 2026-12-01'
);

-- Verify people.archived_at receives the exact supplied calendar date at UTC
select is(
  (select archived_at from public.people where id = '16100000-0000-0000-0000-0000000000f1'),
  '2026-12-01 00:00:00+00'::timestamptz,
  'AC-PPL-LEFT-003 archived_at matches the exact supplied date at UTC'
);

-- Verify running placement ending day: valid_to updated to 2026-11-30 (left_on - 1)
select is(
  (select valid_to from public.crew_members where id = '16100000-0000-0000-0000-0000000000m2'),
  '2026-11-30'::date,
  'AC-PPL-LEFT-003 running placement is closed on the day before departure (p_left_on - 1)'
);

-- Verify exclusive roster boundary:
-- On 2026-11-30 (day before), person IS in the crew roster
select is(
  (select count(*)::int from public.crew_members
   where worker_id = '16100000-0000-0000-0000-0000000000f1'
     and valid_from <= '2026-11-30' and (valid_to is null or valid_to >= '2026-11-30')),
  1,
  'AC-PPL-LEFT-003 person is active on crew roster on the day before departure (2026-11-30)'
);

-- On 2026-12-01 (first day off roster), person is EXCLUDED from the crew roster
select is(
  (select count(*)::int from public.crew_members
   where worker_id = '16100000-0000-0000-0000-0000000000f1'
     and valid_from <= '2026-12-01' and (valid_to is null or valid_to >= '2026-12-01')),
  0,
  'AC-PPL-LEFT-003 person is excluded from crew roster on the departure date (2026-12-01)'
);

-- Verify future placement was deleted (valid_from >= p_left_on)
select is(
  (select count(*)::int from public.crew_members where id = '16100000-0000-0000-0000-0000000000m3'),
  0,
  'AC-PPL-LEFT-003 future placement starting on or after departure date is deleted'
);

-- Verify past placement was preserved unchanged
select is(
  (select valid_to from public.crew_members where id = '16100000-0000-0000-0000-0000000000m1'),
  '2026-10-31'::date,
  'AC-PPL-LEFT-003 past completed placement is preserved unchanged'
);

-- 7. Audit log
reset role;
select is(
  (select count(*)::int from public.audit_events
   where action = 'person.left'
     and org_id = '16100000-0000-0000-0000-00000000000a'
     and entity_id = '16100000-0000-0000-0000-0000000000f1'
     and detail->>'left_on' = '2026-12-01'),
  1,
  'AC-PPL-LEFT-003 audit event logged with action person.left and left_on payload'
);

-- 8. Idempotency / already-left guard
set local role authenticated;
select pg_temp.act_as('16100000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select public.person_mark_left('16100000-0000-0000-0000-0000000000f1', '2026-12-01'::date) $$,
  '23514',
  'PPL_NOT_FOUND: the person was not found, or has already left',
  'AC-PPL-LEFT-003 already left person cannot be marked as left again'
);

select * from finish();
rollback;
