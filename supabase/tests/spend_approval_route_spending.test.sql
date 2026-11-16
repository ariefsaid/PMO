-- spend_approval_route_spending.test.sql — the line a request is judged against counts recorded spending + open
-- orders + reserved + approved claims not yet in the ledger, each once; then the project's whole budget is
-- tested the same way. Migration: 0923_spend_route_recorded_spending.sql.
-- AC-APR-030 line test · AC-APR-031 project test · AC-APR-032 spending unknown · AC-APR-033 below approval rank.
begin;
select plan(32);

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
  'project/within_budget/100.00', 'AC-APR-030: with nothing recorded the line used is the reserved 100 and 200 fits a 400 line');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 300.01, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/exceeds_line/100.00', 'AC-APR-030: one cent over the line goes to the senior set');

-- ── Case 3. Each cost once.
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d2', 'Labor', 50, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/300.00', 'AC-APR-030: a half-paid 300 order is 100 recorded + 200 open = 300 on the line, not 400');

-- ── Case 1 on PMO: recorded spending takes the line over at the boundary.
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d4', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/200.00', 'AC-APR-030: recorded 200 + request 200 = the 400 line: within, the project approver decides');
reset role;
update payments set amount = 200.01 where id = 'a0923000-0000-0000-0000-000000000c04';
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d4', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/exceeds_line/200.01', 'AC-APR-030: one cent of recorded spending more and the senior set decides');
select throws_ok($$ select transition_procurement('a0923000-0000-0000-0000-000000000f01', 'Approved') $$,
  '42501', 'approval routing: exceeds_line requires a named approver',
  'AC-APR-030: the project approver cannot approve what recorded spending took over the line');
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a2');
select lives_ok($$ select transition_procurement('a0923000-0000-0000-0000-000000000f01', 'Approved') $$,
  'AC-APR-030: a senior member approves it');

-- ── Case 1 on ERP: the ledger actual is the recorded spending.
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000b1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e1', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000b3'),
  'project/within_budget/200.00', 'AC-APR-030: ledger 200 + request 200 = the 400 line: within');
reset role;
update erp_actuals_snapshot set net = 200.01 where id = 'a0923000-0000-0000-0000-0000000005e1';
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000b1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e1', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000b3'),
  'org/exceeds_line/200.01', 'AC-APR-030: ledger 200.01 takes the line over: the senior set decides');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e2', 'Labor', 50, 'a0923000-0000-0000-0000-0000000000b3'),
  'project/within_budget/300.00', 'AC-APR-030: an ERP order billed 100 of 300 is the ledger 100 + open 200 = 300 on the line');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e3', 'Labor', 50, 'a0923000-0000-0000-0000-0000000000b3'),
  'project/within_budget/130.00', 'AC-APR-030: a claim already posted to the ledger is not counted again; the unposted 30 is');

-- ── Case 4. Spending not known: the senior set decides.
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e1', 'Materials', 10, 'a0923000-0000-0000-0000-0000000000b3'),
  'org/spending_unknown/null', 'AC-APR-032: a category with no account mapping has no recorded spending to read');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000b', 'a0923000-0000-0000-0000-0000000000e4', 'Labor', 10, 'a0923000-0000-0000-0000-0000000000b3'),
  'org/spending_unknown/null', 'AC-APR-032: a project with no ledger reading has no recorded spending to read');
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000c2');
select is((select reason from spend_approval_route('a0923000-0000-0000-0000-00000000000c', 'a0923000-0000-0000-0000-0000000000f1', 'Labor', 10, 'USD', null)),
  'currency_mismatch', 'AC-APR-032: a ledger in another currency than the budget cannot be compared with it');
select is((select route from spend_approval_route('a0923000-0000-0000-0000-00000000000c', 'a0923000-0000-0000-0000-0000000000f1', 'Labor', 10, 'USD', null)),
  'org', 'AC-APR-032: so it goes to the senior set');

