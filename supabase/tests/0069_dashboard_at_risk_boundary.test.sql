-- 0069_dashboard_at_risk_boundary.test.sql — projects_at_risk boundary reconciliation (>=)
-- + committed-spend drift guard (OD-BUDGET-2).
--
-- (C) AC-ATRISK-BOUNDARY: get_executive_dashboard().projects_at_risk uses the canonical rule
--     spent/budget >= 0.9 (at-or-above 90%, inclusive) over Ongoing projects with budget>0.
--     0027 reconciles the server from the old `> 0.9` to `>= 0.9` (the FE basis).
-- (D) OD-BUDGET-2 drift guard: get_projects_delivery(...).committed_spend agrees with
--     projects.spent for a project whose stored spent equals its committed POs.
begin;
select plan(3);

-- ── Fixtures (table owner, bypassing RLS) ───────────────────────────────────
insert into organizations (id, name) values
  ('00690000-0000-0000-0000-000000000001','At-Risk Boundary Org');

insert into auth.users (id, email) values
  ('00690000-0000-0000-0000-0000000000a1','atrisk-exec@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00690000-0000-0000-0000-0000000000a1','00690000-0000-0000-0000-000000000001',
   'At-Risk Exec','atrisk-exec@example.com','Executive');

insert into companies (id, org_id, name, type) values
  ('00690000-0000-0000-0000-000000000010','00690000-0000-0000-0000-000000000001','Boundary Client','Client');

-- p-edge: EXACTLY 90% committed/budget (spent 900000 of 1000000) — must count under `>=`.
-- p-below: 89.99% (spent 899900 of 1000000) — must NOT count.
-- Both Ongoing Project with positive budget (the active + budget>0 gate).
insert into projects (id, org_id, code, name, status, client_id, project_manager_id, budget, spent, contract_value) values
  ('00690000-0000-0000-0000-000000000020','00690000-0000-0000-0000-000000000001',
   'BND-EDGE','At Exactly 90','Ongoing Project',
   '00690000-0000-0000-0000-000000000010','00690000-0000-0000-0000-0000000000a1',1000000,900000,1500000),
  ('00690000-0000-0000-0000-000000000021','00690000-0000-0000-0000-000000000001',
   'BND-BELOW','Just Below 90','Ongoing Project',
   '00690000-0000-0000-0000-000000000010','00690000-0000-0000-0000-0000000000a1',1000000,899900,1500000);

-- (D) Drift-guard project: committed POs (Ordered..Paid) sum to 250000, stored projects.spent
-- set to the same OD-BUDGET-2 committed basis. A Draft PO is excluded from the committed basis.
insert into projects (id, org_id, code, name, status, client_id, project_manager_id, budget, spent, contract_value) values
  ('00690000-0000-0000-0000-000000000022','00690000-0000-0000-0000-000000000001',
   'BND-DRIFT','Drift Guard','Ongoing Project',
   '00690000-0000-0000-0000-000000000010','00690000-0000-0000-0000-0000000000a1',1000000,250000,1500000);

insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('00690000-0000-0000-0000-000000000101','00690000-0000-0000-0000-000000000001','Ordered','Ordered',100000,'00690000-0000-0000-0000-000000000022','00690000-0000-0000-0000-0000000000a1'),
  ('00690000-0000-0000-0000-000000000102','00690000-0000-0000-0000-000000000001','Paid','Paid',150000,'00690000-0000-0000-0000-000000000022','00690000-0000-0000-0000-0000000000a1'),
  ('00690000-0000-0000-0000-000000000103','00690000-0000-0000-0000-000000000001','Draft','Draft',999999,'00690000-0000-0000-0000-000000000022','00690000-0000-0000-0000-0000000000a1');

-- ── Tests (as the org Executive, so RLS scopes results to this org). ────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00690000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local request.jwt.claim.sub = '00690000-0000-0000-0000-0000000000a1';

-- (C) AC-ATRISK-BOUNDARY: a project at EXACTLY 90% committed/budget IS counted (>= boundary).
-- p-edge (90%) counts; p-below (89.99%) does not; the drift-guard project (25%) does not → count = 1.
select is(
  (get_executive_dashboard() ->> 'projects_at_risk')::int,
  1,
  'AC-ATRISK-BOUNDARY: projects_at_risk counts the exactly-90% project (>= 0.9) and excludes the 89.99% one');

-- (D) OD-BUDGET-2 drift guard: committed_spend from get_projects_delivery == projects.spent.
select is(
  (select committed_spend::numeric(12,0)
     from get_projects_delivery(array['00690000-0000-0000-0000-000000000022'::uuid])),
  (select spent::numeric(12,0) from projects where id = '00690000-0000-0000-0000-000000000022'),
  'OD-BUDGET-2: get_projects_delivery.committed_spend agrees with projects.spent (committed basis)');

-- (D) the committed basis is the OD-BUDGET-2 sum (250000) — Draft excluded.
select is(
  (select committed_spend::numeric(12,0)
     from get_projects_delivery(array['00690000-0000-0000-0000-000000000022'::uuid])),
  250000::numeric,
  'OD-BUDGET-2: committed_spend sums Ordered..Paid only (Draft excluded)');

reset role;

select * from finish();
rollback;
