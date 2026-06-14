-- 0073_crm_activity_rls.test.sql — RLS + the parent-org stamp trigger on crm_activities
-- (W3-CRM, migration 0030). Mirrors 0070_procurement_files_rls.test.sql: crm_activities is a
-- child of contacts whose org_id is inherited from the parent contact by a BEFORE INSERT trigger
-- when the client left it null / at the seed default, and whose write policy carries a
-- parent-org guard (the parent contact must be in the caller's org) + the 4-role writer gate.
--   AC-CRM-009  in-org PM can INSERT an activity on an in-org contact (org stamped from parent, no org_id sent).
--   AC-CRM-010  PM inserting an activity on an org-B contact → parent-org guard denies (42501).
--   AC-CRM-011  cross-org PM-B sees 0 crm_activities rows (RLS read denial / org isolation).
--   AC-CRM-012  Engineer (non-writer) INSERT → 42501 (4-role write gate).
--   AC-CRM-013  deleting the parent contact cascades — its crm_activities are gone.
-- Plus an explicit org_id=B spoof on an in-org parent is rejected by WITH CHECK (the trigger
-- preserves an explicitly-sent org_id, so the spoof still hits the org_id = auth_org_id() check).
begin;
select plan(6);

-- ── Fixtures (two orgs, inserted as table owner — bypasses RLS) ─────────────
insert into organizations (id, name) values
  ('00730000-0000-0000-0000-000000000001','CRM-Act Org A'),
  ('00730000-0000-0000-0000-000000000002','CRM-Act Org B');

insert into auth.users (id, email) values
  ('00730000-0000-0000-0000-0000000000a1','ca-pm-a@example.com'),
  ('00730000-0000-0000-0000-0000000000a2','ca-eng-a@example.com'),
  ('00730000-0000-0000-0000-0000000000b1','ca-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00730000-0000-0000-0000-0000000000a1','00730000-0000-0000-0000-000000000001','CA PM A','ca-pm-a@example.com','Project Manager'),
  ('00730000-0000-0000-0000-0000000000a2','00730000-0000-0000-0000-000000000001','CA Eng A','ca-eng-a@example.com','Engineer'),
  ('00730000-0000-0000-0000-0000000000b1','00730000-0000-0000-0000-000000000002','CA PM B','ca-pm-b@example.com','Project Manager');

-- A company + a contact per org (the activity's parent).
insert into companies (id, org_id, name, type) values
  ('00730000-0000-0000-0000-000000000050','00730000-0000-0000-0000-000000000001','CA Co A','Client'),
  ('00730000-0000-0000-0000-000000000051','00730000-0000-0000-0000-000000000002','CA Co B','Client');
insert into contacts (id, org_id, company_id, full_name) values
  ('00730000-0000-0000-0000-000000000060','00730000-0000-0000-0000-000000000001','00730000-0000-0000-0000-000000000050','CA Contact A'),
  ('00730000-0000-0000-0000-000000000061','00730000-0000-0000-0000-000000000002','00730000-0000-0000-0000-000000000051','CA Contact B');

-- ── AC-CRM-009: in-org PM inserts an activity on an in-org contact ───────────
-- org_id is NOT sent → the column default = seed org; the BEFORE INSERT trigger then inherits
-- the parent contact's org (A), so the *_write WITH CHECK (org_id = auth_org_id()) passes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00730000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into crm_activities (contact_id, kind, subject, body)
       values ('00730000-0000-0000-0000-000000000060','Call','Kickoff call','Discussed scope') $$,
  'AC-CRM-009: in-org PM can INSERT a crm_activity (org_id stamped from parent contact, never sent)');

-- ── AC-CRM-010: PM inserts an activity on an org-B contact → parent-org guard 42501 ──
-- org_id defaults to the seed; the trigger inherits org-B from the parent → WITH CHECK
-- (org_id = auth_org_id() = org-A) fails, AND the parent-org guard EXISTS clause fails.
select throws_ok(
  $$ insert into crm_activities (contact_id, kind, subject)
       values ('00730000-0000-0000-0000-000000000061','Email','Cross-org graft') $$,
  '42501', null,
  'AC-CRM-010: PM inserting an activity onto an org-B parent contact rejected (parent-org guard 42501)');

-- Stamp-trigger spoof rejection: an EXPLICIT org_id = B on an in-org parent is preserved by the
-- trigger (not silently rewritten) so the WITH CHECK (org_id = auth_org_id()) still rejects it.
select throws_ok(
  $$ insert into crm_activities (org_id, contact_id, kind, subject)
       values ('00730000-0000-0000-0000-000000000002','00730000-0000-0000-0000-000000000060','Note','org_id spoof') $$,
  '42501', null,
  'AC-CRM-010: explicit org_id=B spoof on an in-org parent is rejected by WITH CHECK (trigger preserves explicit org_id → 42501)');

reset role;

-- ── AC-CRM-011: cross-org PM-B sees 0 crm_activities rows ────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00730000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from crm_activities $$,
  $$ values (0) $$,
  'AC-CRM-011: cross-org PM-B sees 0 crm_activities rows (RLS read denial / org isolation)');
reset role;

-- ── AC-CRM-012: Engineer (non-writer) insert → 42501 (4-role write gate) ─────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00730000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ insert into crm_activities (contact_id, kind, subject)
       values ('00730000-0000-0000-0000-000000000060','Meeting','Eng attempt') $$,
  '42501', null,
  'AC-CRM-012: Engineer direct INSERT into crm_activities blocked (4-role write gate → 42501)');
reset role;

-- ── AC-CRM-013: deleting the parent contact cascades to its activities ───────
-- The AC-CRM-009 insert left one activity on contact A. Delete the parent (as owner, bypassing
-- RLS) then confirm the child activity rows are gone.
delete from contacts where id = '00730000-0000-0000-0000-000000000060';
select results_eq(
  $$ select count(*)::int from crm_activities where contact_id = '00730000-0000-0000-0000-000000000060' $$,
  $$ values (0) $$,
  'AC-CRM-013: deleting the parent contact cascades — its crm_activities are deleted');

select finish();
rollback;
