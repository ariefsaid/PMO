-- 1568_imprest_requester_route.test.sql — #1568 cash review closure: the requester next-decision read mirrors the
-- decision each site-cash record uses. FR-WAIT-006 (names from the route the database computed).
-- Shipped code under test: supabase/migrations/1568_imprest_requester_route.sql.
begin;
create extension if not exists pgtap;
select plan(78);

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
-- a9 is an active profile whose auth user is raw-banned: is_active_member(a9) must be false (S7).
insert into auth.users (id, email, banned_until) values
  ('15680000-0000-0000-0000-0000000000a9', 'rt-banned@example.com', now() + interval '1 day');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15680000-0000-0000-0000-0000000000a1', '15680000-0000-0000-0000-00000000000a', 'RT Admin',      'rt-admin@example.com',    'Admin',           'active'),
  ('15680000-0000-0000-0000-0000000000a2', '15680000-0000-0000-0000-00000000000a', 'RT Cust',       'rt-cust@example.com',     'Finance',         'active'),
  ('15680000-0000-0000-0000-0000000000a3', '15680000-0000-0000-0000-00000000000a', 'RT Fin Other',  'rt-fin@example.com',      'Finance',         'active'),
  ('15680000-0000-0000-0000-0000000000a4', '15680000-0000-0000-0000-00000000000a', 'RT PM Author',  'rt-author@example.com',   'Project Manager', 'active'),
  ('15680000-0000-0000-0000-0000000000a5', '15680000-0000-0000-0000-00000000000a', 'RT Exec',       'rt-exec@example.com',     'Executive',       'active'),
  ('15680000-0000-0000-0000-0000000000a6', '15680000-0000-0000-0000-00000000000a', 'RT Eng',        'rt-eng@example.com',      'Engineer',        'active'),
  ('15680000-0000-0000-0000-0000000000a7', '15680000-0000-0000-0000-00000000000a', 'RT Fin Off',    'rt-fin-off@example.com',  'Finance',         'disabled'),
  ('15680000-0000-0000-0000-0000000000a8', '15680000-0000-0000-0000-00000000000a', 'RT PM Project', 'rt-pmproj@example.com',   'Project Manager', 'active'),
  ('15680000-0000-0000-0000-0000000000a9', '15680000-0000-0000-0000-00000000000a', 'RT Banned',     'rt-banned@example.com',   'Executive',       'active'),
  ('15680000-0000-0000-0000-0000000000b1', '15680000-0000-0000-0000-00000000000b', 'RT XOrg',       'rt-xorg@example.com',     'Admin',           'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15680000-0000-0000-0000-0000000000c1', '15680000-0000-0000-0000-00000000000a', 'RT Site One',  'Ongoing Project', '15680000-0000-0000-0000-0000000000a4'),
  ('15680000-0000-0000-0000-0000000000c2', '15680000-0000-0000-0000-00000000000a', 'RT Site Two',  'Ongoing Project', '15680000-0000-0000-0000-0000000000a4'),
  ('15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-00000000000a', 'RT Site Four', 'Ongoing Project', '15680000-0000-0000-0000-0000000000a4'),
  ('15680000-0000-0000-0000-0000000000c5', '15680000-0000-0000-0000-00000000000a', 'RT Site Five', 'Ongoing Project', '15680000-0000-0000-0000-0000000000a4'),
  -- S3 (plan total over float) gets its own project so the float can be lowered without touching another case.
  ('15680000-0000-0000-0000-0000000000c7', '15680000-0000-0000-0000-00000000000a', 'RT Site Seven', 'Ongoing Project', '15680000-0000-0000-0000-0000000000a4');
insert into org_imprest_settings (org_id, procurement_limit, updated_by) values
  ('15680000-0000-0000-0000-00000000000a', 2000000, '15680000-0000-0000-0000-0000000000a1');