-- ── Case 7. The project test.
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d3', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/0.00', 'AC-APR-031: 800 recorded (uncategorized) + request 200 = the 1000 project budget exactly: not over');
reset role;
update payments set amount = 800.01 where id = 'a0923000-0000-0000-0000-000000000c03';
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d3', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/exceeds_project/0.00', 'AC-APR-031: the line fits (nothing recorded on Labor) but the project is over through uncategorized spending: senior set');

-- ── Case 5. Below approval rank: no figures, both possible sets.
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a3');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/spending_not_visible/null', 'AC-APR-033: an Engineer is shown who could decide, with no line figure');
select is((select approver_ids from spend_approval_route('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 200, 'USD', 'a0923000-0000-0000-0000-0000000000a3')),
  array['a0923000-0000-0000-0000-0000000000a1', 'a0923000-0000-0000-0000-0000000000a2']::uuid[],
  'AC-APR-033: the project approver and the senior set together');
select is((select line_budget from spend_approval_route('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 200, 'USD', 'a0923000-0000-0000-0000-0000000000a3')),
  null::numeric, 'AC-APR-033: and no line budget');
select is((select reason from spend_approval_route('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 200, 'EUR', 'a0923000-0000-0000-0000-0000000000a3')),
  'currency_mismatch', 'AC-APR-033: a request in another currency is still named as such');
select lives_ok($$ select transition_procurement('a0923000-0000-0000-0000-000000000f02', 'Requested') $$,
  'AC-APR-033: an Engineer submits without being refused for reading spending');
reset role;
select is(pg_temp.who('a0923000-0000-0000-0000-000000000f02'), array['a1', 'a2'],
  'AC-APR-033: the submit notifies the project approver and the senior set');

-- ── Case 6. The rank that may read spending is the rank that may approve.
select is((select bool_and(public.holds_spend_approval_authority(r) = (r::text in ('Admin', 'Finance', 'Executive', 'Project Manager')))
             from unnest(enum_range(null::public.user_role)) r), true,
  'AC-APR-033: approval rank is exactly the roles that may read project spending');

-- A Finance member reads the same figures an Engineer is denied.
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a2');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Labor', 200, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/100.00', 'AC-APR-033: Finance reads the line figures');

-- ── Shape: invoker, same signature, no new definer.
reset role;
select is((select prosecdef from pg_proc where oid = 'public.spend_approval_route(uuid,uuid,public.budget_category,numeric,text,uuid,uuid,timestamptz)'::regprocedure), false,
  'AC-APR-030: the route still runs as the caller');
select is((select count(*)::int from pg_proc where proname = 'org_ledger_currency'), 0,
  'AC-APR-030: no new function carries the ledger currency; it is read from the budget position');

-- Reserved + open orders reach the project test: A reserved only, 1000 budget, 100 reserved.
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d1', 'Materials', 600, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/0.00', 'AC-APR-031: reserved 100 + request 600 inside the project 1000 and the Materials 600 line');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d2', 'Materials', 600, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/0.00', 'AC-APR-031: recorded 100 + open 200 + request 600 = 900 of 1000: within');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d2', 'Materials', 600.01, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/exceeds_line/0.00', 'AC-APR-031: one cent over the Materials line is the line test first');
reset role;
update procurements set total_value = 401 where id = 'a0923000-0000-0000-0000-000000000a02';
set local role authenticated;
select pg_temp.act_as('a0923000-0000-0000-0000-0000000000a1');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d2', 'Materials', 600, 'a0923000-0000-0000-0000-0000000000a3'),
  'org/exceeds_project/0.00', 'AC-APR-031: recorded 100 + open 301 + request 600 is 1 over the project 1000: open orders reach the project test');
select is(pg_temp.r('a0923000-0000-0000-0000-00000000000a', 'a0923000-0000-0000-0000-0000000000d2', 'Materials', 599, 'a0923000-0000-0000-0000-0000000000a3'),
  'project/within_budget/0.00', 'AC-APR-031: and 599 of it fits');

reset role;
select * from finish();
rollback;
