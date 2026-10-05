-- spend_approval_classify.test.sql — #803 "within budget" classification, read through the UI RPC.
-- AC-APR-006 (Reserved+Committed count), 007 (greater of header/items), 011 (no category),
-- 012 (currency), 019 (route + approvers + scoping); DD-APR-3 (a budget activated after submission routes
-- to the senior set) and DD-APR-5 (amounts route up, never down). Migration: 0243_spend_approval_routing.sql.
begin;
select plan(31);

insert into organizations (id, name, default_currency) values
  ('02342000-0000-0000-0000-00000000000a', 'APR Cls Org A', 'IDR'),
  ('02342000-0000-0000-0000-00000000000b', 'APR Cls Org B', 'IDR');
insert into auth.users (id, email) values
  ('02342000-0000-0000-0000-0000000000a1', 'apr-cls-viewer@example.com'),
  ('02342000-0000-0000-0000-0000000000a2', 'apr-cls-pm-approver@example.com'),
  ('02342000-0000-0000-0000-0000000000a3', 'apr-cls-fin-senior@example.com'),
  ('02342000-0000-0000-0000-0000000000a4', 'apr-cls-exec-senior@example.com'),
  ('02342000-0000-0000-0000-0000000000a5', 'apr-cls-eng@example.com'),
  ('02342000-0000-0000-0000-0000000000b1', 'apr-cls-pm-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02342000-0000-0000-0000-0000000000a1','02342000-0000-0000-0000-00000000000a','Cls PM Viewer','apr-cls-viewer@example.com','Project Manager','active'),
  ('02342000-0000-0000-0000-0000000000a2','02342000-0000-0000-0000-00000000000a','Cls PM Approver','apr-cls-pm-approver@example.com','Project Manager','active'),
  ('02342000-0000-0000-0000-0000000000a3','02342000-0000-0000-0000-00000000000a','Cls Finance Senior','apr-cls-fin-senior@example.com','Finance','active'),
  ('02342000-0000-0000-0000-0000000000a4','02342000-0000-0000-0000-00000000000a','Cls Exec Senior','apr-cls-exec-senior@example.com','Executive','active'),
  ('02342000-0000-0000-0000-0000000000a5','02342000-0000-0000-0000-00000000000a','Cls Engineer','apr-cls-eng@example.com','Engineer','active'),
  ('02342000-0000-0000-0000-0000000000b1','02342000-0000-0000-0000-00000000000b','Cls PM B','apr-cls-pm-b@example.com','Project Manager','active');

insert into projects (id, org_id, name, status) values
  ('02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-00000000000a','Cls Project','Ongoing Project'),
  ('02342000-0000-0000-0000-000000000102','02342000-0000-0000-0000-00000000000a','Cls Budget Changed','Ongoing Project'),
  ('02342000-0000-0000-0000-000000000103','02342000-0000-0000-0000-00000000000a','Cls Budget Settled','Ongoing Project');
-- budget_line_items_draft_guard: lines only land on a Draft version, so seed Draft → lines → Active.
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02342000-0000-0000-0000-000000000201','02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000101','v1',1,'Draft'),
  ('02342000-0000-0000-0000-000000000202','02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000102','v1',1,'Draft'),
  ('02342000-0000-0000-0000-000000000203','02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000103','v1',1,'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount, fiscal_year) values
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000201','Materials',1000,'FY-A'),
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000201','Materials', 500,'FY-B'),
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000201','Labor',     300,null),
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000201','Equipment',1000,null),
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000201','Subcontractors',1000,null),
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000202','Materials',1000,null),
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000203','Materials',1000,null);
update budget_versions set status = 'Active' where id in ('02342000-0000-0000-0000-000000000201');
-- DD-APR-3: 202 was activated just now (after its request was submitted); 203 two days ago (before).
update budget_versions set status = 'Active', activated_at = now()                    where id = '02342000-0000-0000-0000-000000000202';
update budget_versions set status = 'Active', activated_at = now() - interval '2 days' where id = '02342000-0000-0000-0000-000000000203';

insert into spend_approvers (org_id, project_id, profile_id) values
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a2'),
  ('02342000-0000-0000-0000-00000000000a',null,'02342000-0000-0000-0000-0000000000a3'),
  ('02342000-0000-0000-0000-00000000000a',null,'02342000-0000-0000-0000-0000000000a4');

-- id suffix: 3xx = already on the line (Reserved/Committed), 4xx = Requested under test.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category, currency) values
  ('02342000-0000-0000-0000-000000000301','02342000-0000-0000-0000-00000000000a','Labor reserved', '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Approved',100,'Labor','IDR'),
  ('02342000-0000-0000-0000-000000000302','02342000-0000-0000-0000-00000000000a','Labor paid',     '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Paid',    100,'Labor','IDR'),
  ('02342000-0000-0000-0000-000000000401','02342000-0000-0000-0000-00000000000a','Labor request',  '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested',150,'Labor','IDR'),
  ('02342000-0000-0000-0000-000000000402','02342000-0000-0000-0000-00000000000a','Equipment items','02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested',100,'Equipment','IDR'),
  ('02342000-0000-0000-0000-000000000403','02342000-0000-0000-0000-00000000000a','No category',    '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested', 10,null,'IDR'),
  ('02342000-0000-0000-0000-000000000404','02342000-0000-0000-0000-00000000000a','Euro request',   '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested', 10,'Materials','EUR'),
  ('02342000-0000-0000-0000-000000000405','02342000-0000-0000-0000-00000000000a','Materials fits', '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested',600,'Materials','IDR'),
  ('02342000-0000-0000-0000-000000000406','02342000-0000-0000-0000-00000000000a','Overhead',       null,                                  '02342000-0000-0000-0000-0000000000a5','Requested', 50,null,'IDR');
