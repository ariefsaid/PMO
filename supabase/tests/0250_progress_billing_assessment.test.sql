-- 0250_progress_billing_assessment.test.sql — #766 AC-PB-017: a progress assessment by quantities extends #765's
-- project_progress_entries (0245) and never reaches billing. BoQ of c1: 10 km @ 50,000 + 5 units @ 100,000 = 1,000,000.
-- Cast: a2 Finance · a4 PM (c1's project manager) · a7 PM2 (not c1's) · a5 Engineer.
begin;
create extension if not exists pgtap;
select plan(25);

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
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-15',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":4},{"boq_item_id":"07660000-0000-0000-0000-0000000000e2","quantity_to_date":1}]'::jsonb) $$,
  'AC-PB-017 the project''s PM records quantities done to date for September');                              -- 1
select is((select pct_complete || '/' || entered_by from project_progress_entries
            where project_id = '07660000-0000-0000-0000-0000000000c1' and month = '2026-09-01'),
  '30.00/07660000-0000-0000-0000-0000000000a4',
  'AC-PB-017 the month''s percent is derived from quantities (300,000 of 1,000,000) and stamped with the PM'); -- 2
select is((select string_agg(q.quantity_to_date::text, ',' order by q.quantity_to_date)
             from progress_assessment_quantities q join project_progress_entries e on e.id = q.entry_id
            where e.project_id = '07660000-0000-0000-0000-0000000000c1' and e.month = '2026-09-01'),
  '1.000,4.000', 'AC-PB-017 each line''s quantity done to date is kept');                                      -- 3
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":6},{"boq_item_id":"07660000-0000-0000-0000-0000000000e2","quantity_to_date":1}]'::jsonb) $$,
  'AC-PB-017 re-recording the open month replaces it');                                                     -- 4
select is((select pct_complete::text from project_progress_entries
            where project_id = '07660000-0000-0000-0000-0000000000c1' and month = '2026-09-01'), '40.00',
  'AC-PB-017 6 km and 1 unit is 40%');                                                                       -- 5
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":6}]'::jsonb) $$,
  'AC-PB-017 an assessment that omits a line');                                                             -- 6
select is((select e.pct_complete || '/' || count(q.id) from project_progress_entries e
             left join progress_assessment_quantities q on q.entry_id = e.id
            where e.project_id = '07660000-0000-0000-0000-0000000000c1' and e.month = '2026-09-01'
            group by e.pct_complete), '30.00/1',
  'AC-PB-017 an omitted line is removed from the month and counts as nothing done');                         -- 7
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":12}]'::jsonb) $$,
  'AC-PB-017 over-measurement is accepted');                                                                -- 8
select is((select pct_complete::text from project_progress_entries
            where project_id = '07660000-0000-0000-0000-0000000000c1' and month = '2026-09-01'), '50.00',
  'AC-PB-017 12 of 10 km counts the line at most to its full value');                                       -- 9
select throws_ok($$ select public.record_project_progress('07660000-0000-0000-0000-0000000000c1', '2026-09-01', 70) $$,
  'P0001', 'this month''s progress is measured by quantities — record the quantities done to date instead',
  'AC-PB-017 a typed percent cannot overwrite a quantity-measured month');                                  -- 10
select lives_ok($$ select public.record_project_progress('07660000-0000-0000-0000-0000000000c1', '2026-08-01', 25) $$,
  'AC-PB-017 CONTROL a typed percent for a month without quantities still works (#765)');                    -- 11
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":-1}]'::jsonb) $$,
  '23514', 'each quantity done to date must be 0 or more with at most 3 decimals',
  'AC-PB-017 a negative quantity is refused');                                                              -- 12
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":1.2345}]'::jsonb) $$,
  '23514', 'each quantity done to date must be 0 or more with at most 3 decimals',
  'AC-PB-017 a quantity has at most 3 decimals');                                                           -- 13
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e3","quantity_to_date":1}]'::jsonb) $$,
  '23514', 'every line must be a bill of quantities line of this project',
  'AC-PB-017 another project''s line is refused');                                                          -- 14
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":1},{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":2}]'::jsonb) $$,
  '23514', 'each bill of quantities line may appear once per assessment',
  'AC-PB-017 a repeated line is refused');                                                                  -- 15
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01', '[]'::jsonb) $$,
  '23502', 'project, month and at least one quantity are required',
  'AC-PB-017 an empty assessment is refused');                                                              -- 16
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":1}]'::jsonb) $$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-PB-017 another PM cannot assess this project');                                                       -- 17
select throws_ok($$ insert into progress_assessment_quantities (entry_id, boq_item_id, quantity_to_date)
  select e.id, '07660000-0000-0000-0000-0000000000e2', 1 from project_progress_entries e
   where e.project_id = '07660000-0000-0000-0000-0000000000c1' and e.month = '2026-08-01' $$,
  '42501', 'new row violates row-level security policy for table "progress_assessment_quantities"',
  'AC-PB-017 another PM cannot write quantities directly either');                                          -- 18
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c1', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity_to_date":1}]'::jsonb) $$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-PB-017 an Engineer cannot assess');                                                                   -- 19
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c3', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e4","quantity_to_date":1}]'::jsonb) $$,
  '23514', 'this project''s bill of quantities has no value, so percent complete cannot be measured from quantities — record a percent instead',
  'AC-PB-017 a BoQ with no value cannot measure a percent');                                                -- 20
select lives_ok($$ select public.record_progress_assessment('07660000-0000-0000-0000-0000000000c2', '2026-09-01',
  '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e3","quantity_to_date":3}]'::jsonb) $$,
  'AC-PB-017 Finance may assess any project');                                                              -- 21
reset role;
select is((select count(*)::int from progress_claims) + (select count(*)::int from external_command_outbox
            where org_id = '07660000-0000-0000-0000-000000000001'), 0,
  'AC-PB-017 an assessment creates no billing claim and no ERP command');                                   -- 22
select throws_ok($$ delete from boq_items where id = '07660000-0000-0000-0000-0000000000e1' $$,
  '23503', 'update or delete on table "boq_items" violates foreign key constraint "progress_assessment_quantities_boq_item_id_fkey" on table "progress_assessment_quantities"',
  'AC-PB-017 a BoQ line with recorded quantities cannot be deleted');                                       -- 23
select is(has_function_privilege('anon', 'public.record_progress_assessment(uuid,date,jsonb,text)', 'EXECUTE'), false,
  'AC-PB-017 anon cannot record an assessment');                                                            -- 24
select is((select prosecdef from pg_proc where oid = 'public.record_progress_assessment(uuid,date,jsonb,text)'::regprocedure), false,
  'AC-PB-017 the assessment writer is SECURITY INVOKER — #765''s RLS stays the authority');                   -- 25

select * from finish();
rollback;