-- The org senior set (project_id null) is the Executive; project approvers are explicit per project.
insert into spend_approvers (org_id, project_id, profile_id, min_amount) values
  ('15680000-0000-0000-0000-00000000000a', null, '15680000-0000-0000-0000-0000000000a5', null),
  -- P1: the project approver, the custodian and the plan author — the last two must never be named.
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c1', '15680000-0000-0000-0000-0000000000a8', null),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c1', '15680000-0000-0000-0000-0000000000a2', null),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c1', '15680000-0000-0000-0000-0000000000a4', null),
  -- P4 tiers: base tier (NULL) has the project approver, the custodian and the author; 5,000,000 has Fin Other.
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-0000000000a8', null),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-0000000000a2', null),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-0000000000a4', null),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-0000000000a3', 5000000),
  -- P5: only the project approver, so making the senior set ineligible leaves the Admin fallback.
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c5', '15680000-0000-0000-0000-0000000000a8', null),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c7', '15680000-0000-0000-0000-0000000000a8', null);
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('15680000-0000-0000-0000-000000000f01', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c1', 'v1', 1, 'Draft'),
  ('15680000-0000-0000-0000-000000000f02', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c2', 'v1', 1, 'Draft'),
  ('15680000-0000-0000-0000-000000000f04', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', 'v1', 1, 'Draft'),
  ('15680000-0000-0000-0000-000000000f05', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c5', 'v1', 1, 'Draft'),
  ('15680000-0000-0000-0000-000000000f07', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c7', 'v1', 1, 'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f01', 'Vehicle',   100000000),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f01', 'Materials', 100000000),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f02', 'Vehicle',   100000000),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f04', 'Vehicle',   100000000),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f04', 'Materials', 100000000),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f05', 'Vehicle',   100000000),
  ('15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-000000000f07', 'Vehicle',   100000000);
update budget_versions set status = 'Active'
 where id in ('15680000-0000-0000-0000-000000000f01', '15680000-0000-0000-0000-000000000f02',
              '15680000-0000-0000-0000-000000000f04', '15680000-0000-0000-0000-000000000f05',
              '15680000-0000-0000-0000-000000000f07');
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15680000-0000-0000-0000-0000000000d1', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c1', '15680000-0000-0000-0000-0000000000a2', 500000000, 'IDR', '15680000-0000-0000-0000-0000000000a1'),
  ('15680000-0000-0000-0000-0000000000d2', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c2', '15680000-0000-0000-0000-0000000000a2', 100000000, 'IDR', '15680000-0000-0000-0000-0000000000a1'),
  ('15680000-0000-0000-0000-0000000000d4', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-0000000000a2', 500000000, 'IDR', '15680000-0000-0000-0000-0000000000a1'),
  ('15680000-0000-0000-0000-0000000000d5', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c5', '15680000-0000-0000-0000-0000000000a2', 500000000, 'IDR', '15680000-0000-0000-0000-0000000000a1'),
  -- F6: custodian is the organisation's only Admin (S2 custodian-only-Admin regression).
  ('15680000-0000-0000-0000-0000000000d6', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c5', '15680000-0000-0000-0000-0000000000a1', 500000000, 'IDR', '15680000-0000-0000-0000-0000000000a1'),
  -- F7: the S3 total-over-float case (lowered after its plan was submitted).
  ('15680000-0000-0000-0000-0000000000d7', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000c7', '15680000-0000-0000-0000-0000000000a2', 200000000, 'IDR', '15680000-0000-0000-0000-0000000000a1');

-- ── O3/O4: isolated raw-ban branch controls (flat / plan join-empty / limit join-empty / payer / Requested count) ──
-- These orgs exist only so a candidate can be raw-banned while profiles.status stays 'active': the authority arms
-- filter status only, so they still name the raw-banned person; the read's own is_active_member filter is the only
-- thing that empties the result. The observer is a separate active approval-rank member.
insert into organizations (id, name, default_currency, default_timezone) values
  ('15680000-0000-0000-0000-00000000000c', 'O3 Raw Ban Org', 'IDR', 'Asia/Jakarta'),
  ('15680000-0000-0000-0000-00000000000d', 'O4 Raw Ban Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('15680000-0000-0000-0000-0000000000c1', 'o3-author@example.com'),
  ('15680000-0000-0000-0000-0000000000c2', 'o3-cust@example.com'),
  ('15680000-0000-0000-0000-0000000000c4', 'o3-prop@example.com'),
  ('15680000-0000-0000-0000-0000000000d1', 'o4-author@example.com'),
  ('15680000-0000-0000-0000-0000000000d2', 'o4-cust@example.com'),
  ('15680000-0000-0000-0000-0000000000d4', 'o4-prior@example.com');
insert into auth.users (id, email, banned_until) values
  ('15680000-0000-0000-0000-0000000000c3', 'o3-dead@example.com',  now() + interval '1 day'),
  ('15680000-0000-0000-0000-0000000000c5', 'o3-admin@example.com', now() + interval '1 day'),
  ('15680000-0000-0000-0000-0000000000d3', 'o4-dead@example.com',  now() + interval '1 day');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15680000-0000-0000-0000-0000000000c1', '15680000-0000-0000-0000-00000000000c', 'O3 Author',   'o3-author@example.com', 'Project Manager', 'active'),
  ('15680000-0000-0000-0000-0000000000c2', '15680000-0000-0000-0000-00000000000c', 'O3 Cust',     'o3-cust@example.com',   'Finance',         'active'),
  ('15680000-0000-0000-0000-0000000000c3', '15680000-0000-0000-0000-00000000000c', 'O3 Dead',     'o3-dead@example.com',   'Finance',         'active'),
  ('15680000-0000-0000-0000-0000000000c4', '15680000-0000-0000-0000-00000000000c', 'O3 Proposer', 'o3-prop@example.com',   'Finance',         'active'),
  ('15680000-0000-0000-0000-0000000000c5', '15680000-0000-0000-0000-00000000000c', 'O3 Admin',    'o3-admin@example.com',  'Admin',           'active'),
  ('15680000-0000-0000-0000-0000000000d1', '15680000-0000-0000-0000-00000000000d', 'O4 Author',   'o4-author@example.com', 'Project Manager', 'active'),
  ('15680000-0000-0000-0000-0000000000d2', '15680000-0000-0000-0000-00000000000d', 'O4 Cust',     'o4-cust@example.com',   'Finance',         'active'),
  ('15680000-0000-0000-0000-0000000000d3', '15680000-0000-0000-0000-00000000000d', 'O4 Dead',     'o4-dead@example.com',   'Finance',         'active'),
  ('15680000-0000-0000-0000-0000000000d4', '15680000-0000-0000-0000-00000000000d', 'O4 Prior',    'o4-prior@example.com',  'Admin',           'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15680000-0000-0000-0000-0000000000e1', '15680000-0000-0000-0000-00000000000c', 'O3 Flat Site',   'Ongoing Project', '15680000-0000-0000-0000-0000000000c1'),
  ('15680000-0000-0000-0000-0000000000e2', '15680000-0000-0000-0000-00000000000c', 'O3 Routed Site', 'Ongoing Project', '15680000-0000-0000-0000-0000000000c1'),
  ('15680000-0000-0000-0000-0000000000e3', '15680000-0000-0000-0000-00000000000d', 'O4 Cash Site',   'Ongoing Project', '15680000-0000-0000-0000-0000000000d1');
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-0000000000e2', '15680000-0000-0000-0000-0000000000c3'),
  ('15680000-0000-0000-0000-00000000000c', null, '15680000-0000-0000-0000-0000000000c3');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('15680000-0000-0000-0000-000000000fa1', '15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-0000000000e1', 'v1', 1, 'Draft'),
  ('15680000-0000-0000-0000-000000000fa2', '15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-0000000000e2', 'v1', 1, 'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-000000000fa1', 'Vehicle', 100000000),
  ('15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-000000000fa2', 'Vehicle', 100000000);
update budget_versions set status = 'Active'
 where id in ('15680000-0000-0000-0000-000000000fa1', '15680000-0000-0000-0000-000000000fa2');
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15680000-0000-0000-0000-0000000000e8', '15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-0000000000e1', '15680000-0000-0000-0000-0000000000c2', 100000000, 'IDR', '15680000-0000-0000-0000-0000000000c1'),
  ('15680000-0000-0000-0000-0000000000e9', '15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-0000000000e2', '15680000-0000-0000-0000-0000000000c2', 100000000, 'IDR', '15680000-0000-0000-0000-0000000000c1'),
  ('15680000-0000-0000-0000-0000000000ea', '15680000-0000-0000-0000-00000000000d', '15680000-0000-0000-0000-0000000000e3', '15680000-0000-0000-0000-0000000000d2', 100000000, 'IDR', '15680000-0000-0000-0000-0000000000d1');
insert into imprest_plans (id, org_id, float_id, month, status, author_id, submitted_at) values
  ('15680000-0000-0000-0000-0000000001a1', '15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-0000000000e8',
   date_trunc('month', now() at time zone 'Asia/Jakarta')::date, 'Submitted', '15680000-0000-0000-0000-0000000000c1', now()),
  ('15680000-0000-0000-0000-0000000001a2', '15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-0000000000e9',
   date_trunc('month', now() at time zone 'Asia/Jakarta')::date, 'Submitted', '15680000-0000-0000-0000-0000000000c1', now());
insert into imprest_plan_lines (plan_id, budget_category, planned_amount) values
  ('15680000-0000-0000-0000-0000000001a1', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-0000000001a2', 'Vehicle', 1000000);
insert into imprest_float_changes (id, org_id, float_id, proposed_amount, status, proposed_by) values
  ('15680000-0000-0000-0000-0000000001a3', '15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-0000000000e9', 200000000, 'Proposed', '15680000-0000-0000-0000-0000000000c4');
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by) values
  ('15680000-0000-0000-0000-0000000001b1', '15680000-0000-0000-0000-00000000000d', '15680000-0000-0000-0000-0000000000ea', 'replenishment', 'O4-REP-1', 'Requested', 3500000, '15680000-0000-0000-0000-0000000000d2', null),
  ('15680000-0000-0000-0000-0000000001b2', '15680000-0000-0000-0000-00000000000d', '15680000-0000-0000-0000-0000000000ea', 'replenishment', 'O4-REP-2', 'Approved',  3500000, '15680000-0000-0000-0000-0000000000d2', '15680000-0000-0000-0000-0000000000d4');

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
  ('15680000-0000-0000-0000-000000000158', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d1', '2027-04-01', 'Draft',     '15680000-0000-0000-0000-0000000000a4', null),
  -- p9: custodian-only Admin; p10: author-only Admin; p11: named route whose only Admin is the author.
  ('15680000-0000-0000-0000-000000000191', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d6', '2027-01-01', 'Submitted', '15680000-0000-0000-0000-0000000000a8', now()),
  ('15680000-0000-0000-0000-000000000192', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d5', '2027-05-01', 'Submitted', '15680000-0000-0000-0000-0000000000a1', now()),
  ('15680000-0000-0000-0000-000000000193', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d5', '2027-06-01', 'Submitted', '15680000-0000-0000-0000-0000000000a1', now()),
  -- S3: three Submitted plans whose APPROVAL is blocked by one condition each, while rejection stays legal.
  -- Months are org-TZ-aware: the ended month is the previous org month; the other two are the current org month.
  ('15680000-0000-0000-0000-000000000194', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d1',
   (date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '1 month')::date, 'Submitted', '15680000-0000-0000-0000-0000000000a4', now()),
  ('15680000-0000-0000-0000-000000000195', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d7',
   date_trunc('month', now() at time zone 'Asia/Jakarta')::date, 'Submitted', '15680000-0000-0000-0000-0000000000a4', now()),
  ('15680000-0000-0000-0000-000000000196', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d1',
   date_trunc('month', now() at time zone 'Asia/Jakarta')::date, 'Submitted', '15680000-0000-0000-0000-0000000000a4', now()),
  -- Branch control: an empty per-line intersection whose only Admin is the plan author (so no eligible Admin).
  ('15680000-0000-0000-0000-000000000197', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d4',
   '2027-08-01', 'Submitted', '15680000-0000-0000-0000-0000000000a1', now());
insert into imprest_plan_lines (plan_id, budget_category, planned_amount) values
  ('15680000-0000-0000-0000-000000000151', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000152', 'Vehicle', 150000000),
  ('15680000-0000-0000-0000-000000000153', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000154', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000155', 'Vehicle', 6000000),
  ('15680000-0000-0000-0000-000000000156', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000157', 'Vehicle', 6000000),
  ('15680000-0000-0000-0000-000000000157', 'Materials', 1000000),
  ('15680000-0000-0000-0000-000000000158', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000191', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000192', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000193', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000194', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000195', 'Vehicle', 90000000),
  ('15680000-0000-0000-0000-000000000196', 'Vehicle', 1000000),
  ('15680000-0000-0000-0000-000000000197', 'Vehicle', 6000000),
  ('15680000-0000-0000-0000-000000000197', 'Materials', 1000000);

-- S3 (b): the float is lowered after the plan was submitted (lawful: 50,000,000 is above the 0 funded),
-- so approval now fails the total ceiling while rejection is still a legal decision.
update imprest_floats set float_amount = 50000000 where id = '15680000-0000-0000-0000-0000000000d7';

-- Float limit changes (one open per float).
insert into imprest_float_changes (id, org_id, float_id, proposed_amount, status, proposed_by) values
  ('15680000-0000-0000-0000-000000000161', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d1', 200000000, 'Proposed', '15680000-0000-0000-0000-0000000000a3'),
  ('15680000-0000-0000-0000-000000000162', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d2', 200000000, 'Proposed', '15680000-0000-0000-0000-0000000000a3'),
  -- ch3: proposer is the organisation's only Admin (S2 proposer-only-Admin regression).
  ('15680000-0000-0000-0000-000000000163', '15680000-0000-0000-0000-00000000000a', '15680000-0000-0000-0000-0000000000d5', 200000000, 'Proposed', '15680000-0000-0000-0000-0000000000a1');

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
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')->>'admin_breakglass', 'true',
  'FR-WAIT-006 a named route reports the true Admin break-glass alternative when a distinct eligible Admin exists');

select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000152')->>'route_kind', 'named',
  'FR-WAIT-006 an over-budget plan still names the decision route');
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000152')),
  array['RT Exec'], 'FR-WAIT-006 an over-budget line with a configured senior set is the senior set only (1292:163-181), never the notification union');

select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000153')->>'route_kind', 'flat',
  'FR-WAIT-006 a project with no named approver is the flat matrix');
select is(json_array_length(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000153')->'approvers'), 0,
  'FR-WAIT-006 a flat route names nobody rather than inventing a person');

-- Admin fallback positive: the senior set has a row but nobody eligible (the only senior is inactive), and a1 is a
-- distinct eligible Admin.
reset role;
update profiles set status = 'disabled' where id = '15680000-0000-0000-0000-0000000000a5';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a1');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000154')->>'route_kind', 'admin',
  'FR-WAIT-006 a configured set with nobody eligible leaves the Admin break-glass when a distinct Admin exists');
select is(json_array_length(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000154')->'approvers'), 0,
  'FR-WAIT-006 the Admin fallback names nobody');
reset role;
update profiles set status = 'active' where id = '15680000-0000-0000-0000-0000000000a5';

-- Named route whose only Admin is the plan author: no fabricated Admin alternative.
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a3');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000193')->>'route_kind', 'named',
  'FR-WAIT-006 a named route names its project approver');
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000193')),
  array['RT PM Project'], 'FR-WAIT-006 the named route stays the named set');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000193')->>'admin_breakglass', 'false',
  'FR-WAIT-006 no Admin alternative is invented when the only Admin is the plan author');

-- Amount tiers (1291): a 6,000,000 line takes the 5,000,000 tier; a 1,000,000 line the base tier.
reset role;
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
select is(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-000000000161')->>'admin_breakglass', 'true',
  'FR-WAIT-006 the limit named route reports the eligible Admin alternative');
-- The only senior is the proposer: Admin fallback (a distinct eligible Admin exists).
reset role;
delete from spend_approvers where org_id = '15680000-0000-0000-0000-00000000000a' and project_id is null;
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15680000-0000-0000-0000-00000000000a', null, '15680000-0000-0000-0000-0000000000a3');
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a3');
select is(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-000000000162')->>'route_kind', 'admin',
  'FR-WAIT-006 a senior set with nobody but the proposer falls to an existing eligible Admin');
select is(json_array_length(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-000000000162')->'approvers'), 0,
  'FR-WAIT-006 the limit Admin fallback names nobody');

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

-- ── caller scope and visibility (Q1: the rank gate must bind on every kind, not only plan) ─────────────────────
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a4');   -- the plan author: may read, never named
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')),
  array['RT PM Project'], 'FR-WAIT-006 the author reading their own plan is not named as its approver');
select is(array(select k from json_object_keys(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')) k order by k),
  array['action', 'admin_breakglass', 'approvers', 'route_kind'], 'FR-WAIT-006 no amount, category or per-line routing detail leaves the read');
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a2');   -- the custodian
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')->>'route_kind', 'named',
  'FR-WAIT-006 the custodian may read the plan route');
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a6');   -- same-org Engineer, below approval rank
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000151')->>'route_kind', 'unavailable',
  'FR-WAIT-006 a same-org non-reader learns nothing from the plan route (no existence or routing oracle)');
select is(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-000000000161')->>'route_kind', 'unavailable',
  'FR-WAIT-006 the same rank gate answers limit_change before its (unguarded) branch');
select is(public.get_imprest_requester_route('replenishment', '15680000-0000-0000-0000-000000000171')->>'route_kind', 'unavailable',
  'FR-WAIT-006 the same rank gate answers replenishment before its (unguarded) branch');
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

-- ── S2: the Admin fallback must prove a distinct eligible Admin (SoD-aware) ──────────────────────────────────
-- No senior set here: the route must be the admin fallback for the check to be exercised.
reset role;
delete from spend_approvers where org_id = '15680000-0000-0000-0000-00000000000a' and project_id is null;
-- (a) only Admin is the custodian (p9: F6's custodian).
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a3');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000191')->>'route_kind', 'unavailable',
  'FR-WAIT-006 no Admin is promised when the only Admin is the plan custodian');
-- (b) only Admin is the author (p10): its sole project approver inactive so the route is admin.
reset role;
update profiles set status = 'disabled' where id = '15680000-0000-0000-0000-0000000000a8';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a3');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000192')->>'route_kind', 'unavailable',
  'FR-WAIT-006 no Admin is promised when the only Admin is the plan author');
-- (c) only Admin is the proposer (ch3).
reset role;
update profiles set status = 'active' where id = '15680000-0000-0000-0000-0000000000a8';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15680000-0000-0000-0000-00000000000a', null, '15680000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a3');
select is(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-000000000163')->>'route_kind', 'unavailable',
  'FR-WAIT-006 no Admin is promised when the only Admin is the limit proposer');

-- ── S7: an active profile whose auth user is raw-banned is not named and cannot back the Admin fallback ────────
reset role;
delete from spend_approvers where org_id = '15680000-0000-0000-0000-00000000000a' and project_id is null;
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15680000-0000-0000-0000-00000000000a', null, '15680000-0000-0000-0000-0000000000a5'),
  ('15680000-0000-0000-0000-00000000000a', null, '15680000-0000-0000-0000-0000000000a9'),
  ('15680000-0000-0000-0000-00000000000a', null, '15680000-0000-0000-0000-0000000000a2');
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a3');
select is(pg_temp.names(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-000000000161')),
  array['RT Exec'], 'FR-WAIT-006 a raw-banned senior is not named while an unbanned one still is');
-- The only Admin is raw-banned: the fallback must not promise them.
reset role;
delete from spend_approvers where org_id = '15680000-0000-0000-0000-00000000000a' and project_id is null;
update profiles set status = 'disabled' where id = '15680000-0000-0000-0000-0000000000a9';
update auth.users set banned_until = now() + interval '1 day' where id = '15680000-0000-0000-0000-0000000000a1';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a3');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000154')->>'route_kind', 'unavailable',
  'FR-WAIT-006 no Admin is promised when the only Admin is raw-banned');
reset role;
update auth.users set banned_until = null where id = '15680000-0000-0000-0000-0000000000a1';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a3');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000154')->>'route_kind', 'admin',
  'FR-WAIT-006 the same Admin backs the fallback once unbanned');

-- ── S3 (root msg 4946c4b2b24f): approval blocked by one condition, the SAME projected actor may still reject ────
-- The read names who can DECIDE (approve OR reject); it never promises that approval will pass.
-- (a) month ended: approval is refused by the ended month; rejection is a legal decision.
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a8');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000194')->>'route_kind', 'named',
  'FR-WAIT-006 an ended-month Submitted plan still projects its decision route');
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000194')),
  array['RT PM Project'], 'FR-WAIT-006 the projected actor is the routed project approver');