insert into procurement_items (org_id, procurement_id, name, quantity, rate) values
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000402','Generator', 3, 400);

-- DD-APR-3: two within-line requests, both submitted yesterday (the submission event is what dates them).
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category, currency) values
  ('02342000-0000-0000-0000-000000000407','02342000-0000-0000-0000-00000000000a','After budget change','02342000-0000-0000-0000-000000000102','02342000-0000-0000-0000-0000000000a5','Requested',100,'Materials','IDR'),
  ('02342000-0000-0000-0000-000000000408','02342000-0000-0000-0000-00000000000a','Budget settled',     '02342000-0000-0000-0000-000000000103','02342000-0000-0000-0000-0000000000a5','Requested',100,'Materials','IDR');
insert into procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, created_at) values
  ('02342000-0000-0000-0000-000000000407','02342000-0000-0000-0000-00000000000a','Draft','Requested','02342000-0000-0000-0000-0000000000a5', now() - interval '1 day'),
  ('02342000-0000-0000-0000-000000000408','02342000-0000-0000-0000-00000000000a','Draft','Requested','02342000-0000-0000-0000-0000000000a5', now() - interval '1 day');

-- DD-APR-5: amounts are never negative from here on…
select throws_ok($$ insert into procurements (org_id, title, total_value) values ('02342000-0000-0000-0000-00000000000a','Neg header',-1) $$,
  '23514', 'new row for relation "procurements" violates check constraint "procurements_total_value_nonneg"',
  'DD-APR-5: a request header total cannot be negative');
select throws_ok($$ insert into procurement_items (org_id, procurement_id, name, quantity, rate) values ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000402','Neg qty',-1,10) $$,
  '23514', 'new row for relation "procurement_items" violates check constraint "procurement_items_quantity_nonneg"',
  'DD-APR-5: a request line quantity cannot be negative');
select throws_ok($$ insert into procurement_items (org_id, procurement_id, name, quantity, rate) values ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000402','Neg rate',1,-10) $$,
  '23514', 'new row for relation "procurement_items" violates check constraint "procurement_items_rate_nonneg"',
  'DD-APR-5: a request line rate cannot be negative');
select is((select count(*)::int from pg_constraint
            where conname in ('procurements_total_value_nonneg','procurement_items_quantity_nonneg','procurement_items_rate_nonneg')
              and not convalidated), 3,
  'DD-APR-5: the three non-negative rules are NOT VALID (rows that predate them are not re-checked)');
-- …but rows that predate the rule can hold them, so the routing must still route them up. Simulate such rows.
alter table procurement_items drop constraint if exists procurement_items_quantity_nonneg;
alter table procurement_items drop constraint if exists procurement_items_rate_nonneg;
alter table procurements      drop constraint if exists procurements_total_value_nonneg;
-- 409: a negative line pulls Σ lines down to 100 · 410: a negative header · 3xx Subcontractors: a request
-- already on the line whose header and lines are both negative, plus a normal 200 · 411: 900 more.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category, currency) values
  ('02342000-0000-0000-0000-000000000409','02342000-0000-0000-0000-00000000000a','Negative line',  '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested',  0,'Materials','IDR'),
  ('02342000-0000-0000-0000-000000000410','02342000-0000-0000-0000-00000000000a','Negative header','02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested',-50,'Materials','IDR'),
  ('02342000-0000-0000-0000-000000000303','02342000-0000-0000-0000-00000000000a','Sub negative',   '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Approved',-5000,'Subcontractors','IDR'),
  ('02342000-0000-0000-0000-000000000304','02342000-0000-0000-0000-00000000000a','Sub reserved',   '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Approved',  200,'Subcontractors','IDR'),
  ('02342000-0000-0000-0000-000000000411','02342000-0000-0000-0000-00000000000a','Sub request',    '02342000-0000-0000-0000-000000000101','02342000-0000-0000-0000-0000000000a5','Requested', 900,'Subcontractors','IDR');
insert into procurement_items (org_id, procurement_id, name, quantity, rate) values
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000409','Steel',   1,  900),
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000409','Credit', -1,  800),
  ('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000303','Credit', -1, 5000);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02342000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-APR-006: Labor 300; Approved 100 + Paid 100 already on it; 150 more does not fit.
