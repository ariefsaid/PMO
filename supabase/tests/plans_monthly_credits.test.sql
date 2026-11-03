-- AC-PLN-011 [pgTAP] — the monthly AI allowance (FR-PLN-012, spec D10, plan Decision 4).
--
-- The pool is a balance over an append-only ledger (0067_org_credit_balance.sql:13), so a month's
-- allowance is a NEW credits row: additive, nothing revoked, unspent credits roll over by
-- construction. One message credit is $0.005 (D10) and a NULL allowance means NO grant (plan
-- Decision 3: Enterprise has (NULL,NULL,NULL) — the tick invents no amount).
--
-- Idempotency is the unique key on (org_id, period) in org_ai_allowance_grants: the insert is
-- `on conflict do nothing`, so a second run — a retried cron fire, a manual re-run — writes no
-- second grant. The two explicit periods (2026-01, 2026-02) are deliberately NOT the current month,
-- so the period-less call at the end is a real third period rather than a replay.
begin;
create extension if not exists pgtap;
select plan(29);

insert into organizations (id, name) values
  ('0535b000-0000-0000-0000-000000000001', 'Plan Grant Starter'),
  ('0535b000-0000-0000-0000-000000000002', 'Plan Grant Enterprise'),
  ('0535b000-0000-0000-0000-000000000003', 'Plan Grant Growth'),
  ('0535b000-0000-0000-0000-000000000004', 'Plan Grant Pro');
insert into auth.users (id, email) values
  ('0535b000-0000-0000-0000-0000000000a1','plan-grant-a@example.invalid'),
  ('0535b000-0000-0000-0000-0000000000b1','plan-grant-b@example.invalid'),
  ('0535b000-0000-0000-0000-0000000000c1','plan-grant-c@example.invalid'),
  ('0535b000-0000-0000-0000-0000000000d1','plan-grant-d@example.invalid'),
  ('0535b000-0000-0000-0000-0000000000e1','plan-grant-operator@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0535b000-0000-0000-0000-0000000000a1','0535b000-0000-0000-0000-000000000001','Grant A Admin','plan-grant-a@example.invalid','Admin','active'),
  ('0535b000-0000-0000-0000-0000000000b1','0535b000-0000-0000-0000-000000000002','Grant B Admin','plan-grant-b@example.invalid','Admin','active'),
  ('0535b000-0000-0000-0000-0000000000c1','0535b000-0000-0000-0000-000000000003','Grant C Admin','plan-grant-c@example.invalid','Admin','active'),
  ('0535b000-0000-0000-0000-0000000000d1','0535b000-0000-0000-0000-000000000004','Grant D Admin','plan-grant-d@example.invalid','Admin','active'),
  ('0535b000-0000-0000-0000-0000000000e1','0535b000-0000-0000-0000-000000000001','Grant Operator','plan-grant-operator@example.invalid','Finance','active');
insert into platform_operators (user_id) values ('0535b000-0000-0000-0000-0000000000e1');
insert into org_plans (org_id, plan_id) values
  ('0535b000-0000-0000-0000-000000000001','starter'),
  ('0535b000-0000-0000-0000-000000000002','enterprise'),
  ('0535b000-0000-0000-0000-000000000003','growth'),
  ('0535b000-0000-0000-0000-000000000004','pro');

-- ── The credit unit is single-sourced, and the allowance it turns into is exact ────────────────────
select is(public.plan_ai_credit_unit_usd(), 0.005::numeric,
  'AC-PLN-011 one AI message credit is $0.005 in the pool''s monetary unit (D10)');
select is((select ai_monthly_messages from public.org_plan_limits('0535b000-0000-0000-0000-000000000001')),
  300, 'AC-PLN-011 starter carries a 300-message monthly allowance');
select is((select ai_monthly_messages from public.org_plan_limits('0535b000-0000-0000-0000-000000000002')),
  null::integer, 'AC-PLN-011 Enterprise has a NULL allowance (no automatic grant)');

-- ── First monthly reset ───────────────────────────────────────────────────────────────────────────
select cmp_ok(public.plan_monthly_ai_allowance_tick('2026-01-01'::date), '>=', 3,
  'AC-PLN-011 the monthly reset grants every org that has an allowance (A, C, D at least)');

select is((select count(*)::int from public.org_ai_allowance_grants
            where org_id = '0535b000-0000-0000-0000-000000000002'), 0,
  'AC-PLN-011 a NULL allowance writes no grant row at all');

select is((select amount from public.org_ai_allowance_grants
            where org_id = '0535b000-0000-0000-0000-000000000001' and period = '2026-01-01'),
  1.50::numeric, 'AC-PLN-011 starter grants 300 x 0.005 = 1.50');
select is((select plan_id from public.org_ai_allowance_grants
            where org_id = '0535b000-0000-0000-0000-000000000001' and period = '2026-01-01'),
  'starter', 'AC-PLN-011 the grant records the plan it came from');
