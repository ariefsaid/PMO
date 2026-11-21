-- spend_approval_route_spending.test.sql — the line a request is judged against counts recorded spending + open
-- orders + reserved + approved claims not yet in the ledger, each once; then the project's whole budget is
-- tested the same way. Migration: 1016_spend_route_recorded_spending.sql.
-- AC-APR-050 line test · AC-APR-051 project test · AC-APR-052 spending unknown · AC-APR-053 below approval rank ·
-- AC-APR-054 the list reads return the route spend_approval_route returns.
begin;
select plan(60);

insert into organizations (id, name, default_currency) values
  ('a0923000-0000-0000-0000-00000000000a', 'Spend Route PMO', 'USD'),
  ('a0923000-0000-0000-0000-00000000000b', 'Spend Route ERP', 'USD'),
  ('a0923000-0000-0000-0000-00000000000c', 'Spend Route ERP EUR', 'USD');
insert into auth.users (id, email) values
  ('a0923000-0000-0000-0000-0000000000a1', 'srs-pm-a@example.test'),
  ('a0923000-0000-0000-0000-0000000000a2', 'srs-fin-a@example.test'),
  ('a0923000-0000-0000-0000-0000000000a3', 'srs-eng-a@example.test'),
  ('a0923000-0000-0000-0000-0000000000b1', 'srs-pm-b@example.test'),
  ('a0923000-0000-0000-0000-0000000000b2', 'srs-fin-b@example.test'),
  ('a0923000-0000-0000-0000-0000000000b3', 'srs-eng-b@example.test'),
  ('a0923000-0000-0000-0000-0000000000c2', 'srs-fin-c@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('a0923000-0000-0000-0000-0000000000a1', 'a0923000-0000-0000-0000-00000000000a', 'SRS PM A',  'srs-pm-a@example.test',  'Project Manager', 'active'),
  ('a0923000-0000-0000-0000-0000000000a2', 'a0923000-0000-0000-0000-00000000000a', 'SRS Fin A', 'srs-fin-a@example.test', 'Finance',         'active'),
  ('a0923000-0000-0000-0000-0000000000a3', 'a0923000-0000-0000-0000-00000000000a', 'SRS Eng A', 'srs-eng-a@example.test', 'Engineer',        'active'),
  ('a0923000-0000-0000-0000-0000000000b1', 'a0923000-0000-0000-0000-00000000000b', 'SRS PM B',  'srs-pm-b@example.test',  'Project Manager', 'active'),
  ('a0923000-0000-0000-0000-0000000000b2', 'a0923000-0000-0000-0000-00000000000b', 'SRS Fin B', 'srs-fin-b@example.test', 'Finance',         'active'),
  ('a0923000-0000-0000-0000-0000000000b3', 'a0923000-0000-0000-0000-00000000000b', 'SRS Eng B', 'srs-eng-b@example.test', 'Engineer',        'active'),
  ('a0923000-0000-0000-0000-0000000000c2', 'a0923000-0000-0000-0000-00000000000c', 'SRS Fin C', 'srs-fin-c@example.test', 'Finance',         'active');

-- PMO org A: a1 = project approver, a2 = senior set. ERP orgs B and C: same shape.
insert into projects (id, org_id, name, status, currency) values
  ('a0923000-0000-0000-0000-0000000000d1', 'a0923000-0000-0000-0000-00000000000a', 'A reserved only',      'Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-0000000000d2', 'a0923000-0000-0000-0000-00000000000a', 'A half paid order',    'Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-0000000000d3', 'a0923000-0000-0000-0000-00000000000a', 'A uncategorized paid', 'Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-0000000000d4', 'a0923000-0000-0000-0000-00000000000a', 'A line boundary',      'Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-0000000000e1', 'a0923000-0000-0000-0000-00000000000b', 'B ledger boundary',    'Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-0000000000e2', 'a0923000-0000-0000-0000-00000000000b', 'B half billed order',  'Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-0000000000e3', 'a0923000-0000-0000-0000-00000000000b', 'B claims and ledger',  'Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-0000000000e4', 'a0923000-0000-0000-0000-00000000000b', 'B no ledger reading',  'Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-0000000000f1', 'a0923000-0000-0000-0000-00000000000c', 'C ledger currency',    'Ongoing Project', 'USD');
insert into budget_versions (id, org_id, project_id, version, name, status, currency)
select ('a0923000-0000-0000-0000-0000000001' || right(p.id::text, 2))::uuid, p.org_id, p.id, 1, 'v1', 'Draft', 'USD'
  from projects p where p.id::text like 'a0923000-%';
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount)
select v.org_id, v.id, c.category, c.amount
  from budget_versions v cross join (values ('Labor'::budget_category, 400::numeric), ('Materials', 600)) c(category, amount)
 where v.id::text like 'a0923000-%';
update budget_versions set status = 'Active' where id::text like 'a0923000-%';

insert into spend_approvers (org_id, project_id, profile_id) values
  ('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'a0923000-0000-0000-0000-0000000000a1'),
  ('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d2', 'a0923000-0000-0000-0000-0000000000a1'),
  ('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d3', 'a0923000-0000-0000-0000-0000000000a1'),
  ('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d4', 'a0923000-0000-0000-0000-0000000000a1'),
  ('a0923000-0000-0000-0000-00000000000a', null,                                   'a0923000-0000-0000-0000-0000000000a2'),
  ('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e1', 'a0923000-0000-0000-0000-0000000000b1'),
  ('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e2', 'a0923000-0000-0000-0000-0000000000b1'),
  ('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e3', 'a0923000-0000-0000-0000-0000000000b1'),
  ('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e4', 'a0923000-0000-0000-0000-0000000000b1'),
  ('a0923000-0000-0000-0000-00000000000b', null,                                   'a0923000-0000-0000-0000-0000000000b2'),
  ('a0923000-0000-0000-0000-00000000000c', null,                                   'a0923000-0000-0000-0000-0000000000c2');

-- ERP orgs: an active binding; Labor is the one mapped category; one snapshot generation per org.
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at) values
  ('a0923000-0000-0000-0000-00000000000b', 'erpnext', 'https://srs-b.example.test', 'srs-test-ref', 'active', 'a0923000-0000-0000-0000-0000000000b2', now()),
  ('a0923000-0000-0000-0000-00000000000c', 'erpnext', 'https://srs-c.example.test', 'srs-test-ref', 'active', 'a0923000-0000-0000-0000-0000000000c2', now());
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('a0923000-0000-0000-0000-00000000000b', 'Labor', 'SRS labor account', false),
  ('a0923000-0000-0000-0000-00000000000c', 'Labor', 'SRS labor account', false);
