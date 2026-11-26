-- 2730_org_day_in_guards.test.sql — #2914. Migration under test: 2730_org_day_in_crew_and_tpi_guards.sql.
-- The clock cannot be faked, so the organisation's timezone is chosen from NOW: UTC+14 when that is already
-- the next UTC day, else UTC-12 (then the previous one). Either way the organisation's day is NOT the UTC day,
-- and each case below is wrong under `current_date` on whichever side it lands.
begin;
create extension if not exists pgtap;
select plan(21);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27300000-0000-0000-0000-00000000000a', 'DAY Org', 'IDR',
   case when (now() at time zone 'Pacific/Kiritimati')::date <> (now() at time zone 'UTC')::date then 'Pacific/Kiritimati' else 'Etc/GMT+12' end);
create temp table day_t as select public.native_org_today('27300000-0000-0000-0000-00000000000a') as d;
grant select on day_t to authenticated;
select isnt((select d from day_t), (now() at time zone 'UTC')::date, 'fixture: the organisation day differs from the UTC day');

insert into auth.users (id, email) values
  ('27300000-0000-0000-0000-0000000000a1', 'day-admin@example.com'), ('27300000-0000-0000-0000-0000000000a3', 'day-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27300000-0000-0000-0000-0000000000a1', '27300000-0000-0000-0000-00000000000a', 'DAY Admin', 'day-admin@example.com', 'Admin', 'active'),
  ('27300000-0000-0000-0000-0000000000a3', '27300000-0000-0000-0000-00000000000a', 'DAY PM', 'day-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('27300000-0000-0000-0000-0000000000d1', '27300000-0000-0000-0000-00000000000a', 'DAY Site', 'Ongoing Project', '27300000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27300000-0000-0000-0000-000000000401', '27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-0000000000d1', 'DAY WO', 'Issued', 1000, 'exclusive', 0);
insert into work_order_sections (id, org_id, project_id, work_order_id, code, name) values
  ('27300000-0000-0000-0000-000000000b01', '27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-0000000000d1', '27300000-0000-0000-0000-000000000401', 'D1', 'Day section');
insert into crews (id, org_id, code, name) values
  ('27300000-0000-0000-0000-000000000c01', '27300000-0000-0000-0000-00000000000a', 'DY-A', 'Ends today'),
  ('27300000-0000-0000-0000-000000000c02', '27300000-0000-0000-0000-00000000000a', 'DY-B', 'Ended yesterday');
insert into people (id, org_id, kind, name, profile_id) values
  ('27300000-0000-0000-0000-000000000f01', '27300000-0000-0000-0000-00000000000a', 'vendor', 'Day Worker A', null),
  ('27300000-0000-0000-0000-000000000f02', '27300000-0000-0000-0000-00000000000a', 'vendor', 'Day Worker B', null);
-- A crew whose last member ends the organisation's TODAY is in use; one that ended yesterday is not.
insert into crew_members (org_id, crew_id, worker_id, valid_from, valid_to) values
  ('27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000c01', '27300000-0000-0000-0000-000000000f01', (select d from day_t) - 30, (select d from day_t)),
  ('27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000c02', '27300000-0000-0000-0000-000000000f02', (select d from day_t) - 30, (select d from day_t) - 1);
insert into work_order_crews (org_id, work_order_id, crew_id, section_id, valid_from, valid_to) values
  ('27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000401', '27300000-0000-0000-0000-000000000c01', '27300000-0000-0000-0000-000000000b01', (select d from day_t) - 30, (select d from day_t)),
  ('27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000401', '27300000-0000-0000-0000-000000000c02', '27300000-0000-0000-0000-000000000b01', (select d from day_t) - 30, (select d from day_t) - 1);


select is(public.equipment_org_today('27300000-0000-0000-0000-00000000000a'),(select d from day_t),'equipment helper follows organisation day');
select is(public.qcr_org_today('27300000-0000-0000-0000-00000000000a'),(select d from day_t),'quantity change helper follows organisation day');
select is(public.rsv_today('27300000-0000-0000-0000-00000000000a'),(select d from day_t),'reservation helper follows organisation day');
select is(public.stock_org_today('27300000-0000-0000-0000-00000000000a'),(select d from day_t),'stock helper follows organisation day');
select is(public.wrp_org_today('27300000-0000-0000-0000-00000000000a'),(select d from day_t),'revenue plan helper follows organisation day');
select set_config('request.jwt.claims', json_build_object('sub', '27300000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select is(public.site_checkpoint_today(),(select d from day_t),'checkpoint helper follows organisation day');
select set_config('request.jwt.claims', '', true);

-- The dashboard and both invoice writes use the same day, even across UTC midnight.
insert into tasks (id, org_id, project_id, name, status, end_date) values
('27550000-0000-0000-0000-000000000001','27300000-0000-0000-0000-00000000000a','27300000-0000-0000-0000-0000000000d1','Boundary task','To Do',least((select d from day_t), current_date));
set local session_replication_role = replica;
insert into sales_invoices (id, org_id, si_number, invoice_date, amount, status, tax_treatment, tax_rate, tax_amount, currency) values
('27550000-0000-0000-0000-000000000011','27300000-0000-0000-0000-00000000000a','SALE-DAY',(select d from day_t),100,'Draft','exclusive',11,0,'IDR');
insert into procurements (id,org_id,title,status,currency) values ('27550000-0000-0000-0000-000000000012','27300000-0000-0000-0000-00000000000a','Purchase','Received','IDR');
insert into procurement_invoices (id,org_id,procurement_id,vi_number,invoice_date,status,amount,tax_treatment,tax_amount,currency) values
('27550000-0000-0000-0000-000000000013','27300000-0000-0000-0000-00000000000a','27550000-0000-0000-0000-000000000012','VI-DAY',(select d from day_t),'Received',100,'exclusive',0,'IDR');
set local session_replication_role = origin;
select set_config('request.jwt.claims', json_build_object('sub', '27300000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select (e->>'overdue_tasks')::int from json_array_elements(public.get_executive_dashboard()->'attention_projects') e where e->>'id'='27300000-0000-0000-0000-0000000000d1'), case when (select d from day_t)>current_date then 1 else 0 end, 'dashboard counts overdue tasks using organisation day');
select lives_ok($$select public.set_sales_invoice_efaktur('27550000-0000-0000-0000-000000000011','010-11',(select d from day_t))$$,'sales invoice accepts organisation today');
select lives_ok($$select public.set_procurement_invoice_efaktur('27550000-0000-0000-0000-000000000013','010-12',(select d from day_t))$$,'vendor invoice accepts organisation today');
select throws_ok($$select public.set_sales_invoice_efaktur('27550000-0000-0000-0000-000000000011','010-11',(select d from day_t)+1)$$,'23514','e-Faktur date cannot be in the future','sales invoice refuses organisation tomorrow');
select throws_ok($$select public.set_procurement_invoice_efaktur('27550000-0000-0000-0000-000000000013','010-12',(select d from day_t)+1)$$,'23514','e-Faktur date cannot be in the future','vendor invoice refuses organisation tomorrow');
reset role;
select set_config('request.jwt.claims', '', true);

insert into expense_claims (id, org_id, claimant_id, project_id, work_order_id, title, currency, created_at)
values ('27550000-0000-0000-0000-000000000701', '27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-0000000000a1', '27300000-0000-0000-0000-0000000000d1', '27300000-0000-0000-0000-000000000401', 'Claim', 'IDR', now());
select is((select occurred_on from public.work_order_cost_lines where source = 'expense_claim' and record_id = '27550000-0000-0000-0000-000000000701'), (select d from day_t), 'empty claim uses its organisation creation day');
set local session_replication_role = replica;
insert into crew_loans (org_id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
('27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000f01', '27300000-0000-0000-0000-000000000c01', '27300000-0000-0000-0000-000000000c02', least((select d from day_t), current_date), least((select d from day_t), current_date));
set local session_replication_role = origin;
create function pg_temp.archive_host() returns boolean language plpgsql as $$ begin update crews set archived_at=now() where id='27300000-0000-0000-0000-000000000c02'; return true; exception when check_violation then return false; end $$;
select is(pg_temp.archive_host(), (select d from day_t) > current_date, 'archive depends on the organisation day of the loan');


set local session_replication_role = replica;
insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, required_for, status, created_by, invited_on, invited_by) values
('27550000-0000-0000-0000-000000000a01', '27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000401', '27300000-0000-0000-0000-0000000000d1', 'Inspection', (select d from day_t), '{}', 'invited', '27300000-0000-0000-0000-0000000000a1', (select d from day_t)-1, '27300000-0000-0000-0000-0000000000a1');
set local session_replication_role = origin;
set local timezone = 'Pacific/Kiritimati';
select throws_ok($$ update third_party_inspections set status='executed', executed_on=(select d from day_t)+1, executed_by='27300000-0000-0000-0000-0000000000a1' where id='27550000-0000-0000-0000-000000000a01' $$, '23514', 'TPI_EXECUTE_FUTURE: the execution date cannot be in the future', 'inspection refuses tomorrow on organisation calendar');
set local timezone = 'UTC';
set local session_replication_role = replica;
update expense_claims set status='Approved', amount=100 where id='27550000-0000-0000-0000-000000000701';
insert into expense_claim_lines (id,org_id,claim_id,expense_date,expense_type,description,amount) values
('27550000-0000-0000-0000-000000000801','27300000-0000-0000-0000-00000000000a','27550000-0000-0000-0000-000000000701','2026-01-01','Meals','First day',30),
('27550000-0000-0000-0000-000000000802','27300000-0000-0000-0000-00000000000a','27550000-0000-0000-0000-000000000701','2026-01-02','Meals','Second day',70);
set local session_replication_role = origin;
update organizations set performance_indices_enabled = true where id='27300000-0000-0000-0000-00000000000a';
select set_config('request.jwt.claims', json_build_object('sub', '27300000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select occurred_on from public.work_order_cost_lines where record_id='27550000-0000-0000-0000-000000000701' and source='expense_claim'), '2026-01-01'::date, 'claim list keeps one row and shows first expense day');
select is((select occurred_on from public.work_order_cost_amounts('27300000-0000-0000-0000-0000000000d1') where record_id='27550000-0000-0000-0000-000000000701' and source='expense_claim'), '2026-01-01'::date, 'claim amount carries the same first expense day');
select is((select count(*) from public.work_order_cost_lines where record_id='27550000-0000-0000-0000-000000000701' and source='expense_claim'), 1::bigint, 'claim list preserves one row per claim');
select is((select sum(amount::numeric) from public.work_order_cost_amounts('27300000-0000-0000-0000-0000000000d1') where source='expense_claim' and record_id='27550000-0000-0000-0000-000000000701'),100::numeric, 'claim total remains 100');
select is(((public.get_work_order_performance('27300000-0000-0000-0000-0000000000d1', '2026-01-01')->'rows'->0->>'ac')::numeric), 30::numeric, 'first day includes only first claim line');
select is(((public.get_work_order_performance('27300000-0000-0000-0000-0000000000d1', '2026-01-02')->'rows'->0->>'ac')::numeric), 100::numeric, 'second day includes both claim lines');
reset role;
select * from finish(); rollback;
