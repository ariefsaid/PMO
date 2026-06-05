-- 0038_dashboard_margin_guards.test.sql — margin div-by-zero guards (empty org)
-- AC-1104 / FR-SPD-001/003
begin;
select plan(3);

-- Create a fresh org with an Executive user but NO projects
insert into organizations (id, name) values
  ('00380000-0000-0000-0000-000000000001', 'Guard Test Org');

insert into auth.users (id, email) values
  ('00380000-0000-0000-0000-0000000000a1', 'guard-exec@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00380000-0000-0000-0000-0000000000a1', '00380000-0000-0000-0000-000000000001',
   'Guard Exec', 'guard-exec@example.com', 'Executive');

-- Set the empty-org user's JWT
set local role authenticated;
set local request.jwt.claims to '{"sub":"00380000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1104: on_hand_margin = 0 (no on-hand projects → no div-by-zero)
select is(
  (get_executive_dashboard() ->> 'on_hand_margin')::numeric,
  0::numeric,
  'AC-1104: on_hand_margin = 0 for empty org (FR-SPD-001)'
);

-- AC-1104: pipeline_projected_margin = 0 (no pipeline projects → no div-by-zero)
select is(
  (get_executive_dashboard() ->> 'pipeline_projected_margin')::numeric,
  0::numeric,
  'AC-1104: pipeline_projected_margin = 0 for empty org (FR-SPD-003)'
);

-- AC-1104: pipeline_weighted_value = 0 (no pipeline projects)
select is(
  (get_executive_dashboard() ->> 'pipeline_weighted_value')::numeric,
  0::numeric,
  'AC-1104: pipeline_weighted_value = 0 for empty org (FR-SPD-003)'
);

reset role;
select * from finish();
rollback;