insert into external_master_records (org_id, external_tier, kind, external_id, name, attrs, source_write_date)
values ('a0923000-0000-0000-0000-00000000000c', 'odoo', 'company', 'srs-company', 'SRS company EUR', '{"currency":"EUR"}', '2026-10-10 00:00:00');
insert into erp_actuals_snapshot (id, org_id, project_id, cost_center, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('a0923000-0000-0000-0000-0000000005e1', 'a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e1', 'cc', 'SRS labor account', '2026', 200, 0, 200, 'a0923000-0000-0000-0000-0000000005f1'),
  ('a0923000-0000-0000-0000-0000000005e2', 'a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e2', 'cc', 'SRS labor account', '2026', 100, 0, 100, 'a0923000-0000-0000-0000-0000000005f1'),
  ('a0923000-0000-0000-0000-0000000005e3', 'a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e3', 'cc', 'SRS labor account', '2026', 100, 0, 100, 'a0923000-0000-0000-0000-0000000005f1'),
  ('a0923000-0000-0000-0000-0000000005e4', 'a0923000-0000-0000-0000-00000000000c', 'a0923000-0000-0000-0000-0000000000f1', 'cc', 'SRS labor account', '2026', 100, 0, 100, 'a0923000-0000-0000-0000-0000000005f2');

insert into procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, requested_by_id) values
  -- d1: Approved 100 reserved on Labor (nothing recorded, no accounting system)
  ('a0923000-0000-0000-0000-000000000a01', 'a0923000-0000-0000-0000-00000000000a', 'reserved 100',       'Approved', 100, 'a0923000-0000-0000-0000-0000000000d1', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000a3'),
  -- d2: Ordered 300, 100 of it paid
  ('a0923000-0000-0000-0000-000000000a02', 'a0923000-0000-0000-0000-00000000000a', 'half paid 300',      'Ordered',  300, 'a0923000-0000-0000-0000-0000000000d2', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000a3'),
  -- d3: paid 800, no budget category
  ('a0923000-0000-0000-0000-000000000a03', 'a0923000-0000-0000-0000-00000000000a', 'uncategorized 800', 'Paid',     800, 'a0923000-0000-0000-0000-0000000000d3', 'USD', null,    'a0923000-0000-0000-0000-0000000000a3'),
  -- d4: paid 200 on Labor (the line boundary; the journey below moves it to 250)
  ('a0923000-0000-0000-0000-000000000a04', 'a0923000-0000-0000-0000-00000000000a', 'labor paid 200',     'Paid',     200, 'a0923000-0000-0000-0000-0000000000d4', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000a3'),
  -- e2: Ordered 300 on Labor, 100 billed into the ledger
  ('a0923000-0000-0000-0000-000000000b02', 'a0923000-0000-0000-0000-00000000000b', 'half billed 300',    'Ordered',  300, 'a0923000-0000-0000-0000-0000000000e2', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000b3');
insert into payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('a0923000-0000-0000-0000-000000000c02', 'a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-000000000a02', 'Paid', '2026-10-10', 100, 'USD'),
  ('a0923000-0000-0000-0000-000000000c03', 'a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-000000000a03', 'Paid', '2026-10-10', 800, 'USD'),
  ('a0923000-0000-0000-0000-000000000c04', 'a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-000000000a04', 'Paid', '2026-10-10', 200, 'USD');
insert into procurement_invoices (id, org_id, procurement_id, status, tax_treatment, tax_amount, amount, currency, erp_docstatus) values
  ('a0923000-0000-0000-0000-000000000d02', 'a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-000000000b02', 'Received', 'exclusive', 0, 100, 'USD', 1);

-- e3: two approved claims on Labor; the 50 one has its approval posted to the ledger (so it is in the 100 already).
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, currency, status, claim_number, submitted_at) values
  ('a0923000-0000-0000-0000-000000000e01', 'a0923000-0000-0000-0000-00000000000b', 'claim', 'a0923000-0000-0000-0000-0000000000b3', 'a0923000-0000-0000-0000-0000000000e3', 'Labor', 'posted claim',   50, 'USD', 'Approved', 'EXP-SRS-0001', now()),
  ('a0923000-0000-0000-0000-000000000e02', 'a0923000-0000-0000-0000-00000000000b', 'claim', 'a0923000-0000-0000-0000-0000000000b3', 'a0923000-0000-0000-0000-0000000000e3', 'Labor', 'unposted claim', 30, 'USD', 'Approved', 'EXP-SRS-0002', now());
insert into expense_posting_erp_mirror (org_id, claim_id, posting, posting_identity, state_stamp, push_state, erp_name) values
  ('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-000000000e01', 'approval',
   'a0923000-0000-0000-0000-000000000e01:approval', now(), 'pushed', 'SRS-JV-1');

-- Requests under test: Requested by the Engineer; Draft ones the Engineer submits below.
insert into procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, requested_by_id) values
  ('a0923000-0000-0000-0000-000000000f01', 'a0923000-0000-0000-0000-00000000000a', 'journey request',  'Requested', 200, 'a0923000-0000-0000-0000-0000000000d4', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000a3'),
  ('a0923000-0000-0000-0000-000000000f02', 'a0923000-0000-0000-0000-00000000000a', 'submit by eng',    'Draft',      50, 'a0923000-0000-0000-0000-0000000000d1', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000a3');

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- 'route/reason/line_used' for a request of p_amt on p_cat of a project, requested by the Engineer of its org.
create function pg_temp.r(p_org uuid, p_project uuid, p_cat public.budget_category, p_amt numeric, p_requester uuid)
returns text language sql stable as $$
  select r.route || '/' || r.reason || '/' || coalesce(r.line_used::numeric(14,2)::text, 'null')
    from public.spend_approval_route(p_org, p_project, p_cat, p_amt, 'USD', p_requester) r
$$;
create function pg_temp.who(p_entity uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(right(owner_id::text, 2) order by owner_id::text), array[]::text[])
    from notifications where metadata->'entity'->>'id' = p_entity::text and title like '%awaiting%' $$;

set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');

-- ── Case 2. No accounting system, nothing recorded: the line is what it was (reserved 100).
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/100.00', 'AC-APR-050: with nothing recorded the line used is the reserved 100 and 200 fits a 400 line');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 300.01, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/exceeds_line/100.00', 'AC-APR-050: one cent over the line goes to the senior set');

-- ── Case 3. Each cost once.
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d2', 'Labor', 50, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/300.00', 'AC-APR-050: a half-paid 300 order is 100 recorded + 200 open = 300 on the line, not 400');

-- ── Case 1 on PMO: recorded spending takes the line over at the boundary.
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d4', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/200.00', 'AC-APR-050: recorded 200 + request 200 = the 400 line: within, the project approver decides');
reset role;
update payments set amount = 200.01 where id = 'a0923000-0000-0000-0000-000000000c04';
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d4', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/exceeds_line/200.01', 'AC-APR-050: one cent of recorded spending more and the senior set decides');
select throws_ok($$ select transition_procurement('a0923000-0000-0000-0000-000000000f01', 'Approved') $$,
  '42501', 'approval routing: exceeds_line requires a named approver',
  'AC-APR-050: the project approver cannot approve what recorded spending took over the line');
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a2');
select lives_ok($$ select transition_procurement('a0923000-0000-0000-0000-000000000f01', 'Approved') $$,
  'AC-APR-050: a senior member approves it');