select throws_ok($$ select public.transition_imprest_plan('15680000-0000-0000-0000-000000000194', 'Approved') $$,
  'P0001', 'the plan''s month has ended; it can no longer be approved',
  'FR-WAIT-006 approval of the ended-month plan fails on the month condition, not on setup, SoD, the route or the feature');
select lives_ok($$ select public.transition_imprest_plan('15680000-0000-0000-0000-000000000194', 'Rejected') $$,
  'FR-WAIT-006 the same projected actor is authorized to reject the ended-month plan');
select is((select status from public.imprest_plans where id = '15680000-0000-0000-0000-000000000194'), 'Rejected',
  'FR-WAIT-006 the ended-month plan reaches Rejected');

-- (b) plan total above the lowered float: approval hits the ceiling; rejection is a legal decision.
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000195')->>'route_kind', 'named',
  'FR-WAIT-006 an over-float Submitted plan still projects its decision route');
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000195')),
  array['RT PM Project'], 'FR-WAIT-006 the over-float projected actor is the routed project approver');
select throws_like($$ select public.transition_imprest_plan('15680000-0000-0000-0000-000000000195', 'Approved') $$,
  'the plan total % is above the float amount %',
  'FR-WAIT-006 approval of the over-float plan fails on the total ceiling, not on setup, SoD, the route or the month');
