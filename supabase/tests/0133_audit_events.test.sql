-- 0133_audit_events.test.sql — durable audit trail for security-sensitive events
-- (audit finding C-3, CRITICAL). Proves:
--   (a) a gated RPC / policy-gated destructive-delete SUCCESS writes a durable audit_events row
--       with the correct org_id / actor_id / action (+ the key change captured in `detail`);
--   (b) SELECT is scoped to the caller's OWN org AND to Admin/Operator only — a non-admin in-org
--       user and ANY cross-org user read ZERO;
--   (c) audit_events is append-only — no authenticated or anon role may INSERT/UPDATE/DELETE
--       directly (the security-definer log_audit() is the SOLE write path).
--
-- Mechanism coverage (BOTH wiring patterns proven):
--   • RPC `perform log_audit(...)` on the success path — proven via operator_grant_credits (credit
--     grant), set_project_contract_value (value SoD), transition_document_status (approval SoD).
--   • AFTER DELETE trigger → log_audit() for policy-gated destructive deletes — proven via the
--     companies (0013) and projects (0052) Admin-only hard-deletes (no RPC exists for these; the
--     trigger is the only behavior-preserving way to record them without changing the authz policy).
begin;
select plan(28);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────
-- Org A + Org B; an org-A Admin, an org-A Engineer, a cross-org (org-B) Admin, and a platform
-- Operator whose home org is A. Inserted as the migration runner (superuser → bypasses RLS).
insert into organizations (id, name) values
  ('a133a000-0000-0000-0000-000000000001','AC-AUDIT Org A'),
  ('a133a000-0000-0000-0000-000000000002','AC-AUDIT Org B');
insert into auth.users (id, email) values
  ('a133a000-0000-0000-0000-0000000000a1','audit-a-admin@example.com'),
  ('a133a000-0000-0000-0000-0000000000a2','audit-a-engineer@example.com'),
  ('a133a000-0000-0000-0000-0000000000b1','audit-b-admin@example.com'),
  ('a133a000-0000-0000-0000-0000000000cf','audit-operator@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('a133a000-0000-0000-0000-0000000000a1','a133a000-0000-0000-0000-000000000001','A Admin','audit-a-admin@example.com','Admin','active'),
  ('a133a000-0000-0000-0000-0000000000a2','a133a000-0000-0000-0000-000000000001','A Engineer','audit-a-engineer@example.com','Engineer','active'),
  ('a133a000-0000-0000-0000-0000000000b1','a133a000-0000-0000-0000-000000000002','B Admin','audit-b-admin@example.com','Admin','active'),
  ('a133a000-0000-0000-0000-0000000000cf','a133a000-0000-0000-0000-000000000001','Operator','audit-operator@example.com','Admin','active');
insert into platform_operators (user_id) values ('a133a000-0000-0000-0000-0000000000cf');

-- Business rows in Org A (superuser insert → bypasses RLS): a pre-win project P1 (value-set target),
-- a document D1 on P1 (transition target, authored by the Engineer so the approver differs), a
-- standalone company C1 (delete target), and a standalone project P2 (delete target).
insert into projects (id, org_id, name, status, contract_value) values
  ('a133a000-0000-0000-0000-0000000000p1','a133a000-0000-0000-0000-000000000001','P1 value-set','Leads',0),
  ('a133a000-0000-0000-0000-0000000000p2','a133a000-0000-0000-0000-000000000001','P2 delete','Leads',0);
insert into companies (id, org_id, name, type) values
  ('a133a000-0000-0000-0000-0000000000c1','a133a000-0000-0000-0000-000000000001','C1 delete','Client');
insert into project_documents (id, org_id, project_id, category, title, status, author_id) values
  ('a133a000-0000-0000-0000-0000000000d1','a133a000-0000-0000-0000-000000000001','a133a000-0000-0000-0000-0000000000p1','Contract','Doc one','Draft','a133a000-0000-0000-0000-0000000000a2');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Structural: table + FORCE RLS + exactly one (SELECT) policy + the log_audit() helper exists.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
select has_table('public','audit_events','AC-AUDIT-000 audit_events table exists');
select ok((select relforcerowsecurity from pg_class where relname = 'audit_events'),
  'AC-AUDIT-000 audit_events has FORCE ROW LEVEL SECURITY');
select is((select count(*)::int from pg_policies where tablename = 'audit_events'), 1,
  'AC-AUDIT-000 audit_events has exactly ONE policy (SELECT only — no I/U/D policy, append-only)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'log_audit'), 1,
  'AC-AUDIT-000 log_audit() helper exists in public');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (a) Gated RPC / destructive-delete SUCCESS writes a durable audit_events row.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Operator grants credits to Org A (own org).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a133a000-0000-0000-0000-0000000000cf","role":"authenticated"}';
select lives_ok(
  $$ select operator_grant_credits('a133a000-0000-0000-0000-000000000001', 100, 'audit test grant') $$,
  'AC-AUDIT-001 operator_grant_credits succeeds (Operator grants own-org credits)');

-- Org-A Admin: set P1 contract value (pre-win → Admin allowed), transition D1 Draft→Issued,
-- hard-delete C1 and P2 (Admin-only destructive deletes gated by 0013/0052 restrictive policies).
set local request.jwt.claims = '{"sub":"a133a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('a133a000-0000-0000-0000-0000000000p1', 5000) $$,
  'AC-AUDIT-002 set_project_contract_value succeeds (Admin sets pre-win value)');