-- ── Case 1 on ERP: the ledger actual is the recorded spending.
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000b1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e1', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000b3'),
  'project/within_budget/200.00', 'AC-APR-050: ledger 200 + request 200 = the 400 line: within');
reset role;
update erp_actuals_snapshot set net = 200.01 where id = 'a0923000-0000-0000-0000-0000000005e1';
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000b1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e1', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000b3'),
  'org/exceeds_line/200.01', 'AC-APR-050: ledger 200.01 takes the line over: the senior set decides');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e2', 'Labor', 50, 'a0923000-0000-0000-0000-0000000000b3'),
  'project/within_budget/300.00', 'AC-APR-050: an ERP order billed 100 of 300 is the ledger 100 + open 200 = 300 on the line');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e3', 'Labor', 50, 'a0923000-0000-0000-0000-0000000000b3'),
  'project/within_budget/130.00', 'AC-APR-050: a claim already posted to the ledger is not counted again; the unposted 30 is');

-- ── Case 4. Spending not known: the senior set decides.
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e1', 'Materials', 10, 'a0923000-0000-0000-0000-0000000000b3'),
  'org/spending_unknown/null', 'AC-APR-052: a category with no account mapping has no recorded spending to read');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e4', 'Labor', 10, 'a0923000-0000-0000-0000-0000000000b3'),
  'org/spending_unknown/null', 'AC-APR-052: a project with no ledger reading has no recorded spending to read');
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000c2');
select is((select reason from spend_approval_route('a0923000-0000-0000-0000-00000000000c', 'a0923000-0000-0000-0000-0000000000f1', 'Labor', 10, 'USD', null)),
  'currency_mismatch', 'AC-APR-052: a ledger in another currency than the budget cannot be compared with it');
select is((select route from spend_approval_route('a0923000-0000-0000-0000-00000000000c', 'a0923000-0000-0000-0000-0000000000f1', 'Labor', 10, 'USD', null)),
  'org', 'AC-APR-052: so it goes to the senior set');

-- ── Case 7. The project test.
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d3', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/0.00', 'AC-APR-051: 800 recorded (uncategorized) + request 200 = the 1000 project budget exactly: not over');
reset role;
update payments set amount = 800.01 where id = 'a0923000-0000-0000-0000-000000000c03';
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d3', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/exceeds_project/0.00', 'AC-APR-051: the line fits (nothing recorded on Labor) but the project is over through uncategorized spending: senior set');