select lives_ok($$ select public.transition_imprest_plan('15680000-0000-0000-0000-000000000195', 'Rejected') $$,
  'FR-WAIT-006 the same projected actor is authorized to reject the over-float plan');
select is((select status from public.imprest_plans where id = '15680000-0000-0000-0000-000000000195'), 'Rejected',
  'FR-WAIT-006 the over-float plan reaches Rejected');

-- (c) imprest feature off: forward approval is gated; rejection is exempt (0534:1138).
reset role;
insert into org_features (org_id, feature_key, enabled, updated_by) values
  ('15680000-0000-0000-0000-00000000000a', 'imprest', false, '15680000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a8');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000196')->>'route_kind', 'named',
  'FR-WAIT-006 a feature-off Submitted plan still projects its decision route');
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000196')),
  array['RT PM Project'], 'FR-WAIT-006 the feature-off projected actor is the routed project approver');
select throws_ok($$ select public.transition_imprest_plan('15680000-0000-0000-0000-000000000196', 'Approved') $$,
  'P0001', 'feature_off',
  'FR-WAIT-006 approval of the feature-off plan fails on the feature switch, not on setup, SoD, the route or the month');
select lives_ok($$ select public.transition_imprest_plan('15680000-0000-0000-0000-000000000196', 'Rejected') $$,
  'FR-WAIT-006 the same projected actor is authorized to reject the feature-off plan');
