-- 0156_release_outbox_hold.test.sql
-- AC-OBX-060 — `release_outbox_hold` (migration 0137 §4): THE ROUTE OUT OF `held`.
--
-- ⚑ WHY THIS EXISTS (money-safety audit round 5, HIGH-2). `held` is the ADR-0058 §4 terminal for a
-- recovery a machine must never resolve on its own (a mutable-anchor money doc whose absence is not
-- conclusive; a recovery reissue whose recorded actor is no longer authorized). Nothing anywhere moved a
-- row OUT of it — and `held` sits INSIDE `external_command_outbox_one_inflight_per_record`, so besides a
-- same-key retry throwing `command-held`, a NEW key for the same (org, domain, pmo_record_id) 23505s and
-- the dispatch answers 409 FOREVER. Concretely: an approver is offboarded mid-recovery ⇒ the week is
-- HELD; the org re-activates them, a manager reopens and re-approves the week (a new `approved_at` ⇒ a
-- new key) ⇒ every attempt 409s and that week's payroll costing never reaches the client's ERP. Two code
-- comments asserted an operator route out that did not exist. This is that route.
--
-- It releases to `failed`, NOT to a success or a re-drive: `failed` is outside the in-flight index (0134
-- B3) and inside both backstop queues (`outbox_reconcile_candidates`), so the ordinary bounded recovery
-- resumes and re-runs every gate from scratch. The RPC itself never touches ERP.
begin;
select plan(17);

-- ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01560000-0000-0000-0000-00000000000a','Hold Org A'),
  ('01560000-0000-0000-0000-00000000000b','Hold Org B');

insert into auth.users (id, email) values
  ('01560000-0000-0000-0000-0000000000a1','admin-hold@example.com'),
  ('01560000-0000-0000-0000-0000000000a2','finance-hold@example.com'),
  ('01560000-0000-0000-0000-0000000000a3','pm-hold@example.com'),
  ('01560000-0000-0000-0000-0000000000b1','admin-orgb-hold@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01560000-0000-0000-0000-0000000000a1','01560000-0000-0000-0000-00000000000a','Admin Hold','admin-hold@example.com','Admin'),
  ('01560000-0000-0000-0000-0000000000a2','01560000-0000-0000-0000-00000000000a','Finance Hold','finance-hold@example.com','Finance'),
  ('01560000-0000-0000-0000-0000000000a3','01560000-0000-0000-0000-00000000000a','PM Hold','pm-hold@example.com','Project Manager'),
  ('01560000-0000-0000-0000-0000000000b1','01560000-0000-0000-0000-00000000000b','Admin OrgB Hold','admin-orgb-hold@example.com','Admin');

-- The outbox is policy-less + machine-written; seed as owner (the dispatch/sweep service role's stand-in).
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, last_error)
values
  ('01560000-0000-0000-0000-0000000000f1','01560000-0000-0000-0000-00000000000a','timesheets','ts-held-1','ts:held-1:t0','erpnext','create','held',
   'recovery-reissue-unauthorized: the recorded actor is no longer active'),
  ('01560000-0000-0000-0000-0000000000f2','01560000-0000-0000-0000-00000000000a','budget','bud-held-1','bud:held-1:t0','erpnext','create','held','held'),
  ('01560000-0000-0000-0000-0000000000f3','01560000-0000-0000-0000-00000000000a','revenue','si-done-1','si:done-1:t0','erpnext','create','confirmed',null),
  ('01560000-0000-0000-0000-0000000000f4','01560000-0000-0000-0000-00000000000b','timesheets','ts-held-b','ts:held-b:t0','erpnext','create','held','held');

-- ── A) Non-Admin callers are refused ─────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01560000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select release_outbox_hold('01560000-0000-0000-0000-0000000000f1'::uuid, 'actor re-activated') $$,
  '42501', null,
  'AC-OBX-060: a Finance caller is refused — releasing a held money command is Admin-only');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01560000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select release_outbox_hold('01560000-0000-0000-0000-0000000000f1'::uuid, 'actor re-activated') $$,
  '42501', null,
  'AC-OBX-060: a Project Manager caller is refused — Admin-only');
reset role;

-- ── B) An Admin of ANOTHER org cannot release org A's held command ────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01560000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ select release_outbox_hold('01560000-0000-0000-0000-0000000000f1'::uuid, 'not mine') $$,
  '42501', null,
  'AC-OBX-060: a cross-org Admin is refused — SECURITY DEFINER re-asserts org internally (ADR-0011/0012)');
