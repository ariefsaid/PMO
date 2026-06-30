-- agent_write_create_activity_rls.test.sql — RLS proof for the agent write-action path (A3).
-- AC-AW-009: crm_activities write is gated to Admin/Exec/PM/Finance; Engineer is denied.
--   R-A3-7 reconciliation: the spec incorrectly noted Engineer as MASTER_DATA writer for
--   crm_activities — AC-CRM-012 already proves this false. The plan's success case uses PM.
--
-- Assertions:
--   AC-AW-009-a  a PM in org A can INSERT a crm_activity on an org-A contact (success path).
--   AC-AW-009-b  that same PM's cross-org INSERT (org-B contact) is denied (42501,
--                parent-org guard — same as AC-CRM-010, proves the agent path inherits it).
--   AC-AW-009-c  an Engineer in org A INSERT is denied (42501, 4-role write gate —
--                same as AC-CRM-012, proves the role gate fires under the caller-JWT path).
--
-- The exact INSERT mirrors what createActivityAction.run executes:
--   ctx.supabase.from('crm_activities').insert({contact_id, kind, subject}).select().single()
-- No org_id is sent; the trigger stamps it from the parent contact (migration 0030).
-- RLS is the authority (ADR-0016/0019).
begin;
select plan(3);

-- ── Fixtures (inserted as table owner — bypasses RLS) ──────────────────────
-- Use a unique UUID namespace (00AW0009-…) to avoid collisions with other test files.
insert into organizations (id, name) values
  ('00aw0009-0000-0000-0000-000000000001','AW-009 Org A'),
  ('00aw0009-0000-0000-0000-000000000002','AW-009 Org B');

insert into auth.users (id, email) values
  ('00aw0009-0000-0000-0000-0000000000a1','aw009-pm-a@example.com'),
  ('00aw0009-0000-0000-0000-0000000000a2','aw009-eng-a@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00aw0009-0000-0000-0000-0000000000a1','00aw0009-0000-0000-0000-000000000001',
   'AW009 PM A','aw009-pm-a@example.com','Project Manager'),
  ('00aw0009-0000-0000-0000-0000000000a2','00aw0009-0000-0000-0000-000000000001',
   'AW009 Eng A','aw009-eng-a@example.com','Engineer');

-- A company + contact in each org (the activity's parent).
insert into companies (id, org_id, name, type) values
  ('00aw0009-0000-0000-0000-000000000050','00aw0009-0000-0000-0000-000000000001','AW009 Co A','Client'),
  ('00aw0009-0000-0000-0000-000000000051','00aw0009-0000-0000-0000-000000000002','AW009 Co B','Client');
insert into contacts (id, org_id, company_id, full_name) values
  ('00aw0009-0000-0000-0000-000000000060','00aw0009-0000-0000-0000-000000000001',
   '00aw0009-0000-0000-0000-000000000050','AW009 Contact A'),
  ('00aw0009-0000-0000-0000-000000000061','00aw0009-0000-0000-0000-000000000002',
   '00aw0009-0000-0000-0000-000000000051','AW009 Contact B');

-- ── AC-AW-009-a: PM in org A CAN INSERT a crm_activity on an org-A contact ──
-- This is the success path for createActivityAction.run under a PM caller JWT.
-- org_id is NOT sent — the BEFORE INSERT trigger inherits it from the parent contact.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00aw0009-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into crm_activities (contact_id, kind, subject)
       values ('00aw0009-0000-0000-0000-000000000060','Call','Agent-proposed follow-up') $$,
  'AC-AW-009-a: PM in org A can INSERT a crm_activity on an org-A contact (agent write path, org stamped from parent)');

-- ── AC-AW-009-b: PM cross-org INSERT (org-B contact) → 42501 (parent-org guard) ──
-- Proves the agent path cannot be used to write activities on another org's contacts.
select throws_ok(
  $$ insert into crm_activities (contact_id, kind, subject)
       values ('00aw0009-0000-0000-0000-000000000061','Email','Cross-org graft') $$,
  '42501', null,
  'AC-AW-009-b: PM cross-org INSERT on an org-B contact denied (42501, parent-org guard)');

reset role;

-- ── AC-AW-009-c: Engineer INSERT → 42501 (4-role write gate; not in MASTER_DATA for activities) ──
-- R-A3-7: Engineer is NOT in the crm_activities write gate (Admin/Exec/PM/Finance only).
-- This is the denied-role path for the agent under an Engineer caller JWT.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00aw0009-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ insert into crm_activities (contact_id, kind, subject)
       values ('00aw0009-0000-0000-0000-000000000060','Note','Engineer attempt') $$,
  '42501', null,
  'AC-AW-009-c: Engineer INSERT into crm_activities blocked (4-role write gate → 42501)');

reset role;

select finish();
rollback;