select lives_ok(
  $$ select transition_document_status('a133a000-0000-0000-0000-0000000000d1', 'Issued') $$,
  'AC-AUDIT-003 transition_document_status succeeds (Admin Draft→Issued)');
select lives_ok(
  $$ delete from companies where id = 'a133a000-0000-0000-0000-0000000000c1' $$,
  'AC-AUDIT-004 Admin hard-deletes company C1');
select lives_ok(
  $$ delete from projects where id = 'a133a000-0000-0000-0000-0000000000p2' $$,
  'AC-AUDIT-005 Admin hard-deletes project P2');
reset role;

-- Assert the five audit rows (read as superuser → bypasses RLS). Each captures org/actor/action
-- and the key change in `detail`.
select is((select count(*)::int from audit_events where action = 'credits.grant'), 1,
  'AC-AUDIT-001a credits.grant wrote exactly one audit row');
select is((select (array_agg(org_id))[1] from audit_events where action = 'credits.grant'),
  'a133a000-0000-0000-0000-000000000001'::uuid,
  'AC-AUDIT-001b credits.grant row stamped with the caller org (Org A)');
select is((select (array_agg(actor_id))[1] from audit_events where action = 'credits.grant'),
  'a133a000-0000-0000-0000-0000000000cf'::uuid,
  'AC-AUDIT-001c credits.grant row records the Operator actor');
select is((select (detail ->> 'amount')::numeric from audit_events where action = 'credits.grant'), 100,
  'AC-AUDIT-001d credits.grant detail captures the granted amount');

select is((select count(*)::int from audit_events where action = 'project.contract_value.set'
            and entity_id = 'a133a000-0000-0000-0000-0000000000p1'), 1,
  'AC-AUDIT-002a contract-value set wrote one audit row for P1');
select is((select (detail ->> 'from')::numeric from audit_events where action = 'project.contract_value.set'), 0,
  'AC-AUDIT-002b contract-value detail captures the OLD value');
select is((select (detail ->> 'to')::numeric from audit_events where action = 'project.contract_value.set'), 5000,
  'AC-AUDIT-002c contract-value detail captures the NEW value');

select is((select count(*)::int from audit_events where action = 'project_document.transition'
            and entity_id = 'a133a000-0000-0000-0000-0000000000d1'), 1,
  'AC-AUDIT-003a document transition wrote one audit row for D1');
select is((select (detail ->> 'from') || '→' || (detail ->> 'to')
            from audit_events where action = 'project_document.transition'), 'Draft→Issued',
  'AC-AUDIT-003b transition detail captures from→to');

select is((select count(*)::int from audit_events where action = 'company.delete'
            and entity_id = 'a133a000-0000-0000-0000-0000000000c1'), 1,
  'AC-AUDIT-004 company hard-delete wrote one audit row (AFTER DELETE trigger)');
select is((select (array_agg(actor_id))[1] from audit_events where action = 'company.delete'),
  'a133a000-0000-0000-0000-0000000000a1'::uuid,
  'AC-AUDIT-004b company.delete row records the Admin actor');

select is((select count(*)::int from audit_events where action = 'project.delete'
            and entity_id = 'a133a000-0000-0000-0000-0000000000p2'), 1,
  'AC-AUDIT-005 project hard-delete wrote one audit row (AFTER DELETE trigger)');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (b) SELECT scoping: own-org Admin/Operator only. A non-admin in-org user reads ZERO; any
--     cross-org user reads ZERO.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"a133a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from audit_events), 5,
  'AC-AUDIT-006 Org-A Admin reads all 5 own-org audit rows');

set local request.jwt.claims = '{"sub":"a133a000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from audit_events), 0,
  'AC-AUDIT-007 Org-A Engineer (non-admin) reads ZERO audit rows (Admin/Operator only)');

set local request.jwt.claims = '{"sub":"a133a000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from audit_events), 0,
  'AC-AUDIT-008 Org-B Admin (cross-org) reads ZERO of Org A (no cross-org leak)');
reset role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (c) Append-only: no authenticated or anon role may INSERT/UPDATE/DELETE directly.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"a133a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into audit_events (action, entity_type) values ('forged','x') $$,
  '42501', null,
  'AC-AUDIT-009 authenticated INSERT denied (no INSERT policy → append-only)');
select throws_ok(
  $$ update audit_events set action = 'forged' $$,
  '42501', null,
  'AC-AUDIT-010 authenticated UPDATE denied (no UPDATE grant → append-only, privilege-denied)');
select throws_ok(
  $$ delete from audit_events $$,
  '42501', null,
  'AC-AUDIT-011 authenticated DELETE denied (no DELETE grant → append-only, privilege-denied)');
reset role;

set local role anon;
select throws_ok(
  $$ insert into audit_events (action, entity_type) values ('forged','x') $$,
  '42501', null,
  'AC-AUDIT-012 anon INSERT denied (append-only)');
reset role;

select * from finish();
rollback;
