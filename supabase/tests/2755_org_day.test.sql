-- 2755: exercise an organisation day behind UTC with a transaction-scoped clock.
-- The real bodies are retained: only their search_path is changed within this rolled-back
-- transaction so the test clock shadows pg_catalog.now(). CURRENT_DATE stays the UTC day.
begin;
create extension if not exists pgtap;
select plan(25);
set local timezone = 'UTC';
create function public.now() returns timestamptz language sql stable as $$
  select (date_trunc('day', transaction_timestamp() at time zone 'UTC') at time zone 'UTC') + interval '1 hour'
$$;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = any(array[
      'native_org_today', 'native_org_date', 'org_today', 'org_date',
      'equipment_org_today', 'qcr_org_today', 'rsv_today', 'site_checkpoint_today',
      'stock_org_today', 'wrp_org_today', 'get_executive_dashboard',
      'guard_crew_loan_archive', 'guard_tpi_transition', 'set_sales_invoice_efaktur',
      'set_procurement_invoice_efaktur', 'get_work_order_performance',
      'work_order_cost_amounts_unrounded'])
  loop execute format('alter function %s set search_path = public, pg_catalog, pg_temp', f.signature); end loop;
end $$;
set local search_path = public, pg_catalog, extensions, pg_temp;
insert into organizations (id, name, default_currency, default_timezone) values
  ('27300000-0000-0000-0000-00000000000a', 'DAY Org', 'IDR', 'Etc/GMT+12');
create temp table day_t as select public.native_org_today('27300000-0000-0000-0000-00000000000a') as d;
grant select on day_t to authenticated;
select is((select d from day_t), current_date - 1, 'fixture: frozen 01:00 UTC is yesterday in UTC-12');

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


