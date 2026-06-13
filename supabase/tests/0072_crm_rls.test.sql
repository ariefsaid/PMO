-- 0072_crm_rls.test.sql — the CRM contacts RLS write contract (W3-CRM, migration 0030).
-- Mirrors 0051_companies_crud.test.sql: contacts is a top-level master-data entity whose
-- org_id is column-defaulted (NOT trigger-stamped) and whose writer set = the 4 master-data
-- roles (Admin/Executive/Project Manager/Finance), with a RESTRICTIVE Admin-only DELETE policy.
-- The contacts_write policy additionally carries a parent-org guard: the referenced company
-- must be in the caller's org.
--   AC-CRM-001  in-org PM can INSERT a contact (org_id defaulted from auth_org_id(), never sent).
--   AC-CRM-002  in-org PM can UPDATE a contact in its own org.
--   AC-CRM-003  in-org PM can archive a contact (set archived_at) — and it persists.
--   AC-CRM-004  Engineer (non-writer) INSERT is denied by WITH CHECK → 42501.
--   AC-CRM-005  Engineer UPDATE is a silent 0-row no-op (USING hides the row).
--   AC-CRM-006  cross-org PM-B sees 0 contact rows (RLS read denial / org isolation).
--   AC-CRM-007  Admin hard-delete of a contact cascades — its crm_activities are gone too.
--   AC-CRM-008  PM-B hard-delete of an org-A contact is a 0-row no-op (Admin-only DELETE + USING).
-- RLS is the enforcement authority; the FE can() gating is a clarity projection only.
begin;
select plan(12);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
-- Org-A is the DEFAULT org ('00000000-…-0001') so a write-role there satisfies the
-- contacts_write WITH CHECK (org_id = auth_org_id()) WITHOUT sending org_id — exactly the
-- production createContact() path. Org-B is the cross-org attacker.
insert into organizations (id, name) values
  ('00720000-0000-0000-0000-000000000002','CRM Org B');

insert into auth.users (id, email) values
  ('00720000-0000-0000-0000-0000000000a1','crm-pm@example.com'),
  ('00720000-0000-0000-0000-0000000000a2','crm-eng@example.com'),
  ('00720000-0000-0000-0000-0000000000a3','crm-admin@example.com'),
  ('00720000-0000-0000-0000-0000000000b1','crm-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00720000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','CRM PM','crm-pm@example.com','Project Manager'),
  ('00720000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','CRM Eng','crm-eng@example.com','Engineer'),
  ('00720000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','CRM Admin','crm-admin@example.com','Admin'),
  ('00720000-0000-0000-0000-0000000000b1','00720000-0000-0000-0000-000000000002','CRM PM B','crm-pm-b@example.com','Project Manager');

-- A company per org (contacts.company_id is NOT NULL FK).
insert into companies (id, org_id, name, type) values
  ('00720000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000001','CRM Co A','Client'),
  ('00720000-0000-0000-0000-000000000051','00720000-0000-0000-0000-000000000002','CRM Co B','Client');

-- An org-A contact the Engineer / cross-org user will try (and fail) to UPDATE, plus one
-- the Admin will cascade-delete (with an activity attached).
insert into contacts (id, org_id, company_id, full_name) values
  ('00720000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000001','00720000-0000-0000-0000-000000000050','Locked Contact'),
  ('00720000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000001','00720000-0000-0000-0000-000000000050','Cascade Contact');
-- An activity on the cascade contact, to prove AC-CRM-007 (cascade) at the contacts layer.
insert into crm_activities (id, org_id, contact_id, kind, subject) values
  ('00720000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000001','00720000-0000-0000-0000-000000000061','Call','Cascade me');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-CRM-004/005: Engineer (non-writer) — run FIRST so baselines are untouched.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00720000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- AC-CRM-004: Engineer INSERT denied by contacts_write WITH CHECK (role not in the 4 writers) → 42501.
