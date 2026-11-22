-- 1890_imprest_plan_line_splits.test.sql — cash-advance-estimate: a plan line split over work orders.
-- Migration under test: 1890_imprest_plan_line_splits.sql. Spec docs/specs/cash-advance-estimate.spec.md.
-- AC-CAE-001 a split is saved, org stamped by trigger · 002 splits never exceed the line · 003 same-project, open work order ·
-- 004 only the author, only while the plan is Draft or Rejected · 005 a line cannot drop below its splits; deleting a line
-- deletes its splits · 006 reads follow the plan (an Engineer, another org and a light account see none); no direct write.
-- MUTATION CHECK (break the rule, the named assertion must go red, restore; run with `supabase test db <this file>`):
--   in save_imprest_plan_line_split make the sum test `if false and v_other + ... > v_l.planned_amount`  -> AC-CAE-002 reds
--   delete the `v_wo.project_id is distinct from v_f.project_id` operand                                  -> AC-CAE-003 reds
--   change `v_p.status not in ('Draft','Rejected')` to `false`                                            -> AC-CAE-004 reds
--   drop trigger imprest_plan_lines_below_splits on public.imprest_plan_lines                             -> AC-CAE-005 reds
--   grant insert on public.imprest_plan_line_splits to authenticated                                      -> AC-CAE-006 reds
--   delete the select policy's `exists (... imprest_plan_lines ...)` conjunct                             -> AC-CAE-006 (Engineer reads) reds
begin;
create extension if not exists pgtap;
select plan(34);

