-- imprest_approval_route.test.sql — #1515 fix round (0426): get_expense_claim_approval_routes is plan-aware. A Submitted float
-- record above the month's remaining reads as the senior route with is_exception = true, excluding the claimant and the
-- approver of the month's plan; the same decision transition_expense_claim makes. AC-IMP-023..025 (read half).
begin;
create extension if not exists pgtap;
select plan(15);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15260000-0000-0000-0000-00000000000a', 'IAR Org',   'IDR', 'Asia/Jakarta'),
  ('15260000-0000-0000-0000-00000000000b', 'IAR Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15260000-0000-0000-0000-0000000000a1', 'iar-admin@example.com'),
  ('15260000-0000-0000-0000-0000000000a2', 'iar-cust@example.com'),   -- Finance, custodian of float F
  ('15260000-0000-0000-0000-0000000000a4', 'iar-pm1@example.com'),    -- PM, project approver of P1
  ('15260000-0000-0000-0000-0000000000a6', 'iar-eng@example.com'),    -- Engineer, claimant
  ('15260000-0000-0000-0000-0000000000a7', 'iar-exec@example.com'),   -- Executive, senior, approved the plan
  ('15260000-0000-0000-0000-0000000000a8', 'iar-exec2@example.com'),  -- Executive, senior
  ('15260000-0000-0000-0000-0000000000b1', 'iar-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15260000-0000-0000-0000-0000000000a1', '15260000-0000-0000-0000-00000000000a', 'IAR Admin', 'iar-admin@example.com', 'Admin', 'active'),
  ('15260000-0000-0000-0000-0000000000a2', '15260000-0000-0000-0000-00000000000a', 'IAR Cust',  'iar-cust@example.com',  'Finance', 'active'),
  ('15260000-0000-0000-0000-0000000000a4', '15260000-0000-0000-0000-00000000000a', 'IAR PM1',   'iar-pm1@example.com',   'Project Manager', 'active'),
  ('15260000-0000-0000-0000-0000000000a6', '15260000-0000-0000-0000-00000000000a', 'IAR Eng',   'iar-eng@example.com',   'Engineer', 'active'),
  ('15260000-0000-0000-0000-0000000000a7', '15260000-0000-0000-0000-00000000000a', 'IAR Exec',  'iar-exec@example.com',  'Executive', 'active'),
  ('15260000-0000-0000-0000-0000000000a8', '15260000-0000-0000-0000-00000000000a', 'IAR Exec2', 'iar-exec2@example.com', 'Executive', 'active'),
  ('15260000-0000-0000-0000-0000000000b1', '15260000-0000-0000-0000-00000000000b', 'IAR XOrg',  'iar-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15260000-0000-0000-0000-0000000000c1', '15260000-0000-0000-0000-00000000000a', 'IAR Site', 'Ongoing Project', '15260000-0000-0000-0000-0000000000a4');
insert into org_imprest_settings (org_id, procurement_limit, updated_by) values
  ('15260000-0000-0000-0000-00000000000a', 5000000, '15260000-0000-0000-0000-0000000000a1');
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15260000-0000-0000-0000-00000000000a', null, '15260000-0000-0000-0000-0000000000a7'),
  ('15260000-0000-0000-0000-00000000000a', null, '15260000-0000-0000-0000-0000000000a8'),
  ('15260000-0000-0000-0000-00000000000a', '15260000-0000-0000-0000-0000000000c1', '15260000-0000-0000-0000-0000000000a4');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('15260000-0000-0000-0000-000000000f01', '15260000-0000-0000-0000-00000000000a', '15260000-0000-0000-0000-0000000000c1', 'v1', 1, 'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('15260000-0000-0000-0000-00000000000a', '15260000-0000-0000-0000-000000000f01', 'Vehicle', 100000000);
update budget_versions set status = 'Active' where id = '15260000-0000-0000-0000-000000000f01';
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15260000-0000-0000-0000-0000000000d1', '15260000-0000-0000-0000-00000000000a', '15260000-0000-0000-0000-0000000000c1',
   '15260000-0000-0000-0000-0000000000a2', 10000000, 'IDR', '15260000-0000-0000-0000-0000000000a1');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.m() returns date language sql stable as $$
  select date_trunc('month', now() at time zone 'Asia/Jakarta')::date
