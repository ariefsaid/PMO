-- 1568_imprest_requester_route.test.sql — #1568 cash review closure: the requester who-next read mirrors the
-- decision each site-cash record uses. FR-WAIT-006 (names from the route the database computed).
-- Shipped code under test: supabase/migrations/1568_imprest_requester_route.sql.
begin;
create extension if not exists pgtap;
select plan(33);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15680000-0000-0000-0000-00000000000a', 'RT Org',       'IDR', 'Asia/Jakarta'),
  ('15680000-0000-0000-0000-00000000000b', 'RT Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15680000-0000-0000-0000-0000000000a1', 'rt-admin@example.com'),
  ('15680000-0000-0000-0000-0000000000a2', 'rt-cust@example.com'),
  ('15680000-0000-0000-0000-0000000000a3', 'rt-fin@example.com'),
  ('15680000-0000-0000-0000-0000000000a4', 'rt-author@example.com'),
  ('15680000-0000-0000-0000-0000000000a5', 'rt-exec@example.com'),
  ('15680000-0000-0000-0000-0000000000a6', 'rt-eng@example.com'),
  ('15680000-0000-0000-0000-0000000000a7', 'rt-fin-off@example.com'),
  ('15680000-0000-0000-0000-0000000000a8', 'rt-pmproj@example.com'),
  ('15680000-0000-0000-0000-0000000000b1', 'rt-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15680000-0000-0000-0000-0000000000a1', '15680000-0000-0000-0000-00000000000a', 'RT Admin',      'rt-admin@example.com',    'Admin',           'active'),
  ('15680000-0000-0000-0000-0000000000a2', '15680000-0000-0000-0000-00000000000a', 'RT Cust',       'rt-cust@example.com',     'Finance',         'active'),
  ('15680000-0000-0000-0000-0000000000a3', '15680000-0000-0000-0000-00000000000a', 'RT Fin Other',  'rt-fin@example.com',      'Finance',         'active'),
  ('15680000-0000-0000-0000-0000000000a4', '15680000-0000-0000-0000-00000000000a', 'RT PM Author',  'rt-author@example.com',   'Project Manager', 'active'),
  ('15680000-0000-0000-0000-0000000000a5', '15680000-0000-0000-0000-00000000000a', 'RT Exec',       'rt-exec@example.com',     'Executive',       'active'),
  ('15680000-0000-0000-0000-0000000000a6', '15680000-0000-0000-0000-00000000000a', 'RT Eng',        'rt-eng@example.com',      'Engineer',        'active'),
  ('15680000-0000-0000-0000-0000000000a7', '15680000-0000-0000-0000-00000000000a', 'RT Fin Off',    'rt-fin-off@example.com',  'Finance',         'disabled'),
  ('15680000-0000-0000-0000-0000000000a8', '15680000-0000-0000-0000-00000000000a', 'RT PM Project', 'rt-pmproj@example.com',   'Project Manager', 'active'),
  ('15680000-0000-0000-0000-0000000000b1', '15680000-0000-0000-0000-00000000000b', 'RT XOrg',       'rt-xorg@example.com',     'Admin',           'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15680000-0000-0000-0000-0000000000c1', '15680000-0000-0000-0000-00000000000a', 'RT Site One',  'Ongoing Project', '15680000-0000-0000-0000-0000000000a4'),
  ('15680000-0000-0000-0000-0000000000c2', '15680000-0000-0000-0000-00000000000a', 'RT Site Two',  'Ongoing Project', '15680000-0000-0000-0000-0000000000a4'),
  ('15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-00000000000a', 'RT Site Four', 'Ongoing Project', '15680000-0000-0000-0000-0000000000a4'),
  ('15680000-0000-0000-0000-0000000000c5', '15680000-0000-0000-0000-00000000000a', 'RT Site Five', 'Ongoing Project', '15680000-0000-0000-0000-0000000000a4');
insert into org_imprest_settings (org_id, procurement_limit, updated_by) values
  ('15680000-0000-0000-0000-00000000000a', 2000000, '15680000-0000-0000-0000-0000000000a1');
