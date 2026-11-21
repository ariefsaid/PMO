-- 1115_work_order_crew_hours_approved_only.test.sql — #2626 (docs/specs/work-order-plan-vs-actual.spec.md FR-WPVA-012).
-- Migration under test: 1115_work_order_crew_hours_approved_only.sql.
-- AC-WPVA-017 a work order's crew hours are hours of Approved timesheet weeks only: a Rejected, Draft or Submitted
-- week's line is still in the read (marked not-posted, no money) and is never counted as actual crew hours.
begin;
create extension if not exists pgtap;
select plan(7);

insert into organizations (id, name, default_currency) values ('26260000-0000-0000-0000-00000000000a', 'Crew Hours Org', 'IDR');
insert into auth.users (id, email) values
  ('26260000-0000-0000-0000-0000000000a1', 'crew-fin@example.com'),
  ('26260000-0000-0000-0000-0000000000a2', 'crew-one@example.com'),
  ('26260000-0000-0000-0000-0000000000a3', 'crew-two@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26260000-0000-0000-0000-0000000000a1', '26260000-0000-0000-0000-00000000000a', 'Crew Fin', 'crew-fin@example.com', 'Finance', 'active'),
  ('26260000-0000-0000-0000-0000000000a2', '26260000-0000-0000-0000-00000000000a', 'Crew One', 'crew-one@example.com', 'Engineer', 'active'),
  ('26260000-0000-0000-0000-0000000000a3', '26260000-0000-0000-0000-00000000000a', 'Crew Two', 'crew-two@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('26260000-0000-0000-0000-0000000000d1', '26260000-0000-0000-0000-00000000000a', 'Crew Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('26260000-0000-0000-0000-000000000401', '26260000-0000-0000-0000-00000000000a', '26260000-0000-0000-0000-0000000000d1', 'WO-CREW', 'Crew WO', 'Issued', 10000, 'exclusive', 0, 'IDR');

-- Source rows with triggers off: this file proves the read, not the timesheet write path.
set local session_replication_role = replica;
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('26260000-0000-0000-0000-000000000701', '26260000-0000-0000-0000-00000000000a', '26260000-0000-0000-0000-0000000000a2', '2026-11-02', 'Approved'),
  ('26260000-0000-0000-0000-000000000702', '26260000-0000-0000-0000-00000000000a', '26260000-0000-0000-0000-0000000000a3', '2026-11-02', 'Rejected'),
  ('26260000-0000-0000-0000-000000000703', '26260000-0000-0000-0000-00000000000a', '26260000-0000-0000-0000-0000000000a2', '2026-11-09', 'Draft'),
  ('26260000-0000-0000-0000-000000000704', '26260000-0000-0000-0000-00000000000a', '26260000-0000-0000-0000-0000000000a3', '2026-11-09', 'Submitted');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, work_order_id, entry_date, hours) values
  ('26260000-0000-0000-0000-000000000711', '26260000-0000-0000-0000-00000000000a', '26260000-0000-0000-0000-000000000701', '26260000-0000-0000-0000-0000000000d1', '26260000-0000-0000-0000-000000000401', '2026-11-02', 8),
  ('26260000-0000-0000-0000-000000000712', '26260000-0000-0000-0000-00000000000a', '26260000-0000-0000-0000-000000000702', '26260000-0000-0000-0000-0000000000d1', '26260000-0000-0000-0000-000000000401', '2026-11-02', 5),
  ('26260000-0000-0000-0000-000000000713', '26260000-0000-0000-0000-00000000000a', '26260000-0000-0000-0000-000000000703', '26260000-0000-0000-0000-0000000000d1', '26260000-0000-0000-0000-000000000401', '2026-11-09', 3),
  ('26260000-0000-0000-0000-000000000714', '26260000-0000-0000-0000-00000000000a', '26260000-0000-0000-0000-000000000704', '26260000-0000-0000-0000-0000000000d1', '26260000-0000-0000-0000-000000000401', '2026-11-09', 2);
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('26260000-0000-0000-0000-0000000000a1');
create temp table crew_rows as
  select * from public.work_order_cost_amounts('26260000-0000-0000-0000-0000000000d1') where source = 'timesheet_entry';

select is((select count(*)::int from crew_rows), 4,
  'AC-WPVA-017 every timesheet line of the work order is in the read, whatever its week''s status');
select is((select reason from crew_rows where record_id = '26260000-0000-0000-0000-000000000711'), 'no-rate',
  'AC-WPVA-017 an Approved week''s hours are actual crew hours (hours only, no rate)');
select is((select reason from crew_rows where record_id = '26260000-0000-0000-0000-000000000712'), 'not-posted',
  'AC-WPVA-017 a Rejected week''s hours are not actual crew hours');
select is((select array_agg(reason order by record_id) from crew_rows
            where record_id in ('26260000-0000-0000-0000-000000000713', '26260000-0000-0000-0000-000000000714')),
  array['not-posted', 'not-posted']::text[],
  'AC-WPVA-017 a Draft or Submitted week''s hours are pending, not actual');
select is((select sum(quantity) from crew_rows where reason = 'no-rate' and work_order_id = '26260000-0000-0000-0000-000000000401'), 8::numeric,
  'AC-WPVA-017 actual crew hours on the work order are the Approved 8, not the 18 entered');
select is((select count(distinct person_id)::int from crew_rows where reason = 'no-rate' and quantity > 0), 1,
  'AC-WPVA-017 crew size counts only people with approved hours');
select ok((select bool_and(amount is null) from crew_rows), 'timesheet lines carry no money, approved or not');

select * from finish();
rollback;