insert into organizations (id, name, default_currency, default_timezone) values
  ('18900000-0000-0000-0000-00000000000a', 'CAE Org', 'IDR', 'Asia/Jakarta'),
  ('18900000-0000-0000-0000-00000000000b', 'CAE Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('18900000-0000-0000-0000-0000000000a1', 'cae-admin@example.com'), ('18900000-0000-0000-0000-0000000000a2', 'cae-fin@example.com'),
  ('18900000-0000-0000-0000-0000000000a4', 'cae-pm1@example.com'),   ('18900000-0000-0000-0000-0000000000a5', 'cae-pm2@example.com'),
  ('18900000-0000-0000-0000-0000000000a6', 'cae-eng@example.com'),   ('18900000-0000-0000-0000-0000000000a8', 'cae-foreman@example.com'),
  ('18900000-0000-0000-0000-0000000000b1', 'cae-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('18900000-0000-0000-0000-0000000000a1', '18900000-0000-0000-0000-00000000000a', 'CAE Admin', 'cae-admin@example.com', 'Admin', 'active', null),
  ('18900000-0000-0000-0000-0000000000a2', '18900000-0000-0000-0000-00000000000a', 'CAE Fin', 'cae-fin@example.com', 'Finance', 'active', null),
  ('18900000-0000-0000-0000-0000000000a4', '18900000-0000-0000-0000-00000000000a', 'CAE PM1', 'cae-pm1@example.com', 'Project Manager', 'active', null),
  ('18900000-0000-0000-0000-0000000000a5', '18900000-0000-0000-0000-00000000000a', 'CAE PM2', 'cae-pm2@example.com', 'Project Manager', 'active', null),
  ('18900000-0000-0000-0000-0000000000a6', '18900000-0000-0000-0000-00000000000a', 'CAE Eng', 'cae-eng@example.com', 'Engineer', 'active', null),
  ('18900000-0000-0000-0000-0000000000a8', '18900000-0000-0000-0000-00000000000a', 'CAE Foreman', 'cae-foreman@example.com', 'Engineer', 'active', 'foreman'),
  ('18900000-0000-0000-0000-0000000000b1', '18900000-0000-0000-0000-00000000000b', 'CAE XOrg', 'cae-xorg@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('18900000-0000-0000-0000-0000000000c1', '18900000-0000-0000-0000-00000000000a', 'CAE Site One', 'Ongoing Project', '18900000-0000-0000-0000-0000000000a4', 'IDR'),
  ('18900000-0000-0000-0000-0000000000c2', '18900000-0000-0000-0000-00000000000a', 'CAE Site Two', 'Ongoing Project', '18900000-0000-0000-0000-0000000000a5', 'IDR'),
  ('18900000-0000-0000-0000-0000000000c9', '18900000-0000-0000-0000-00000000000b', 'CAE Other',    'Ongoing Project', null, 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('18900000-0000-0000-0000-000000000401', '18900000-0000-0000-0000-00000000000a', '18900000-0000-0000-0000-0000000000c1', 'WO-A', 'CAE WO A', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('18900000-0000-0000-0000-000000000402', '18900000-0000-0000-0000-00000000000a', '18900000-0000-0000-0000-0000000000c1', 'WO-B', 'CAE WO B', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('18900000-0000-0000-0000-000000000403', '18900000-0000-0000-0000-00000000000a', '18900000-0000-0000-0000-0000000000c2', 'WO-C', 'CAE WO two', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('18900000-0000-0000-0000-000000000409', '18900000-0000-0000-0000-00000000000b', '18900000-0000-0000-0000-0000000000c9', 'WO-X', 'CAE WO other org', 'Issued', 10000, 'exclusive', 0, 'IDR');
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, cancelled_at, currency) values
  ('18900000-0000-0000-0000-000000000404', '18900000-0000-0000-0000-00000000000a', '18900000-0000-0000-0000-0000000000c1', 'WO-Z', 'CAE WO cancelled', 'Cancelled', 0, 'exclusive', 0, now(), 'IDR');
set local session_replication_role = origin;
-- float F on project one, custodian Finance
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('18900000-0000-0000-0000-0000000000d1', '18900000-0000-0000-0000-00000000000a', '18900000-0000-0000-0000-0000000000c1',
   '18900000-0000-0000-0000-0000000000a2', 10000000, 'IDR', '18900000-0000-0000-0000-0000000000a1');
-- plan P (Draft) and plan Q (Submitted), both authored by PM1
insert into imprest_plans (id, org_id, float_id, month, author_id, status) values
  ('18900000-0000-0000-0000-000000000101', '18900000-0000-0000-0000-00000000000a', '18900000-0000-0000-0000-0000000000d1',
   (date_trunc('month', now() at time zone 'Asia/Jakarta') + interval '1 month')::date, '18900000-0000-0000-0000-0000000000a4', 'Draft'),
  ('18900000-0000-0000-0000-000000000102', '18900000-0000-0000-0000-00000000000a', '18900000-0000-0000-0000-0000000000d1',
   (date_trunc('month', now() at time zone 'Asia/Jakarta') + interval '2 months')::date, '18900000-0000-0000-0000-0000000000a4', 'Submitted');
insert into imprest_plan_lines (id, plan_id, budget_category, planned_amount) values
  ('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000101', 'Materials', 100000),
  ('18900000-0000-0000-0000-000000000202', '18900000-0000-0000-0000-000000000102', 'Materials', 50000),
  ('18900000-0000-0000-0000-000000000203', '18900000-0000-0000-0000-000000000101', 'Vehicle',   100000);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- run a statement and report 'SQLSTATE|message' (or 'ok'), so each denial asserts the code AND the message
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || '|' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;

set local role authenticated;
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a4');

-- AC-CAE-001
select lives_ok($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000401', 60000) $$,
  'AC-CAE-001 the plan author splits 60000 of a 100000 line to a work order of the float''s project');
select is((select org_id::text from imprest_plan_line_splits where line_id = '18900000-0000-0000-0000-000000000201'),
  '18900000-0000-0000-0000-00000000000a', 'AC-CAE-001 org_id is stamped from the line, not sent by the caller');
select lives_ok($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000402', 30000) $$,
  'AC-CAE-001 a second work order takes 30000');
select is((select planned_amount - coalesce((select sum(amount) from imprest_plan_line_splits s where s.line_id = l.id), 0)
             from imprest_plan_lines l where l.id = '18900000-0000-0000-0000-000000000201'), 10000.00,
  'AC-CAE-001 the unassigned remainder of the line reads 10000');
select lives_ok($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000401', 70000) $$,
  'AC-CAE-001 saving the same work order again changes its amount (70000 + 30000 = the line, exactly)');
select is((select count(*)::int from imprest_plan_line_splits where line_id = '18900000-0000-0000-0000-000000000201'), 2,
  'AC-CAE-001 still one split per work order');

-- AC-CAE-002
select like(pg_temp.try($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000402', 30001) $$),
  '23514|ICE_SPLIT_OVER_LINE:%', 'AC-CAE-002 splits adding up to more than the line are refused');
select like(pg_temp.try($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000402', 0) $$),
  'P0001|a split amount must be greater than zero%', 'AC-CAE-002 a zero amount is refused');
select is((select sum(amount) from imprest_plan_line_splits where line_id = '18900000-0000-0000-0000-000000000201'), 100000.00,
  'AC-CAE-002 a refused split changed nothing');

-- AC-CAE-003
select like(pg_temp.try($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000203', '18900000-0000-0000-0000-000000000403', 10) $$),
  '23514|ICE_WO_PROJECT:%', 'AC-CAE-003 a work order of another project is refused');
select like(pg_temp.try($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000203', '18900000-0000-0000-0000-000000000409', 10) $$),
  '23514|ICE_WO_PROJECT:%', 'AC-CAE-003 a work order of another organisation is refused');
select like(pg_temp.try($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000203', '18900000-0000-0000-0000-000000000404', 10) $$),
  '23514|ICE_WO_CANCELLED:%', 'AC-CAE-003 a cancelled work order is refused');

-- AC-CAE-005 (lines)
select like(pg_temp.try($$ update imprest_plan_lines set planned_amount = 99999 where id = '18900000-0000-0000-0000-000000000201' $$),
  '23514|ICE_SPLIT_OVER_LINE:%', 'AC-CAE-005 a line cannot drop below what is split off it');
select is(pg_temp.try($$ update imprest_plan_lines set planned_amount = 100000 where id = '18900000-0000-0000-0000-000000000201' $$), 'ok',
  'AC-CAE-005 a line may keep its amount, or rise, while split');
select lives_ok($$ select public.delete_imprest_plan_line_split((select id from imprest_plan_line_splits
    where line_id = '18900000-0000-0000-0000-000000000201' and work_order_id = '18900000-0000-0000-0000-000000000402')) $$,
  'AC-CAE-005 the author removes one split');
select is((select count(*)::int from imprest_plan_line_splits where line_id = '18900000-0000-0000-0000-000000000201'), 1,
  'AC-CAE-005 one split is left');
select lives_ok($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000203', '18900000-0000-0000-0000-000000000402', 5000) $$,
  'AC-CAE-005 (setup) a split on the second line');
select lives_ok($$ delete from imprest_plan_lines where id = '18900000-0000-0000-0000-000000000203' $$,
  'AC-CAE-005 the author deletes a line');
select is((select count(*)::int from imprest_plan_line_splits where line_id = '18900000-0000-0000-0000-000000000203'), 0,
  'AC-CAE-005 deleting a line deletes its splits');

-- AC-CAE-004: a Submitted plan is frozen, and only its author writes
select like(pg_temp.try($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000202', '18900000-0000-0000-0000-000000000401', 100) $$),
  '42501|this plan is Submitted and its lines can no longer be changed%', 'AC-CAE-004 a Submitted plan takes no split');
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a5');
select like(pg_temp.try($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000402', 100) $$),
  '42501|only the author of the plan changes its lines%', 'AC-CAE-004 another project manager cannot split the author''s line');
select like(pg_temp.try($$ select public.delete_imprest_plan_line_split((select id from imprest_plan_line_splits limit 1)) $$),
  '42501|only the author of the plan changes its lines%', 'AC-CAE-004 nor delete the author''s split');
-- a plan frozen after the splits exist: reopening is the author's move; a decided plan stays closed
reset role;
set local session_replication_role = replica;
update imprest_plans set status = 'Submitted' where id = '18900000-0000-0000-0000-000000000101';
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a4');
select like(pg_temp.try($$ select public.delete_imprest_plan_line_split((select id from imprest_plan_line_splits limit 1)) $$),
  '42501|this plan is Submitted%', 'AC-CAE-004 once the plan is Submitted its author cannot delete a split either');
reset role;
set local session_replication_role = replica;
update imprest_plans set status = 'Rejected' where id = '18900000-0000-0000-0000-000000000101';
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a4');
select lives_ok($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000402', 20000) $$,
  'AC-CAE-004 a Rejected plan is editable again, splits included');

-- AC-CAE-006: reads follow the plan
select cmp_ok((select count(*)::int from imprest_plan_line_splits), '>', 0, 'AC-CAE-006 a project manager reads the splits');
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from imprest_plan_line_splits), 0, 'AC-CAE-006 an Engineer reads none');
select like(pg_temp.try($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000402', 100) $$),
  '42501|only the author of the plan changes its lines%', 'AC-CAE-006 an Engineer cannot write a split');
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a8');
select is((select count(*)::int from imprest_plan_line_splits), 0, 'AC-CAE-006 a light account reads none');
select like(pg_temp.try($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000402', 100) $$),
  '42501|LIGHT_ACCOUNT:%', 'AC-CAE-006 a light account is refused outright');
select pg_temp.act_as('18900000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from imprest_plan_line_splits), 0, 'AC-CAE-006 another organisation reads none');
select like(pg_temp.try($$ select public.save_imprest_plan_line_split('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000409', 100) $$),
  'P0002|plan line not found%', 'AC-CAE-006 another organisation finds no such line');
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a4');
select like(pg_temp.try($$ insert into imprest_plan_line_splits (line_id, work_order_id, amount)
    values ('18900000-0000-0000-0000-000000000201', '18900000-0000-0000-0000-000000000402', 1) $$),
  '42501|permission denied%', 'AC-CAE-006 even the author has no direct insert: only the function writes');
select like(pg_temp.try($$ update imprest_plan_line_splits set amount = 1 $$), '42501|permission denied%', 'AC-CAE-006 nor a direct update');
select like(pg_temp.try($$ delete from imprest_plan_line_splits $$), '42501|permission denied%', 'AC-CAE-006 nor a direct delete');

select * from finish();
rollback;
