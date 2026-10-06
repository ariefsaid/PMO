-- 0252_progress_pct_derived_guard.test.sql — #766 AC-PB-017: a quantity-measured month's percent cannot be overwritten by a direct UPDATE.
-- (setup copied from 0250_progress_billing_assessment.test.sql: a progress assessment by quantities extends #765's
-- project_progress_entries (0245) and never reaches billing. BoQ of c1: 10 km @ 50,000 + 5 units @ 100,000 = 1,000,000.
-- Cast: a2 Finance · a4 PM (c1's project manager) · a7 PM2 (not c1's) · a5 Engineer.
begin;
create extension if not exists pgtap;
select plan(5);

insert into organizations (id, name) values ('07660000-0000-0000-0000-000000000001', 'PB Org');
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000a4', 'pb-pm@example.com'),
  ('07660000-0000-0000-0000-0000000000a5', 'pb-eng@example.com'),
  ('07660000-0000-0000-0000-0000000000a7', 'pb-pm2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000a4', '07660000-0000-0000-0000-000000000001', 'PB PM', 'pb-pm@example.com', 'Project Manager', 'active'),
  ('07660000-0000-0000-0000-0000000000a5', '07660000-0000-0000-0000-000000000001', 'PB Eng', 'pb-eng@example.com', 'Engineer', 'active'),
  ('07660000-0000-0000-0000-0000000000a7', '07660000-0000-0000-0000-000000000001', 'PB PM Two', 'pb-pm2@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000a4'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Project Two', 'Ongoing Project', 1000000, 'exclusive', 0, null),
  ('07660000-0000-0000-0000-0000000000c3', '07660000-0000-0000-0000-000000000001', 'PB Project Three', 'Ongoing Project', 1000000, 'exclusive', 0, null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000),
  ('07660000-0000-0000-0000-0000000000e2', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'STATION', 'Station build', 'unit', 5, 100000),
  ('07660000-0000-0000-0000-0000000000e3', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2', 'CABLE', 'Cable pull', 'km', 10, 50000),
  ('07660000-0000-0000-0000-0000000000e4', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c3', 'FREE', 'Free service', 'lot', 1, 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":4},{"boq_item_id":"07660000-0000-0000-0000-0000000000e2","quantity_to_date":1}]'::jsonb) $$,
  'AC-PB-017 the PM records quantities for September (30%)');                                                -- 1
select throws_ok($$ update project_progress_entries set pct_complete = 99
   where project_id = '07660000-0000-0000-0000-0000000000c1' and month = '2026-09-01' $$,
  'P0001', 'this month''s progress is measured by quantities — record the quantities done to date instead',
  'AC-PB-017 a direct table UPDATE cannot overwrite a quantity-derived percent');                            -- 2
select is((select pct_complete::text from project_progress_entries
            where project_id = '07660000-0000-0000-0000-0000000000c1' and month = '2026-09-01'), '30.00',
  'AC-PB-017 the derived percent is untouched');                                                              -- 3
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":6},{"boq_item_id":"07660000-0000-0000-0000-0000000000e2","quantity_to_date":1}]'::jsonb) $$,
  'AC-PB-017 CONTROL the derived writer can still re-derive the percent');                                    -- 4
select lives_ok($$ select public.record_project_progress('07660000-0000-0000-0000-0000000000c1', '2026-08-01', 25) $$,
  'AC-PB-017 CONTROL a month without quantities still takes a typed percent (#765)');                        -- 5

select * from finish();
rollback;
