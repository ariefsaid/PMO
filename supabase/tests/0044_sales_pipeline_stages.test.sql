-- 0044_sales_pipeline_stages.test.sql — get_sales_pipeline() stage + project payload
-- AC-1110 / FR-SPD-010 / OD-SP-1/2
-- DECOUPLED from seed: uses its own isolated org with exactly the pipeline projects
-- needed to prove the stage aggregation logic. UUID prefix 00440000-…
--
-- Fixture:
--   Tender Submitted: P-TS1 (1,200,000) + P-TS2 (950,000) + P-TS3 (1,000,000) = count=3, total=3,150,000
--   PQ Submitted:    P-PQ1 (800,000)                                            = count=1, total=800,000
--   win_prob from isolated pipeline_stage_config seeded below:
--     Tender Submitted = 0.500 → weighted = 1,575,000
--     PQ Submitted     = 0.250 → weighted =   200,000
begin;
select plan(6);

-- ── Isolated org + executive ──────────────────────────────────────────────────
insert into organizations (id, name) values
  ('00440000-0000-0000-0000-000000000001', 'Sales Pipeline Test Org (0044)');

insert into auth.users (id, email) values
  ('00440000-0000-0000-0000-0000000000a1', 'exec@pipeline0044.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00440000-0000-0000-0000-0000000000a1', '00440000-0000-0000-0000-000000000001',
   'Exec 0044', 'exec@pipeline0044.example', 'Executive');

-- ── Pipeline stage config for the isolated org ────────────────────────────────
insert into pipeline_stage_config (org_id, status, win_probability) values
  ('00440000-0000-0000-0000-000000000001', 'Tender Submitted', 0.500),
  ('00440000-0000-0000-0000-000000000001', 'PQ Submitted',     0.250);

-- ── Pipeline projects ─────────────────────────────────────────────────────────
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent)
values
  -- Three Tender Submitted: 1,200,000 + 950,000 + 1,000,000 = 3,150,000
  ('44000000-0000-0000-0000-000000000001', '00440000-0000-0000-0000-000000000001',
   'TS001', 'Tender Project Alpha', 'Tender Submitted',
   '00440000-0000-0000-0000-0000000000a1',
   1200000, 0, 0),
  ('44000000-0000-0000-0000-000000000002', '00440000-0000-0000-0000-000000000001',
   'TS002', 'Tender Project Beta', 'Tender Submitted',
   '00440000-0000-0000-0000-0000000000a1',
   950000, 0, 0),
  ('44000000-0000-0000-0000-000000000003', '00440000-0000-0000-0000-000000000001',
   'TS003', 'Tender Project Gamma', 'Tender Submitted',
   '00440000-0000-0000-0000-0000000000a1',
   1000000, 0, 0),
  -- One PQ Submitted: 800,000
  ('44000000-0000-0000-0000-000000000004', '00440000-0000-0000-0000-000000000001',
   'PQ001', 'PQ Project Delta', 'PQ Submitted',
   '00440000-0000-0000-0000-0000000000a1',
   800000, 0, 0),
  -- One Ongoing Project — must NOT appear in pipeline stages
  ('44000000-0000-0000-0000-000000000005', '00440000-0000-0000-0000-000000000001',
   'ON001', 'Ongoing Project Epsilon', 'Ongoing Project',
   '00440000-0000-0000-0000-0000000000a1',
   5000000, 4000000, 0),
  -- One Loss Tender — must NOT appear in pipeline stages
  ('44000000-0000-0000-0000-000000000006', '00440000-0000-0000-0000-000000000001',
   'LT001', 'Lost Bid Zeta', 'Loss Tender',
   '00440000-0000-0000-0000-0000000000a1',
   600000, 0, 0);

-- ── Authenticate as the test-org Executive ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00440000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1110: Tender Submitted stage — count=3, total=3,150,000, win_prob=0.500, weighted=1,575,000
select ok(
  (select (elem->>'count')::int = 3
     and  abs((elem->>'total_value')::numeric - 3150000) < 1
     and  abs((elem->>'win_probability')::numeric - 0.5) < 1e-6
     and  abs((elem->>'weighted_value')::numeric - 1575000) < 1
   from json_array_elements((get_sales_pipeline()->'stages')) elem
   where elem->>'status' = 'Tender Submitted'),
  'AC-1110: Tender Submitted stage count=3, total=3150000, win_prob=0.500, weighted=1575000 (FR-SPD-010)'
);

-- AC-1110: PQ Submitted stage — count=1, total=800,000, win_prob=0.250, weighted=200,000
select ok(
  (select (elem->>'count')::int = 1
     and  abs((elem->>'total_value')::numeric - 800000) < 1
     and  abs((elem->>'win_probability')::numeric - 0.25) < 1e-6
     and  abs((elem->>'weighted_value')::numeric - 200000) < 1
   from json_array_elements((get_sales_pipeline()->'stages')) elem
   where elem->>'status' = 'PQ Submitted'),
  'AC-1110: PQ Submitted stage count=1, total=800000, win_prob=0.250, weighted=200000 (FR-SPD-010)'
);

-- AC-1110: No Ongoing Project stage in pipeline output
select ok(
  not exists(
    select 1
    from json_array_elements((get_sales_pipeline()->'stages')) elem
    where elem->>'status' = 'Ongoing Project'
  ),
  'AC-1110: Ongoing Project not included in pipeline stages'
);

-- AC-1110: No Loss Tender stage in pipeline output
select ok(
  not exists(
    select 1
    from json_array_elements((get_sales_pipeline()->'stages')) elem
    where elem->>'status' = 'Loss Tender'
  ),
  'AC-1110: Loss Tender not included in pipeline stages'
);

-- AC-1110: projects array contains a Tender Submitted project with contract_value=1,200,000
select ok(
  exists(
    select 1
    from json_array_elements((get_sales_pipeline()->'projects')) proj
    where proj->>'status' = 'Tender Submitted'
      and abs((proj->>'contract_value')::numeric - 1200000) < 1
  ),
  'AC-1110: projects list includes Tender Submitted project with contract_value=1200000'
);

-- AC-1110: anon has no EXECUTE on get_sales_pipeline
reset role;
select ok(
  not has_function_privilege('anon', 'get_sales_pipeline()', 'execute'),
  'AC-1110: anon cannot execute get_sales_pipeline (NFR-SPD-SEC-001)'
);

select * from finish();
rollback;