-- The org senior set (project_id null) is the Executive; project approvers are explicit per project.
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15680000-0000-0000-0000-00000000000a', null, '15680000-0000-0000-0000-0000000000a5'),
  -- P1: the project approver, the custodian and the plan author — the last two must never be named.
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c1', '15680000-0000-0000-0000-0000000000a8'),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c1', '15680000-0000-0000-0000-0000000000a2'),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c1', '15680000-0000-0000-0000-0000000000a4'),
  -- P4 tiers: base tier (NULL) has the project approver, the custodian and the author; 5,000,000 has Fin Other.
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-0000000000a8'),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-0000000000a2'),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-0000000000a4'),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-0000000000a3', 5000000),
  -- P5: only the project approver, so making the senior set ineligible leaves the Admin fallback.
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c5', '15680000-0000-0000-0000-0000000000a8');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('15680000-0000-0000-0000-000000000f01', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c1', 'v1', 1, 'Draft'),
  ('15680000-0000-0000-0000-000000000f02', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c2', 'v1', 1, 'Draft'),
  ('15680000-0000-0000-0000-000000000f04', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', 'v1', 1, 'Draft'),
  ('15680000-0000-0000-0000-000000000f05', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c5', 'v1', 1, 'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f01', 'Vehicle',   100000000),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f01', 'Materials', 100000000),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f02', 'Vehicle',   100000000),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f04', 'Vehicle',   100000000),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f04', 'Materials', 100000000),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f05', 'Vehicle',   100000000);
