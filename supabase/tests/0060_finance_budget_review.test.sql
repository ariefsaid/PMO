-- 0060_finance_budget_review.test.sql
-- AC-FIN-DEBT-010: committed-basis spent + variance = spent - budget per project.
-- AC-FIN-DEBT-011: rows ordered by variance desc; budget=0 project excluded.
-- AC-FIN-DEBT-012: security-invoker org scoping — org-A caller sees only org-A projects.
begin;
select plan(5);

insert into organizations (id, name) values
  ('00600000-0000-0000-0000-000000000001','BR Org A'),
  ('00600000-0000-0000-0000-000000000002','BR Org B');
insert into auth.users (id, email) values
  ('00600000-0000-0000-0000-0000000000a1','fin-a@example.com'),
  ('00600000-0000-0000-0000-0000000000b1','fin-b@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('00600000-0000-0000-0000-0000000000a1','00600000-0000-0000-0000-000000000001','Fin A','fin-a@example.com','Finance'),
  ('00600000-0000-0000-0000-0000000000b1','00600000-0000-0000-0000-000000000002','Fin B','fin-b@example.com','Finance');

-- Org-A projects:
--  OVER: budget 100k, committed PO 150k (Ordered) ⇒ spent 150k, variance +50k.
--  UNDER: budget 200k, committed PO 50k (Paid)    ⇒ spent  50k, variance -150k.
--  ZERO: budget 0 (excluded by the budget>0 filter regardless of spend).
insert into projects (id, org_id, name, status, budget) values
  ('00600000-0000-0000-0000-000000000d01','00600000-0000-0000-0000-000000000001','OVER',  'Ongoing Project',100000),
  ('00600000-0000-0000-0000-000000000d02','00600000-0000-0000-0000-000000000001','UNDER', 'Ongoing Project',200000),
  ('00600000-0000-0000-0000-000000000d03','00600000-0000-0000-0000-000000000001','ZEROBUD','Ongoing Project',0);
-- Org-B project (budget>0) — must NOT appear for org-A.
insert into projects (id, org_id, name, status, budget) values
  ('00600000-0000-0000-0000-000000000d09','00600000-0000-0000-0000-000000000002','ORGB',  'Ongoing Project',300000);

-- Committed POs (status in the committed set) drive `spent`.
insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('00600000-0000-0000-0000-000000000e01','00600000-0000-0000-0000-000000000001','PO OVER','Ordered',150000,'00600000-0000-0000-0000-000000000d01','00600000-0000-0000-0000-0000000000a1'),
  ('00600000-0000-0000-0000-000000000e02','00600000-0000-0000-0000-000000000001','PO UNDER','Paid',  50000,'00600000-0000-0000-0000-000000000d02','00600000-0000-0000-0000-0000000000a1'),
  -- A non-committed PR (Requested) on OVER that must NOT count toward spent.
  ('00600000-0000-0000-0000-000000000e03','00600000-0000-0000-0000-000000000001','PR OVER nc','Requested',999999,'00600000-0000-0000-0000-000000000d01','00600000-0000-0000-0000-0000000000a1');

-- ── Org-A Finance caller ──────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00600000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-FIN-DEBT-010: OVER's spent = 150k (only committed POs; the Requested 999999 is excluded).
select is(
  (select (e->>'spent')::numeric from json_array_elements(get_finance_budget_review()) e where e->>'name'='OVER'),
  150000::numeric,
  'AC-FIN-DEBT-010: spent = Σ committed-PO total_value (non-committed Requested excluded)');
-- AC-FIN-DEBT-010: OVER's variance = 150k - 100k = +50k.
select is(
  (select (e->>'variance')::numeric from json_array_elements(get_finance_budget_review()) e where e->>'name'='OVER'),
  50000::numeric,
  'AC-FIN-DEBT-010: variance = spent - budget');
-- AC-FIN-DEBT-011: ordering — first row (variance desc) is OVER (+50k) ahead of UNDER (-150k).
-- ->0 indexes the JSON array deterministically (json_agg fixed the order variance desc).
select is(
  (get_finance_budget_review()->0->>'name'),
  'OVER',
  'AC-FIN-DEBT-011: rows ordered by variance descending (most-over first)');
-- AC-FIN-DEBT-011: budget=0 project (ZEROBUD) is excluded.
select ok(
  not exists(select 1 from json_array_elements(get_finance_budget_review()) e where e->>'name'='ZEROBUD'),
  'AC-FIN-DEBT-011: budget=0 project excluded (budget>0 filter applied server-side)');
-- AC-FIN-DEBT-012: org-A caller never sees org-B project (security-invoker RLS scoping).
select ok(
  not exists(select 1 from json_array_elements(get_finance_budget_review()) e where e->>'name'='ORGB'),
  'AC-FIN-DEBT-012: org-A caller sees only org-A projects (security invoker, RLS-scoped)');

reset role;
select * from finish();
rollback;