select is((select status from public.imprest_plans where id = '15680000-0000-0000-0000-000000000196'), 'Rejected',
  'FR-WAIT-006 the feature-off plan reaches Rejected');
reset role;
delete from org_features where org_id = '15680000-0000-0000-0000-00000000000a' and feature_key = 'imprest';

-- ── bounded branch-discriminating additions (root msg_cfe8ecacd2d5) ─────────────────────────────────────────────
-- A. Empty per-line intersection with NO eligible Admin. Positive control: p7 (same branch, an eligible Admin).
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000a3');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-000000000197')->>'route_kind', 'unavailable',
  'FR-WAIT-006 an empty per-line intersection with no eligible Admin is an honest empty, not a fabricated fallback');

-- B. Plan join-empty: the authority arm still names the raw-banned project approver; only the read-local active
-- filter empties the name join, and the sole Admin is raw-banned. Fixture precondition is owner-side.
reset role;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000c1');
select is((select approver_ids @> array['15680000-0000-0000-0000-0000000000c3']::uuid[]
             from public.spend_approval_route('15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-0000000000e2',
                   'Vehicle', 1000000, 'IDR', '15680000-0000-0000-0000-0000000000c1', null, now())),
  true, 'FIXTURE PRECONDITION (owner-side route arm): spend_approval_route still names the raw-banned project approver');
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000c1');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-0000000001a2')->>'route_kind', 'unavailable',
  'FR-WAIT-006 all named plan candidates raw-banned and the sole Admin raw-banned => unavailable');
