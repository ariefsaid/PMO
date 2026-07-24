-- 0151_timesheet_outbox_guard_acl.test.sql
-- AC-TSC-R7 (Luna SHOULD-FIX 5b) — THE MACHINE-ONLY GUARDS ARE PINNED MACHINE-ONLY.
--
-- Luna BLOCK 2: `insert_timesheet_outbox_pending` is SECURITY DEFINER over the policy-less outbox and
-- takes `p_org`, `p_payload` and `p_actor` as ARGUMENTS. While it was `grant execute … to authenticated`
-- ANY signed-in user could mint an outbox row over PostgREST with a forged org, forged hours and a
-- forged actor, under the deterministic `ts:<id>:<approved_at>` key — and the sweep DRIVES an existing
-- row without replacing its payload, so those forged hours would reach ERPNext. The status='Approved'
-- re-check does not help: the attacker's own approved sheet passes it.
--
-- That grant is revoked. This file exists so it can never come back silently: the new SQL tests
-- invoked the function AS THE TEST RUNNER, which is exactly the posture that cannot see an ACL bug.
-- Here the ACL is asserted directly AND exercised from an untrusted `authenticated` session.
begin;
select plan(9);

-- ── The ACL, as granted ────────────────────────────────────────────────────
select ok(
  not has_function_privilege('authenticated', 'public.insert_timesheet_outbox_pending(uuid,text,text,text,text,text,jsonb,text,uuid)', 'EXECUTE'),
  'AC-TSC-R7: `authenticated` CANNOT execute insert_timesheet_outbox_pending (⛔ do not re-add — forged org/payload/actor mint)');
select ok(
  not has_function_privilege('anon', 'public.insert_timesheet_outbox_pending(uuid,text,text,text,text,text,jsonb,text,uuid)', 'EXECUTE'),
  'AC-TSC-R7: `anon` CANNOT execute insert_timesheet_outbox_pending');
select ok(
  not has_function_privilege('public', 'public.insert_timesheet_outbox_pending(uuid,text,text,text,text,text,jsonb,text,uuid)', 'EXECUTE'),
  'AC-TSC-R7: PUBLIC has no execute on insert_timesheet_outbox_pending (the default grant is revoked)');
select ok(
  has_function_privilege('service_role', 'public.insert_timesheet_outbox_pending(uuid,text,text,text,text,text,jsonb,text,uuid)', 'EXECUTE'),
  'AC-TSC-R7: `service_role` (the served boundary + the sweep — its ONLY callers) CAN execute it');

-- The claim guard is re-created in 0151 §C; its 0096 machine-only ACL must survive that replacement
-- (a `create or replace` resets nothing, but a future re-edit could drop the revoke/grant pair).
select ok(
  not has_function_privilege('authenticated', 'public.claim_outbox_for_commit(uuid,interval)', 'EXECUTE'),
  'AC-TSC-R7: `authenticated` CANNOT execute claim_outbox_for_commit (re-created in 0151 §C — the ACL survived)');
select ok(
  has_function_privilege('service_role', 'public.claim_outbox_for_commit(uuid,interval)', 'EXECUTE'),
  'AC-TSC-R7: `service_role` CAN execute claim_outbox_for_commit');

-- The user-facing transition is the opposite case — it MUST stay reachable by a signed-in approver.
select ok(
  has_function_privilege('authenticated', 'public.transition_timesheet(uuid,timesheet_status,text)', 'EXECUTE'),
  'AC-TSC-R7: `authenticated` CAN still execute transition_timesheet (the re-open is a user action)');
select ok(
  not has_function_privilege('anon', 'public.transition_timesheet(uuid,timesheet_status,text)', 'EXECUTE'),
  'AC-TSC-R7: `anon` cannot execute transition_timesheet');

-- ── …and exercised, from an untrusted session ──────────────────────────────
-- The forged shape from the finding: someone else's org, an invented payload, an invented actor. It
-- must not even reach the function body (42501 at the ACL), let alone insert a row.
insert into organizations (id, name) values
  ('01517000-0000-0000-0000-000000000001','TS Guard ACL Org');
insert into auth.users (id, email) values
  ('01517000-0000-0000-0000-0000000000a1','guardacl-user@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01517000-0000-0000-0000-0000000000a1','01517000-0000-0000-0000-000000000001',
   'Ordinary U','guardacl-user@example.com','Engineer');
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01517000-0000-0000-0000-000000000010','01517000-0000-0000-0000-000000000001',
   '01517000-0000-0000-0000-0000000000a1','2026-06-01','Approved',
   '01517000-0000-0000-0000-0000000000a1', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"01517000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.insert_timesheet_outbox_pending(
       p_org:='01517000-0000-0000-0000-000000000001'::uuid,
       p_domain:='timesheets',
       p_record_id:='01517000-0000-0000-0000-000000000010',
       p_key:='ts-forged',
       p_tier:='erpnext',
       p_operation:='create',
       p_payload:='{"erp_doc_kind":"timesheet","entries":[{"project_id":"p","entry_date":"2026-06-01","hours":"999.00"}]}'::jsonb,
       p_digest:='forged',
       p_actor:='01517000-0000-0000-0000-0000000000a1'::uuid) $$,
  '42501', 'permission denied for function insert_timesheet_outbox_pending',
  'AC-TSC-R7: an ordinary authenticated caller cannot mint a forged outbox command (42501 at the ACL, before any check)');
reset role;

select * from finish();
rollback;