select is((select reason    from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000401']::uuid[])), 'exceeds_line',
  'AC-APR-006: Reserved and Committed spend both count against the line');
select is((select route     from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000401']::uuid[])), 'org',
  'AC-APR-006: an over-line request routes to the senior set');
select is((select line_used from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000401']::uuid[])), 200::numeric,
  'AC-APR-006: line used = Approved 100 + Paid 100');

-- AC-APR-007: header 100, items 3 x 400 = 1200 against an Equipment line of 1000.
select is((select request_amount from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000402']::uuid[])), 1200::numeric,
  'AC-APR-007: request amount is the greater of header total and line items');
select is((select reason from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000402']::uuid[])), 'exceeds_line',
  'AC-APR-007: the line-item value is what is checked against the line');

-- AC-APR-011: project request with no category.
select is((select reason from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000403']::uuid[])), 'no_category',
  'AC-APR-011: a project request with no budget category cannot be checked');
select is((select route  from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000403']::uuid[])), 'org',
  'AC-APR-011: so it routes to the senior set');

-- AC-APR-012: EUR request against an IDR budget.
select is((select reason from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000404']::uuid[])), 'currency_mismatch',
  'AC-APR-012: a request in another currency cannot be checked against the line');

-- AC-APR-019: Materials 1000 (FY-A) + 500 (FY-B) = 1500; 600 fits; the project approver decides.
select is((select route       from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000405']::uuid[])), 'project',
  'AC-APR-019: a within-line project request routes to the project approver');
select is((select reason      from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000405']::uuid[])), 'within_budget',
  'AC-APR-019: reason within_budget');
select is((select line_budget from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000405']::uuid[])), 1500::numeric,
  'AC-APR-019: the line spans every fiscal year of the Active version');
select is((select approvers   from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000405']::uuid[])),
  '[{"id":"02342000-0000-0000-0000-0000000000a2","full_name":"Cls PM Approver"}]'::jsonb,
  'AC-APR-019: approvers = the named project approver');
select is((select reason    from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000406']::uuid[])), 'no_project',
  'AC-APR-019: an overhead request has reason no_project');
select is((select approvers from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000406']::uuid[])),
  '[{"id":"02342000-0000-0000-0000-0000000000a4","full_name":"Cls Exec Senior"},{"id":"02342000-0000-0000-0000-0000000000a3","full_name":"Cls Finance Senior"}]'::jsonb,
  'AC-APR-019: an overhead request names both senior-set members');
select is((select count(*)::int from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000301']::uuid[])), 0,
  'AC-APR-019: only Requested requests are routed');

-- DD-APR-3: the budget a request was submitted against is the budget it is judged on.
select is((select reason from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000407']::uuid[])), 'budget_changed',
  'DD-APR-3: a budget activated after the request was submitted routes it to the senior set');
select is((select route  from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000407']::uuid[])), 'org',
  'DD-APR-3: so the senior set decides it');
select is((select reason from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000408']::uuid[])), 'within_budget',
  'DD-APR-3: a budget activated before the request was submitted routes normally');

-- DD-APR-5: amounts route up, never down.
select is(procurement_request_amount('02342000-0000-0000-0000-000000000409'), null::numeric,
  'DD-APR-5: a request with a negative line has no trustworthy amount');
select is((select reason from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000409']::uuid[])), 'amount_invalid',
  'DD-APR-5: a negative line routes the request to the senior set');
select is((select route  from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000409']::uuid[])), 'org',
  'DD-APR-5: so the senior set decides a request with a negative line');
select is((select reason from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000410']::uuid[])), 'amount_invalid',
  'DD-APR-5: a negative header total routes the request to the senior set');
select is((select line_used from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000411']::uuid[])), 200::numeric,
  'DD-APR-5: a request already on the line never counts below zero');
select is((select reason from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000411']::uuid[])), 'exceeds_line',
  'DD-APR-5: so a negative request cannot make room on the line');
select is((select reason from spend_approval_route('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000101',
            'Materials', -1::numeric, 'IDR', '02342000-0000-0000-0000-0000000000a5')), 'amount_invalid',
  'DD-APR-5: the route itself sends a negative amount to the senior set (claims reuse it directly)');
select is((select reason from spend_approval_route('02342000-0000-0000-0000-00000000000a','02342000-0000-0000-0000-000000000101',
            'Materials', null::numeric, 'IDR', '02342000-0000-0000-0000-0000000000a5')), 'amount_invalid',
  'DD-APR-5: the route itself sends an unknown amount to the senior set');

set local request.jwt.claims = '{"sub":"02342000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from get_procurement_approval_routes(array['02342000-0000-0000-0000-000000000405','02342000-0000-0000-0000-000000000406']::uuid[])), 0,
  'AC-APR-019: another org''s caller gets no routes for org A ids');

reset role;
select * from finish();
rollback;