-- ── Case 5. Below approval rank: no figures, both possible sets.
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a3');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/spending_not_visible/null', 'AC-APR-053: an Engineer is shown who could decide, with no line figure');
select is((select approver_ids from spend_approval_route('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 200, 'USD', 'a0923000-0000-0000-0000-0000000000a3')),
  array['a0923000-0000-0000-0000-0000000000a1', 'a0923000-0000-0000-0000-0000000000a2']::uuid[],
  'AC-APR-053: the project approver and the senior set together');
select is((select line_budget from spend_approval_route('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 200, 'USD', 'a0923000-0000-0000-0000-0000000000a3')),
  null::numeric, 'AC-APR-053: and no line budget');
select is((select reason from spend_approval_route('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 200, 'EUR', 'a0923000-0000-0000-0000-0000000000a3')),
  'currency_mismatch', 'AC-APR-053: a request in another currency is still named as such');
select lives_ok($$ select transition_procurement('a0923000-0000-0000-0000-000000000f02', 'Requested') $$,
  'AC-APR-053: an Engineer submits without being refused for reading spending');
reset role;
select is(pg_temp.who('a0923000-0000-0000-0000-000000000f02'), array['a1', 'a2'],
  'AC-APR-053: the submit notifies the project approver and the senior set');

-- ── Case 6. The rank that may read spending is the rank that may approve: for every role, the two readers
-- the route calls (project_budget_positions, project_finance_actuals) open exactly when holds_spend_approval_authority says so.
insert into organizations (id, name, default_currency) values ('a0923000-0000-0000-0000-0000000009a0', 'Spend Route Rank', 'USD');
insert into auth.users (id, email) values
  ('a0923000-0000-0000-0000-0000000009a1', 'srs-rank-1@example.test'), ('a0923000-0000-0000-0000-0000000009a2', 'srs-rank-2@example.test'),
  ('a0923000-0000-0000-0000-0000000009a3', 'srs-rank-3@example.test'), ('a0923000-0000-0000-0000-0000000009a4', 'srs-rank-4@example.test'),
  ('a0923000-0000-0000-0000-0000000009a5', 'srs-rank-5@example.test');
insert into profiles (id, org_id, full_name, email, role, status)
select ('a0923000-0000-0000-0000-0000000009a' || r.n)::uuid, 'a0923000-0000-0000-0000-0000000009a0', 'SRS Rank ' || r.n,
       'srs-rank-' || r.n || '@example.test', r.role, 'active'
  from (select row_number() over () as n, e as role from unnest(enum_range(null::public.user_role)) e) r;
insert into projects (id, org_id, name, status, currency) values
  ('a0923000-0000-0000-0000-0000000009b0', 'a0923000-0000-0000-0000-0000000009a0', 'Rank gate', 'Ongoing Project', 'USD');
insert into budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('a0923000-0000-0000-0000-0000000009c0', 'a0923000-0000-0000-0000-0000000009a0', 'a0923000-0000-0000-0000-0000000009b0', 1, 'v1', 'Draft', 'USD');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount)
values ('a0923000-0000-0000-0000-0000000009a0', 'a0923000-0000-0000-0000-0000000009c0', 'Labor', 100);
update budget_versions set status = 'Active' where id = 'a0923000-0000-0000-0000-0000000009c0';
create function pg_temp.reads_positions(p_uid uuid) returns boolean language plpgsql as $$
begin
  perform pg_temp.act_as(p_uid);
  return exists (select 1 from public.project_budget_positions(array['a0923000-0000-0000-0000-0000000009b0']::uuid[]));
end $$;
create function pg_temp.reads_actuals(p_uid uuid) returns boolean language plpgsql as $$
begin
  perform pg_temp.act_as(p_uid);
  perform count(*) from public.project_finance_actuals('a0923000-0000-0000-0000-0000000009b0');
  return true;
exception when sqlstate '42501' then return false;
end $$;
-- The user list is fixed before the role switch: each reader call changes the JWT, which would change what profiles shows.
create temp table rank_users as select id, role from profiles where org_id = 'a0923000-0000-0000-0000-0000000009a0';
grant select on rank_users to authenticated;
set local role authenticated;
select is(coalesce((select array_agg(u.role::text order by u.role::text) filter (where pg_temp.reads_positions(u.id)) from rank_users u), array[]::text[]),
          coalesce((select array_agg(u.role::text order by u.role::text) filter (where public.holds_spend_approval_authority(u.role)) from rank_users u), array[]::text[]),
  'AC-APR-053: the roles that read the budget positions are exactly the roles that hold approval rank');
select is(coalesce((select array_agg(u.role::text order by u.role::text) filter (where pg_temp.reads_actuals(u.id)) from rank_users u), array[]::text[]),
          coalesce((select array_agg(u.role::text order by u.role::text) filter (where public.holds_spend_approval_authority(u.role)) from rank_users u), array[]::text[]),
  'AC-APR-053: the roles that read project spending are exactly the roles that hold approval rank (the rest get 42501)');
reset role;

-- A Finance member reads the same figures an Engineer is denied.
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a2');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/100.00', 'AC-APR-053: Finance reads the line figures');

-- ── Shape: invoker, same signature, no new definer.
reset role;
select is((select prosecdef from pg_proc where oid = 'public.spend_approval_route(uuid,uuid,public.budget_category,numeric,text,uuid,uuid,timestamptz)'::regprocedure), false,
  'AC-APR-050: the route still runs as the caller');
select is((select count(*)::int from pg_proc where proname = 'org_ledger_currency'), 0,
  'AC-APR-050: no new function carries the ledger currency; it is read from the budget position');

-- Reserved + open orders reach the project test: A reserved only, 1000 budget, 100 reserved.
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Materials', 600, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/0.00', 'AC-APR-051: reserved 100 + request 600 inside the project 1000 and the Materials 600 line');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d2', 'Materials', 600, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/0.00', 'AC-APR-051: recorded 100 + open 200 + request 600 = 900 of 1000: within');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d2', 'Materials', 600.01, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/exceeds_line/0.00', 'AC-APR-051: one cent over the Materials line is the line test first');
reset role;
update procurements set total_value = 401 where id = 'a0923000-0000-0000-0000-000000000a02';
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d2', 'Materials', 600, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/exceeds_project/0.00', 'AC-APR-051: recorded 100 + open 301 + request 600 is 1 over the project 1000: open orders reach the project test');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d2', 'Materials', 599, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/0.00', 'AC-APR-051: and 599 of it fits');


-- ── The list RPCs and the public route agree row for row, for every kind of caller.
reset role;
insert into procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, requested_by_id) values
  ('a0923000-0000-0000-0000-000000000e11', 'a0923000-0000-0000-0000-00000000000a', 'eq within',          'Requested', 200, 'a0923000-0000-0000-0000-0000000000d1', 'USD', 'Labor',     'a0923000-0000-0000-0000-0000000000a3'),
  ('a0923000-0000-0000-0000-000000000e12', 'a0923000-0000-0000-0000-00000000000a', 'eq over line',        'Requested', 200, 'a0923000-0000-0000-0000-0000000000d4', 'USD', 'Labor',     'a0923000-0000-0000-0000-0000000000a3'),
  ('a0923000-0000-0000-0000-000000000e13', 'a0923000-0000-0000-0000-00000000000a', 'eq over project',     'Requested', 200, 'a0923000-0000-0000-0000-0000000000d3', 'USD', 'Labor',     'a0923000-0000-0000-0000-0000000000a3'),
  ('a0923000-0000-0000-0000-000000000e14', 'a0923000-0000-0000-0000-00000000000a', 'eq over project open','Requested', 600, 'a0923000-0000-0000-0000-0000000000d2', 'USD', 'Materials', 'a0923000-0000-0000-0000-0000000000a3'),
  ('a0923000-0000-0000-0000-000000000e15', 'a0923000-0000-0000-0000-00000000000a', 'eq overhead',          'Requested',  50, null,                                   'USD', null,        'a0923000-0000-0000-0000-0000000000a3'),
  ('a0923000-0000-0000-0000-000000000e16', 'a0923000-0000-0000-0000-00000000000a', 'eq no category',      'Requested',  50, 'a0923000-0000-0000-0000-0000000000d1', 'USD', null,        'a0923000-0000-0000-0000-0000000000a3'),
  ('a0923000-0000-0000-0000-000000000e21', 'a0923000-0000-0000-0000-00000000000b', 'eq ledger over line', 'Requested', 200, 'a0923000-0000-0000-0000-0000000000e1', 'USD', 'Labor',     'a0923000-0000-0000-0000-0000000000b3'),
  ('a0923000-0000-0000-0000-000000000e22', 'a0923000-0000-0000-0000-00000000000b', 'eq unmapped',         'Requested',  10, 'a0923000-0000-0000-0000-0000000000e1', 'USD', 'Materials', 'a0923000-0000-0000-0000-0000000000b3'),
  ('a0923000-0000-0000-0000-000000000e23', 'a0923000-0000-0000-0000-00000000000b', 'eq no reading',       'Requested',  10, 'a0923000-0000-0000-0000-0000000000e4', 'USD', 'Labor',     'a0923000-0000-0000-0000-0000000000b3'),
  ('a0923000-0000-0000-0000-000000000e24', 'a0923000-0000-0000-0000-00000000000b', 'eq half billed',      'Requested',  50, 'a0923000-0000-0000-0000-0000000000e2', 'USD', 'Labor',     'a0923000-0000-0000-0000-0000000000b3'),
  ('a0923000-0000-0000-0000-000000000e25', 'a0923000-0000-0000-0000-00000000000b', 'eq claims in ledger', 'Requested',  50, 'a0923000-0000-0000-0000-0000000000e3', 'USD', 'Labor',     'a0923000-0000-0000-0000-0000000000b3'),
  ('a0923000-0000-0000-0000-000000000e31', 'a0923000-0000-0000-0000-00000000000c', 'eq ledger currency',  'Requested',  10, 'a0923000-0000-0000-0000-0000000000f1', 'USD', 'Labor',     'a0923000-0000-0000-0000-0000000000c2');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, currency, status, claim_number, submitted_at) values
  ('a0923000-0000-0000-0000-000000000e41', 'a0923000-0000-0000-0000-00000000000a', 'claim', 'a0923000-0000-0000-0000-0000000000a3', 'a0923000-0000-0000-0000-0000000000d4', 'Labor',     'eq claim over line', 100, 'USD', 'Submitted', 'EXP-SRS-0101', now()),
  ('a0923000-0000-0000-0000-000000000e42', 'a0923000-0000-0000-0000-00000000000a', 'claim', 'a0923000-0000-0000-0000-0000000000a3', 'a0923000-0000-0000-0000-0000000000d1', 'Labor',     'eq claim within',     50, 'USD', 'Submitted', 'EXP-SRS-0102', now()),
  ('a0923000-0000-0000-0000-000000000e43', 'a0923000-0000-0000-0000-00000000000b', 'claim', 'a0923000-0000-0000-0000-0000000000b3', 'a0923000-0000-0000-0000-0000000000e3', 'Labor',     'eq claim ledger',     50, 'USD', 'Submitted', 'EXP-SRS-0103', now()),
  ('a0923000-0000-0000-0000-000000000e44', 'a0923000-0000-0000-0000-00000000000b', 'claim', 'a0923000-0000-0000-0000-0000000000b3', 'a0923000-0000-0000-0000-0000000000e1', 'Materials', 'eq claim unmapped',   10, 'USD', 'Submitted', 'EXP-SRS-0104', now());