$$;
-- plan: Vehicle 500,000 this month, approved by Exec
insert into imprest_plans (id, org_id, float_id, month, author_id) values
  ('15260000-0000-0000-0000-000000000150', '15260000-0000-0000-0000-00000000000a', '15260000-0000-0000-0000-0000000000d1',
   pg_temp.m(), '15260000-0000-0000-0000-0000000000a4');
insert into imprest_plan_lines (plan_id, budget_category, planned_amount) values
  ('15260000-0000-0000-0000-000000000150', 'Vehicle', 500000);
update imprest_plans set status = 'Approved', number = 'IMP-2611010150', submitted_at = now(),
       approved_by = '15260000-0000-0000-0000-0000000000a7', approved_at = now()
 where id = '15260000-0000-0000-0000-000000000150';

-- 211 in plan (400,000) · 212 out of plan (700,000) · 213 off-float (700,000)
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, imprest_float_id) values
  ('15260000-0000-0000-0000-000000000211', '15260000-0000-0000-0000-00000000000a', 'claim', '15260000-0000-0000-0000-0000000000a6',
   '15260000-0000-0000-0000-0000000000c1', 'Vehicle', 'In plan', 0, 'Draft', '15260000-0000-0000-0000-0000000000d1'),
  ('15260000-0000-0000-0000-000000000212', '15260000-0000-0000-0000-00000000000a', 'claim', '15260000-0000-0000-0000-0000000000a6',
   '15260000-0000-0000-0000-0000000000c1', 'Vehicle', 'Out of plan', 0, 'Draft', '15260000-0000-0000-0000-0000000000d1'),
  ('15260000-0000-0000-0000-000000000213', '15260000-0000-0000-0000-00000000000a', 'claim', '15260000-0000-0000-0000-0000000000a6',
   '15260000-0000-0000-0000-0000000000c1', 'Vehicle', 'Off float', 0, 'Draft', null),
  ('15260000-0000-0000-0000-000000000214', '15260000-0000-0000-0000-00000000000a', 'claim', '15260000-0000-0000-0000-0000000000a8',
   '15260000-0000-0000-0000-0000000000c1', 'Vehicle', 'Senior own claim', 0, 'Draft', '15260000-0000-0000-0000-0000000000d1');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('15260000-0000-0000-0000-000000000211', current_date, 'Local transport', 'Diesel', 400000),
  ('15260000-0000-0000-0000-000000000212', current_date, 'Local transport', 'Diesel', 700000),
  ('15260000-0000-0000-0000-000000000213', current_date, 'Local transport', 'Diesel', 700000),
  ('15260000-0000-0000-0000-000000000214', current_date, 'Local transport', 'Diesel', 700000);
insert into expense_claim_files (claim_id, org_id, file_path)
select c, '15260000-0000-0000-0000-00000000000a', '15260000-0000-0000-0000-00000000000a/' || c || '/' || gen_random_uuid() || '/r.pdf'
  from unnest(array['15260000-0000-0000-0000-000000000211', '15260000-0000-0000-0000-000000000212',
                    '15260000-0000-0000-0000-000000000213', '15260000-0000-0000-0000-000000000214']::uuid[]) c;
update expense_claims set status = 'Submitted', submitted_at = now() + interval '1 hour', imprest_month = pg_temp.m(),
       claim_number = 'EXP-26110102' || right(id::text, 2)
-- the off-float record carries no month
 where id in ('15260000-0000-0000-0000-000000000211', '15260000-0000-0000-0000-000000000212', '15260000-0000-0000-0000-000000000214');
update expense_claims set status = 'Submitted', submitted_at = now() + interval '1 hour', claim_number = 'EXP-2611010213'
 where id = '15260000-0000-0000-0000-000000000213';

