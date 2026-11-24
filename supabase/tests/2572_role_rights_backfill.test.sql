-- Replay the actual migration against legacy Draft and submitted purchases, in one rolled-back transaction.
begin;
create extension if not exists pgtap;
-- The CLI streams tests into its database container; read the applied migration ledger rather than host paths.
drop trigger procurements_guard_plan_submitter on public.procurements;
drop function public.guard_equipment_plan_purchase_submitter();
drop function public.equipment_plan_purchase_submit_context(uuid);
do $history$
declare stmt text; restored integer:=0;
begin
 for stmt in select x.statement from supabase_migrations.schema_migrations m
   cross join lateral unnest(m.statements) with ordinality x(statement,n)
   where (m.version='1882' and x.statement ilike '%create or replace function public.approve_equipment_plan(%')
      or (m.version='2001' and x.statement ilike '%create or replace function public.transition_procurement(%')
   order by m.version,x.n
 loop execute stmt; restored:=restored+1; end loop;
 if restored<>2 then raise exception 'Historical function bodies missing from migration ledger'; end if;
end $history$;
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

set local role authenticated;
select pg_temp._as('27004000-0000-0000-0000-0000000000a1');
select transition_procurement((select id from target),'Requested');
reset role;
select set_config('request.jwt.claims','{}',true);
-- MIGRATION-REPLAY
do $replay$
declare stmt text; replayed integer:=0;
begin
 for stmt in select x.statement from supabase_migrations.schema_migrations m
   cross join lateral unnest(m.statements) with ordinality x(statement,n)
   where m.version='2571' order by x.n
 loop execute stmt; replayed:=replayed+1; end loop;
 if replayed=0 then raise exception 'Reviewed forward migration missing from migration ledger'; end if;
end $replay$;
create temp table backfill_cases(id text,actual text,expected text);
insert into backfill_cases values
('requester_backfill',(select p.requested_by_id::text from procurements p join equipment_plan_lines l on l.procurement_id=p.id where l.plan_id='27004000-0000-0000-0000-000000000b01' and p.status='Draft'),'27004000-0000-0000-0000-0000000000a2'),
('requester_historical',(select requested_by_id::text from procurements where id=(select id from target)),'27004000-0000-0000-0000-0000000000a1');
select plan(count(*)::int) from backfill_cases where coalesce(current_setting('pmo.only_boundary',true),'') in ('',id);
select is(actual,expected,'AC-RRP-'||id) from backfill_cases where coalesce(current_setting('pmo.only_boundary',true),'') in ('',id) order by id;
select * from finish();rollback;