reset role;
update auth.users set banned_until = null where id = '15680000-0000-0000-0000-0000000000c3';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000c1');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-0000000001a2')->>'route_kind', 'named',
  'FR-WAIT-006 positive control: the plan join names the approver once the raw ban is lifted');
select is(pg_temp.names(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-0000000001a2')),
  array['O3 Dead'], 'FR-WAIT-006 the positive control names the once-banned approver');
reset role;
update auth.users set banned_until = now() + interval '1 day' where id = '15680000-0000-0000-0000-0000000000c3';

-- C. Limit join-empty: same two guards on the limit branch; the precondition uses the revoked senior helper
-- owner-side because authenticated cannot execute it.
reset role;
select is((select approver_ids @> array['15680000-0000-0000-0000-0000000000c3']::uuid[]
             from public.imprest_senior_route('15680000-0000-0000-0000-00000000000c', '15680000-0000-0000-0000-0000000000c4')),
  true, 'FIXTURE PRECONDITION (owner-side revoked helper): imprest_senior_route still names the raw-banned senior');
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000c1');
select is(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-0000000001a3')->>'route_kind', 'unavailable',
  'FR-WAIT-006 all named limit candidates raw-banned and the sole Admin raw-banned => unavailable');
reset role;
update auth.users set banned_until = null where id = '15680000-0000-0000-0000-0000000000c3';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000c1');
select is(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-0000000001a3')->>'route_kind', 'named',
  'FR-WAIT-006 positive control: the limit join names the senior once the raw ban is lifted');
select is(pg_temp.names(public.get_imprest_requester_route('limit_change', '15680000-0000-0000-0000-0000000001a3')),
  array['O3 Dead'], 'FR-WAIT-006 the limit positive control names the once-banned senior');
reset role;
update auth.users set banned_until = now() + interval '1 day' where id = '15680000-0000-0000-0000-0000000000c3';

-- D. Banned sole flat candidate: ban the other Finance candidate too, leaving only raw-banned approval-rank people.
reset role;
update auth.users set banned_until = now() + interval '1 day' where id = '15680000-0000-0000-0000-0000000000c4';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000c1');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-0000000001a1')->>'route_kind', 'unavailable',
  'FR-WAIT-006 a flat plan whose every non-SoD candidate is raw-banned is an honest empty');
