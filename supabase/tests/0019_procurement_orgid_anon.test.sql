-- 0019_procurement_orgid_anon.test.sql
-- AC-814: org_id not client-supplied + anon-revoke.
--   • Finance INSERT into procurement_receipts supplying an explicit foreign org_id → 42501.
--   • anon role cannot execute transition_procurement (execute revoked).
--   • anon role cannot execute create_procurement_receipt (execute revoked).
--   • authenticated cannot DIRECTLY execute next_procurement_doc_number (HIGH-1: minter is an
--     internal-only helper; only the definer RPCs may mint, so a direct call must be denied).
begin;
select plan(4);

-- Fixtures (inserted as table owner).
insert into organizations (id, name) values
  ('00190000-0000-0000-0000-000000000001','Proc OrgId Org A'),
  ('00190000-0000-0000-0000-000000000002','Proc OrgId Org B');

insert into auth.users (id, email) values
  ('00190000-0000-0000-0000-0000000000a1','fin-orgid@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00190000-0000-0000-0000-0000000000a1','00190000-0000-0000-0000-000000000001','Fin OrgId','fin-orgid@example.com','Finance');

-- Org-A procurement (Finance user's org).
insert into procurements (id, org_id, title, status) values
  ('00190000-0000-0000-0000-000000000010','00190000-0000-0000-0000-000000000001',
   'OrgId Proc','Ordered');

-- ── T1: Finance supplies explicit foreign org_id on INSERT → 42501 ────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00190000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-814: org_id = org-B (foreign) supplied explicitly → RLS with check rejects it.
select throws_ok(
  $$ insert into procurement_receipts (org_id, procurement_id, status)
     values ('00190000-0000-0000-0000-000000000002',
             '00190000-0000-0000-0000-000000000010',
             'Partial') $$,
  '42501', null,
  'AC-814: explicit foreign org_id on receipt INSERT rejected by RLS with check (42501)');

reset role;

-- ── T2: anon cannot execute transition_procurement ────────────────────────────
set local role anon;

-- AC-814: anon has no execute grant on transition_procurement.
select throws_ok(
  $$ select transition_procurement('00190000-0000-0000-0000-000000000010','Received') $$,
  '42501', null,
  'AC-814: anon role cannot execute transition_procurement (execute revoked)');

-- AC-814: anon has no execute grant on create_procurement_receipt.
select throws_ok(
  $$ select create_procurement_receipt('00190000-0000-0000-0000-000000000010','Partial','2026-06-05') $$,
  '42501', null,
  'AC-814: anon role cannot execute create_procurement_receipt (execute revoked)');

reset role;

-- ── T3: authenticated cannot DIRECTLY execute next_procurement_doc_number (HIGH-1) ──
-- The minter is internal-only — only the security-definer RPCs may call it (they run as the
-- function owner and retain execute after the revoke). A direct authenticated call must be
-- denied (permission denied / 42501) so no user can write another org's counter or pick an
-- arbitrary prefix. The org argument is foreign here, but execute is revoked before org is read.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00190000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select next_procurement_doc_number('00190000-0000-0000-0000-000000000001','PR') $$,
  '42501', null,
  'AC-814/HIGH-1: authenticated cannot directly execute next_procurement_doc_number (internal-only minter, execute revoked)');

reset role;
select * from finish();
rollback;
