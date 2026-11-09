-- 0810_pack_earned_value.test.sql — #1279. Migration under test: 0810_pack_earned_value.sql.
-- A project with contract lines is recognised in the management pack from the same per-line earned value
-- get_project_billing reports; a project without lines keeps the percent basis (no earned fact).
-- Also covers the as-at path with closed work orders (c3: one closed in an earlier month, one closed later).
-- Cast: PM a1 (records assessments) · FIN a2 Finance (reads the pack).
begin;
create extension if not exists pgtap;
select plan(18);

insert into organizations (id, name, default_currency, default_timezone) values
  ('08100000-0000-0000-0000-000000000001', 'Earned Pack Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('08100000-0000-0000-0000-0000000000a1', 'ev-pm@example.invalid'),
  ('08100000-0000-0000-0000-0000000000a2', 'ev-fin@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08100000-0000-0000-0000-0000000000a1', '08100000-0000-0000-0000-000000000001', 'EV PM', 'ev-pm@example.invalid', 'Project Manager', 'active'),
  ('08100000-0000-0000-0000-0000000000a2', '08100000-0000-0000-0000-000000000001', 'EV Fin', 'ev-fin@example.invalid', 'Finance', 'active');
-- Lines total 10 x 1,000 = 10,000 while the contract value is 50,000: the two bases differ on purpose.
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, project_manager_id, currency) values
  ('08100000-0000-0000-0000-0000000000c1', '08100000-0000-0000-0000-000000000001', 'EV Lines',   'Ongoing Project', 50000, 'exclusive', 0, '08100000-0000-0000-0000-0000000000a1', 'IDR'),
  ('08100000-0000-0000-0000-0000000000c2', '08100000-0000-0000-0000-000000000001', 'EV NoLines', 'Ongoing Project', 50000, 'exclusive', 0, '08100000-0000-0000-0000-0000000000a1', 'IDR');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('08100000-0000-0000-0000-0000000000e1', '08100000-0000-0000-0000-000000000001', '08100000-0000-0000-0000-0000000000c1', 'L1', 'Line', 'unit', 10, 1000);
insert into project_progress_entries (org_id, project_id, month, pct_complete, entered_by) values
  ('08100000-0000-0000-0000-000000000001', '08100000-0000-0000-0000-0000000000c2', date_trunc('month', now())::date, 40, '08100000-0000-0000-0000-0000000000a1');

-- c3: one line of 100 x 10, two work orders (40 and 30) each closed by a final acceptance in a different past month.
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, project_manager_id, currency) values
  ('08100000-0000-0000-0000-0000000000c3', '08100000-0000-0000-0000-000000000001', 'EV Closed WOs', 'Ongoing Project', 1000, 'exclusive', 0, '08100000-0000-0000-0000-0000000000a1', 'IDR');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('08100000-0000-0000-0000-0000000000e3', '08100000-0000-0000-0000-000000000001', '08100000-0000-0000-0000-0000000000c3', 'L3', 'Line', 'unit', 100, 10);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('08100000-0000-0000-0000-0000000000d1', '08100000-0000-0000-0000-000000000001', '08100000-0000-0000-0000-0000000000c3', 'WO closed early', 'Issued', 400, 'exclusive', 0),
  ('08100000-0000-0000-0000-0000000000d2', '08100000-0000-0000-0000-000000000001', '08100000-0000-0000-0000-0000000000c3', 'WO closed later', 'Issued', 300, 'exclusive', 0);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('08100000-0000-0000-0000-000000000001', '08100000-0000-0000-0000-0000000000d1', '08100000-0000-0000-0000-0000000000e3', 40),
  ('08100000-0000-0000-0000-000000000001', '08100000-0000-0000-0000-0000000000d2', '08100000-0000-0000-0000-0000000000e3', 30);
insert into project_documents (id, org_id, project_id, category, title, status, file_path) values
  ('08100000-0000-0000-0000-0000000000f1', '08100000-0000-0000-0000-000000000001', '08100000-0000-0000-0000-0000000000c3', 'Acceptance', 'BAST evidence', 'Issued',
   '08100000-0000-0000-0000-000000000001/08100000-0000-0000-0000-0000000000c3/08100000-0000-0000-0000-0000000000f1/bast.pdf');

set local role authenticated;
set local request.jwt.claims = '{"sub":"08100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.record_progress_assessment('08100000-0000-0000-0000-0000000000c1', (date_trunc('month', now()) - interval '1 month')::date,
  '[{"boq_item_id":"08100000-0000-0000-0000-0000000000e1","quantity_to_date":4}]'::jsonb)$$, 'AC-1279 assessment of 4 of 10 recorded last month');
select lives_ok($$select public.record_progress_assessment('08100000-0000-0000-0000-0000000000c1', date_trunc('month', now())::date,
  '[{"boq_item_id":"08100000-0000-0000-0000-0000000000e1","quantity_to_date":15}]'::jsonb)$$, 'AC-1279 assessment of 15 (past the 10 contracted) recorded this month');
set local request.jwt.claims = '{"sub":"08100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('ev.pack', public.get_management_pack()::text, true); end $$;

select is((select e ->> 'earned_value' from jsonb_array_elements(current_setting('ev.pack')::jsonb -> 'earned') e
            where e ->> 'project_id' = '08100000-0000-0000-0000-0000000000c1'
              and (e ->> 'month')::date = (date_trunc('month', now()) - interval '1 month')::date)::numeric, 4000::numeric,
  'AC-1279 last month is recognised at the assessed 4 x 1,000, not percent x contract');
select is((select e ->> 'earned_value' from jsonb_array_elements(current_setting('ev.pack')::jsonb -> 'earned') e
            where e ->> 'project_id' = '08100000-0000-0000-0000-0000000000c1'
              and (e ->> 'month')::date = date_trunc('month', now())::date)::numeric, 10000::numeric,
  'AC-1279 an assessment past the contract quantity is capped at 10 x 1,000');
