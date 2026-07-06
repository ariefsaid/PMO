-- 0118_credits_enforced_org_pool.test.sql
-- AC-CRE-003 [pgTAP, SINGLE OWNER]: AGENT_CREDITS_ENFORCED meters the ORG pool. The guard-equivalent
-- `org_credit_balance(org) <= 0` returns the IDENTICAL exceeded result for EVERY member of the org
-- (regardless of which member fired it) — the deputy invariant under org-pool (FR-CRE-004). An
-- Operator grant flips it for everyone at once. (The guard's JS branch — exceeded = balance <= 0 +
-- the reason field — is exercised by the mocked vitest in S2-C, a shape test, NOT the owner.)
begin;
select plan(5);

-- ── Fixtures: org X with two active members (A, B) and a seeded Operator. ──
insert into organizations (id, name) values
  ('01180000-0000-0000-0000-000000000001','AC-CRE-003 Org X');
insert into auth.users (id, email) values
  ('01180000-0000-0000-0000-0000000000a1','cre003-a@example.com'),
  ('01180000-0000-0000-0000-0000000000a2','cre003-b@example.com'),
  ('01180000-0000-0000-0000-0000000000f1','cre003-operator@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01180000-0000-0000-0000-0000000000a1','01180000-0000-0000-0000-000000000001','Member A','cre003-a@example.com','Engineer'),
  ('01180000-0000-0000-0000-0000000000a2','01180000-0000-0000-0000-000000000001','Member B','cre003-b@example.com','Engineer'),
  ('01180000-0000-0000-0000-0000000000f1','01180000-0000-0000-0000-000000000001','Operator','cre003-operator@example.com','Admin');
insert into platform_operators (user_id) values ('01180000-0000-0000-0000-0000000000f1');

-- Balance 0: one grant of 100 (org-pool grant) fully consumed by a member's agent_usage.cost of 100.
insert into credits (org_id, owner_id, amount, granted_by) values
  ('01180000-0000-0000-0000-000000000001', null, 100, '01180000-0000-0000-0000-0000000000f1');
insert into agent_usage (org_id, owner_id, model, cost) values
  ('01180000-0000-0000-0000-000000000001','01180000-0000-0000-0000-0000000000a1','gpt-test',100);

-- (1)+(2) At balance 0, BOTH members A and B read the same exceeded=true (org-pool metering is
--     owner_id-agnostic — the deputy invariant under org-pool).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01180000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.org_credit_balance('01180000-0000-0000-0000-000000000001') <= 0, true,
  'AC-CRE-003 member A at org balance 0 → exceeded=true (guard-equivalent)');
set local request.jwt.claims = '{"sub":"01180000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.org_credit_balance('01180000-0000-0000-0000-000000000001') <= 0, true,
  'AC-CRE-003 member B (same org) reads the SAME exceeded=true (regardless of which member fired it)');
reset role;

-- (3) Operator grants +500 (FR-CRE-005). operator_grant_credits writes owner_id NULL (org pool).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01180000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select operator_grant_credits('01180000-0000-0000-0000-000000000001', 500, 'AC-CRE-003 topup') $$,
  'AC-CRE-003 Operator grant +500 succeeds (owner_id NULL — org-pool grant)');
reset role;

-- (4)+(5) After the grant, BOTH members read balance 500 → exceeded=false (identical).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01180000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.org_credit_balance('01180000-0000-0000-0000-000000000001') <= 0, false,
  'AC-CRE-003 member A after +500 grant → exceeded=false');
set local request.jwt.claims = '{"sub":"01180000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.org_credit_balance('01180000-0000-0000-0000-000000000001') <= 0, false,
  'AC-CRE-003 member B (same org) reads the SAME exceeded=false (grant flips everyone at once)');
reset role;

select * from finish();
rollback;
