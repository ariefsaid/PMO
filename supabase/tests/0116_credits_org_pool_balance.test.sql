-- 0116_credits_org_pool_balance.test.sql
-- AC-CRE-001 [pgTAP]: org-pool balance is owner_id-agnostic. Pins FR-CRE-001/002: balance =
-- Σ credits.amount(org_id=X, ANY owner_id) − Σ agent_usage.cost(org_id=X). Legacy non-null owner_id
-- grants COUNT (no backfill); new NULL-owner_id grants count. A per-owner "balance" is NOT defined.
begin;
select plan(3);

-- ── Fixtures: org X, a legacy member (carries a non-null owner_id grant), a 2nd member. ──
insert into organizations (id, name) values
  ('01160000-0000-0000-0000-000000000001','AC-CRE-001 Org X');
insert into auth.users (id, email) values
  ('01160000-0000-0000-0000-0000000000a1','cre001-admin@example.com'),
  ('01160000-0000-0000-0000-0000000000e1','cre001-eng@example.com'),
  ('01160000-0000-0000-0000-0000000000e2','cre001-eng2@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01160000-0000-0000-0000-0000000000a1','01160000-0000-0000-0000-000000000001','X Admin','cre001-admin@example.com','Admin'),
  ('01160000-0000-0000-0000-0000000000e1','01160000-0000-0000-0000-000000000001','X Eng','cre001-eng@example.com','Engineer'),
  ('01160000-0000-0000-0000-0000000000e2','01160000-0000-0000-0000-000000000001','X Eng2','cre001-eng2@example.com','Engineer');

-- Grants: 1000 (owner_id NULL — new org-pool grant) + 250 (owner_id = legacy member — non-null
-- pre-flip grant from 0047 that MUST still count). Usage: cost 100 + 50 for two different owners.
insert into credits (org_id, owner_id, amount, note, granted_by) values
  ('01160000-0000-0000-0000-000000000001', null,                                  1000, 'pool grant',             '01160000-0000-0000-0000-0000000000a1'),
  ('01160000-0000-0000-0000-000000000001', '01160000-0000-0000-0000-0000000000e1',  250, 'legacy per-user grant',  '01160000-0000-0000-0000-0000000000a1');
insert into agent_usage (org_id, owner_id, model, cost) values
  ('01160000-0000-0000-0000-000000000001','01160000-0000-0000-0000-0000000000e1','gpt-test',100),
  ('01160000-0000-0000-0000-000000000001','01160000-0000-0000-0000-0000000000e2','gpt-test',50);

-- (1) org_credit_balance(X) = 1100 (1000 + 250 − 150). Called under an org-X member's JWT (the fn
--     asserts p_org_id = auth_org_id()). Both the NULL and the legacy non-null grant count.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01160000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.org_credit_balance('01160000-0000-0000-0000-000000000001'), 1100::numeric,
  'AC-CRE-001 org-pool balance = 1100 (NULL + legacy non-null grants both count, owner_id-agnostic)');

-- (2) A DIFFERENT member of the SAME org reads the SAME pool balance (the deputy invariant — any
--     member's turn reads their own org pool). This is the AC-CRE-003 premise proven at the fn level.
set local request.jwt.claims = '{"sub":"01160000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is(public.org_credit_balance('01160000-0000-0000-0000-000000000001'), 1100::numeric,
  'AC-CRE-001 any org-X member reads the same pool balance (deputy invariant)');
reset role;

-- (3) A per-owner "balance" is NOT defined: summing credits.amount for org X regardless of owner_id
--     returns the ORG total (1250), not a per-user number — the org-pool math is owner_id-agnostic.
select is(
  (select coalesce(sum(amount),0) from credits where org_id = '01160000-0000-0000-0000-000000000001'),
  1250::numeric,
  'AC-CRE-001 credits.amount summed for the org = 1250 (org total, not a per-owner balance)');

select * from finish();
rollback;