select throws_ok(
  $$ insert into contacts (company_id, full_name)
       values ('00720000-0000-0000-0000-000000000050','Eng Contact') $$,
  '42501', null,
  'AC-CRM-004: Engineer cannot INSERT a contact (contacts_write WITH CHECK role gate → 42501)');

-- AC-CRM-005: Engineer UPDATE runs without error but USING hides the row → 0-row no-op.
select lives_ok(
  $$ update contacts set full_name = 'Eng Renamed'
       where id = '00720000-0000-0000-0000-000000000060' $$,
  'AC-CRM-005: Engineer UPDATE contacts runs without error (USING hides the row → RLS no-op)');

reset role;

-- Confirm the Engineer changed nothing: name unchanged.
select is(
  (select full_name from contacts where id = '00720000-0000-0000-0000-000000000060'),
  'Locked Contact',
  'AC-CRM-005: Engineer UPDATE affected 0 rows (name unchanged)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-CRM-006: cross-org read isolation — org-B PM sees 0 org-A contacts.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00720000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select results_eq(
  $$ select count(*)::int from contacts $$,
  $$ values (0) $$,
  'AC-CRM-006: cross-org PM-B sees 0 contact rows (RLS read denial / org isolation)');

-- AC-CRM-008: PM-B hard-delete of an org-A contact is a silent 0-row no-op (Admin-only DELETE
-- + USING hides the row). DELETE has no WITH CHECK, so the denial is a no-op, not 42501.
select lives_ok(
  $$ delete from contacts where id = '00720000-0000-0000-0000-000000000060' $$,
  'AC-CRM-008: PM-B DELETE of an org-A contact runs without error (Admin-only DELETE + USING → RLS no-op)');

reset role;

-- Confirm the PM-B delete affected nothing: the row still exists.
select ok(
  (select exists (select 1 from contacts where id = '00720000-0000-0000-0000-000000000060')),
  'AC-CRM-008: PM-B DELETE affected 0 rows (Locked Contact still present)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-CRM-001/002/003: the in-org PM (a write-role) does the real CRUD.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00720000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-CRM-001: PM can INSERT a contact. org_id is NOT sent — the column default + auth_org_id() stamp org-A.
select lives_ok(
  $$ insert into contacts (company_id, full_name, title, email)
       values ('00720000-0000-0000-0000-000000000050','PM Created Contact','Buyer','pm@example.com') $$,
  'AC-CRM-001: a write-role (PM) can INSERT a contact (org_id defaulted, never sent)');

-- AC-CRM-002: PM can UPDATE a contact in its own org.
select lives_ok(
  $$ update contacts set full_name = 'Locked Contact (Renamed)', title = 'Lead'
       where id = '00720000-0000-0000-0000-000000000060' $$,
  'AC-CRM-002: a write-role (PM) can UPDATE a contact in its own org');

-- AC-CRM-003: PM can archive a contact (set archived_at).
select lives_ok(
  $$ update contacts set archived_at = now()
       where id = '00720000-0000-0000-0000-000000000060' $$,
  'AC-CRM-003: a write-role (PM) can archive a contact (set archived_at)');

reset role;

-- AC-CRM-001: confirm the PM's INSERT landed in the caller's (default) org (org_id was defaulted, not spoofable).
select is(
  (select org_id::text from contacts where full_name = 'PM Created Contact'),
  '00000000-0000-0000-0000-000000000001',
  'AC-CRM-001: the PM-inserted contact is stamped with the caller''s org (org_id column default)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-CRM-007: ADMIN hard-delete cascades to crm_activities.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00720000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ delete from contacts where id = '00720000-0000-0000-0000-000000000061' $$,
  'AC-CRM-007: Admin hard-delete of a contact succeeds (Admin-only DELETE policy)');

reset role;

-- AC-CRM-007: confirm the cascade removed the child activity too.
select results_eq(
  $$ select count(*)::int from crm_activities where contact_id = '00720000-0000-0000-0000-000000000061' $$,
  $$ values (0) $$,
  'AC-CRM-007: deleting a contact cascades — its crm_activities are deleted');

select * from finish();
rollback;