select is((select e ->> 'earned_value' from jsonb_array_elements(current_setting('ev.pack')::jsonb -> 'earned') e
            where e ->> 'project_id' = '08100000-0000-0000-0000-0000000000c1'
              and (e ->> 'month')::date = date_trunc('month', now())::date)::numeric,
  (public.get_project_billing('08100000-0000-0000-0000-0000000000c1') ->> 'earned_value')::numeric,
  'AC-1279 the pack matches get_project_billing earned value for the as-at month');
select is((select sum(earned_value) from public.project_line_earned('08100000-0000-0000-0000-0000000000c1')),
  (public.get_project_billing('08100000-0000-0000-0000-0000000000c1') ->> 'earned_value')::numeric,
  'AC-1279 get_project_billing reads the shared earning function');
select is((select count(*)::int from jsonb_array_elements(current_setting('ev.pack')::jsonb -> 'earned') e
            where e ->> 'project_id' = '08100000-0000-0000-0000-0000000000c2'), 0,
  'AC-1279 a project without contract lines has no earned fact and keeps the percent basis');
select is((select (g ->> 'pct_complete')::numeric from jsonb_array_elements(current_setting('ev.pack')::jsonb -> 'progress') g
            where g ->> 'project_id' = '08100000-0000-0000-0000-0000000000c2'), 40::numeric,
  'AC-1279 the percent-basis progress fact is unchanged for a project without lines');
select is((select count(*)::int from jsonb_array_elements(current_setting('ev.pack')::jsonb -> 'earned') e
            where (e ->> 'month')::date = (date_trunc('month', now()) - interval '1 month')::date
              and e ->> 'project_id' = '08100000-0000-0000-0000-0000000000c1'), 1,
  'AC-1279 one earned fact per contract-line project per month');

-- ── as-at path with closed work orders ──
-- d1 closes at an accepted 35 of 40 in month M-2; d2 closes at an accepted 25 of 30 in month M-1. No assessments.
set local request.jwt.claims = '{"sub":"08100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select set_config('ev.d1', public.prepare_work_order_acceptance('08100000-0000-0000-0000-0000000000d1', current_date, true,
  '[{"boq_item_id":"08100000-0000-0000-0000-0000000000e3","quantity":35}]'::jsonb, '08100000-0000-0000-0000-0000000000f1')::text, true)$$, 'AC-1279 PM prepares the final acceptance of 35 for the first work order');
select lives_ok($$select set_config('ev.d2', public.prepare_work_order_acceptance('08100000-0000-0000-0000-0000000000d2', current_date, true,
  '[{"boq_item_id":"08100000-0000-0000-0000-0000000000e3","quantity":25}]'::jsonb, '08100000-0000-0000-0000-0000000000f1')::text, true)$$, 'AC-1279 PM prepares the final acceptance of 25 for the second work order');
set local request.jwt.claims = '{"sub":"08100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('ev.d1')::uuid)$$, 'AC-1279 Finance confirms the first final acceptance');
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('ev.d2')::uuid)$$, 'AC-1279 Finance confirms the second final acceptance');
-- Both confirmations share this transaction's clock; production confirms in separate months. Back-date them.
reset role;
alter table work_order_acceptances disable trigger work_order_acceptances_immutable;
update work_order_acceptances set confirmed_at = date_trunc('month', now()) - interval '2 months' + interval '10 days' where id = current_setting('ev.d1')::uuid;
update work_order_acceptances set confirmed_at = date_trunc('month', now()) - interval '1 month' + interval '10 days' where id = current_setting('ev.d2')::uuid;
alter table work_order_acceptances enable trigger work_order_acceptances_immutable;
set local role authenticated;
set local request.jwt.claims = '{"sub":"08100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('ev.pack3', public.get_management_pack((date_trunc('month', now()) - interval '2 months')::date)::text, true); end $$;

select is((select sum(earned_value) from public.project_line_earned('08100000-0000-0000-0000-0000000000c3', (date_trunc('month', now()) - interval '2 months')::date)), 350::numeric,
  'AC-1279 as at M-2 only the work order closed by then counts, at its final accepted 35 x 10');
select is((select sum(earned_value) from public.project_line_earned('08100000-0000-0000-0000-0000000000c3', (date_trunc('month', now()) - interval '1 month')::date)), 600::numeric,
  'AC-1279 as at M-1 both closed work orders count at their final accepted quantities (35 + 25) x 10');
select is((select sum(earned_value) from public.project_line_earned('08100000-0000-0000-0000-0000000000c3')),
  (select sum(earned_value) from public.project_line_earned('08100000-0000-0000-0000-0000000000c3', date_trunc('month', now())::date)),
  'AC-1279 as at the current month equals the live (no as-at) earned value');
select is((select e ->> 'earned_value' from jsonb_array_elements(current_setting('ev.pack3')::jsonb -> 'earned') e
            where e ->> 'project_id' = '08100000-0000-0000-0000-0000000000c3'
              and (e ->> 'month')::date = (date_trunc('month', now()) - interval '2 months')::date)::numeric, 350::numeric,
  'AC-1279 the pack month before a work order closed excludes it');
select is((select e ->> 'earned_value' from jsonb_array_elements(current_setting('ev.pack3')::jsonb -> 'earned') e
            where e ->> 'project_id' = '08100000-0000-0000-0000-0000000000c3'
              and (e ->> 'month')::date = (date_trunc('month', now()) - interval '1 month')::date)::numeric, 600::numeric,
  'AC-1279 the pack month after it closed includes it');

select * from finish();
rollback;
