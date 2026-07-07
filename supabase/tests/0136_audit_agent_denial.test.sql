-- 0136_audit_agent_denial.test.sql — durable audit trail for agent AUTHORIZATION REFUSALS
-- (audit Observability-High #1). Proves the 0079 wrapper RPC:
--   (a) an authenticated ACTIVE member call writes exactly ONE audit_events row with
--       action='agent.permission_denied', org_id/actor_id stamped from the live JWT, and the
--       caller's p_reason + p_detail merged into `detail`;
--   (b) the caller CANNOT forge org/actor — even when p_detail carries forged `org_id`/
--       `actor_id` keys, the row's org_id/actor_id columns come from the JWT (auth_org_id()/
--       auth.uid()), not from p_detail (the forged values survive only as annotation in detail);
--   (c) an INACTIVE member is rejected by the is_active_member() guard → 42501, no row;
--   (d) anon (execute granted to authenticated ONLY) → 42501, no row.
--
-- Mechanism: the wrapper is SECURITY DEFINER (postgres owner) so it may call log_audit() (0076,
-- the sole writer) despite log_audit being granted to no client role; log_audit's own definer
-- INSERT then bypasses audit_events' FORCE RLS + absent INSERT policy. The row is readable by
-- 0076's existing SELECT policy (own-org Admin/Operator) — no new policy.
begin;
select plan(19);

-- ── Fixtures (mirror 0133's style; fresh a136… UUIDs to avoid collision) ─────────────────────
-- Org A (the caller's org) + Org B (a distinct org used as the FORGED org_id value). An org-A
-- Admin (active — the caller) and an org-A Admin (inactive — the guard target). Inserted as the
-- migration runner (superuser → bypasses RLS).
insert into organizations (id, name) values
  ('a136a000-0000-0000-0000-000000000001','AC-AGENTDENY Org A'),
  ('a136a000-0000-0000-0000-000000000002','AC-AGENTDENY Org B');
insert into auth.users (id, email) values
  ('a136a000-0000-0000-0000-0000000000a1','agentdeny-a-admin@example.com'),
  ('a136a000-0000-0000-0000-0000000000a2','agentdeny-a-inactive@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('a136a000-0000-0000-0000-0000000000a1','a136a000-0000-0000-0000-000000000001','A Admin','agentdeny-a-admin@example.com','Admin','active'),
  ('a136a000-0000-0000-0000-0000000000a2','a136a000-0000-0000-0000-000000000001','A Inactive','agentdeny-a-inactive@example.com','Admin','disabled');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Structural: the wrapper exists in public and is SECURITY DEFINER (the property that lets it
-- call log_audit despite log_audit being granted to no client role).
-- ══════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'audit_agent_denial'), 1,
  'AC-AGENTDENY-000 audit_agent_denial() wrapper exists in public');
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'audit_agent_denial'),
  'AC-AGENTDENY-000b audit_agent_denial() is SECURITY DEFINER (may call log_audit)');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (a) An authenticated ACTIVE member call writes exactly ONE audit_events row with the correct
--     action + JWT-stamped org/actor + the caller's p_reason/p_detail merged into `detail`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"a136a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select audit_agent_denial('sod_violation', '{"tool":"create_activity","action":"create","entity":"contactActivity"}'::jsonb) $$,
  'AC-AGENTDENY-001 authenticated active member call succeeds (granted to authenticated)');
reset role;

select is((select count(*)::int from audit_events
            where action = 'agent.permission_denied' and detail->>'reason' = 'sod_violation'), 1,
  'AC-AGENTDENY-001a the call wrote exactly ONE audit_events row');
select is((select (array_agg(org_id))[1] from audit_events where detail->>'reason' = 'sod_violation'),
  'a136a000-0000-0000-0000-000000000001'::uuid,
  'AC-AGENTDENY-001b row org_id stamped from the JWT (caller org A)');
