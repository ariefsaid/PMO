begin;
create extension if not exists pgtap;
select plan(9);
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('15220000-0000-0000-0000-0000000000a1', 'DSR Org A', 'USD', 'UTC', true),
  ('15220000-0000-0000-0000-0000000000a2', 'DSR Org B', 'USD', 'UTC', true);
insert into auth.users (id, email) values
  ('15220000-0000-0000-0000-0000000000b1', 'dsr-eng@example.com'),
  ('15220000-0000-0000-0000-0000000000b2', 'dsr-pm@example.com'),
  ('15220000-0000-0000-0000-0000000000b3', 'dsr-fin@example.com'),
  ('15220000-0000-0000-0000-0000000000b4', 'dsr-exec@example.com'),
  ('15220000-0000-0000-0000-0000000000b5', 'dsr-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15220000-0000-0000-0000-0000000000b1', '15220000-0000-0000-0000-0000000000a1', 'DSR Engineer', 'dsr-eng@example.com', 'Engineer', 'active'),
  ('15220000-0000-0000-0000-0000000000b2', '15220000-0000-0000-0000-0000000000a1', 'DSR PM', 'dsr-pm@example.com', 'Project Manager', 'active'),
  ('15220000-0000-0000-0000-0000000000b3', '15220000-0000-0000-0000-0000000000a1', 'DSR Finance', 'dsr-fin@example.com', 'Finance', 'active'),
  ('15220000-0000-0000-0000-0000000000b4', '15220000-0000-0000-0000-0000000000a1', 'DSR Exec', 'dsr-exec@example.com', 'Executive', 'active'),
  ('15220000-0000-0000-0000-0000000000b5', '15220000-0000-0000-0000-0000000000a2', 'DSR Foreign', 'dsr-foreign@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('15220000-0000-0000-0000-0000000000c1', '15220000-0000-0000-0000-0000000000a1', 'DSR Contract', 'Ongoing Project', 'USD', '15220000-0000-0000-0000-0000000000b2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('15220000-0000-0000-0000-0000000000e1', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'WO one', 'Issued', 10000, 'exclusive', 0),
  ('15220000-0000-0000-0000-0000000000e2', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'WO two', 'Issued', 10000, 'exclusive', 0);
insert into rate_catalogue_variants (id, org_id, project_id, name, is_default) values
  ('15220000-0000-0000-0000-0000000000d1', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'Remote', true);
insert into rate_catalogue_items (id, org_id, project_id, item_code, description, unit) values
  ('15220000-0000-0000-0000-0000000000d2', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'W-1', 'Weld', 'm');
insert into rate_catalogue_rates (org_id, item_id, variant_id, rate, effective_from) values
  ('15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000d2', '15220000-0000-0000-0000-0000000000d1', 5, '2026-01-01');
insert into rate_catalogue_stage_weights (org_id, item_id, effective_from, position, stage, weight_pct) values
  ('15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000d2', '2026-01-01', 1, 'Fab', 20),
  ('15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000d2', '2026-01-01', 2, 'Weld', 80);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, catalogue_item_id, catalogue_variant_id, catalogue_priced_as_of) values
  ('15220000-0000-0000-0000-0000000000f1', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'L1', 'Weld line', 'm', 100, 5,
   '15220000-0000-0000-0000-0000000000d2', '15220000-0000-0000-0000-0000000000d1', '2026-01-01');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15220000-0000-0000-0000-0000000000f2', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'L2', 'Paint line', 'm2', 100, 3),
  ('15220000-0000-0000-0000-0000000000f3', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'L3', 'Other WO line', 'm', 100, 1),
  ('15220000-0000-0000-0000-0000000000f4', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'L4', 'Unpriced line', 'ea', 100, 0);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('15220000-0000-0000-0000-000000000011', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000e1', '15220000-0000-0000-0000-0000000000f1', 100),
  ('15220000-0000-0000-0000-000000000012', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000e1', '15220000-0000-0000-0000-0000000000f2', 100),
  ('15220000-0000-0000-0000-000000000013', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000e2', '15220000-0000-0000-0000-0000000000f3', 100),
  ('15220000-0000-0000-0000-000000000014', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000e1', '15220000-0000-0000-0000-0000000000f4', 100);
insert into stock_units (id, org_id, code, name) values
  ('15220000-0000-0000-0000-000000000021', '15220000-0000-0000-0000-0000000000a1', 'kg', 'Kilogram');
insert into stock_items (id, org_id, code, name, unit_id) values
  ('15220000-0000-0000-0000-000000000022', '15220000-0000-0000-0000-0000000000a1', 'ROD', 'Welding rod', '15220000-0000-0000-0000-000000000021');


update profiles set built_in_role = 'quantity_surveyor' where id = '15220000-0000-0000-0000-0000000000b1';
insert into daily_site_reports (id,org_id,project_id,work_order_id,work_date,author_id,status,validated_by,validated_at)
values ('25700000-0000-0000-0000-000000000001','15220000-0000-0000-0000-0000000000a1','15220000-0000-0000-0000-0000000000c1','15220000-0000-0000-0000-0000000000e1','2026-11-20','15220000-0000-0000-0000-0000000000b1','validated','15220000-0000-0000-0000-0000000000b2',now());
insert into dsr_progress_lines (org_id,report_id,position,work_order_line_id,quantity,unit,frozen_rate,frozen_rate_source,frozen_amount,frozen_at)
values ('15220000-0000-0000-0000-0000000000a1','25700000-0000-0000-0000-000000000001',1,'15220000-0000-0000-0000-000000000011',10,'m',5,'contract',50,now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select * from dsr_report_revenue('25700000-0000-0000-0000-000000000001')$$,'AC-QSR-002 QS reads validated report');
select is((select sum(amount) from dsr_report_revenue('25700000-0000-0000-0000-000000000001')),50::numeric,'AC-QSR-002 frozen quantity times rate');
select is(dsr_may_see_revenue('15220000-0000-0000-0000-0000000000c1'),false,'AC-QSR-003 general revenue stays refused');
select throws_ok($$select work_order_validated_revenue('15220000-0000-0000-0000-0000000000e1')$$,'42501',null,'AC-QSR-003 WO total stays refused');
select throws_ok($$update organizations set qs_report_revenue_enabled=false$$,'42501',null,'AC-QSR-004 QS cannot change setting');
reset role;
update daily_site_reports set status='submitted',validated_by=null,validated_at=null where id='25700000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select * from dsr_report_revenue('25700000-0000-0000-0000-000000000001')$$,'42501',null,'AC-QSR-003 unvalidated report refused');
reset role;
update daily_site_reports set status='validated',validated_by='15220000-0000-0000-0000-0000000000b2',validated_at=now() where id='25700000-0000-0000-0000-000000000001';
update organizations set qs_report_revenue_enabled=false where id='15220000-0000-0000-0000-0000000000a1';
set local role authenticated;
select throws_ok($$select * from dsr_report_revenue('25700000-0000-0000-0000-000000000001')$$,'42501',null,'AC-QSR-004 disabled read refused');
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($$select * from dsr_report_revenue('25700000-0000-0000-0000-000000000001')$$,'P0002',null,'AC-QSR-003 foreign report absent');
reset role;
select ok(has_function_privilege('authenticated','public.dsr_report_revenue(uuid)','EXECUTE'),'AC-QSR-002 authenticated execute grant');
select * from finish();
rollback;