reset role;
update auth.users set banned_until = null where id = '15680000-0000-0000-0000-0000000000c3';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000c1');
select is(public.get_imprest_requester_route('plan', '15680000-0000-0000-0000-0000000001a1')->>'route_kind', 'flat',
  'FR-WAIT-006 positive control: the flat route returns once a candidate is active');
reset role;
update auth.users set banned_until = now() + interval '1 day' where id = '15680000-0000-0000-0000-0000000000c3';
update auth.users set banned_until = null where id = '15680000-0000-0000-0000-0000000000c4';

-- E. Banned sole payer (O4): the prior approver is SoD-excluded, so d3 is the only payer and is raw-banned.
reset role;
update auth.users set banned_until = now() + interval '1 day' where id = '15680000-0000-0000-0000-0000000000d4';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000d1');
select is(public.get_imprest_requester_route('replenishment', '15680000-0000-0000-0000-0000000001b2')->>'route_kind', 'unavailable',
  'FR-WAIT-006 an Approved-unpaid replenishment whose sole payer is raw-banned is an honest empty');
reset role;
update auth.users set banned_until = null where id = '15680000-0000-0000-0000-0000000000d3';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000d1');
select is(public.get_imprest_requester_route('replenishment', '15680000-0000-0000-0000-0000000001b2')->>'route_kind', 'finance_admin',
  'FR-WAIT-006 positive control: the pay route returns once the payer is active');
