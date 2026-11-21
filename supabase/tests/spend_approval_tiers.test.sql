-- spend_approval_tiers.test.sql — #2695 approval by amount tiers.
-- Orgs: A (tiers on: base Fin X, tier 100000 Exec Y, tier 1000000 Fin Z), B (tiers off, same shape), D (top tier
-- member disabled). Migrations: 1290 (setting, min_amount), 1291 (spend_approvers_for_amount), 1292 (route reads it).
-- Mutation checks: (1) make the flag-on branch of spend_approvers_for_amount return every row (AC-TIER-002/003 red);
-- (2) make cfg.tiers_on always true (AC-TIER-001 red); (3) make the NULL/foreign-currency case choose the lowest tier
-- (AC-TIER-006 red); (4) drop the Admin check from the settings insert/update policies (AC-TIER-008 red).
begin;
select plan(34);

insert into organizations (id, name, default_currency) values
  ('02695000-0000-0000-0000-00000000000e','Tier Org E','IDR'),
  ('02695000-0000-0000-0000-000000000010','Tier Org A','IDR'),
  ('02695000-0000-0000-0000-000000000011','Tier Org B','IDR'),
  ('02695000-0000-0000-0000-000000000013','Tier Org D','IDR');
insert into auth.users (id, email) values
  ('02695000-0000-0000-0000-0000000000e3','tier-e-fin@example.com'),
  ('02695000-0000-0000-0000-0000000000e6','tier-e-eng@example.com'),
  ('02695000-0000-0000-0000-0000000000a0','tier-a-admin@example.com'),
  ('02695000-0000-0000-0000-0000000000a1','tier-a-pm@example.com'),
  ('02695000-0000-0000-0000-0000000000a2','tier-a-pm2@example.com'),
  ('02695000-0000-0000-0000-0000000000a3','tier-a-fin-x@example.com'),
  ('02695000-0000-0000-0000-0000000000a4','tier-a-exec-y@example.com'),
  ('02695000-0000-0000-0000-0000000000a5','tier-a-fin-z@example.com'),
  ('02695000-0000-0000-0000-0000000000a6','tier-a-eng@example.com'),
  ('02695000-0000-0000-0000-0000000000b0','tier-b-admin@example.com'),
  ('02695000-0000-0000-0000-0000000000b3','tier-b-fin-x@example.com'),
  ('02695000-0000-0000-0000-0000000000b4','tier-b-exec-y@example.com'),
  ('02695000-0000-0000-0000-0000000000b6','tier-b-eng@example.com'),
  ('02695000-0000-0000-0000-0000000000d0','tier-d-admin@example.com'),
  ('02695000-0000-0000-0000-0000000000d3','tier-d-fin-x@example.com'),
  ('02695000-0000-0000-0000-0000000000d5','tier-d-fin-z@example.com'),
  ('02695000-0000-0000-0000-0000000000d6','tier-d-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02695000-0000-0000-0000-0000000000e3','02695000-0000-0000-0000-00000000000e','Tier E fin','tier-e-fin@example.com','Finance','active'),
  ('02695000-0000-0000-0000-0000000000e6','02695000-0000-0000-0000-00000000000e','Tier E eng','tier-e-eng@example.com','Engineer','active'),
  ('02695000-0000-0000-0000-0000000000a0','02695000-0000-0000-0000-000000000010','Tier A admin','tier-a-admin@example.com','Admin','active'),
  ('02695000-0000-0000-0000-0000000000a1','02695000-0000-0000-0000-000000000010','Tier A pm','tier-a-pm@example.com','Project Manager','active'),
  ('02695000-0000-0000-0000-0000000000a2','02695000-0000-0000-0000-000000000010','Tier A pm2','tier-a-pm2@example.com','Project Manager','active'),
  ('02695000-0000-0000-0000-0000000000a3','02695000-0000-0000-0000-000000000010','Tier A fin-x','tier-a-fin-x@example.com','Finance','active'),
  ('02695000-0000-0000-0000-0000000000a4','02695000-0000-0000-0000-000000000010','Tier A exec-y','tier-a-exec-y@example.com','Executive','active'),
  ('02695000-0000-0000-0000-0000000000a5','02695000-0000-0000-0000-000000000010','Tier A fin-z','tier-a-fin-z@example.com','Finance','active'),
  ('02695000-0000-0000-0000-0000000000a6','02695000-0000-0000-0000-000000000010','Tier A eng','tier-a-eng@example.com','Engineer','active'),
  ('02695000-0000-0000-0000-0000000000b0','02695000-0000-0000-0000-000000000011','Tier B admin','tier-b-admin@example.com','Admin','active'),
  ('02695000-0000-0000-0000-0000000000b3','02695000-0000-0000-0000-000000000011','Tier B fin-x','tier-b-fin-x@example.com','Finance','active'),
  ('02695000-0000-0000-0000-0000000000b4','02695000-0000-0000-0000-000000000011','Tier B exec-y','tier-b-exec-y@example.com','Executive','active'),
  ('02695000-0000-0000-0000-0000000000b6','02695000-0000-0000-0000-000000000011','Tier B eng','tier-b-eng@example.com','Engineer','active'),
  ('02695000-0000-0000-0000-0000000000d0','02695000-0000-0000-0000-000000000013','Tier D admin','tier-d-admin@example.com','Admin','active'),
  ('02695000-0000-0000-0000-0000000000d3','02695000-0000-0000-0000-000000000013','Tier D fin-x','tier-d-fin-x@example.com','Finance','active'),
  ('02695000-0000-0000-0000-0000000000d5','02695000-0000-0000-0000-000000000013','Tier D fin-z','tier-d-fin-z@example.com','Finance','disabled'),
  ('02695000-0000-0000-0000-0000000000d6','02695000-0000-0000-0000-000000000013','Tier D eng','tier-d-eng@example.com','Engineer','active');
