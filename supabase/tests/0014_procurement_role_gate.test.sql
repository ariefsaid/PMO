-- 0014_procurement_role_gate.test.sql
-- AC-808: role gate on transitions — Engineer cannot Approve; Finance (non-requester) can.
begin;
select plan(3);

-- Fixtures (inserted as table owner).
insert into organizations (id, name) values
  ('00140000-0000-0000-0000-000000000001','Proc Role Gate Org');

insert into auth.users (id, email) values
  ('00140000-0000-0000-0000-0000000000a1','eng-rgate@example.com'),
  ('00140000-0000-0000-0000-0000000000a2','pm-rgate@example.com'),
  ('00140000-0000-0000-0000-0000000000a3','fin-rgate@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00140000-0000-0000-0000-0000000000a1','00140000-0000-0000-0000-000000000001','Eng RGate','eng-rgate@example.com','Engineer'),
  ('00140000-0000-0000-0000-0000000000a2','00140000-0000-0000-0000-000000000001','PM RGate','pm-rgate@example.com','Project Manager'),
  ('00140000-0000-0000-0000-0000000000a3','00140000-0000-0000-0000-000000000001','Fin RGate','fin-rgate@example.com','Finance');

-- A procurement in Requested status; requester is the PM (not the Finance user who will approve).
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00140000-0000-0000-0000-000000000010','00140000-0000-0000-0000-000000000001',
   'Proc Requested RGate','Requested','00140000-0000-0000-0000-0000000000a2');

-- ── T1: Engineer cannot Approve ──────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00140000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-808: Engineer calling Requested→Approved → 42501.
select throws_ok(
  $$ select transition_procurement('00140000-0000-0000-0000-000000000010','Approved') $$,
  '42501', null,
  'AC-808: Engineer cannot Approve a Requested procurement (role gate 42501)');

reset role;

-- ── T2: Finance user (non-requester) CAN Approve ─────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00140000-0000-0000-0000-0000000000a3","role":"authenticated"}';

-- AC-808: Finance (not the requester) calling Requested→Approved → succeeds.
select lives_ok(
  $$ select transition_procurement('00140000-0000-0000-0000-000000000010','Approved') $$,
  'AC-808: Finance (non-requester) can Approve a Requested procurement (lives_ok)');

-- Confirm status is now Approved.
select is(
  (select status::text from procurements where id = '00140000-0000-0000-0000-000000000010'),
  'Approved',
  'AC-808: status is Approved after Finance transition');

reset role;
select * from finish();
rollback;