-- Rows where the list RPC and the public route differ, over every caller; and the rows compared.
create function pg_temp.eq_all() returns jsonb language plpgsql as $f$
declare u uuid; v_bad int := 0; v_n int := 0; v_reasons text[] := '{}'; r record; k int;
begin
  foreach u in array array['a0923000-0000-0000-0000-0000000000a1','a0923000-0000-0000-0000-0000000000a2','a0923000-0000-0000-0000-0000000000a3',
                           'a0923000-0000-0000-0000-0000000000b1','a0923000-0000-0000-0000-0000000000b2','a0923000-0000-0000-0000-0000000000b3',
                           'a0923000-0000-0000-0000-0000000000c2']::uuid[] loop
    perform pg_temp.act_as(u);
    for r in
      select g.reason as g_reason,
             (g.route, g.reason, g.line_budget, g.line_used) is distinct from (x.route, x.reason, x.line_budget, x.line_used)
             or g.approvers is distinct from coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'full_name', pf.full_name) order by pf.full_name)
                                                          from public.profiles pf where pf.id = any (x.approver_ids)), '[]'::jsonb) as differs
        from public.get_procurement_approval_routes(array(select id from public.procurements where title like 'eq %')) g
        join public.procurements p on p.id = g.procurement_id
        cross join lateral public.spend_approval_route(p.org_id, p.project_id, p.budget_category, g.request_amount, p.currency, p.requested_by_id,
                                                       nullif(auth.uid(), p.requested_by_id), public.procurement_submitted_at(p.id)) x
    loop
      v_n := v_n + 1; v_reasons := v_reasons || r.g_reason; if r.differs then v_bad := v_bad + 1; end if;
    end loop;
    for r in
      select g.reason as g_reason,
             (g.route, g.reason, g.line_budget, g.line_used) is distinct from (x.route, x.reason, x.line_budget, x.line_used) as differs
        from public.get_expense_claim_approval_routes(array(select id from public.expense_claims where title like 'eq %')) g
        join public.expense_claims c on c.id = g.claim_id
        cross join lateral public.spend_approval_route(c.org_id, c.project_id, c.budget_category, c.amount, c.currency, c.claimant_id,
                                                       nullif(auth.uid(), c.claimant_id), c.submitted_at) x
    loop
      v_n := v_n + 1; v_reasons := v_reasons || r.g_reason; if r.differs then v_bad := v_bad + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('bad', v_bad, 'compared', v_n, 'reasons', (select jsonb_agg(distinct x order by x) from unnest(v_reasons) x));
end $f$;
set local role authenticated;
select is(pg_temp.eq_all()->>'bad', '0',
  'AC-APR-054: for every Requested purchase and Submitted claim and every caller, the list RPCs return the route spend_approval_route returns');
select cmp_ok((pg_temp.eq_all()->>'compared')::int, '>=', 40,
  'AC-APR-054: and the comparison covers every row each caller can see');
select is(pg_temp.eq_all()->'reasons',
  '["currency_mismatch", "exceeds_line", "exceeds_project", "no_category", "no_project", "spending_not_visible", "spending_unknown", "within_budget"]'::jsonb,
  'AC-APR-054: across within, over-line, over-project, unknown, currency, role-free and below-rank rows');