select is((select ai_monthly_messages from public.org_ai_allowance_grants
            where org_id = '0535b000-0000-0000-0000-000000000001' and period = '2026-01-01'),
  300, 'AC-PLN-011 the grant records the allowance it converted');
select is((select amount from public.org_ai_allowance_grants
            where org_id = '0535b000-0000-0000-0000-000000000004' and period = '2026-01-01'),
  25.00::numeric, 'AC-PLN-011 pro grants 5000 x 0.005 = 25.00');

-- The money landed in the EXISTING pool: org_credit_balance is the same read the meter uses.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535b000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.org_credit_balance('0535b000-0000-0000-0000-000000000001'), 1.50::numeric,
  'AC-PLN-011 the starter org''s pool gains exactly its allowance');
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535b000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is(public.org_credit_balance('0535b000-0000-0000-0000-000000000003'), 7.50::numeric,
  'AC-PLN-011 the growth org''s pool gains exactly its allowance');
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535b000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(public.org_credit_balance('0535b000-0000-0000-0000-000000000002'), 0::numeric,
  'AC-PLN-011 an Enterprise org''s pool is untouched (no invented grant)');
reset role;

-- The grant is a real credits row, system-attributed, in the existing append-only table.
select is((select count(*)::int from public.credits
            where org_id = '0535b000-0000-0000-0000-000000000001'), 1,
  'AC-PLN-011 the grant is one credits row');
select ok((select owner_id is null and granted_by is null
             from public.credits where org_id = '0535b000-0000-0000-0000-000000000001'),
  'AC-PLN-011 the grant is an org-pool credit with no human granter');
select is((select count(*)::int from public.org_ai_allowance_grants g
             join public.credits c on c.id = g.credit_id
            where g.org_id = '0535b000-0000-0000-0000-000000000001'), 1,
  'AC-PLN-011 every ledger row points at the real credits row it minted');

-- ── Idempotency: a re-run of the same reset grants nothing (AC-PLN-011) ──────────────────────────
select is(public.plan_monthly_ai_allowance_tick('2026-01-01'::date), 0,
  'AC-PLN-011 re-running the same monthly reset grants nothing');
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535b000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.org_credit_balance('0535b000-0000-0000-0000-000000000001'), 1.50::numeric,
  'AC-PLN-011 the pool is unchanged after the idempotent re-run');
reset role;
select is((select count(*)::int from public.credits
            where org_id = '0535b000-0000-0000-0000-000000000001'), 1,
  'AC-PLN-011 the re-run minted no second credits row');
select is((select count(*)::int from public.org_ai_allowance_grants
            where org_id = '0535b000-0000-0000-0000-000000000001'), 1,
  'AC-PLN-011 one ledger row per org per month');

-- ── Additive: next month adds, it never expires the previous grant (plan Decision 4) ─────────────
select cmp_ok(public.plan_monthly_ai_allowance_tick('2026-02-01'::date), '>=', 3,
  'AC-PLN-011 the next monthly reset grants again');
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535b000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.org_credit_balance('0535b000-0000-0000-0000-000000000001'), 3.00::numeric,
  'AC-PLN-011 unused allowance rolls over — the second month adds to the first');
reset role;
select is((select count(*)::int from public.org_ai_allowance_grants
            where org_id = '0535b000-0000-0000-0000-000000000001'), 2,
  'AC-PLN-011 the ledger keeps one row per month');

-- ── It composes with the Operator's manual grant, and re-running still does nothing ──────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535b000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok(
  $$ select public.operator_grant_credits('0535b000-0000-0000-0000-000000000001', 5, 'operator top-up') $$,
  'AC-PLN-011 an Operator grant still works alongside the automatic allowance');
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535b000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.org_credit_balance('0535b000-0000-0000-0000-000000000001'), 8.00::numeric,
  'AC-PLN-011 the pool is additive across automatic and manual grants');
reset role;
select is(public.plan_monthly_ai_allowance_tick('2026-02-01'::date), 0,
  'AC-PLN-011 re-running after a manual grant still grants nothing');

-- ── Scheduled the way this repo schedules jobs (0094 / 0564 pattern) ────────────────────────────
select is((select count(*)::int from cron.job where jobname = 'plan-monthly-ai-allowance'), 1,
  'AC-PLN-011 the monthly grant is registered as a pg_cron job');
select ok((select schedule from cron.job where jobname = 'plan-monthly-ai-allowance') like '%1 * *',
  'AC-PLN-011 the job runs on the first day of the month');

-- A NULL period uses the current month, and stays idempotent on a second call.
select cmp_ok(public.plan_monthly_ai_allowance_tick(), '>=', 3,
  'AC-PLN-011 a period-less call grants the current month');
select is(public.plan_monthly_ai_allowance_tick(), 0,
  'AC-PLN-011 the period-less call is idempotent on its second run');

select * from finish();
rollback;
