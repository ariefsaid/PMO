-- 0057_sales_pipeline_attention.test.sql — get_sales_pipeline() attention signals for OPEN deals.
-- AC-IXD-PIPE-W5-C5 / N14: prove the RPC now projects `last_update` + the owner (`pm_name`) per
-- open-pipeline row, and that the org-scoping / tenancy of the (security invoker) RPC still holds.
begin;
select plan(6);

-- ── Tenancy fixture (insert as table owner BEFORE switching to authenticated; RLS on
--    organizations blocks an authenticated INSERT, per 0039's ordering) ──────────────
insert into organizations (id, name) values
  ('00570000-0000-0000-0000-000000000001', 'Tenancy Test Org B (0057)');
insert into auth.users (id, email) values
  ('00570000-0000-0000-0000-0000000000b1', 'orgb-exec-0057@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('00570000-0000-0000-0000-0000000000b1', '00570000-0000-0000-0000-000000000001',
   'Org B Exec 0057', 'orgb-exec-0057@example.com', 'Executive');

-- ── In-org caller (default-org Executive, sub a1; same JWT as 0044) ──────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-IXD-PIPE-W5-C5: an OPEN pipeline row now carries `last_update` (the projects.last_update
-- timestamp the FE aging/last-touch reads). P002 "Northwind ERP Rollout" is Tender Submitted.
select isnt(
  (select proj->>'last_update'
     from json_array_elements((get_sales_pipeline()->'projects')) proj
    where proj->>'name' = 'Northwind ERP Rollout'),
  null,
  'AC-IXD-PIPE-W5-C5: open pipeline row projects last_update (N14 Last touch source)'
);

-- AC-IXD-PIPE-W5-C5: that last_update is a parseable timestamp (the FE daysSince() consumes it).
select ok(
  (select (proj->>'last_update')::timestamptz is not null
     from json_array_elements((get_sales_pipeline()->'projects')) proj
    where proj->>'name' = 'Northwind ERP Rollout'),
  'AC-IXD-PIPE-W5-C5: last_update on an open row is a valid timestamp'
);

-- AC-IXD-PIPE-W5-C5: the open row carries its OWNER (pm_name) — P002's PM is Alice Manager (a2),
-- joined projects.project_manager_id → profiles.full_name (the same owner the FE shows for lost deals).
select is(
  (select proj->>'pm_name'
     from json_array_elements((get_sales_pipeline()->'projects')) proj
    where proj->>'name' = 'Northwind ERP Rollout'),
  'Alice Manager',
  'AC-IXD-PIPE-W5-C5: open pipeline row projects pm_name = owner full_name (N14 Owner column)'
);

-- AC-IXD-PIPE-W5-C5: a projects row STILL carries the existing fields (additive change — no regression
-- of the original return shape).
select ok(
  (select (proj::jsonb ? 'id') and (proj::jsonb ? 'contract_value') and (proj::jsonb ? 'win_probability')
     from json_array_elements((get_sales_pipeline()->'projects')) proj
    where proj->>'name' = 'Northwind ERP Rollout'),
  'AC-IXD-PIPE-W5-C5: existing projects fields preserved (id/contract_value/win_probability)'
);

-- ── Tenancy: an org-B caller sees NONE of default-org's pipeline rows nor any owner ─────────────
-- (org B + its Exec were inserted above as table owner; authenticate as the ORG-B Executive,
-- which has an empty pipeline of its own.)
set local role authenticated;
set local request.jwt.claims to '{"sub":"00570000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- AC-IXD-PIPE-W5-C5: org B sees ZERO of default-org's open pipeline projects (RLS scopes the read).
select is(
  (select json_array_length(get_sales_pipeline()->'projects')),
  0,
  'AC-IXD-PIPE-W5-C5: org B caller sees no default-org pipeline rows (NFR-SPD-SEC-001 tenancy)'
);

-- AC-IXD-PIPE-W5-C5: org B can never resolve default-org's owner name (the profiles join is
-- RLS-scoped, so "Alice Manager" cannot appear in org B's pipeline payload).
select ok(
  not exists(
    select 1 from json_array_elements((get_sales_pipeline()->'projects')) proj
     where proj->>'pm_name' = 'Alice Manager'
  ),
  'AC-IXD-PIPE-W5-C5: org B never sees default-org owner name (profiles join stays org-scoped)'
);

reset role;
select * from finish();
rollback;
