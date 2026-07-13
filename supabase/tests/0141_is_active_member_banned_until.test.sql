-- 0141_is_active_member_banned_until.test.sql
-- ADR-0057 Task-3 capstone (mig 0095): is_active_member() now also honors auth.users.banned_until.
-- Proves a caller whose profiles.status='active' but who is banned out-of-band (banned_until in the
-- FUTURE) is treated as INACTIVE — denied reads + writes at RLS on every is_active_member-gated
-- table — while a non-banned active caller and a caller whose ban has EXPIRED (banned_until in the
-- past) stay fully active (no lock-out regression).
begin;
select plan(7);

-- ── Fixtures: org, and three status='active' members differing only by banned_until. ──
insert into organizations (id, name) values
  ('01410000-0000-0000-0000-000000000001','AC-JWT-095 Org');
insert into auth.users (id, email, banned_until) values
  ('01410000-0000-0000-0000-0000000000a1','jwt095-ok@example.com',      null),                 -- A: not banned
  ('01410000-0000-0000-0000-0000000000a2','jwt095-banned@example.com',  now() + interval '1 year'), -- B: raw-banned (future)
  ('01410000-0000-0000-0000-0000000000a3','jwt095-expired@example.com', now() - interval '1 day');   -- C: ban expired (past)
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01410000-0000-0000-0000-0000000000a1','01410000-0000-0000-0000-000000000001','A Ok','jwt095-ok@example.com','Admin','active'),
  ('01410000-0000-0000-0000-0000000000a2','01410000-0000-0000-0000-000000000001','B Banned','jwt095-banned@example.com','Engineer','active'),
  ('01410000-0000-0000-0000-0000000000a3','01410000-0000-0000-0000-000000000001','C Expired','jwt095-expired@example.com','Engineer','active');

-- Seed a business row AS TABLE OWNER (bypassing RLS) so "0 rows" is a real deny, not an empty table.
insert into projects (id, org_id, name, status, project_manager_id) values
  ('01410000-0000-0000-0000-0000000b0001','01410000-0000-0000-0000-000000000001','P','Internal Project','01410000-0000-0000-0000-0000000000a1');
insert into notifications (id, org_id, owner_id, title) values
  ('01410000-0000-0000-0000-000000130001','01410000-0000-0000-0000-000000000001','01410000-0000-0000-0000-0000000000a2','N');

-- ── B: status='active' but banned_until in the FUTURE → is_active_member() false → denied. ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01410000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.is_active_member(), false, 'AC-JWT-095 raw-banned (future banned_until) → is_active_member() false');
select is((select count(*)::int from projects), 0, 'AC-JWT-095 raw-banned reads 0 projects (RLS deny)');
select throws_ok(
  $$ insert into notifications (org_id, owner_id, title) values ('01410000-0000-0000-0000-000000000001','01410000-0000-0000-0000-0000000000a2','N2') $$,
  '42501', null,
  'AC-JWT-095 raw-banned notifications INSERT denied (WITH CHECK conjunct)');
reset role;

-- ── A: not banned → is_active_member() true → reads normally (control: deny is ban-scoped). ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01410000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.is_active_member(), true, 'AC-JWT-095 non-banned active → is_active_member() true');
select is((select count(*)::int from projects), 1, 'AC-JWT-095 non-banned active reads 1 project (control)');
reset role;

-- ── C: ban EXPIRED (banned_until in the past) → still active (no lock-out regression). ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01410000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(public.is_active_member(), true, 'AC-JWT-095 expired ban (past banned_until) → is_active_member() true (not locked out)');
select is((select count(*)::int from projects), 1, 'AC-JWT-095 expired-ban member reads 1 project (no regression)');
reset role;

select * from finish();
rollback;
