begin;
create extension if not exists pgtap;
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
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('27004000-0000-0000-0000-00000000000a', 'EQP Org',       'IDR', 'Asia/Jakarta', true),
  ('27004000-0000-0000-0000-00000000000b', 'EQP Other Org', 'IDR', 'Asia/Jakarta', true);
insert into auth.users (id, email) values
  ('27004000-0000-0000-0000-0000000000a1', 'eqp-admin@example.com'),
  ('27004000-0000-0000-0000-0000000000a2', 'eqp-pm@example.com'),
  ('27004000-0000-0000-0000-0000000000a3', 'eqp-eng-on@example.com'),
  ('27004000-0000-0000-0000-0000000000a4', 'eqp-fin@example.com'),
  ('27004000-0000-0000-0000-0000000000a5', 'eqp-eng-off@example.com'),
  ('27004000-0000-0000-0000-0000000000b1', 'eqp-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27004000-0000-0000-0000-0000000000a1', '27004000-0000-0000-0000-00000000000a', 'EQP Admin',   'eqp-admin@example.com',   'Admin', 'active'),
  ('27004000-0000-0000-0000-0000000000a2', '27004000-0000-0000-0000-00000000000a', 'EQP PM',      'eqp-pm@example.com',      'Project Manager', 'active'),
  ('27004000-0000-0000-0000-0000000000a3', '27004000-0000-0000-0000-00000000000a', 'EQP Eng On',  'eqp-eng-on@example.com',  'Engineer', 'active'),
  ('27004000-0000-0000-0000-0000000000a4', '27004000-0000-0000-0000-00000000000a', 'EQP Finance', 'eqp-fin@example.com',     'Finance', 'active'),
  ('27004000-0000-0000-0000-0000000000a5', '27004000-0000-0000-0000-00000000000a', 'EQP Eng Off', 'eqp-eng-off@example.com', 'Engineer', 'active'),
  ('27004000-0000-0000-0000-0000000000b1', '27004000-0000-0000-0000-00000000000b', 'EQP XAdmin',  'eqp-xadmin@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status) values
  ('27004000-0000-0000-0000-0000000000c1', '27004000-0000-0000-0000-00000000000a', 'EQP Project',       'Ongoing Project'),
  ('27004000-0000-0000-0000-0000000000c2', '27004000-0000-0000-0000-00000000000a', 'EQP Other Project', 'Ongoing Project'),
  ('27004000-0000-0000-0000-0000000000c3', '27004000-0000-0000-0000-00000000000b', 'EQP Foreign',       'Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('27004000-0000-0000-0000-0000000000e1', '27004000-0000-0000-0000-00000000000a', 'EQP Vendor',         'Vendor'),
  ('27004000-0000-0000-0000-0000000000e2', '27004000-0000-0000-0000-00000000000b', 'EQP Foreign Vendor', 'Vendor');
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('27004000-0000-0000-0000-0000000000d1', '27004000-0000-0000-0000-00000000000a', '27004000-0000-0000-0000-0000000000c1', 'EQP WO on project', 10, 'exclusive', 0),
  ('27004000-0000-0000-0000-0000000000d2', '27004000-0000-0000-0000-00000000000a', '27004000-0000-0000-0000-0000000000c2', 'EQP WO elsewhere',  10, 'exclusive', 0);
-- the first type is a decoy: named like a rental, but not flagged; the flag, not the name, marks the real one
insert into org_purchase_type_settings (org_id, enabled) values ('27004000-0000-0000-0000-00000000000a', true) on conflict (org_id) do update set enabled = true;
-- the organisation trigger already seeded starter purchase types; this file brings its own
delete from purchase_types where org_id = '27004000-0000-0000-0000-00000000000a';
insert into purchase_types (id, org_id, name, is_rental, position) values
  ('27004000-0000-0000-0000-0000000000f1', '27004000-0000-0000-0000-00000000000a', 'Rental', false, 1),
  ('27004000-0000-0000-0000-0000000000f2', '27004000-0000-0000-0000-00000000000a', 'Hire',   true,  2);
-- an Engineer who raised a purchase on the project is "on" it
insert into procurements (id, org_id, title, status, project_id, requested_by_id) values
  ('27004000-0000-0000-0000-000000000a01', '27004000-0000-0000-0000-00000000000a', 'EQP engineer purchase', 'Draft', '27004000-0000-0000-0000-0000000000c1', '27004000-0000-0000-0000-0000000000a3');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- one plan line as the RPC takes it; p_extra overrides any key
create or replace function pg_temp._line(p_id uuid, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'description', 'Excavator', 'quantity', 2, 'rate', 1000,
    'vendor_id', '27004000-0000-0000-0000-0000000000e1', 'date_from', '2026-03-05', 'date_to', '2026-03-20') || p_extra
$$;
grant execute on function pg_temp._line(uuid, jsonb) to authenticated;

insert into org_equipment_plan_settings (org_id, enabled) values ('27004000-0000-0000-0000-00000000000a', true);
-- run as the table owner: a Draft plan with two lines, then Submitted (the one legal move)
create or replace function pg_temp._mkplan(p_plan uuid, p_project uuid, p_month date, p_author uuid) returns void language plpgsql as $$
begin
  insert into equipment_plans (id, org_id, project_id, plan_month, created_by) values (p_plan, '27004000-0000-0000-0000-00000000000a', p_project, p_month, p_author);
  insert into equipment_plan_lines (id, org_id, plan_id, work_order_id, description, quantity, rate, vendor_id, date_from, date_to) values
    (md5(p_plan::text || '1')::uuid, '27004000-0000-0000-0000-00000000000a', p_plan, '27004000-0000-0000-0000-0000000000d1', 'Excavator', 2, 1000, '27004000-0000-0000-0000-0000000000e1', p_month + 4, p_month + 19),
    (md5(p_plan::text || '2')::uuid, '27004000-0000-0000-0000-00000000000a', p_plan, null, 'Generator', 1, 500, '27004000-0000-0000-0000-0000000000e1', p_month + 9, p_month + 27);
  update equipment_plans set status = 'Submitted', submitted_at = now() where id = p_plan;
end $$;


update profiles set built_in_role='buyer' where id='27004000-0000-0000-0000-0000000000a3';
insert into purchase_order_settings(org_id,order_job_roles) values('27004000-0000-0000-0000-00000000000a',array['buyer']) on conflict(org_id) do update set order_job_roles=excluded.order_job_roles;
select pg_temp._mkplan('27004000-0000-0000-0000-000000000b01','27004000-0000-0000-0000-0000000000c1','2026-01-01','27004000-0000-0000-0000-0000000000a2');
set local role authenticated;
select pg_temp._as('27004000-0000-0000-0000-0000000000a1');
select approve_equipment_plan('27004000-0000-0000-0000-000000000b01');
reset role;
-- An ordinary draft of another requester, not a plan purchase.
insert into procurements(id,org_id,title,status,project_id,requested_by_id) values
('25710000-0000-0000-0000-000000000001','27004000-0000-0000-0000-00000000000a','Ordinary draft','Draft','27004000-0000-0000-0000-0000000000c1','27004000-0000-0000-0000-0000000000a2');
create function pg_temp.purchase_id() returns uuid language sql as $$select procurement_id from equipment_plan_lines where plan_id='27004000-0000-0000-0000-000000000b01' order by id limit 1$$;
grant execute on function pg_temp.purchase_id() to authenticated;
-- Cache the id before switching to a Buyer whose plan visibility remains restricted.
create temp table target as select pg_temp.purchase_id() id;
grant select on target to authenticated;


create function pg_temp.patch(fn text, old text, replacement text) returns void language plpgsql as $b$
declare src text; begin
 src:=pg_get_functiondef(fn::regprocedure);
 if position(old in src)=0 then raise exception 'mutation target absent: %',fn; end if;
 execute replace(src,old,replacement);
end $b$;
create function pg_temp.force_bool(fn text, value boolean) returns void language plpgsql as $b$
declare src text; lang text; body text; begin
 select l.lanname into lang from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=fn::regprocedure;
 src:=split_part(pg_get_functiondef(fn::regprocedure),'AS $function$',1);
 body:=case when lang='sql' then 'select ' else 'begin return ' end || value::text || case when lang='sql' then '' else '; end' end;
 execute src || 'AS $function$' || body || '$function$;';
end $b$;
create function pg_temp.capture(command text) returns text language plpgsql as $b$
declare v text; begin if command ~* '^truncate' then execute command; else execute command into v; end if; return 'ok:'||coalesce(v,''); exception when others then return 'error:'||sqlstate; end $b$;
create function pg_temp.run_boundary(k text) returns text language plpgsql as $b$
declare c record; actual text; begin
 select * into strict c from boundary_cases where id=k;
 begin
  perform set_config('request.jwt.claims','{}',true);
  execute c.setup;
  if c.actor='anon' then
   perform set_config('request.jwt.claims','{"role":"anon"}',true);
   execute 'set local role anon';
  else
   perform set_config('request.jwt.claims',jsonb_build_object('sub',c.actor,'role','authenticated','app_metadata',jsonb_build_object('role','Admin','built_in_role',current_setting('boundary.view_as',true)),'view_as',current_setting('boundary.view_as',true))::text,true);
   execute 'set local role authenticated';
  end if;
  actual:=pg_temp.capture(c.operation);
  raise exception using errcode='ZX001',message=actual;
 exception when sqlstate 'ZX001' then return sqlerrm; end;
end $b$;

create temp table boundary_cases(id text primary key,actor text,setup text,operation text,expected text);
grant select on boundary_cases to authenticated,anon;
insert into boundary_cases values
('qs_role_planner','15220000-0000-0000-0000-0000000000b1','update profiles set built_in_role=''planner'' where id=''15220000-0000-0000-0000-0000000000b1'';','select sum(amount)::text from dsr_report_revenue(''25700000-0000-0000-0000-000000000001'')','error:42501'),
('qs_role_none','15220000-0000-0000-0000-0000000000b1','update profiles set built_in_role=null where id=''15220000-0000-0000-0000-0000000000b1'';','select sum(amount)::text from dsr_report_revenue(''25700000-0000-0000-0000-000000000001'')','error:42501'),
('qs_role_engineer','15220000-0000-0000-0000-0000000000b1','update profiles set built_in_role=''engineer'' where id=''15220000-0000-0000-0000-0000000000b1'';','select sum(amount)::text from dsr_report_revenue(''25700000-0000-0000-0000-000000000001'')','error:42501'),
('qs_validated','15220000-0000-0000-0000-0000000000b1','update daily_site_reports set status=''submitted'',validated_by=null,validated_at=null where id=''25700000-0000-0000-0000-000000000001'';','select sum(amount)::text from dsr_report_revenue(''25700000-0000-0000-0000-000000000001'')','error:42501'),
('qs_org','15220000-0000-0000-0000-0000000000b5','select pg_temp.force_bool(''public.actor_holds_job_role(text)'',true);select pg_temp.force_bool(''public.dsr_may_see_revenue(uuid)'',false);','select sum(amount)::text from dsr_report_revenue(''25700000-0000-0000-0000-000000000001'')','error:P0002'),
('qs_active','15220000-0000-0000-0000-0000000000b1','update profiles set status=''disabled'' where id=''15220000-0000-0000-0000-0000000000b1'';select pg_temp.force_bool(''public.actor_holds_job_role(text)'',true);','select sum(amount)::text from dsr_report_revenue(''25700000-0000-0000-0000-000000000001'')','error:42501'),
('qs_field','15220000-0000-0000-0000-0000000000b1','update profiles set built_in_role=''field_user'' where id=''15220000-0000-0000-0000-0000000000b1'';select pg_temp.force_bool(''public.actor_holds_job_role(text)'',true);','select sum(amount)::text from dsr_report_revenue(''25700000-0000-0000-0000-000000000001'')','error:42501'),
('qs_switch','15220000-0000-0000-0000-0000000000b1','update organizations set qs_report_revenue_enabled=false where id=''15220000-0000-0000-0000-0000000000a1'';','select sum(amount)::text from dsr_report_revenue(''25700000-0000-0000-0000-000000000001'')','error:42501'),
('qs_switch_admin','15220000-0000-0000-0000-0000000000b1','','with changed as (update organizations set qs_report_revenue_enabled=false where id=''15220000-0000-0000-0000-0000000000a1'' returning id) select count(*)::text from changed','ok:0'),
('qs_switch_foreign','15220000-0000-0000-0000-0000000000b3','update profiles set role=''Admin'' where id=''15220000-0000-0000-0000-0000000000b3'';create policy boundary_read on organizations for select to authenticated using(true);','with changed as (update organizations set qs_report_revenue_enabled=false where id=''15220000-0000-0000-0000-0000000000a2'' returning id) select count(*)::text from changed','ok:0'),
('qs_switch_admin_inactive','15220000-0000-0000-0000-0000000000b3','update profiles set status=''disabled'',role=''Admin'' where id=''15220000-0000-0000-0000-0000000000b3'';create policy boundary_read on organizations for select to authenticated using(id=auth_org_id());','with changed as (update organizations set qs_report_revenue_enabled=false where id=''15220000-0000-0000-0000-0000000000a1'' returning id) select count(*)::text from changed','ok:0'),
('qs_existing_reader','15220000-0000-0000-0000-0000000000b3','update organizations set qs_report_revenue_enabled=false where id=''15220000-0000-0000-0000-0000000000a1'';','select sum(amount)::text from dsr_report_revenue(''25700000-0000-0000-0000-000000000001'')','ok:50.00'),
('qs_real_identity','15220000-0000-0000-0000-0000000000b4','update profiles set built_in_role=''engineer'' where id=''15220000-0000-0000-0000-0000000000b4'';select set_config(''boundary.view_as'',''quantity_surveyor'',true);select pg_temp.force_bool(''public.dsr_may_see_revenue(uuid)'',false);select pg_temp.patch(''public.actor_holds_job_role(text)'',''and public.actor_built_in_role() is not distinct from p_key'','''');','select sum(amount)::text from dsr_report_revenue(''25700000-0000-0000-0000-000000000001'')','error:42501'),
('qs_frozen','15220000-0000-0000-0000-0000000000b1','','select sum(amount)::text from dsr_report_revenue(''25700000-0000-0000-0000-000000000001'')','ok:50.00'),
('qs_raw_frozen_rate','15220000-0000-0000-0000-0000000000b1','update daily_site_reports set status=''submitted'',validated_by=null,validated_at=null where id=''25700000-0000-0000-0000-000000000001'';','select frozen_rate::text from dsr_progress_lines where report_id=''25700000-0000-0000-0000-000000000001''','error:42501'),
('qs_raw_frozen_amount','15220000-0000-0000-0000-0000000000b1','update daily_site_reports set status=''submitted'',validated_by=null,validated_at=null where id=''25700000-0000-0000-0000-000000000001'';','select frozen_amount::text from dsr_progress_lines where report_id=''25700000-0000-0000-0000-000000000001''','error:42501'),
('qs_report_only','15220000-0000-0000-0000-0000000000b1','','select work_order_validated_revenue(''15220000-0000-0000-0000-0000000000e1'')::text','error:42501'),
('buyer_order_on','27004000-0000-0000-0000-0000000000a3','','select equipment_plan_purchase_submit_context((select id from target))->>''may_submit''','ok:true'),
('buyer_order_off','27004000-0000-0000-0000-0000000000a3','update purchase_order_settings set order_job_roles=''{}'' where org_id=''27004000-0000-0000-0000-00000000000a'';','select equipment_plan_purchase_submit_context((select id from target))->>''may_submit''','ok:false'),
('buyer_held_key','27004000-0000-0000-0000-0000000000a3','update profiles set built_in_role=null where id=''27004000-0000-0000-0000-0000000000a3'';','select equipment_plan_purchase_submit_context((select id from target))->>''may_submit''','ok:false'),
('buyer_real_identity','27004000-0000-0000-0000-0000000000a5','update profiles set built_in_role=''engineer'' where id=''27004000-0000-0000-0000-0000000000a5'';select pg_temp.patch(''public.actor_may_order_purchases()'',''and public.actor_built_in_role() is not distinct from k'','''');select set_config(''boundary.view_as'',''buyer'',true);','select equipment_plan_purchase_submit_context((select id from target))->>''may_submit''','ok:false'),
('buyer_draft','27004000-0000-0000-0000-0000000000a3','update procurements set status=''Requested'' where id=(select id from target);','select equipment_plan_purchase_submit_context((select id from target))->>''may_submit''','ok:false'),
('buyer_approved_plan','27004000-0000-0000-0000-0000000000a3','set local session_replication_role=replica;update equipment_plans set status=''Submitted'' where id=''27004000-0000-0000-0000-000000000b01'';set local session_replication_role=origin;','select equipment_plan_purchase_submit_context((select id from target))->>''may_submit''','ok:false'),
('buyer_purchase_org','27004000-0000-0000-0000-0000000000b1','select pg_temp.force_bool(''public.actor_may_order_purchases()'',true);','select equipment_plan_purchase_submit_context((select id from target))->>''may_submit''','ok:false'),
('buyer_plan_org','27004000-0000-0000-0000-0000000000a3','set local session_replication_role=replica;update equipment_plans set org_id=''27004000-0000-0000-0000-00000000000b'' where id=''27004000-0000-0000-0000-000000000b01'';set local session_replication_role=origin;','select equipment_plan_purchase_submit_context((select id from target))->>''may_submit''','ok:false'),
('buyer_line_org','27004000-0000-0000-0000-0000000000a3','set local session_replication_role=replica;update equipment_plan_lines set org_id=''27004000-0000-0000-0000-00000000000b'' where procurement_id=(select id from target);set local session_replication_role=origin;','select equipment_plan_purchase_submit_context((select id from target))->>''may_submit''','ok:false'),
('buyer_active','27004000-0000-0000-0000-0000000000a3','update profiles set status=''disabled'' where id=''27004000-0000-0000-0000-0000000000a3'';select pg_temp.force_bool(''public.actor_may_order_purchases()'',true);','select equipment_plan_purchase_submit_context((select id from target))->>''may_submit''','error:42501'),
('buyer_field','27004000-0000-0000-0000-0000000000a3','update profiles set built_in_role=''field_user'' where id=''27004000-0000-0000-0000-0000000000a3'';select pg_temp.force_bool(''public.actor_may_order_purchases()'',true);','select equipment_plan_purchase_submit_context((select id from target))->>''may_submit''','error:42501'),
('buyer_transition_active','27004000-0000-0000-0000-0000000000a3','update profiles set status=''disabled'' where id=''27004000-0000-0000-0000-0000000000a3'';select pg_temp.force_bool(''public.actor_may_order_purchases()'',true);select pg_temp.patch(''public.equipment_plan_purchase_submit_context(uuid)'',''perform public.assert_is_active_member();'','''');','select transition_procurement((select id from target),''Requested'')','error:42501'),
('buyer_transition_field','27004000-0000-0000-0000-0000000000a3','update profiles set built_in_role=''field_user'' where id=''27004000-0000-0000-0000-0000000000a3'';select pg_temp.force_bool(''public.actor_may_order_purchases()'',true);select pg_temp.patch(''public.equipment_plan_purchase_submit_context(uuid)'',''perform public.assert_not_light();'','''');','select transition_procurement((select id from target),''Requested'')','error:42501'),
('buyer_ordinary','27004000-0000-0000-0000-0000000000a3','','select transition_procurement(''25710000-0000-0000-0000-000000000001'',''Requested'')','error:42501'),
('buyer_link_table_grant','27004000-0000-0000-0000-0000000000a3','alter table equipment_plan_lines disable row level security; alter table equipment_plan_lines disable trigger user;','update equipment_plan_lines set procurement_id=''25710000-0000-0000-0000-000000000001'' where procurement_id=(select id from target) returning ''changed''::text','error:42501'),
('buyer_link_table_rls','27004000-0000-0000-0000-0000000000a3','grant update(procurement_id) on equipment_plan_lines to authenticated; alter table equipment_plan_lines disable trigger user;','with changed as (update equipment_plan_lines set procurement_id=''25710000-0000-0000-0000-000000000001'' where procurement_id=(select id from target) returning id) select count(*)::text from changed','ok:0'),
('buyer_link_save_rpc','27004000-0000-0000-0000-0000000000a3','','select (save_equipment_plan(''25720000-0000-0000-0000-000000000001'',''27004000-0000-0000-0000-0000000000c1'',''2026-05-01'',jsonb_build_array(pg_temp._line(''25720000-0000-0000-0000-000000000002'',jsonb_build_object(''date_from'',''2026-05-01'',''date_to'',''2026-05-20'',''procurement_id'',''25710000-0000-0000-0000-000000000001''))))).id::text','error:22023'),
('identity_rpc_actor','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'',''{"actor_id":"27004000-0000-0000-0000-0000000000a1"}'');reset role;select set_config(''request.jwt.claims'',''{}'',true);','select actor_id::text from procurement_status_events where procurement_id=(select id from target) and from_status=''Draft'' and to_status=''Requested''','ok:27004000-0000-0000-0000-0000000000a3'),
('identity_authenticated_insert','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);alter table procurement_status_events disable row level security; alter table procurement_status_events disable trigger user;','insert into procurement_status_events(procurement_id,org_id,from_status,to_status,actor_id) values((select id from target),''27004000-0000-0000-0000-00000000000a'',''Draft'',''Requested'',''27004000-0000-0000-0000-0000000000a1'') returning ''changed''::text','error:42501'),
('identity_authenticated_update','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);alter table procurement_status_events disable row level security; alter table procurement_status_events disable trigger user;','update procurement_status_events set actor_id=''27004000-0000-0000-0000-0000000000a1'' where procurement_id=(select id from target) returning ''changed''::text','error:42501'),
('identity_authenticated_delete','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);alter table procurement_status_events disable row level security; alter table procurement_status_events disable trigger user;','delete from procurement_status_events where procurement_id=(select id from target) returning ''changed''::text','error:42501'),
('identity_authenticated_truncate','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);alter table procurement_status_events disable row level security; alter table procurement_status_events disable trigger user;','truncate procurement_status_events','error:42501'),
('identity_anon_insert','anon','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);alter table procurement_status_events disable row level security; alter table procurement_status_events disable trigger user;grant select on target,procurement_status_events to anon;','insert into procurement_status_events(procurement_id,org_id,from_status,to_status,actor_id) values((select id from target),''27004000-0000-0000-0000-00000000000a'',''Draft'',''Requested'',''27004000-0000-0000-0000-0000000000a1'') returning ''changed''::text','error:42501'),
('identity_anon_update','anon','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);alter table procurement_status_events disable row level security; alter table procurement_status_events disable trigger user;grant select on target,procurement_status_events to anon;','update procurement_status_events set actor_id=''27004000-0000-0000-0000-0000000000a1'' where procurement_id=(select id from target) returning ''changed''::text','error:42501'),
('identity_anon_delete','anon','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);alter table procurement_status_events disable row level security; alter table procurement_status_events disable trigger user;grant select on target,procurement_status_events to anon;','delete from procurement_status_events where procurement_id=(select id from target) returning ''changed''::text','error:42501'),
('identity_anon_truncate','anon','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);alter table procurement_status_events disable row level security; alter table procurement_status_events disable trigger user;grant select on target,procurement_status_events to anon;','truncate procurement_status_events','error:42501'),
('approval_transition_admin','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);update profiles set built_in_role=null,role=''Admin'' where id=''27004000-0000-0000-0000-0000000000a3'';alter table procurements disable trigger procurements_guard_plan_submitter;','select transition_procurement((select id from target),''Approved'')','error:42501'),
('approval_transition_delegate','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);update profiles set built_in_role=null,role=''Finance'' where id=''27004000-0000-0000-0000-0000000000a3'';insert into spend_approvers(org_id,project_id,profile_id) values(''27004000-0000-0000-0000-00000000000a'',''27004000-0000-0000-0000-0000000000c1'',''27004000-0000-0000-0000-0000000000a3'');alter table procurements disable trigger procurements_guard_plan_submitter;','select transition_procurement((select id from target),''Approved'')','error:42501'),
('approval_transition_senior','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);update profiles set built_in_role=null,role=''Finance'' where id=''27004000-0000-0000-0000-0000000000a3'';delete from spend_approvers where org_id=''27004000-0000-0000-0000-00000000000a'';alter table procurements disable trigger procurements_guard_plan_submitter;','select transition_procurement((select id from target),''Approved'')','error:42501'),
('approval_reject','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);update profiles set built_in_role=null,role=''Admin'' where id=''27004000-0000-0000-0000-0000000000a3'';','select transition_procurement((select id from target),''Rejected'',''Return to author'')','error:42501'),
('approval_amount_rpc','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);update profiles set built_in_role=null,role=''Admin'' where id=''27004000-0000-0000-0000-0000000000a3'';set local session_replication_role=replica;update procurements set status=''Vendor Invoiced'',approved_total_value=100 where id=(select id from target);set local session_replication_role=origin;','select approve_procurement_amount((select id from target),100000)','error:42501'),
('approval_amount_independent','27004000-0000-0000-0000-0000000000a1','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);update profiles set built_in_role=null,role=''Admin'' where id=''27004000-0000-0000-0000-0000000000a3'';set local session_replication_role=replica;update procurements set status=''Vendor Invoiced'',approved_total_value=100 where id=(select id from target);set local session_replication_role=origin;','select approve_procurement_amount((select id from target),100000)','ok:'),
('approval_row_alternate','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);update profiles set built_in_role=null,role=''Admin'' where id=''27004000-0000-0000-0000-0000000000a3'';select pg_temp.patch(''public.transition_procurement(uuid,public.procurement_status,text)'',''if v_from=''''Requested'''' and p_to in (''''Approved'''',''''Rejected'''')
    and (public.equipment_plan_purchase_submit_context(p_id)->>''''is_submitter'''')::boolean then'',''if false then'');','select transition_procurement((select id from target),''Approved'')','error:42501'),
('approval_independent','27004000-0000-0000-0000-0000000000a1','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);','select transition_procurement((select id from target),''Approved'')','ok:'),
('identity_original_resubmission','27004000-0000-0000-0000-0000000000a3','select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a3","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a1","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Rejected'',''Return to author'');reset role;select set_config(''request.jwt.claims'',''{"sub":"27004000-0000-0000-0000-0000000000a2","role":"authenticated"}'',true);set local role authenticated;select transition_procurement((select id from target),''Draft'');select transition_procurement((select id from target),''Requested'');reset role;select set_config(''request.jwt.claims'',''{}'',true);set local session_replication_role=replica;update procurement_status_events set created_at=now()+interval ''1 second'' where procurement_id=(select id from target) and actor_id=''27004000-0000-0000-0000-0000000000a2'' and to_status=''Requested'';set local session_replication_role=origin;update profiles set built_in_role=null,role=''Admin'' where id=''27004000-0000-0000-0000-0000000000a3'';set local session_replication_role=replica;update procurement_status_events set created_at=now()+interval ''1 second'' where procurement_id=(select id from target) and actor_id=''27004000-0000-0000-0000-0000000000a2'' and to_status=''Requested'';set local session_replication_role=origin;','select transition_procurement((select id from target),''Approved'')','error:42501'),
('requester_new_generation','27004000-0000-0000-0000-0000000000a1','','select requested_by_id::text from procurements where id=(select id from target)','ok:27004000-0000-0000-0000-0000000000a2');
-- MUTATION-READY
select plan(count(*)::int) from boundary_cases where coalesce(current_setting('pmo.only_boundary',true),'') in ('',id);
select is(pg_temp.run_boundary(id),expected,'AC-RRP-'||id) from boundary_cases where coalesce(current_setting('pmo.only_boundary',true),'') in ('',id) order by id;
select * from finish(); rollback;