update budget_versions set status = 'Active'
 where id in ('15680000-0000-0000-0000-000000000f01', '15680000-0000-0000-0000-000000000f02',
              '15680000-0000-0000-0000-000000000f04', '15680000-0000-0000-0000-000000000f05');
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15680000-0000-0000-0000-0000000000d1', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c1', '15680000-0000-0000-0000-0000000000a2', 500000000, 'IDR', '15680000-0000-0000-0000-0000000000a1'),
  ('15680000-0000-0000-0000-0000000000d2', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c2', '15680000-0000-0000-0000-0000000000a2', 100000000, 'IDR', '15680000-0000-0000-0000-0000000000a1'),
  ('15680000-0000-0000-0000-0000000000d4', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-0000000000a2', 500000000, 'IDR', '15680000-0000-0000-0000-0000000000a1'),
  ('15680000-0000-0000-0000-0000000000d5', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c5', '15680000-0000-0000-0000-0000000000a2', 500000000, 'IDR', '15680000-0000-0000-0000-0000000000a1');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.names(p json) returns text[] language sql as $$
  select coalesce(array_agg(a->>'name' order by a->>'name'), '{}')
    from json_array_elements(coalesce(p->'approvers', '[]'::json)) a;
$$;

-- Submitted plans (inserted as the writer; the route is what is under test, not the transition).
insert into imprest_plans (id, org_id, float_id, month, status, author_id, submitted_at) values
  ('15680000-0000-0000-0000-000000000151', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d1', '2027-01-01', 'Submitted', '15680000-0000-0000-0000-0000000000a4', now()),
  ('15680000-0000-0000-0000-000000000152', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d1', '2027-02-01', 'Submitted', '15680000-0000-0000-0000-0000000000a4', now()),
  ('15680000-0000-0000-0000-000000000153', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d2', '2027-01-01', 'Submitted', '15680000-0000-0000-0000-0000000000a4', now()),
  ('15680000-0000-0000-0000-000000000154', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d5', '2027-01-01', 'Submitted', '15680000-0000-0000-0000-0000000000a8', now()),
  ('15680000-0000-0000-0000-000000000155', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d4', '2027-01-01', 'Submitted', '15680000-0000-0000-0000-0000000000a4', now()),
  ('15680000-0000-0000-0000-000000000156', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d4', '2027-02-01', 'Submitted', '15680000-0000-0000-0000-0000000000a4', now()),
  ('15680000-0000-0000-0000-000000000157', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d4', '2027-03-01', 'Submitted', '15680000-0000-0000-0000-0000000000a4', now()),
  ('15680000-0000-0000-0000-000000000158', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d1', '2027-04-01', 'Draft',     '15680000-0000-0000-0000-0000000000a4', null);
insert into imprest_plan_lines (plan_id, budget_category, planned_amount) values
  ('15680000-0000-0000-0000-000000000151', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000152', 'Vehicle', 150000000),
  ('15680000-0000-0000-0000-000000000153', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000154', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000155', 'Vehicle', 6000000),
  ('15680000-0000-0000-0000-000000000156', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000157', 'Vehicle', 6000000),
  ('15680000-0000-0000-0000-000000000157', 'Materials', 1000000),
  ('15680000-0000-0000-0000-000000000158', 'Vehicle', 1000000);

-- Float limit changes (one open per float).
insert into imprest_float_changes (id, org_id, float_id, proposed_amount, status, proposed_by) values
  ('15680000-0000-0000-0000-000000000161', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d1', 200000000, 'Proposed', '15680000-0000-0000-0000-0000000000a3'),
  ('15680000-0000-0000-0000-000000000162', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d2', 200000000, 'Proposed', '15680000-0000-0000-0000-0000000000a3');

-- Replenishments: Requested (approval) and Approved (payment).
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by) values
  ('15680000-0000-0000-0000-000000000171', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d1', 'replenishment', 'RT-REP-1', 'Requested', 3500000, '15680000-0000-0000-0000-0000000000a2', null),
  ('15680000-0000-0000-0000-000000000172', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d1', 'replenishment', 'RT-REP-2', 'Approved',  3500000, '15680000-0000-0000-0000-0000000000a2', '15680000-0000-0000-0000-0000000000a3');

-- ── plan: per-line route, intersection, exclusions ─────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a1');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')->>'route_kind', 'named',
  'FR-WAIT-006 a within-budget plan routes to its named project approver');
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')),
  array['RT PM Project'], 'FR-WAIT-006 the plan author and the custodian are excluded even when they are on the route');
select is(json_array_length(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')->'approvers'), 1,
  'FR-WAIT-006 exactly the one eligible approver is named');

select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000152')->>'route_kind', 'named',
  'FR-WAIT-006 an over-budget plan still names the route');
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000152')),
  array['RT Exec', 'RT PM Project'], 'FR-WAIT-006 an over-budget line joins the project and senior sets (never the roles only)');

select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000153')->>'route_kind', 'flat',
  'FR-WAIT-006 a project with no named approver is the flat matrix');
select is(json_array_length(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000153')->'approvers'), 0,
  'FR-WAIT-006 a flat route names nobody rather than inventing a person');

-- Admin fallback: the senior set has a row but nobody eligible (the only senior is inactive).
reset role;
update profiles set status = 'disabled' where id = '15680000-0000-0000-0000-0000000000a5';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a1');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000154')->>'route_kind', 'admin',
  'FR-WAIT-006 a configured set with nobody eligible leaves the Admin break-glass, never a fabricated approver');
select is(json_array_length(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000154')->'approvers'), 0,
  'FR-WAIT-006 the Admin fallback names nobody');
reset role;
update profiles set status = 'active' where id = '15680000-0000-0000-0000-0000000000a5';

-- Amount tiers (1291): a 6,000,000 line takes the 5,000,000 tier; a 1,000,000 line the base tier.
insert into spend_approval_settings (org_id, tiers_enabled) values ('15680000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a1');
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000155')),
  array['RT Fin Other'], 'FR-WAIT-006 tiers on: the high-amount line names only its tier approver');
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000156')),
  array['RT PM Project'], 'FR-WAIT-006 tiers on: the base-tier line names only its tier approver');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000157')->>'route_kind', 'admin',
  'FR-WAIT-006 the per-line INTERSECTION: two lines in different tiers share nobody, so only an Admin');
select is(json_array_length(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000157')->'approvers'), 0,
  'FR-WAIT-006 an empty intersection invents no fallback candidate');

-- ── float limit change: the named senior set, or Admin ─────────────────────────────────────────────────────────
reset role;
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15680000-0000-0000-0000-00000000000a', null, '15680000-0000-0000-0000-0000000000a2');  -- the custodian, never eligible
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a3');
select is(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-000000000161')->>'route_kind', 'named',
  'FR-WAIT-006 a proposed limit change routes to the named senior set');
select is(pg_temp.names(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-000000000161')),
  array['RT Exec'], 'FR-WAIT-006 the limit route excludes the proposer and the custodian');
-- The only senior is the proposer: Admin fallback.
reset role;
delete from spend_approvers where org_id = '15680000-0000-0000-0000-00000000000a' and project_id is null;
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15680000-0000-0000-0000-00000000000a', null, '15680000-0000-0000-0000-0000000000a3');
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a3');
select is(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-000000000162')->>'route_kind', 'admin',
  'FR-WAIT-006 a senior set with nobody but the proposer is the Admin fallback, never "senior approver"');

-- ── replenishment: approval vs payment are different actors ────────────────────────────────────────────────────
select is(public.get_imprest_requester_route('replenishment', '15680000-0000-0000-0000-000000000171')->>'route_kind', 'finance_admin',
  'FR-WAIT-006 a Requested replenishment waits for Finance or Admin');
select is(public.get_imprest_requester_route('replenishment', '15680000-0000-0000-0000-000000000171')->>'action', 'approve',
  'FR-WAIT-006 the Requested step is an approval, not a payment');
select is(public.get_imprest_requester_route('replenishment', '15680000-0000-0000-0000-000000000172')->>'action', 'pay',
  'FR-WAIT-006 an Approved-unpaid replenishment is waiting for payment');
select is(pg_temp.names(public.get_imprest_requester_route('replenishment', '15680000-0000-0000-0000-000000000172')),
  array['RT Admin'], 'FR-WAIT-006 the payer excludes the requester, the custodian and the prior approver');
-- Nobody else can pay: the only remaining Admin is disabled.
reset role;
update profiles set status = 'disabled' where id = '15680000-0000-0000-0000-0000000000a1';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a2');
select is(public.get_imprest_requester_route('replenishment', '15680000-0000-0000-0000-000000000172')->>'route_kind', 'unavailable',
  'FR-WAIT-006 no eligible payer is an honest empty, never a fallback person');
reset role;
update profiles set status = 'active' where id = '15680000-0000-0000-0000-0000000000a1';

-- ── caller scope and visibility ────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a4');   -- the plan author: may read, never named
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')),
  array['RT PM Project'], 'FR-WAIT-006 the author reading their own plan is not named as its approver');
select is(array(select k from json_object_keys(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')) k order by k),
  array['action', 'approvers', 'route_kind'], 'FR-WAIT-006 no amount, category or per-line routing detail leaves the read');
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a2');   -- the custodian
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')->>'route_kind', 'named',
  'FR-WAIT-006 the custodian may read the plan route');
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a6');   -- same-org Engineer, below approval rank
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')->>'route_kind', 'unavailable',
  'FR-WAIT-006 a same-org non-reader learns nothing (no existence or routing oracle)');
select pg_temp.act_as('15680000-0000-0000-0000-0000000000b1');   -- other-org Admin
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')->>'route_kind', 'unavailable',
  'FR-WAIT-006 a foreign-org caller gets the same empty answer as a missing record');
select is(public.get_imprest_requester_route('plan', 'not-a-uuid')->>'route_kind', 'unavailable',
  'FR-WAIT-006 an unusable record id is an empty answer, not an error');
select is(public.get_imprest_requester_route('unknown_kind', '15680000-0000-0000-0000-000000000151')->>'route_kind', 'unavailable',
  'FR-WAIT-006 a kind outside the enumerated three is refused empty');
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a7');   -- disabled Finance
select throws_ok($$ select public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151') $$,
  '42501', null, 'FR-WAIT-006 a disabled account is refused, not answered');
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a1');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000158')->>'route_kind', 'unavailable',
  'FR-WAIT-006 a Draft plan is not waiting for anyone');

-- Light account: refused with the 1209 convention.
reset role;
select set_config('request.jwt.claims', '', true);
update organizations set built_in_roles_enabled = true where id = '15680000-0000-0000-0000-00000000000a';
update profiles set built_in_role = 'foreman' where id = '15680000-0000-0000-0000-0000000000a6';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a6');
select throws_ok($$ select public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151') $$,
  '42501', 'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this',
  'FR-WAIT-006 a light account is refused the requester route');

-- Access: signed-in only.
reset role;
select is(has_function_privilege('anon', 'public.get_imprest_requester_route(text, text)', 'execute'), false,
  'FR-WAIT-006 anon cannot run the requester route');
select is(has_function_privilege('authenticated', 'public.get_imprest_requester_route(text, text)', 'execute'), true,
  'FR-WAIT-006 a signed-in person can');

select * from finish();
rollback;