select is((select (array_agg(actor_id))[1] from audit_events where detail->>'reason' = 'sod_violation'),
  'a136a000-0000-0000-0000-0000000000a1'::uuid,
  'AC-AGENTDENY-001c row actor_id stamped from the JWT (caller uid)');
select is((select detail->>'reason' from audit_events where detail->>'reason' = 'sod_violation'),
  'sod_violation',
  'AC-AGENTDENY-001d detail carries the caller reason');
select is((select detail->>'tool' from audit_events where detail->>'reason' = 'sod_violation'),
  'create_activity',
  'AC-AGENTDENY-001e caller p_detail merged into detail (tool annotation preserved)');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (b) Non-forgeable identity: even with forged org_id/actor_id stuffed into p_detail, the row's
--     org_id/actor_id COLUMNS come from the JWT. The forged values survive ONLY as annotation.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"a136a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select audit_agent_denial('prompt_injection_attempt',
       '{"tool":"create_activity","org_id":"a136a000-0000-0000-0000-000000000002","actor_id":"a136a000-0000-0000-0000-00000000dead"}'::jsonb) $$,
  'AC-AGENTDENY-002 call with forged org/actor in p_detail still succeeds');
reset role;

select is((select count(*)::int from audit_events where detail->>'reason' = 'prompt_injection_attempt'), 1,
  'AC-AGENTDENY-002a the forge call wrote exactly ONE row');
select is((select (array_agg(org_id))[1] from audit_events where detail->>'reason' = 'prompt_injection_attempt'),
  'a136a000-0000-0000-0000-000000000001'::uuid,
  'AC-AGENTDENY-002b row org_id = caller org A, NOT the forged org B (identity non-forgeable)');
select is((select (array_agg(actor_id))[1] from audit_events where detail->>'reason' = 'prompt_injection_attempt'),
  'a136a000-0000-0000-0000-0000000000a1'::uuid,
  'AC-AGENTDENY-002c row actor_id = caller uid, NOT the forged uid (identity non-forgeable)');
select is((select detail->>'org_id' from audit_events where detail->>'reason' = 'prompt_injection_attempt'),
  'a136a000-0000-0000-0000-000000000002',
  'AC-AGENTDENY-002d the forged org_id survives only as detail annotation (ignored for the column)');
select is((select detail->>'actor_id' from audit_events where detail->>'reason' = 'prompt_injection_attempt'),
  'a136a000-0000-0000-0000-00000000dead',
  'AC-AGENTDENY-002e the forged actor_id survives only as detail annotation (ignored for the column)');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (c) Inactive member → is_active_member() guard raises 42501; no row written.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"a136a000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select audit_agent_denial('inactive_attempt', '{"tool":"create_activity"}'::jsonb) $$,
  '42501', null,
  'AC-AGENTDENY-003 inactive member rejected by the is_active_member() guard (42501)');
reset role;
select is((select count(*)::int from audit_events where detail->>'reason' = 'inactive_attempt'), 0,
  'AC-AGENTDENY-003a no audit row written for the inactive member');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (d) anon (execute granted to authenticated ONLY) → 42501 at the privilege check; no row.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
set local role anon;
select throws_ok(
  $$ select audit_agent_denial('anon_attempt', '{"tool":"create_activity"}'::jsonb) $$,
  '42501', null,
  'AC-AGENTDENY-004 anon denied (execute granted to authenticated only)');
reset role;
select is((select count(*)::int from audit_events where detail->>'reason' = 'anon_attempt'), 0,
  'AC-AGENTDENY-004a no audit row written for anon');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Integrity: exactly the two successful member writes landed (the inactive + anon calls wrote
-- nothing). audit_events started empty (transactional fixture).
-- ══════════════════════════════════════════════════════════════════════════════════════════════
select is((select count(*)::int from audit_events where action = 'agent.permission_denied'), 2,
  'AC-AGENTDENY-005 exactly two permission_denied rows total (the two member writes; guard/anon wrote none)');

select * from finish();
rollback;
