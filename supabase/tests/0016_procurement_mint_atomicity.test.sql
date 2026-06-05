-- 0016_procurement_mint_atomicity.test.sql
-- AC-811: transition atomicity + PR#/PO# minted in one atomic step.
-- Draft→Requested mints pr_number matching ^PR-\d{10}$; →Ordered mints po_number matching ^PO-\d{10}$.
begin;
select plan(6);

-- Fixtures (inserted as table owner).
insert into organizations (id, name) values
  ('00160000-0000-0000-0000-000000000001','Proc Atomicity Org');

insert into auth.users (id, email) values
  ('00160000-0000-0000-0000-0000000000a1','pm-atom@example.com'),
  ('00160000-0000-0000-0000-0000000000a2','fin-atom@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00160000-0000-0000-0000-0000000000a1','00160000-0000-0000-0000-000000000001','PM Atom','pm-atom@example.com','Project Manager'),
  ('00160000-0000-0000-0000-0000000000a2','00160000-0000-0000-0000-000000000001','Fin Atom','fin-atom@example.com','Finance');

-- Procurement in Draft with null pr_number (for AC-811 atomicity).
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00160000-0000-0000-0000-000000000010','00160000-0000-0000-0000-000000000001',
   'Proc Atomicity Draft','Draft','00160000-0000-0000-0000-0000000000a1');

-- ── Step 1: Draft → Requested (mints pr_number atomically) ───────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00160000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select transition_procurement('00160000-0000-0000-0000-000000000010','Requested') $$,
  'AC-811: Draft→Requested transition succeeds');

-- AC-811: status = Requested AND pr_number matches (atomic: no Requested with null pr_number).
select is(
  (select status::text from procurements where id = '00160000-0000-0000-0000-000000000010'),
  'Requested',
  'AC-811: status is Requested after Draft→Requested');

select matches(
  (select pr_number from procurements where id = '00160000-0000-0000-0000-000000000010'),
  '^PR-[0-9]{10}$',
  'AC-811: pr_number minted atomically matching ^PR-\d{10}$ on Draft→Requested (NFR-PROC-ATOM-001)');

reset role;

-- ── Step 2: Requested → Approved (Finance, non-requester) ────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00160000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select transition_procurement('00160000-0000-0000-0000-000000000010','Approved') $$,
  'AC-811: Requested→Approved succeeds (Finance non-requester, setup for Ordered step)');

-- ── Step 3: Approved → Ordered (Finance, mints po_number) ────────────────────
select lives_ok(
  $$ select transition_procurement('00160000-0000-0000-0000-000000000010','Ordered') $$,
  'AC-811: Approved→Ordered transition succeeds (mints po_number)');

-- AC-811: po_number minted on →Ordered matching ^PO-\d{10}$.
select matches(
  (select po_number from procurements where id = '00160000-0000-0000-0000-000000000010'),
  '^PO-[0-9]{10}$',
  'AC-811: po_number minted atomically matching ^PO-\d{10}$ on Approved→Ordered');

reset role;
select * from finish();
rollback;
