-- 0044_sales_pipeline_stages.test.sql — get_sales_pipeline() stage + project payload
-- AC-1110 / FR-SPD-010 / OD-SP-1/2
begin;
select plan(6);

-- Seed Executive JWT (sub = default-org Executive; same as other dashboard tests)
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ── stage assertions ───────────────────────────────────────────────────────────

-- AC-1110: Tender Submitted stage — three seeded deals (P002 1,200,000 + P011 950,000 [PR #27]
--   + P012 1,000,000 [AC-1011's dedicated win-target row]): count=3,
--   total_value=3,150,000, win_prob=0.500, weighted=3,150,000×0.5=1,575,000
select ok(
  (select (elem->>'count')::int = 3
     and  abs((elem->>'total_value')::numeric - 3150000) < 1
     and  abs((elem->>'win_probability')::numeric - 0.5) < 1e-6
     and  abs((elem->>'weighted_value')::numeric - 1575000) < 1
   from json_array_elements((get_sales_pipeline()->'stages')) elem
   where elem->>'status' = 'Tender Submitted'),
  'AC-1110: Tender Submitted stage count=3, total=3150000, win_prob=0.500, weighted=1575000 (FR-SPD-010)'
);

-- AC-1110: PQ Submitted stage — count=1, total_value=800000, win_prob=0.250, weighted=200000
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

-- AC-1110: projects array contains Tender Submitted project (P002)
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