set local role authenticated;
select pg_temp.act_as('15260000-0000-0000-0000-0000000000a4');
select is((select route || '/' || is_exception::text from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000211']::uuid[])),
  'project/false', 'AC-IMP-023 an in-plan float record keeps the project route and is no exception');
select is((select route || '/' || is_exception::text from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000212']::uuid[])),
  'org/true', 'AC-IMP-023 an out-of-plan float record reads as the senior route with is_exception');
select is((select route || '/' || is_exception::text from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000213']::uuid[])),
  'project/false', 'AC-IMP-023 an off-float record above the plan is no exception');
select is((select jsonb_agg(a->>'full_name' order by a->>'full_name')
             from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000212']::uuid[]) r, jsonb_array_elements(r.approvers) a),
  '["IAR Exec2"]'::jsonb, 'AC-IMP-024 the exception approvers exclude the claimant and the approver of the month''s plan');
select ok(exists (select 1 from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000212']::uuid[])
                   where reason is not null and request_amount = 700000),
  'AC-IMP-023 the exception row still carries the budget reason and the request amount');

-- the read matches the decision
select throws_ok($$ select transition_expense_claim('15260000-0000-0000-0000-000000000212', 'Approved') $$,
  '42501', null, 'AC-IMP-023 the project approver the read excludes is refused by the transition');
select pg_temp.act_as('15260000-0000-0000-0000-0000000000a8');
select is((select count(*)::int from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000212']::uuid[])
            where approvers @> '[{"full_name":"IAR Exec2"}]'::jsonb), 1,
  'AC-IMP-023 the senior approver the read lists is the one who may decide');

-- a claimant cannot read the plan, so the read never flags an exception for them
select pg_temp.act_as('15260000-0000-0000-0000-0000000000a6');
select is((select route || '/' || is_exception::text from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000212']::uuid[])),
  'project/false', 'AC-IMP-023 a claimant''s read flags nothing (the plan is not theirs to read)');

-- a senior's own out-of-plan record never routes to the senior themselves (Exec is the plan approver, Exec2 the claimant)
select pg_temp.act_as('15260000-0000-0000-0000-0000000000a1');
select is((select route || '/' || jsonb_array_length(approvers)::text
             from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000214']::uuid[])),
  'admin/0', 'AC-IMP-024 the claimant is excluded from the senior route');

-- another organization sees no rows
select pg_temp.act_as('15260000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000212']::uuid[])), 0,
  'AC-IMP-023 another organization reads no route');

-- the only other senior is out: an Admin decides
reset role;
delete from spend_approvers where org_id = '15260000-0000-0000-0000-00000000000a' and profile_id = '15260000-0000-0000-0000-0000000000a8';
set local role authenticated;
select pg_temp.act_as('15260000-0000-0000-0000-0000000000a1');
select is((select route || '/' || is_exception::text || '/' || jsonb_array_length(approvers)::text
             from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000212']::uuid[])),
  'admin/true/0', 'AC-IMP-024 with no eligible senior the exception routes to an Admin');
select lives_ok($$ select transition_expense_claim('15260000-0000-0000-0000-000000000212', 'Approved') $$,
  'AC-IMP-024 and an Admin who did not approve the plan decides it');
reset role;
-- an approved record is no longer listed
select is((select count(*)::int from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000212']::uuid[])), 0,
  'AC-IMP-023 only Submitted records are routed');
-- the 0247 shape for the plain claim is unchanged
set local role authenticated;
select pg_temp.act_as('15260000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from get_expense_claim_approval_routes(array['15260000-0000-0000-0000-000000000211']::uuid[])
            where claim_id = '15260000-0000-0000-0000-000000000211' and line_budget = 100000000), 1,
  'AC-IMP-023 the 0247 columns (claim_id, line_budget) are kept');
select ok(has_function_privilege('authenticated', 'public.get_expense_claim_approval_routes(uuid[])', 'execute')
          and not has_function_privilege('anon', 'public.get_expense_claim_approval_routes(uuid[])', 'execute'),
  'AC-IMP-023 the grants stay: authenticated yes, anon no');
reset role;

select * from finish();
rollback;