-- ── The helper: figures are required, and rank is the caller's own.
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a3');
select is((select reason from spend_approval_route_from_figures('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 10, 'USD',
             'a0923000-0000-0000-0000-0000000000a3', null, null,
             '{"basis":"pmo","ledger_currency":"USD","budget_currency":"USD","proj_budget":999999,"proj_spent":0,"proj_open":0,"proj_reserved":0,"proj_foreign":false,
               "other_used":0,"foreign":false,"recorded":{"Labor":{"mapped":true,"amount":0}}}'::jsonb)),
  'spending_not_visible', 'AC-APR-053: an Engineer calling the logic with figures that say "within budget" still gets spending_not_visible');
select is((select line_used from spend_approval_route_from_figures('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 10, 'USD',
             'a0923000-0000-0000-0000-0000000000a3', null, null,
             '{"basis":"pmo","ledger_currency":"USD","budget_currency":"USD","proj_budget":999999,"proj_spent":0,"proj_open":0,"proj_reserved":0,"proj_foreign":false,
               "other_used":0,"foreign":false,"recorded":{"Labor":{"mapped":true,"amount":0}}}'::jsonb)),
  null::numeric, 'AC-APR-053: and no line figure comes back');
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select is((select reason from spend_approval_route_from_figures('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 10, 'USD',
             'a0923000-0000-0000-0000-0000000000a3', null, null,
             '{"ledger_currency":"USD","proj_budget":1000,"proj_spent":0,"proj_open":0,"proj_reserved":0,"other_used":0,"recorded":{"Labor":{"mapped":true,"amount":0}}}'::jsonb)),
  'spending_unknown', 'AC-APR-052: missing spending basis routes conservatively');
select is((select reason from spend_approval_route_from_figures('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 10, 'USD',
             'a0923000-0000-0000-0000-0000000000a3', null, null,
             '{"basis":"pmo","ledger_currency":"USD","proj_budget":1000,"proj_spent":0,"proj_open":0,"proj_reserved":0,"recorded":{"Labor":{"mapped":true,"amount":0}}}'::jsonb)),
  'spending_unknown', 'AC-APR-052: missing line commitments route conservatively');
select throws_ok($$ select * from spend_approval_route_from_figures('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 10, 'USD',
             'a0923000-0000-0000-0000-0000000000a3', null, null, null) $$,
  '22004', 'spend_approval_route_from_figures requires figures', 'AC-APR-054: the logic refuses to run without figures');

-- ── No senior set: the approver set never widens as a request gets riskier (org D has project approvers, no senior set).
reset role;
select set_config('request.jwt.claims', '', true);   -- fixtures are written as the table owner, with no acting user
insert into organizations (id, name, default_currency) values ('a0923000-0000-0000-0000-00000000000d', 'Spend Route no senior set', 'USD');
insert into auth.users (id, email) values
  ('a0923000-0000-0000-0000-0000000000f2', 'srs-pm-d@example.test'),
  ('a0923000-0000-0000-0000-0000000000f3', 'srs-eng-d@example.test'),
  ('a0923000-0000-0000-0000-0000000000f4', 'srs-pm-d2@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('a0923000-0000-0000-0000-0000000000f2', 'a0923000-0000-0000-0000-00000000000d', 'SRS PM D',  'srs-pm-d@example.test',  'Project Manager', 'active'),
  ('a0923000-0000-0000-0000-0000000000f3', 'a0923000-0000-0000-0000-00000000000d', 'SRS Eng D', 'srs-eng-d@example.test', 'Engineer',        'active'),
  ('a0923000-0000-0000-0000-0000000000f4', 'a0923000-0000-0000-0000-00000000000d', 'SRS PM D2', 'srs-pm-d2@example.test', 'Project Manager', 'disabled');
insert into projects (id, org_id, name, status, currency) values
  ('a0923000-0000-0000-0000-000000000501', 'a0923000-0000-0000-0000-00000000000d', 'D over line',        'Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-000000000502', 'a0923000-0000-0000-0000-00000000000d', 'D over project',     'Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-000000000503', 'a0923000-0000-0000-0000-00000000000d', 'D unknown spending', 'Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-000000000504', 'a0923000-0000-0000-0000-00000000000d', 'D no named approver','Ongoing Project', 'USD'),
  ('a0923000-0000-0000-0000-000000000505', 'a0923000-0000-0000-0000-00000000000d', 'D named but disabled','Ongoing Project', 'USD');
insert into budget_versions (id, org_id, project_id, version, name, status, currency)
select ('a0923000-0000-0000-0000-000000000' || (p.n + 200)::text)::uuid, 'a0923000-0000-0000-0000-00000000000d', p.id, 1, 'v1', 'Draft', 'USD'
  from (select id, right(id::text, 3)::int as n from projects where org_id = 'a0923000-0000-0000-0000-00000000000d') p;
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount)
select v.org_id, v.id, c.category, c.amount
  from budget_versions v cross join (values ('Labor'::budget_category, 400::numeric), ('Materials', 600)) c(category, amount)
 where v.org_id = 'a0923000-0000-0000-0000-00000000000d';
update budget_versions set status = 'Active' where org_id = 'a0923000-0000-0000-0000-00000000000d';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('a0923000-0000-0000-0000-00000000000d', 'a0923000-0000-0000-0000-000000000501', 'a0923000-0000-0000-0000-0000000000f2'),
  ('a0923000-0000-0000-0000-00000000000d', 'a0923000-0000-0000-0000-000000000502', 'a0923000-0000-0000-0000-0000000000f2'),
  ('a0923000-0000-0000-0000-00000000000d', 'a0923000-0000-0000-0000-000000000503', 'a0923000-0000-0000-0000-0000000000f2'),
  ('a0923000-0000-0000-0000-00000000000d', 'a0923000-0000-0000-0000-000000000505', 'a0923000-0000-0000-0000-0000000000f4');
insert into procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, requested_by_id, approved_total_value) values
  ('a0923000-0000-0000-0000-000000000d01', 'a0923000-0000-0000-0000-00000000000d', 'D paid 250 labor',   'Paid',    250, 'a0923000-0000-0000-0000-000000000501', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000f3', 1000),
  ('a0923000-0000-0000-0000-000000000d02', 'a0923000-0000-0000-0000-00000000000d', 'D paid 900 nocat',   'Paid',    900, 'a0923000-0000-0000-0000-000000000502', 'USD', null,    'a0923000-0000-0000-0000-0000000000f3', 1000),
  ('a0923000-0000-0000-0000-000000000d03', 'a0923000-0000-0000-0000-00000000000d', 'D paid in EUR',      'Ordered', 100, 'a0923000-0000-0000-0000-000000000503', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000f3', 1000),
  ('a0923000-0000-0000-0000-000000000d04', 'a0923000-0000-0000-0000-00000000000d', 'D paid 250 labor 504','Paid',    250, 'a0923000-0000-0000-0000-000000000504', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000f3', 1000),
  ('a0923000-0000-0000-0000-000000000d05', 'a0923000-0000-0000-0000-00000000000d', 'D paid 250 labor 505','Paid',    250, 'a0923000-0000-0000-0000-000000000505', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000f3', 1000);
insert into payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('a0923000-0000-0000-0000-000000000d11', 'a0923000-0000-0000-0000-00000000000d', 'a0923000-0000-0000-0000-000000000d01', 'Paid', '2026-10-10', 250, 'USD'),
  ('a0923000-0000-0000-0000-000000000d12', 'a0923000-0000-0000-0000-00000000000d', 'a0923000-0000-0000-0000-000000000d02', 'Paid', '2026-10-10', 900, 'USD'),
  ('a0923000-0000-0000-0000-000000000d13', 'a0923000-0000-0000-0000-00000000000d', 'a0923000-0000-0000-0000-000000000d03', 'Paid', '2026-10-10',  50, 'EUR'),
  ('a0923000-0000-0000-0000-000000000d14', 'a0923000-0000-0000-0000-00000000000d', 'a0923000-0000-0000-0000-000000000d04', 'Paid', '2026-10-10', 250, 'USD'),
  ('a0923000-0000-0000-0000-000000000d15', 'a0923000-0000-0000-0000-00000000000d', 'a0923000-0000-0000-0000-000000000d05', 'Paid', '2026-10-10', 250, 'USD');
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000f2');
create function pg_temp.rd(p_project uuid, p_amt numeric) returns text language sql stable as $$
  select r.route || '/' || r.reason || '/' || coalesce(r.approver_ids::text, 'null')
    from public.spend_approval_route('a0923000-0000-0000-0000-00000000000d', p_project, 'Labor', p_amt, 'USD', 'a0923000-0000-0000-0000-0000000000f3') r $$;
select is(pg_temp.rd('a0923000-0000-0000-0000-000000000501', 200),
  'project/exceeds_line/{a0923000-0000-0000-0000-0000000000f2}', 'AC-APR-055: over the line with no senior set goes to the project''s named approver, not to everyone');
select is(pg_temp.rd('a0923000-0000-0000-0000-000000000502', 200),
  'project/exceeds_project/{a0923000-0000-0000-0000-0000000000f2}', 'AC-APR-055: over the project with no senior set goes to the project''s named approver');
select is(pg_temp.rd('a0923000-0000-0000-0000-000000000503', 10),
  'project/spending_unknown/{a0923000-0000-0000-0000-0000000000f2}', 'AC-APR-055: unknown spending with no senior set goes to the project''s named approver');
select is(pg_temp.rd('a0923000-0000-0000-0000-000000000504', 200),
  'flat/exceeds_line/null', 'AC-APR-055: with no named approver either the flat matrix applies');
select is(pg_temp.rd('a0923000-0000-0000-0000-000000000505', 200),
  'admin/exceeds_line/{}', 'AC-APR-055: a named approver nobody can act as leaves it to an Admin, not to everyone');
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000f3');
select is((select route || '/' || reason || '/' || approver_ids::text from spend_approval_route('a0923000-0000-0000-0000-00000000000d', 'a0923000-0000-0000-0000-000000000501', 'Labor', 200, 'USD', 'a0923000-0000-0000-0000-0000000000f3')),
  'project/spending_not_visible/{a0923000-0000-0000-0000-0000000000f2}', 'AC-APR-055: below approval rank with no senior set names the project''s named approver');
select is((select route from spend_approval_route('a0923000-0000-0000-0000-00000000000d', 'a0923000-0000-0000-0000-000000000504', 'Labor', 200, 'USD', 'a0923000-0000-0000-0000-0000000000f3')),
  'flat', 'AC-APR-055: and with none named, flat');
select is((select route || '/' || reason from spend_approval_route('a0923000-0000-0000-0000-00000000000d', null, 'Labor', 200, 'USD', 'a0923000-0000-0000-0000-0000000000f3')),
  'flat/no_project', 'AC-APR-055: overhead spend, which has no project, stays flat when nothing is configured');
-- the list read and the route agree here too
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000f2');
reset role;
insert into procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, requested_by_id) values
  ('a0923000-0000-0000-0000-000000000e51', 'a0923000-0000-0000-0000-00000000000d', 'eq D over line',    'Requested', 200, 'a0923000-0000-0000-0000-000000000501', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000f3'),
  ('a0923000-0000-0000-0000-000000000e52', 'a0923000-0000-0000-0000-00000000000d', 'eq D unknown',      'Requested',  10, 'a0923000-0000-0000-0000-000000000503', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000f3'),
  ('a0923000-0000-0000-0000-000000000e53', 'a0923000-0000-0000-0000-00000000000d', 'eq D no approver',  'Requested', 200, 'a0923000-0000-0000-0000-000000000504', 'USD', 'Labor', 'a0923000-0000-0000-0000-0000000000f3');
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000f2');
select is((select string_agg(g.route || '/' || g.reason, ',' order by g.route || '/' || g.reason) from get_procurement_approval_routes(array(select id from procurements where title like 'eq D %')) g),
  'flat/exceeds_line,project/exceeds_line,project/spending_unknown', 'AC-APR-055: the list read returns the same routes');
select is((select count(*)::int from get_procurement_approval_routes(array(select id from procurements where title like 'eq D %')) g
            where g.route = 'project' and g.approvers = '[{"id":"a0923000-0000-0000-0000-0000000000f2","full_name":"SRS PM D"}]'::jsonb), 2,
  'AC-APR-055: and names the named approver');

-- ── Structure: the figure readers and the logic are reached only from the route and the two list RPCs.
reset role;
select is((select array_agg(proname::text order by proname) from pg_proc
            where pronamespace = 'public'::regnamespace and prosrc like '%spend_approval_route_from_figures%'
              and proname <> 'spend_approval_route_from_figures'),
  array['get_expense_claim_approval_routes', 'get_procurement_approval_routes', 'spend_approval_route'],
  'AC-APR-054: only the route and the two list RPCs call the figures-taking logic');
select is((select array_agg(proname::text order by proname) from pg_proc
            where pronamespace = 'public'::regnamespace
              and (prosrc like '%spend_approval_project_figures%' or prosrc like '%spend_approval_line_figures%')
              and proname not in ('spend_approval_project_figures', 'spend_approval_line_figures')),
  array['get_expense_claim_approval_routes', 'get_procurement_approval_routes', 'spend_approval_route'],
  'AC-APR-054: only the route and the two list RPCs read the figures');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
             and proname in ('spend_approval_route', 'spend_approval_route_from_figures', 'spend_approval_project_figures',
                             'spend_approval_line_figures', 'get_procurement_approval_routes', 'get_expense_claim_approval_routes')), 0,
  'AC-APR-054: none of them is a definer');
select is((select bool_or(has_function_privilege('anon', oid, 'execute')) from pg_proc
            where pronamespace = 'public'::regnamespace and proname in ('spend_approval_route_from_figures', 'spend_approval_project_figures', 'spend_approval_line_figures')),
  false, 'AC-APR-054: anonymous callers cannot execute the figure functions');
select ok((select obj_description('public.spend_approval_route_from_figures(uuid,uuid,public.budget_category,numeric,text,uuid,uuid,timestamptz,jsonb)'::regprocedure, 'pg_proc')) like 'DISPLAY ONLY%spend_approval_route%',
  'AC-APR-054: the logic is documented as display only and names the route every decision uses');


-- Cross-category project usage is decided through the actual approval RPC.
reset role;
insert into projects (id, org_id, name, status, currency) values
 ('a0923000-0000-0000-0000-000000000801','a0923000-0000-0000-0000-00000000000a','Cross claim','Ongoing Project','USD'),
 ('a0923000-0000-0000-0000-000000000802','a0923000-0000-0000-0000-00000000000a','Cross reservation','Ongoing Project','USD');
insert into budget_versions (id, org_id, project_id, version, name, status, currency) values
 ('a0923000-0000-0000-0000-000000000811','a0923000-0000-0000-0000-00000000000a','a0923000-0000-0000-0000-000000000801',1,'v1','Draft','USD'),
 ('a0923000-0000-0000-0000-000000000812','a0923000-0000-0000-0000-00000000000a','a0923000-0000-0000-0000-000000000802',1,'v1','Draft','USD');
insert into budget_line_items (org_id,budget_version_id,category,budgeted_amount)
select 'a0923000-0000-0000-0000-00000000000a', v.id, c.category, c.amount
from budget_versions v cross join (values ('Labor'::budget_category,400::numeric),('Materials'::budget_category,600::numeric)) c(category,amount)
where v.id in ('a0923000-0000-0000-0000-000000000811','a0923000-0000-0000-0000-000000000812');
update budget_versions set status='Active' where id in ('a0923000-0000-0000-0000-000000000811','a0923000-0000-0000-0000-000000000812');
insert into spend_approvers (org_id,project_id,profile_id)
select 'a0923000-0000-0000-0000-00000000000a', id, 'a0923000-0000-0000-0000-0000000000a1' from projects
where id in ('a0923000-0000-0000-0000-000000000801','a0923000-0000-0000-0000-000000000802');
insert into expense_claims (id,org_id,kind,claimant_id,project_id,budget_category,title,amount,currency,status,claim_number,submitted_at) values
 ('a0923000-0000-0000-0000-000000000821','a0923000-0000-0000-0000-00000000000a','claim','a0923000-0000-0000-0000-0000000000a3','a0923000-0000-0000-0000-000000000801','Labor','Cross claim',600,'USD','Approved','EXP-CROSS-1',now());
insert into procurements (id,org_id,title,status,total_value,project_id,currency,budget_category,requested_by_id) values
 ('a0923000-0000-0000-0000-000000000831','a0923000-0000-0000-0000-00000000000a','Cross claim request','Requested',500,'a0923000-0000-0000-0000-000000000801','USD','Materials','a0923000-0000-0000-0000-0000000000a3'),
 ('a0923000-0000-0000-0000-000000000832','a0923000-0000-0000-0000-00000000000a','Itemized reservation','Approved',0,'a0923000-0000-0000-0000-000000000802','USD','Labor','a0923000-0000-0000-0000-0000000000a3'),
 ('a0923000-0000-0000-0000-000000000833','a0923000-0000-0000-0000-00000000000a','Cross reservation request','Requested',500,'a0923000-0000-0000-0000-000000000802','USD','Materials','a0923000-0000-0000-0000-0000000000a3');
insert into procurement_items (org_id,procurement_id,name,quantity,rate) values
 ('a0923000-0000-0000-0000-00000000000a','a0923000-0000-0000-0000-000000000832','Item',1,600);
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select throws_ok($$ select transition_procurement('a0923000-0000-0000-0000-000000000831','Approved') $$,
 '42501', 'approval routing: exceeds_project requires a named approver', 'AC-APR-051: cross-category claim consumes project headroom');
select throws_ok($$ select transition_procurement('a0923000-0000-0000-0000-000000000833','Approved') $$,
 '42501', 'approval routing: exceeds_project requires a named approver', 'AC-APR-051: itemized reservation consumes project headroom');
reset role;


-- ERP project usage counts unposted claims across categories and excludes posted claims already in the ledger.
insert into expense_claims (id,org_id,kind,claimant_id,project_id,budget_category,title,amount,currency,status,claim_number,submitted_at) values
 ('a0923000-0000-0000-0000-000000000841','a0923000-0000-0000-0000-00000000000b','claim','a0923000-0000-0000-0000-0000000000b3','a0923000-0000-0000-0000-0000000000e3','Materials','Cross ERP claim',600,'USD','Approved','EXP-CROSS-ERP',now());
insert into procurements (id,org_id,title,status,total_value,project_id,currency,budget_category,requested_by_id) values
 ('a0923000-0000-0000-0000-000000000842','a0923000-0000-0000-0000-00000000000b','ERP boundary','Requested',250,'a0923000-0000-0000-0000-0000000000e3','USD','Labor','a0923000-0000-0000-0000-0000000000b3'),
 ('a0923000-0000-0000-0000-000000000843','a0923000-0000-0000-0000-00000000000b','ERP over','Requested',250,'a0923000-0000-0000-0000-0000000000e3','USD','Labor','a0923000-0000-0000-0000-0000000000b3');
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000b1');
select is((select reason from get_procurement_approval_routes(array['a0923000-0000-0000-0000-000000000842'::uuid])), 'within_budget',
 'AC-APR-051: posted ERP claim already in recorded actual is not counted twice');
reset role;
update expense_claims set amount = 700 where id = 'a0923000-0000-0000-0000-000000000841';
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000b1');
select throws_ok($$ select transition_procurement('a0923000-0000-0000-0000-000000000843','Approved') $$,
 '42501', 'approval routing: exceeds_project requires a named approver', 'AC-APR-051: cross-category unposted ERP claim consumes project headroom');
reset role;

select * from finish();
rollback;