select is(pg_temp.names(public.get_imprest_requester_route('replenishment', '15680000-0000-0000-0000-0000000001b2')),
  array['O4 Dead'], 'FR-WAIT-006 the positive control names the once-banned payer');
reset role;
update auth.users set banned_until = now() + interval '1 day' where id = '15680000-0000-0000-0000-0000000000d3';

-- F. Requested count filter: the prior Admin is also raw-banned, so the Requested count is zero.
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000d1');
select is(public.get_imprest_requester_route('replenishment', '15680000-0000-0000-0000-0000000001b1')->>'route_kind', 'unavailable',
  'FR-WAIT-006 the Requested count sees no active Finance/Admin after the requester/custodian exclusion');
reset role;
update auth.users set banned_until = null where id = '15680000-0000-0000-0000-0000000000d3';
set local role authenticated;
select pg_temp.act_as('15680000-0000-0000-0000-0000000000d1');
select is(public.get_imprest_requester_route('replenishment', '15680000-0000-0000-0000-0000000001b1')->>'route_kind', 'finance_admin',
  'FR-WAIT-006 positive control: the Requested approval route returns once a Finance candidate is active');
reset role;
update auth.users set banned_until = now() + interval '1 day' where id = '15680000-0000-0000-0000-0000000000d3';

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