reset role;

select is((select state from external_command_outbox where id = '01560000-0000-0000-0000-0000000000f1'),
  'held', 'AC-OBX-060: the refused cross-org attempt left the row held');

-- ── C) A DISABLED Admin holding a still-valid JWT is refused (the 0128/0129/0130 offboarding gate) ─
update profiles set status = 'disabled' where id = '01560000-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"01560000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select release_outbox_hold('01560000-0000-0000-0000-0000000000f1'::uuid, 'offboarded admin') $$,
  '42501', null,
  'AC-OBX-060: a DISABLED Admin with a still-valid JWT is refused 42501 (offboarding gate)');
reset role;
update profiles set status = 'active' where id = '01560000-0000-0000-0000-0000000000a1';

-- ── D) A row that is not `held` is never resurrected ──────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01560000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select release_outbox_hold('01560000-0000-0000-0000-0000000000f3'::uuid, 'oops') $$,
  'P0001', null,
  'AC-OBX-060: a CONFIRMED command cannot be "released" — only a held row has a hold to release');
select throws_ok(
  $$ select release_outbox_hold('01560000-0000-0000-0000-0000000000ff'::uuid, 'nope') $$,
  'P0002', null,
  'AC-OBX-060: an unknown outbox id is a not-found, never a silent no-op');
reset role;

-- ── E) An in-org, active Admin releases: held → failed, with the reason + actor recorded ──────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01560000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select release_outbox_hold('01560000-0000-0000-0000-0000000000f1'::uuid, 'approver re-activated; safe to re-drive') $$,
  'AC-OBX-060: an in-org active Admin releases the hold');
reset role;

select is((select state from external_command_outbox where id = '01560000-0000-0000-0000-0000000000f1'),
  'failed',
  'AC-OBX-060: the row lands in `failed` — outside the one-in-flight index and inside the backstop queues, so the ORDINARY bounded recovery owns it (never a fabricated success)');

select ok(
  (select last_error from external_command_outbox where id = '01560000-0000-0000-0000-0000000000f1')
    like '%released by operator%',
  'AC-OBX-060: the release is recorded in last_error — an operator-cleared hold must never look like a spontaneous recovery');

select ok(
  (select last_error from external_command_outbox where id = '01560000-0000-0000-0000-0000000000f1')
    like '%approver re-activated; safe to re-drive%',
  'AC-OBX-060: the operator''s own stated reason is recorded verbatim');

-- The whole point: the released row is a reconcile candidate again.
select is(
  (select count(*)::int from outbox_reconcile_candidates('01560000-0000-0000-0000-00000000000a'::uuid)
     where id = '01560000-0000-0000-0000-0000000000f1'),
  1,
  'AC-OBX-060: the released row is a reconcile candidate again — the backstop can finally re-drive it');

-- …and a NEW key for the same PMO record no longer 23505s on the one-in-flight index (the concrete
-- wedge: a re-approved week derives a NEW key and every attempt answered 409 forever).
select lives_ok(
  $$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
     values ('01560000-0000-0000-0000-00000000000a','timesheets','ts-held-1','ts:held-1:t1','erpnext','create','pending') $$,
  'AC-OBX-060: a NEW key for the same PMO record now inserts — the permanent 409 wedge is gone');

-- ── F) Exactly one audit row, naming the releasing Admin + the released command ───────────────────
select is(
  (select count(*)::int from audit_events
     where action = 'release_outbox_hold'
       and actor_id = '01560000-0000-0000-0000-0000000000a1'
       and entity_id = '01560000-0000-0000-0000-0000000000f1'),
  1,
  'AC-OBX-060: the release writes exactly one audit_events row naming the Admin who cleared it');

select ok(
  (select detail->>'reason' from audit_events
     where action = 'release_outbox_hold' and entity_id = '01560000-0000-0000-0000-0000000000f1')
    = 'approver re-activated; safe to re-drive',
  'AC-OBX-060: the audit row carries the operator''s stated reason (a money-command hold is cleared BY someone, FOR a reason)');

-- ── G) ACL: the RPC is not callable by anon ──────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.release_outbox_hold(uuid, text)', 'execute'),
  'AC-OBX-060: anon may not execute release_outbox_hold');
select ok(
  has_function_privilege('authenticated', 'public.release_outbox_hold(uuid, text)', 'execute'),
  'AC-OBX-060: authenticated may execute it (the Admin gate is INSIDE the function — the ADR-0011/0012 pattern)');

select * from finish();
rollback;