select is(public.equipment_org_today('27300000-0000-0000-0000-00000000000a'),(select d from day_t),'equipment helper follows organisation day (regression)');
select is(public.qcr_org_today('27300000-0000-0000-0000-00000000000a'),(select d from day_t),'quantity change helper follows organisation day (regression)');
select is(public.rsv_today('27300000-0000-0000-0000-00000000000a'),(select d from day_t),'reservation helper follows organisation day (regression)');
select is(public.stock_org_today('27300000-0000-0000-0000-00000000000a'),(select d from day_t),'stock helper follows organisation day (regression)');
select is(public.wrp_org_today('27300000-0000-0000-0000-00000000000a'),(select d from day_t),'revenue plan helper follows organisation day (regression)');
select set_config('request.jwt.claims', json_build_object('sub', '27300000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select is(public.site_checkpoint_today(),(select d from day_t),'checkpoint helper follows organisation day (regression)');
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
select is((select (e->>'overdue_tasks')::int from json_array_elements(public.get_executive_dashboard()->'attention_projects') e where e->>'id'='27300000-0000-0000-0000-0000000000d1'), case when (select d from day_t)>current_date then 1 else 0 end, 'dashboard counts overdue tasks using organisation day (regression)');
select lives_ok($$select public.set_sales_invoice_efaktur('27550000-0000-0000-0000-000000000011','010-11',(select d from day_t))$$,'sales invoice accepts organisation today (regression)');
select lives_ok($$select public.set_procurement_invoice_efaktur('27550000-0000-0000-0000-000000000013','010-12',(select d from day_t))$$,'vendor invoice accepts organisation today (regression)');
select throws_ok($$select public.set_sales_invoice_efaktur('27550000-0000-0000-0000-000000000011','010-11',(select d from day_t)+1)$$,'23514','e-Faktur date cannot be in the future','sales invoice refuses organisation tomorrow (regression)');
select throws_ok($$select public.set_procurement_invoice_efaktur('27550000-0000-0000-0000-000000000013','010-12',(select d from day_t)+1)$$,'23514','e-Faktur date cannot be in the future','vendor invoice refuses organisation tomorrow (regression)');
reset role;
select set_config('request.jwt.claims', '', true);

insert into expense_claims (id, org_id, claimant_id, project_id, work_order_id, title, currency, created_at)
values ('27550000-0000-0000-0000-000000000701', '27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-0000000000a1', '27300000-0000-0000-0000-0000000000d1', '27300000-0000-0000-0000-000000000401', 'Claim', 'IDR', now());
select is((select occurred_on from public.work_order_cost_lines where source = 'expense_claim' and record_id = '27550000-0000-0000-0000-000000000701'), (select d from day_t), 'empty claim uses its organisation creation day');
set local session_replication_role = replica;
insert into crew_loans (org_id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
('27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000f01', '27300000-0000-0000-0000-000000000c01', '27300000-0000-0000-0000-000000000c02', (select d from day_t), (select d from day_t));
set local session_replication_role = origin;
create function pg_temp.archive_host() returns boolean language plpgsql as $$ begin update crews set archived_at=now() where id='27300000-0000-0000-0000-000000000c02'; return true; exception when check_violation then return false; end $$;
select is(pg_temp.archive_host(), false, 'loan ending on organisation today prevents archiving its host');


set local session_replication_role = replica;
insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, required_for, status, created_by, invited_on, invited_by) values
('27550000-0000-0000-0000-000000000a01', '27300000-0000-0000-0000-00000000000a', '27300000-0000-0000-0000-000000000401', '27300000-0000-0000-0000-0000000000d1', 'Inspection', (select d from day_t), '{}', 'invited', '27300000-0000-0000-0000-0000000000a1', (select d from day_t)-1, '27300000-0000-0000-0000-0000000000a1');
set local session_replication_role = origin;
select throws_ok($$ update third_party_inspections set status='executed', executed_on=(select d from day_t)+1, executed_by='27300000-0000-0000-0000-0000000000a1' where id='27550000-0000-0000-0000-000000000a01' $$, '23514', 'TPI_EXECUTE_FUTURE: the execution date cannot be in the future', 'inspection refuses tomorrow on organisation calendar');
select set_config('request.jwt.claims', json_build_object('sub', '27300000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into expense_claim_lines (id,claim_id,expense_date,expense_type,description,amount) values
('27550000-0000-0000-0000-000000000801','27550000-0000-0000-0000-000000000701','2026-01-01','Meals','First day',30),
('27550000-0000-0000-0000-000000000802','27550000-0000-0000-0000-000000000701','2026-01-02','Meals','Second day',70);
select is((select amount from expense_claims where id='27550000-0000-0000-0000-000000000701'), 100::numeric, 'line triggers compute the claim total');
select lives_ok($$select transition_expense_claim('27550000-0000-0000-0000-000000000701', 'Submitted')$$, 'claimant submits the dated claim');
select set_config('request.jwt.claims', json_build_object('sub', '27300000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select lives_ok($$select transition_expense_claim('27550000-0000-0000-0000-000000000701', 'Approved')$$, 'project manager approves the dated claim');
reset role;
update organizations set performance_indices_enabled = true where id='27300000-0000-0000-0000-00000000000a';
select set_config('request.jwt.claims', json_build_object('sub', '27300000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((public.get_work_order_performance('27300000-0000-0000-0000-0000000000d1')->>'as_of')::date, (select d from day_t), 'regression: performance defaults to organisation today');
select is((select occurred_on from public.work_order_cost_lines where record_id='27550000-0000-0000-0000-000000000701' and source='expense_claim'), '2026-01-01'::date, 'claim list keeps one row and shows first expense day');
select is((select occurred_on from public.work_order_cost_amounts('27300000-0000-0000-0000-0000000000d1') where record_id='27550000-0000-0000-0000-000000000701' and source='expense_claim'), '2026-01-01'::date, 'claim amount carries the same first expense day');
select is((select count(*) from public.work_order_cost_lines where record_id='27550000-0000-0000-0000-000000000701' and source='expense_claim'), 1::bigint, 'claim list preserves one row per claim');
select is((select sum(amount::numeric) from public.work_order_cost_amounts('27300000-0000-0000-0000-0000000000d1') where source='expense_claim' and record_id='27550000-0000-0000-0000-000000000701'),100::numeric, 'claim total remains 100');
select is(((public.get_work_order_performance('27300000-0000-0000-0000-0000000000d1', '2026-01-01')->'rows'->0->>'ac')::numeric), 30::numeric, 'first day includes only first claim line');
select is(((public.get_work_order_performance('27300000-0000-0000-0000-0000000000d1', '2026-01-02')->'rows'->0->>'ac')::numeric), 100::numeric, 'second day includes both claim lines');
reset role;
select * from finish(); rollback;