insert into projects (id, org_id, name, status) values ('02695000-0000-0000-0000-000000000101','02695000-0000-0000-0000-000000000010','Tier Project P','Ongoing Project');
insert into budget_versions (id, org_id, project_id, name, version, status, created_by) values ('02695000-0000-0000-0000-000000000201','02695000-0000-0000-0000-000000000010','02695000-0000-0000-0000-000000000101','v1',1,'Draft','02695000-0000-0000-0000-0000000000a2');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values ('02695000-0000-0000-0000-000000000010','02695000-0000-0000-0000-000000000201','Materials',1000);
update budget_versions set status = 'Active', activated_at = now() - interval '2 days' where id = '02695000-0000-0000-0000-000000000201';
-- Settings: A on, B off, D on.
insert into spend_approval_settings (org_id, tiers_enabled) values ('02695000-0000-0000-0000-000000000010',true),('02695000-0000-0000-0000-000000000011',false),('02695000-0000-0000-0000-000000000013',true);
insert into spend_approvers (org_id, project_id, profile_id, min_amount) values
  ('02695000-0000-0000-0000-00000000000e',null,'02695000-0000-0000-0000-0000000000e3',50000),
  ('02695000-0000-0000-0000-000000000010',null,'02695000-0000-0000-0000-0000000000a3',null),
  ('02695000-0000-0000-0000-000000000010',null,'02695000-0000-0000-0000-0000000000a4',100000),
  ('02695000-0000-0000-0000-000000000010',null,'02695000-0000-0000-0000-0000000000a5',1000000),
  ('02695000-0000-0000-0000-000000000010','02695000-0000-0000-0000-000000000101','02695000-0000-0000-0000-0000000000a1',null),
  ('02695000-0000-0000-0000-000000000010','02695000-0000-0000-0000-000000000101','02695000-0000-0000-0000-0000000000a2',400),
  ('02695000-0000-0000-0000-000000000011',null,'02695000-0000-0000-0000-0000000000b3',null),
  ('02695000-0000-0000-0000-000000000011',null,'02695000-0000-0000-0000-0000000000b4',100000),
  ('02695000-0000-0000-0000-000000000013',null,'02695000-0000-0000-0000-0000000000d3',null),
  ('02695000-0000-0000-0000-000000000013',null,'02695000-0000-0000-0000-0000000000d5',1000000);
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category, currency) values
  ('02695000-0000-0000-0000-000000000401','02695000-0000-0000-0000-000000000010','T 500',null,'02695000-0000-0000-0000-0000000000a6','Requested',500,null,'IDR'),
  ('02695000-0000-0000-0000-000000000402','02695000-0000-0000-0000-000000000010','T 100000',null,'02695000-0000-0000-0000-0000000000a6','Requested',100000,null,'IDR'),
  ('02695000-0000-0000-0000-000000000403','02695000-0000-0000-0000-000000000010','T 999999',null,'02695000-0000-0000-0000-0000000000a6','Requested',999999,null,'IDR'),
  ('02695000-0000-0000-0000-000000000404','02695000-0000-0000-0000-000000000010','T 1000000',null,'02695000-0000-0000-0000-0000000000a6','Requested',1000000,null,'IDR'),
  ('02695000-0000-0000-0000-000000000405','02695000-0000-0000-0000-000000000010','T 1000000 b',null,'02695000-0000-0000-0000-0000000000a6','Requested',1000000,null,'IDR'),
  ('02695000-0000-0000-0000-000000000406','02695000-0000-0000-0000-000000000010','T 1000000 c',null,'02695000-0000-0000-0000-0000000000a6','Requested',1000000,null,'IDR'),
  ('02695000-0000-0000-0000-000000000407','02695000-0000-0000-0000-000000000013','T D big',null,'02695000-0000-0000-0000-0000000000d6','Requested',2000000,null,'IDR'),
  ('02695000-0000-0000-0000-000000000408','02695000-0000-0000-0000-000000000010','T usd',null,'02695000-0000-0000-0000-0000000000a6','Requested',500,null,'USD');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a0","role":"authenticated"}';
