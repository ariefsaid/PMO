-- 0732_executive_attention_ranking.test.sql — #1418: the executive dashboard's project list is the true top five
-- BY ATTENTION over the whole active population, not the five largest contracts.
--
-- Fixture (one org, isolated prefix 07320000-…): five active projects. The SMALLEST contract carries three signal
-- kinds (overdue work, over budget, waiting approvals) and must rank first; the largest contract has nothing wrong
-- and sits last. The sixth project proves the five-row cut is by attention, not by value.
--
-- Rules reused (each already defined elsewhere, restated here so a rule drift reddens this file):
--   tasks      — open status + end_date before the org's today + not tombstoned/archived;
--   milestones — target past + effective % under 100 + started (subtasks/archived tasks excluded, 0145);
--   invoices   — Submitted/Unpaid, unpaired, due (received_date | erp_due_date | invoice_date + terms) before today;
--   over budget— the dashboard's at-risk basis (spent + open commitment on a PMO basis) past 100%;
--   approvals  — project-scoped pending records (Requested procurement, Submitted expense claim).
--
-- Also: tenant isolation (org B's five overdue tasks never reach org A), and the security posture is unchanged
-- (invoker, executable by authenticated, not by anon).
begin;
select plan(17);

-- ── Orgs, users ─────────────────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('07320000-0000-0000-0000-000000000001', 'Attention Ranking Org A'),
  ('07320000-0000-0000-0000-000000000002', 'Attention Ranking Org B');

insert into auth.users (id, email) values
  ('07320000-0000-0000-0000-0000000000a1', 'attention-a@invalid.example'),
  ('07320000-0000-0000-0000-0000000000b1', 'attention-b@invalid.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('07320000-0000-0000-0000-0000000000a1', '07320000-0000-0000-0000-000000000001', 'Attention A', 'attention-a@invalid.example', 'Executive'),
  ('07320000-0000-0000-0000-0000000000b1', '07320000-0000-0000-0000-000000000002', 'Attention B', 'attention-b@invalid.example', 'Executive');

-- ── Org A: customer (30-day terms), six active projects ────────────────────────────────────────────────────────
insert into companies (id, org_id, name, type, erp_payment_terms_days) values
  ('07320000-0000-0000-0000-0000000000c1', '07320000-0000-0000-0000-000000000001', 'Attention Client', 'Client', 30);

-- P_ALL: SMALLEST contract, all three signal kinds → must rank first.
-- P_OVERDUE: one signal (overdue work, 4 items).
-- P_APPROVALS: one signal (2 waiting approvals).
-- P_BUDGET: one signal (over budget, ratio 1.5).
-- P_BIG_VALUE: largest contract, nothing wrong (+ a Done past task and a not-started milestone that must NOT count).
-- P_NONE_2: second-largest contract, nothing wrong → pushed out by the five-row cut.
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount) values
  ('07320000-0000-0000-0000-0000000000d1', '07320000-0000-0000-0000-000000000001', 'P_ALL_SIGNALS',   'Ongoing Project', 'USD',  200000, 'exclusive', 0),
  ('07320000-0000-0000-0000-0000000000d2', '07320000-0000-0000-0000-000000000001', 'P_OVERDUE_ONLY',  'Ongoing Project', 'USD',  500000, 'exclusive', 0),
  ('07320000-0000-0000-0000-0000000000d3', '07320000-0000-0000-0000-000000000001', 'P_APPROVALS_ONLY','Ongoing Project', 'USD',  300000, 'exclusive', 0),
  ('07320000-0000-0000-0000-0000000000d4', '07320000-0000-0000-0000-000000000001', 'P_OVER_BUDGET',   'Ongoing Project', 'USD',  400000, 'exclusive', 0),
  ('07320000-0000-0000-0000-0000000000d5', '07320000-0000-0000-0000-000000000001', 'P_BIG_VALUE',     'Ongoing Project', 'USD', 9000000, 'exclusive', 0),
  ('07320000-0000-0000-0000-0000000000d6', '07320000-0000-0000-0000-000000000001', 'P_NONE_2',        'Ongoing Project', 'USD', 6000000, 'exclusive', 0);

-- Overdue work on P_ALL (1 task) and P_OVERDUE (2 open + a Done past + an archived past, which must not count).
insert into tasks (id, org_id, project_id, name, status, end_date) values
  ('07320000-0000-0000-0000-0000000000e1', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d1', 'All-signals task', 'In Progress', ((now() at time zone 'UTC')::date - 2)),
  ('07320000-0000-0000-0000-0000000000e2', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d2', 'Overdue task A',  'To Do',       ((now() at time zone 'UTC')::date - 3)),
  ('07320000-0000-0000-0000-0000000000e3', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d2', 'Overdue task B',  'Blocked',     ((now() at time zone 'UTC')::date - 1)),
  ('07320000-0000-0000-0000-0000000000e4', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d2', 'Finished late',   'Done',        ((now() at time zone 'UTC')::date - 9)),
  ('07320000-0000-0000-0000-0000000000e5', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d2', 'Archived late',   'In Progress', ((now() at time zone 'UTC')::date - 9)),
  ('07320000-0000-0000-0000-0000000000e6', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d5', 'Done past task',  'Done',        ((now() at time zone 'UTC')::date - 4));
update tasks set archived_at = now() where id = '07320000-0000-0000-0000-0000000000e5';

-- Milestones: one overdue (started, 40%), one not-started (must NOT count), one future on P_OVERDUE.
insert into project_milestones (id, org_id, project_id, name, target_date, input_pct) values
  ('07320000-0000-0000-0000-0000000000f1', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d1', 'All-signals phase',  ((now() at time zone 'UTC')::date - 4), 60),
  ('07320000-0000-0000-0000-0000000000f2', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d2', 'Overdue phase',      ((now() at time zone 'UTC')::date - 5), 40),
  ('07320000-0000-0000-0000-0000000000f3', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d2', 'Not started phase',  ((now() at time zone 'UTC')::date - 5), null),
  ('07320000-0000-0000-0000-0000000000f4', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d2', 'Future phase',       ((now() at time zone 'UTC')::date + 20), 0),
  ('07320000-0000-0000-0000-0000000000f5', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d5', 'Big not started',    ((now() at time zone 'UTC')::date - 6), null);

-- Invoices on P_OVERDUE: one overdue (Submitted, 60 days old on 30-day terms), one paid, one not yet due.
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, status, amount) values
  ('07320000-0000-0000-0000-000000000101', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d2', '07320000-0000-0000-0000-0000000000c1', ((now() at time zone 'UTC')::date - 60), 'Submitted', 1000),
  ('07320000-0000-0000-0000-000000000102', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d2', '07320000-0000-0000-0000-0000000000c1', ((now() at time zone 'UTC')::date - 90), 'Paid',      1000),
  ('07320000-0000-0000-0000-000000000103', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d2', '07320000-0000-0000-0000-0000000000c1', ((now() at time zone 'UTC')::date - 2),  'Submitted', 1000);

-- Waiting approvals: one Requested procurement on P_ALL, one Requested + one Submitted claim elsewhere.
insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('07320000-0000-0000-0000-000000000111', '07320000-0000-0000-0000-000000000001', 'All-signals request', 'Requested', 200, '07320000-0000-0000-0000-0000000000d1', '07320000-0000-0000-0000-0000000000a1'),
  ('07320000-0000-0000-0000-000000000112', '07320000-0000-0000-0000-000000000001', 'Approvals request',   'Requested', 100, '07320000-0000-0000-0000-0000000000d3', '07320000-0000-0000-0000-0000000000a1');
insert into expense_claims (id, org_id, claimant_id, project_id, title, currency, amount, status) values
  ('07320000-0000-0000-0000-000000000121', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000a1', '07320000-0000-0000-0000-0000000000d3', 'Approvals claim', 'USD', 50, 'Submitted');

-- Over budget: an Active budget (1,000 / 100) and an Ordered purchase above it (2,000 / 200) — no payments, so the
-- PMO consumption figure is the open commitment and the ratio is 2.0 / 2.0 (over 100%).
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('07320000-0000-0000-0000-000000000131', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d1', 1, 'All-signals v1', 'Draft'),
  ('07320000-0000-0000-0000-000000000132', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-0000000000d4', 1, 'Over-budget v1', 'Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount) values
  ('07320000-0000-0000-0000-000000000141', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-000000000131', 'Labor', 'All-signals crew', 100),
  ('07320000-0000-0000-0000-000000000142', '07320000-0000-0000-0000-000000000001', '07320000-0000-0000-0000-000000000132', 'Labor', 'Over-budget crew', 1000);
update budget_versions set status = 'Active'
 where id in ('07320000-0000-0000-0000-000000000131', '07320000-0000-0000-0000-000000000132');
insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('07320000-0000-0000-0000-000000000151', '07320000-0000-0000-0000-000000000001', 'All-signals order', 'Ordered', 200,  '07320000-0000-0000-0000-0000000000d1', '07320000-0000-0000-0000-0000000000a1'),
  ('07320000-0000-0000-0000-000000000152', '07320000-0000-0000-0000-000000000001', 'Over-budget order', 'Ordered', 1500, '07320000-0000-0000-0000-0000000000d4', '07320000-0000-0000-0000-0000000000a1');

-- ── Org B: one project with five overdue tasks (would rank first if tenancy leaked) ───────────────────────────
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount) values
  ('07320000-0000-0000-0000-0000000000b7', '07320000-0000-0000-0000-000000000002', 'B_ATTENTION_LEAK', 'Ongoing Project', 'USD', 100, 'exclusive', 0);
insert into tasks (id, org_id, project_id, name, status, end_date) values
  ('07320000-0000-0000-0000-000000000201', '07320000-0000-0000-0000-000000000002', '07320000-0000-0000-0000-0000000000b7', 'B overdue 1', 'To Do', ((now() at time zone 'UTC')::date - 1)),
  ('07320000-0000-0000-0000-000000000202', '07320000-0000-0000-0000-000000000002', '07320000-0000-0000-0000-0000000000b7', 'B overdue 2', 'To Do', ((now() at time zone 'UTC')::date - 1)),
  ('07320000-0000-0000-0000-000000000203', '07320000-0000-0000-0000-000000000002', '07320000-0000-0000-0000-0000000000b7', 'B overdue 3', 'To Do', ((now() at time zone 'UTC')::date - 1)),
  ('07320000-0000-0000-0000-000000000204', '07320000-0000-0000-0000-000000000002', '07320000-0000-0000-0000-0000000000b7', 'B overdue 4', 'To Do', ((now() at time zone 'UTC')::date - 1)),
  ('07320000-0000-0000-0000-000000000205', '07320000-0000-0000-0000-000000000002', '07320000-0000-0000-0000-0000000000b7', 'B overdue 5', 'To Do', ((now() at time zone 'UTC')::date - 1));

-- ── Run as org A's Executive ──────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07320000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local request.jwt.claim.sub = '07320000-0000-0000-0000-0000000000a1';

-- Attention beats contract value: the 200k project with three signal kinds leads a nine-million contract with none.
select is(
  (select json_array_length(get_executive_dashboard() -> 'attention_projects')),
  5,
  'AC-1418-01: the list is the five-row cut over the whole active population'
);
select is(
  (get_executive_dashboard() -> 'attention_projects' -> 0 ->> 'id')::uuid,
  '07320000-0000-0000-0000-0000000000d1'::uuid,
  'AC-1418-02: the smallest contract with three signal kinds ranks above the nine-million contract'
);
select is(
  (get_executive_dashboard() -> 'attention_projects' -> 0 ->> 'attention_signals')::int,
  3,
  'AC-1418-03: the leader carries three signal kinds (overdue work, over budget, waiting approvals)'
);
select is(
  (get_executive_dashboard() -> 'attention_projects' -> 4 ->> 'name'),
  'P_BIG_VALUE',
  'AC-1418-04: the largest contract, with nothing wrong, sits last rather than first'
);
select is(
  (select count(*)::int from json_array_elements(get_executive_dashboard() -> 'attention_projects') e
    where e ->> 'name' = 'P_NONE_2'),
  0,
  'AC-1418-05: a larger contract with no signal is cut before a smaller one with signals'
);

-- Signal fields the panel renders, each from the reused rule.
select is(
  (select (e ->> 'overdue_items')::int from json_array_elements(get_executive_dashboard() -> 'attention_projects') e
    where e ->> 'name' = 'P_OVERDUE_ONLY'),
  4,
  'AC-1418-06: overdue work totals 2 open past tasks + 1 started past milestone + 1 overdue invoice'
);
select is(
  (select (e ->> 'overdue_tasks')::int from json_array_elements(get_executive_dashboard() -> 'attention_projects') e
    where e ->> 'name' = 'P_OVERDUE_ONLY'),
  2,
  'AC-1418-07: a Done past task and an archived past task are not overdue tasks'
);
select is(
  (select (e ->> 'overdue_milestones')::int from json_array_elements(get_executive_dashboard() -> 'attention_projects') e
    where e ->> 'name' = 'P_OVERDUE_ONLY'),
  1,
  'AC-1418-08: a past milestone that never started does not count as overdue'
);
select is(
  (select (e ->> 'overdue_invoices')::int from json_array_elements(get_executive_dashboard() -> 'attention_projects') e
    where e ->> 'name' = 'P_OVERDUE_ONLY'),
  1,
  'AC-1418-09: a paid past invoice and a not-yet-due invoice are not overdue'
);
select is(
  (select (e ->> 'waiting_approvals')::int from json_array_elements(get_executive_dashboard() -> 'attention_projects') e
    where e ->> 'name' = 'P_APPROVALS_ONLY'),
  2,
  'AC-1418-10: a Requested procurement and a Submitted expense claim both wait on their project'
);
select is(
  (select e ->> 'over_budget' from json_array_elements(get_executive_dashboard() -> 'attention_projects') e
    where e ->> 'name' = 'P_OVER_BUDGET'),
  'true',
  'AC-1418-11: consumption (spent + open commitment) past the Active budget is over budget'
);
select is(
  (select (e ->> 'budget_used_ratio')::numeric from json_array_elements(get_executive_dashboard() -> 'attention_projects') e
    where e ->> 'name' = 'P_OVER_BUDGET'),
  1.5::numeric,
  'AC-1418-12: the ratio is the dashboard at-risk basis (1,500 of 1,000), not a different money calc'
);
select is(
  (select (e ->> 'overdue_items')::int from json_array_elements(get_executive_dashboard() -> 'attention_projects') e
    where e ->> 'name' = 'P_BIG_VALUE'),
  0,
  'AC-1418-13: a Done past task and a not-started past milestone leave a project clean'
);

-- Tenancy: org B's signal-rich project never appears in org A's list.
select is(
  (select count(*)::int from json_array_elements(get_executive_dashboard() -> 'attention_projects') e
    where e ->> 'name' = 'B_ATTENTION_LEAK'),
  0,
  'AC-1418-14: another org''s projects are not in this org''s ranking'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"07320000-0000-0000-0000-0000000000b1","role":"authenticated"}';
set local request.jwt.claim.sub = '07320000-0000-0000-0000-0000000000b1';
select is(
  (select json_array_length(get_executive_dashboard() -> 'attention_projects')),
  1,
  'AC-1418-15: org B sees only its own project (no row set from org A)'
);

-- Security posture unchanged: same function, still invoker, executable by authenticated and not by anon.
reset role;
select ok(
  (select not prosecdef from pg_proc where oid = 'public.get_executive_dashboard()'::regprocedure),
  'AC-1418-16a: get_executive_dashboard stays SECURITY INVOKER (RLS is the tenancy boundary)'
);
select ok(
  has_function_privilege('authenticated', 'public.get_executive_dashboard()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_executive_dashboard()', 'EXECUTE'),
  'AC-1418-16b: executable by authenticated, not by anon (grants unchanged)'
);

select * from finish();
rollback;
