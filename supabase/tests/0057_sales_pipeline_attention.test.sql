-- 0057_sales_pipeline_attention.test.sql — get_sales_pipeline() attention signals for OPEN deals.
-- AC-IXD-PIPE-W5-C5 / N14: prove the RPC now projects `last_update` + the owner (`pm_name`) per
-- open-pipeline row, and that the org-scoping / tenancy of the (security invoker) RPC still holds.
-- DECOUPLED from seed: uses own isolated org A + org B fixtures. UUID prefix 00570000-…
begin;
select plan(6);

-- ── Org A: the in-org caller with a known open pipeline project ───────────────
insert into organizations (id, name) values
  ('00570000-0000-0000-0000-000000000001', 'Pipeline Attention Test Org A (0057)');

insert into auth.users (id, email) values
  ('00570000-0000-0000-0000-0000000000a1', 'exec-a@pipeline0057.example'),
  ('00570000-0000-0000-0000-0000000000a2', 'pm-a@pipeline0057.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00570000-0000-0000-0000-0000000000a1', '00570000-0000-0000-0000-000000000001',
   'Exec A 0057', 'exec-a@pipeline0057.example', 'Executive'),
  ('00570000-0000-0000-0000-0000000000a2', '00570000-0000-0000-0000-000000000001',
   'Alice Manager', 'pm-a@pipeline0057.example', 'Project Manager');

-- Org A: one Tender Submitted project with a known PM and a stale last_update
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent)
values
  ('57000000-0000-0000-0000-000000000001', '00570000-0000-0000-0000-000000000001',
   'PA001', 'Test Pipeline Deal', 'Tender Submitted',
   '00570000-0000-0000-0000-0000000000a2',
   1200000, 0, 0);

-- Set a stale last_update so the attention aging logic has a parseable timestamptz
update projects set last_update = now() - interval '45 days'
  where id = '57000000-0000-0000-0000-000000000001';

-- ── Org B: tenancy fixture — org B caller must see ZERO of org A's pipeline ───
insert into organizations (id, name) values
  ('00570000-0000-0000-0000-000000000002', 'Tenancy Test Org B (0057)');

insert into auth.users (id, email) values
  ('00570000-0000-0000-0000-0000000000b1', 'exec-b@pipeline0057.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00570000-0000-0000-0000-0000000000b1', '00570000-0000-0000-0000-000000000002',
   'Org B Exec 0057', 'exec-b@pipeline0057.example', 'Executive');

-- ── In-org caller (Org A Executive) ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00570000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-IXD-PIPE-W5-C5: an OPEN pipeline row now carries `last_update` (the projects.last_update
-- timestamp the FE aging/last-touch reads). 'Test Pipeline Deal' is Tender Submitted.
select isnt(
  (select proj->>'last_update'
     from json_array_elements((get_sales_pipeline()->'projects')) proj
    where proj->>'name' = 'Test Pipeline Deal'),
  null,
  'AC-IXD-PIPE-W5-C5: open pipeline row projects last_update (N14 Last touch source)'
);

-- AC-IXD-PIPE-W5-C5: that last_update is a parseable timestamp (the FE daysSince() consumes it).
select ok(
  (select (proj->>'last_update')::timestamptz is not null
     from json_array_elements((get_sales_pipeline()->'projects')) proj
    where proj->>'name' = 'Test Pipeline Deal'),
  'AC-IXD-PIPE-W5-C5: last_update on an open row is a valid timestamp'
);

-- AC-IXD-PIPE-W5-C5: the open row carries its OWNER (pm_name) — 'Test Pipeline Deal' PM is 'Alice Manager',
-- joined projects.project_manager_id → profiles.full_name.
select is(
  (select proj->>'pm_name'
     from json_array_elements((get_sales_pipeline()->'projects')) proj
    where proj->>'name' = 'Test Pipeline Deal'),
  'Alice Manager',
  'AC-IXD-PIPE-W5-C5: open pipeline row projects pm_name = owner full_name (N14 Owner column)'
);

-- AC-IXD-PIPE-W5-C5: a projects row STILL carries the existing fields (additive change — no regression
-- of the original return shape).
select ok(
  (select (proj::jsonb ? 'id') and (proj::jsonb ? 'contract_value') and (proj::jsonb ? 'win_probability')
     from json_array_elements((get_sales_pipeline()->'projects')) proj
    where proj->>'name' = 'Test Pipeline Deal'),
  'AC-IXD-PIPE-W5-C5: existing projects fields preserved (id/contract_value/win_probability)'
);

-- ── Tenancy: org B caller sees NONE of org A's pipeline rows nor any owner ─────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00570000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- AC-IXD-PIPE-W5-C5: org B sees ZERO of org A's open pipeline projects (RLS scopes the read).
select is(
  (select json_array_length(get_sales_pipeline()->'projects')),
  0,
  'AC-IXD-PIPE-W5-C5: org B caller sees no org A pipeline rows (NFR-SPD-SEC-001 tenancy)'
);

-- AC-IXD-PIPE-W5-C5: org B can never resolve org A's owner name (the profiles join is
-- RLS-scoped, so 'Alice Manager' cannot appear in org B's pipeline payload).
select ok(
  not exists(
    select 1 from json_array_elements((get_sales_pipeline()->'projects')) proj
     where proj->>'pm_name' = 'Alice Manager'
  ),
  'AC-IXD-PIPE-W5-C5: org B never sees org A owner name (profiles join stays org-scoped)'
);

reset role;
select * from finish();
rollback;
