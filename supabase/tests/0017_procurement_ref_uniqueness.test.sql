-- 0017_procurement_ref_uniqueness.test.sql
-- AC-812: two PO numbers minted on the same org/day have distinct #### suffixes;
--         the first mint on a fresh day ends 0001 (daily reset).
-- Risk R3 from plan: reset procurement_doc_counters for today as table owner before the role switch
-- so the first mint is deterministic (ends 0001) regardless of prior rows in this txn.
begin;
select plan(9);

-- Fixtures (inserted as table owner).
insert into organizations (id, name) values
  ('00170000-0000-0000-0000-000000000001','Proc Uniqueness Org');

insert into auth.users (id, email) values
  ('00170000-0000-0000-0000-0000000000a1','pm-uniq@example.com'),
  ('00170000-0000-0000-0000-0000000000a2','fin-uniq@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00170000-0000-0000-0000-0000000000a1','00170000-0000-0000-0000-000000000001','PM Uniq','pm-uniq@example.com','Project Manager'),
  ('00170000-0000-0000-0000-0000000000a2','00170000-0000-0000-0000-000000000001','Fin Uniq','fin-uniq@example.com','Finance');

-- Two Draft procurements to be driven to Requested→Approved→Ordered (each mints a PO number).
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00170000-0000-0000-0000-000000000010','00170000-0000-0000-0000-000000000001',
   'Proc Uniq 1','Draft','00170000-0000-0000-0000-0000000000a1'),
  ('00170000-0000-0000-0000-000000000011','00170000-0000-0000-0000-000000000001',
   'Proc Uniq 2','Draft','00170000-0000-0000-0000-0000000000a1');

-- Risk R3: delete any existing PO counter row for today in this org so the first mint is 0001.
-- This runs as table owner (no RLS), ensuring determinism for the "ends 0001" assertion.
delete from procurement_doc_counters
  where org_id = '00170000-0000-0000-0000-000000000001'
    and prefix = 'PO'
    and doc_date = current_date;

-- ── Drive proc 1: Draft → Requested (mints PR) then → Approved → Ordered (mints PO) ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"00170000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select transition_procurement('00170000-0000-0000-0000-000000000010','Requested') $$,
  'AC-812: proc-1 Draft→Requested (setup)');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00170000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select transition_procurement('00170000-0000-0000-0000-000000000010','Approved') $$,
  'AC-812: proc-1 Requested→Approved (setup)');

select lives_ok(
  $$ select transition_procurement('00170000-0000-0000-0000-000000000010','Ordered') $$,
  'AC-812: proc-1 Approved→Ordered — mints first PO# (setup)');

reset role;

-- Capture po_number for proc-1 (as table owner, bypasses RLS for the read).
-- We reset role to superuser context for the read outside of the authenticated block.

-- ── Drive proc 2: Draft → Requested → Approved → Ordered (mints second PO) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00170000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select transition_procurement('00170000-0000-0000-0000-000000000011','Requested') $$,
  'AC-812: proc-2 Draft→Requested (setup)');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00170000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select transition_procurement('00170000-0000-0000-0000-000000000011','Approved') $$,
  'AC-812: proc-2 Requested→Approved (setup)');

select lives_ok(
  $$ select transition_procurement('00170000-0000-0000-0000-000000000011','Ordered') $$,
  'AC-812: proc-2 Approved→Ordered — mints second PO# (setup)');

reset role;

-- ── Assertions: po_a ≠ po_b; po_a ends 0001 (daily reset); po_b ends 0002 ────
-- Read as table owner (superuser context after reset role above).
select isnt(
  (select po_number from procurements where id = '00170000-0000-0000-0000-000000000010'),
  (select po_number from procurements where id = '00170000-0000-0000-0000-000000000011'),
  'AC-812: two PO numbers minted same org/day are distinct (no collision)');

select matches(
  (select po_number from procurements where id = '00170000-0000-0000-0000-000000000010'),
  '0001$',
  'AC-812: first PO# minted on a fresh day ends 0001 (daily reset, R3 counter seeded clean)');

select matches(
  (select po_number from procurements where id = '00170000-0000-0000-0000-000000000011'),
  '0002$',
  'AC-812: second PO# minted same day ends 0002 (sequential, no collision)');

select * from finish();
rollback;