-- Helper: approvers as a sorted text list of last hex digits.

-- AC-TIER-002: tier by amount on the senior set (org A).
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000010',null,null,500,'IDR','02695000-0000-0000-0000-0000000000a6') r, unnest(r.approver_ids) x), '{a3}'::text[], 'AC-TIER-002: amount 500 reaches {a3}');
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000010',null,null,99999,'IDR','02695000-0000-0000-0000-0000000000a6') r, unnest(r.approver_ids) x), '{a3}'::text[], 'AC-TIER-002: amount 99999 reaches {a3}');
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000010',null,null,100000,'IDR','02695000-0000-0000-0000-0000000000a6') r, unnest(r.approver_ids) x), '{a4}'::text[], 'AC-TIER-002: amount 100000 reaches {a4}');
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000010',null,null,999999,'IDR','02695000-0000-0000-0000-0000000000a6') r, unnest(r.approver_ids) x), '{a4}'::text[], 'AC-TIER-002: amount 999999 reaches {a4}');
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000010',null,null,1000000,'IDR','02695000-0000-0000-0000-0000000000a6') r, unnest(r.approver_ids) x), '{a5}'::text[], 'AC-TIER-002: amount 1000000 reaches {a5}');
-- Each org's route is read as a member of that org (spend_approvers RLS is org-scoped).
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000b0","role":"authenticated"}';
-- AC-TIER-001: tiers off, every row regardless of min_amount.
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000011',null,null,500,'IDR','02695000-0000-0000-0000-0000000000b6') r, unnest(r.approver_ids) x), '{b3,b4}'::text[], 'AC-TIER-001: tiers off, both members decide a small amount');
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000011',null,null,5000000,'IDR','02695000-0000-0000-0000-0000000000b6') r, unnest(r.approver_ids) x), '{b3,b4}'::text[], 'AC-TIER-001: tiers off, both members decide a large amount');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a0","role":"authenticated"}';
-- AC-TIER-006: unknown, negative, foreign currency take the highest tier.
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000010',null,null,null,'IDR','02695000-0000-0000-0000-0000000000a6') r, unnest(r.approver_ids) x), '{a5}'::text[], 'AC-TIER-006: NULL amount takes the top tier');
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000010',null,null,-5,'IDR','02695000-0000-0000-0000-0000000000a6') r, unnest(r.approver_ids) x), '{a5}'::text[], 'AC-TIER-006: negative amount takes the top tier');
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000010',null,null,500,'USD','02695000-0000-0000-0000-0000000000a6') r, unnest(r.approver_ids) x), '{a5}'::text[], 'AC-TIER-006: a foreign-currency amount takes the top tier');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000d0","role":"authenticated"}';
-- AC-TIER-005: the top tier's only member is disabled: Admin, not a lower tier.
select is((select route from spend_approval_route('02695000-0000-0000-0000-000000000013',null,null,2000000,'IDR','02695000-0000-0000-0000-0000000000d6')), 'admin', 'AC-TIER-005: nobody eligible in the top tier routes to an Admin');
select is((select route from spend_approval_route('02695000-0000-0000-0000-000000000013',null,null,500,'IDR','02695000-0000-0000-0000-0000000000d6')), 'org', 'AC-TIER-005: a small amount still reaches the base tier');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a0","role":"authenticated"}';
-- AC-TIER-007: project list tiered separately; an over-budget request uses the senior list's tier.
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000010','02695000-0000-0000-0000-000000000101','Materials',300,'IDR','02695000-0000-0000-0000-0000000000a6') r, unnest(r.approver_ids) x), '{a1}'::text[], 'AC-TIER-007: a within-budget 300 reaches the project base tier');
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000010','02695000-0000-0000-0000-000000000101','Materials',500,'IDR','02695000-0000-0000-0000-0000000000a6') r, unnest(r.approver_ids) x), '{a2}'::text[], 'AC-TIER-007: a within-budget 500 reaches the project 400 tier');
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-000000000010','02695000-0000-0000-0000-000000000101','Materials',150000,'IDR','02695000-0000-0000-0000-0000000000a6') r, unnest(r.approver_ids) x), '{a4}'::text[], 'AC-TIER-007: an over-budget 150000 reaches the senior 100000 tier');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000e3","role":"authenticated"}';
-- AC-TIER-004: only tiers from 50000 exist (org E); a 10000 request is decided by the lowest tier, never flat.
select is((select array_agg(right(x::text,2) order by x::text) from spend_approval_route('02695000-0000-0000-0000-00000000000e',null,null,10000,'IDR','02695000-0000-0000-0000-0000000000e6') r, unnest(r.approver_ids) x), '{e3}'::text[], 'AC-TIER-004: below every minimum the lowest tier decides');
select is((select route from spend_approval_route('02695000-0000-0000-0000-00000000000e',null,null,10000,'IDR','02695000-0000-0000-0000-0000000000e6')), 'org', 'AC-TIER-004: the route is org, not flat');
-- AC-TIER-010: expense claims read the approver lists through the same function.
select ok(pg_get_functiondef('public.get_expense_claim_approval_routes(uuid[])'::regprocedure) like '%spend_approval_route_from_figures%', 'AC-TIER-010: the claim route read uses the tiered route function');
-- AC-TIER-003: enforcement through transition_procurement.
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02695000-0000-0000-0000-000000000404','Approved') $$,'42501',null,'AC-TIER-003: a lower-tier member cannot approve a top-tier amount');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02695000-0000-0000-0000-000000000405','Approved') $$,'42501',null,'AC-TIER-003: the base-tier member cannot approve a top-tier amount');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02695000-0000-0000-0000-000000000404','Approved') $$,'AC-TIER-003: the top-tier member approves a top-tier amount');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a0","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02695000-0000-0000-0000-000000000405','Approved') $$,'AC-TIER-003: an Admin may still decide (break-glass)');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02695000-0000-0000-0000-000000000401','Approved') $$,'AC-TIER-003: the base-tier member approves a small amount');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02695000-0000-0000-0000-000000000402','Approved') $$,'42501',null,'AC-TIER-003: the top-tier member is not in the 100000 tier');
-- AC-TIER-011: the list read names the tier the decision enforces.
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a0","role":"authenticated"}';
select is((select array_agg(right((a->>'id'),2) order by a->>'id') from get_procurement_approval_routes(array['02695000-0000-0000-0000-000000000403']::uuid[]) g, jsonb_array_elements(g.approvers) a), '{a4}'::text[], 'AC-TIER-011: the display read lists the enforced tier');
-- AC-TIER-008: setting writes are Admin-only.
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ update spend_approval_settings set tiers_enabled = false where org_id = '02695000-0000-0000-0000-000000000010' $$,'AC-TIER-008: a PM update matches no row (RLS filters it, no error) and changes nothing');
select is((select tiers_enabled from spend_approval_settings where org_id = '02695000-0000-0000-0000-000000000010'), true, 'AC-TIER-008: the setting is unchanged after the PM attempt');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a0","role":"authenticated"}';
select lives_ok($$ update spend_approval_settings set tiers_enabled = false where org_id = '02695000-0000-0000-0000-000000000010' $$,'AC-TIER-008: the Admin turns tiers off');
select is((select count(*)::int from audit_events where action = 'spend_approval_tiers.change' and org_id = '02695000-0000-0000-0000-000000000010'), 2, 'AC-TIER-008: the setting change is audited (seed insert and this update)');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000b0","role":"authenticated"}';
select is((select count(*)::int from spend_approval_settings where org_id = '02695000-0000-0000-0000-000000000010'), 0, 'AC-TIER-008: org B cannot see org A settings');
-- AC-TIER-009: min_amount insert rules.
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ insert into spend_approvers (project_id, profile_id, min_amount) values (null,'02695000-0000-0000-0000-0000000000a3',5) $$,'42501',null,'AC-TIER-009: a PM cannot add an approver with an amount');
set local request.jwt.claims = '{"sub":"02695000-0000-0000-0000-0000000000a0","role":"authenticated"}';
select throws_ok($$ insert into spend_approvers (project_id, profile_id, min_amount) values (null,'02695000-0000-0000-0000-0000000000a6',-1) $$,null,null,'AC-TIER-009: a negative amount is refused');
select lives_ok($$ insert into spend_approvers (project_id, profile_id, min_amount) values (null,'02695000-0000-0000-0000-0000000000a2',250000) $$,'AC-TIER-009: an Admin adds an approver with an amount');
select is((select (detail->>'min_amount')::numeric from audit_events where action = 'spend_approver.add' and entity_id = (select id from spend_approvers where profile_id = '02695000-0000-0000-0000-0000000000a2' and project_id is null)), 250000::numeric, 'AC-TIER-009: the add audit row records the amount');

select * from finish();
rollback;
