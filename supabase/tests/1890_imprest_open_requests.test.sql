-- 1890_imprest_open_requests.test.sql — cash-advance-estimate: the read-only suggestion for a site cash plan.
-- Migration under test: 1890_imprest_open_requests.sql. Spec docs/specs/cash-advance-estimate.spec.md.
-- AC-CAE-001 only the open requests of the float's project (submitted, not yet ordered or paid) · 002 their lines and totals,
-- a request with no line still listed once · 003 the work order where the data has one · 004 no other project's and no other
-- organisation's request · 005 visibility per role: the four approval-rank roles read it, an Engineer, a light account and a
-- signed-out role read nothing · 006 an archived float suggests nothing.
-- MUTATION CHECK (break the rule, the named assertion must go red, restore; run with `supabase test db <this file>`):
--   drop `p.status in (...)` from the function                                   -> AC-CAE-001 reds (Draft/Ordered/Paid appear)
--   change `p.project_id = f.project_id` to `true`                                -> AC-CAE-004 reds (other project's request appears)
--   drop `p.org_id = f.org_id`                                                    -> AC-CAE-004 reds only if the other org's float row is reachable; the float's own RLS then still holds
--   make the function `security definer`                                          -> AC-CAE-005 reds (Engineer / light account read it)
--   replace `procurements_masked` with `procurements` and `security definer`       -> AC-CAE-005 reds
begin;
create extension if not exists pgtap;
select plan(18);

insert into organizations (id, name, default_currency, default_timezone) values
  ('18900000-0000-0000-0000-00000000000a', 'CAE Org', 'IDR', 'Asia/Jakarta'), ('18900000-0000-0000-0000-00000000000b', 'CAE Other Org', 'IDR', 'UTC');
update organizations set built_in_roles_enabled = true where id = '18900000-0000-0000-0000-00000000000a';
insert into auth.users (id, email) values
  ('18900000-0000-0000-0000-0000000000a1', 'cae-admin@example.com'), ('18900000-0000-0000-0000-0000000000a2', 'cae-fin@example.com'), ('18900000-0000-0000-0000-0000000000a4', 'cae-pm@example.com'),
  ('18900000-0000-0000-0000-0000000000a6', 'cae-eng@example.com'), ('18900000-0000-0000-0000-0000000000a7', 'cae-eng2@example.com'), ('18900000-0000-0000-0000-0000000000a8', 'cae-foreman@example.com'),
  ('18900000-0000-0000-0000-0000000000a9', 'cae-exec@example.com'), ('18900000-0000-0000-0000-0000000000aa', 'cae-nopx@example.com'),
  ('18900000-0000-0000-0000-0000000000b1', 'cae-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('18900000-0000-0000-0000-0000000000a1', '18900000-0000-0000-0000-00000000000a', 'CAE Admin', 'cae-admin@example.com', 'Admin', 'active', null),
  ('18900000-0000-0000-0000-0000000000a2', '18900000-0000-0000-0000-00000000000a', 'CAE Fin', 'cae-fin@example.com', 'Finance', 'active', null),
  ('18900000-0000-0000-0000-0000000000a4', '18900000-0000-0000-0000-00000000000a', 'CAE PM', 'cae-pm@example.com', 'Project Manager', 'active', null),
  ('18900000-0000-0000-0000-0000000000a6', '18900000-0000-0000-0000-00000000000a', 'CAE Eng', 'cae-eng@example.com', 'Engineer', 'active', null),
  ('18900000-0000-0000-0000-0000000000a7', '18900000-0000-0000-0000-00000000000a', 'CAE Eng2', 'cae-eng2@example.com', 'Engineer', 'active', null),
  ('18900000-0000-0000-0000-0000000000a8', '18900000-0000-0000-0000-00000000000a', 'CAE Foreman', 'cae-foreman@example.com', 'Engineer', 'active', 'foreman'),
  ('18900000-0000-0000-0000-0000000000a9', '18900000-0000-0000-0000-00000000000a', 'CAE Exec', 'cae-exec@example.com', 'Executive', 'active', null),
  ('18900000-0000-0000-0000-0000000000aa', '18900000-0000-0000-0000-00000000000a', 'CAE No Price Right', 'cae-nopx@example.com', 'Finance', 'active', 'storekeeper'),
  ('18900000-0000-0000-0000-0000000000b1', '18900000-0000-0000-0000-00000000000b', 'CAE XOrg', 'cae-xorg@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('18900000-0000-0000-0000-0000000000c1', '18900000-0000-0000-0000-00000000000a', 'CAE Site One', 'Ongoing Project', '18900000-0000-0000-0000-0000000000a4', 'IDR'),
  ('18900000-0000-0000-0000-0000000000c2', '18900000-0000-0000-0000-00000000000a', 'CAE Site Two', 'Ongoing Project', '18900000-0000-0000-0000-0000000000a4', 'IDR'),
  ('18900000-0000-0000-0000-0000000000c9', '18900000-0000-0000-0000-00000000000b', 'CAE Other', 'Ongoing Project', null, 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('18900002-0000-0000-0000-000000000001', '18900000-0000-0000-0000-00000000000a', '18900000-0000-0000-0000-0000000000c1', 'WO-A', 'CAE WO A', 'Issued', 10000, 'exclusive', 0, 'IDR');
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('18900003-0000-0000-0000-000000000001', '18900000-0000-0000-0000-00000000000a', '18900000-0000-0000-0000-0000000000c1', '18900000-0000-0000-0000-0000000000a2', 10000000, 'IDR', '18900000-0000-0000-0000-0000000000a1');
-- requests: 1 Requested (two lines, on a work order), 2 Approved (one line, requested by the Engineer), 3 Quote Selected (no line),
-- 13 Vendor Quoted; excluded: 4 Draft, 5 Ordered, 6 Paid, 7 Cancelled, 8 Rejected, 9 Vendor Invoiced, 10 Received,
-- 11 another project, 12 another organisation
set local session_replication_role = replica;
insert into procurements (id, org_id, title, status, requested_by_id, currency, total_value, project_id, budget_category, pr_number) values
  ('18900001-0000-0000-0000-000000000001', '18900000-0000-0000-0000-00000000000a', 'CAE PR 1', 'Requested', '18900000-0000-0000-0000-0000000000a4', 'IDR', 500000, '18900000-0000-0000-0000-0000000000c1', 'Materials', 'PR-1'),
  ('18900001-0000-0000-0000-000000000002', '18900000-0000-0000-0000-00000000000a', 'CAE PR 2', 'Approved', '18900000-0000-0000-0000-0000000000a6', 'IDR', 300000, '18900000-0000-0000-0000-0000000000c1', 'Equipment', 'PR-2'),
  ('18900001-0000-0000-0000-000000000003', '18900000-0000-0000-0000-00000000000a', 'CAE PR 3', 'Quote Selected', '18900000-0000-0000-0000-0000000000a4', 'IDR', 100000, '18900000-0000-0000-0000-0000000000c1', 'Materials', 'PR-3'),
  ('18900001-0000-0000-0000-000000000004', '18900000-0000-0000-0000-00000000000a', 'CAE PR 4', 'Draft', '18900000-0000-0000-0000-0000000000a4', 'IDR', 11, '18900000-0000-0000-0000-0000000000c1', 'Materials', 'PR-4'),
  ('18900001-0000-0000-0000-000000000005', '18900000-0000-0000-0000-00000000000a', 'CAE PR 5', 'Ordered', '18900000-0000-0000-0000-0000000000a4', 'IDR', 12, '18900000-0000-0000-0000-0000000000c1', 'Materials', 'PR-5'),
  ('18900001-0000-0000-0000-000000000006', '18900000-0000-0000-0000-00000000000a', 'CAE PR 6', 'Paid', '18900000-0000-0000-0000-0000000000a4', 'IDR', 13, '18900000-0000-0000-0000-0000000000c1', 'Materials', 'PR-6'),
  ('18900001-0000-0000-0000-000000000007', '18900000-0000-0000-0000-00000000000a', 'CAE PR 7', 'Cancelled', '18900000-0000-0000-0000-0000000000a4', 'IDR', 14, '18900000-0000-0000-0000-0000000000c1', 'Materials', 'PR-7'),
  ('18900001-0000-0000-0000-000000000008', '18900000-0000-0000-0000-00000000000a', 'CAE PR 8', 'Rejected', '18900000-0000-0000-0000-0000000000a4', 'IDR', 15, '18900000-0000-0000-0000-0000000000c1', 'Materials', 'PR-8'),
  ('18900001-0000-0000-0000-000000000009', '18900000-0000-0000-0000-00000000000a', 'CAE PR 9', 'Vendor Invoiced', '18900000-0000-0000-0000-0000000000a4', 'IDR', 16, '18900000-0000-0000-0000-0000000000c1', 'Materials', 'PR-9'),
  ('18900001-0000-0000-0000-000000000010', '18900000-0000-0000-0000-00000000000a', 'CAE PR 10', 'Received', '18900000-0000-0000-0000-0000000000a4', 'IDR', 17, '18900000-0000-0000-0000-0000000000c1', 'Materials', 'PR-10'),
  ('18900001-0000-0000-0000-000000000011', '18900000-0000-0000-0000-00000000000a', 'CAE PR 11', 'Requested', '18900000-0000-0000-0000-0000000000a4', 'IDR', 18, '18900000-0000-0000-0000-0000000000c2', 'Materials', 'PR-11'),
  ('18900001-0000-0000-0000-000000000012', '18900000-0000-0000-0000-00000000000b', 'CAE PR 12', 'Requested', '18900000-0000-0000-0000-0000000000b1', 'IDR', 19, '18900000-0000-0000-0000-0000000000c9', 'Materials', 'PR-12'),
  ('18900001-0000-0000-0000-000000000013', '18900000-0000-0000-0000-00000000000a', 'CAE PR 13', 'Vendor Quoted', '18900000-0000-0000-0000-0000000000a4', 'IDR', 20000, '18900000-0000-0000-0000-0000000000c1', 'Equipment', 'PR-13');
set local session_replication_role = origin;
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('18900004-0000-0000-0000-000000000001', '18900000-0000-0000-0000-00000000000a', '18900001-0000-0000-0000-000000000001', 'Cement', 10, 30000),
  ('18900004-0000-0000-0000-000000000002', '18900000-0000-0000-0000-00000000000a', '18900001-0000-0000-0000-000000000001', 'Sand', 5, 40000),
  ('18900004-0000-0000-0000-000000000003', '18900000-0000-0000-0000-00000000000a', '18900001-0000-0000-0000-000000000002', 'Scaffold hire', 1, 300000),
  ('18900004-0000-0000-0000-000000000004', '18900000-0000-0000-0000-00000000000a', '18900001-0000-0000-0000-000000000005', 'Ordered item', 1, 12);
insert into purchase_requests (id, org_id, procurement_id, currency, work_order_id) values
  ('18900005-0000-0000-0000-000000000001', '18900000-0000-0000-0000-00000000000a', '18900001-0000-0000-0000-000000000001', 'IDR', '18900002-0000-0000-0000-000000000001');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a4');

-- AC-CAE-001
select is((select string_agg(distinct pr_number, ',' order by pr_number) from get_imprest_open_requests('18900003-0000-0000-0000-000000000001')),
  'PR-1,PR-13,PR-2,PR-3', 'AC-CAE-001 the open requests are Requested, Approved, Vendor Quoted and Quote Selected');
select is((select count(*)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001')
            where pr_number in ('PR-4', 'PR-5', 'PR-6', 'PR-7', 'PR-8', 'PR-9', 'PR-10')), 0,
  'AC-CAE-001 a Draft, an Ordered, Paid, Cancelled, Rejected, Invoiced or Received request is not suggested');
-- AC-CAE-002
select is((select string_agg(line_name || ':' || line_amount, ',' order by line_name) from get_imprest_open_requests('18900003-0000-0000-0000-000000000001') where pr_number = 'PR-1'),
  'Cement:300000.00,Sand:200000.00', 'AC-CAE-002 a request lists its lines');
select is((select request_total from get_imprest_open_requests('18900003-0000-0000-0000-000000000001') where pr_number = 'PR-1' limit 1), 500000.00,
  'AC-CAE-002 and its total');
select is((select count(*)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001') where pr_number = 'PR-3' and line_id is null), 1,
  'AC-CAE-002 a request with no line is listed once, without a line');
select is((select budget_category::text from get_imprest_open_requests('18900003-0000-0000-0000-000000000001') where pr_number = 'PR-2' limit 1), 'Equipment',
  'AC-CAE-002 the purpose is the request''s budget category');
-- AC-CAE-003
select is((select wo_number from get_imprest_open_requests('18900003-0000-0000-0000-000000000001') where pr_number = 'PR-1' limit 1), 'WO-A',
  'AC-CAE-003 the work order is named where the request has one');
select is((select count(*)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001') where pr_number = 'PR-2' and work_order_id is not null), 0,
  'AC-CAE-003 and empty where it has none');
-- AC-CAE-004
select is((select count(*)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001') where pr_number in ('PR-11', 'PR-12')), 0,
  'AC-CAE-004 no request of another project or another organisation');
-- AC-CAE-005
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a2');
select is((select count(distinct pr_number)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001')), 4, 'AC-CAE-005 Finance reads it');
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a9');
select is((select count(distinct pr_number)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001')), 4, 'AC-CAE-005 an Executive reads it');
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001')), 0,
  'AC-CAE-005 an Engineer, even the requester of one of them, reads none (the float is not theirs to see)');
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a8');
select is((select count(*)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001')), 0, 'AC-CAE-005 a light account reads none');
select pg_temp.act_as('18900000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001')), 0, 'AC-CAE-005 another organisation reads none');
select is(has_function_privilege('anon', 'public.get_imprest_open_requests(uuid)', 'EXECUTE'), false, 'AC-CAE-005 the signed-out role cannot run it');
-- AC-CAE-005 hidden prices: with the organisation's setting on, a person with no price right (built-in role without it) holds the
-- access level of that role's base, so the float is not theirs to see and they read nothing: no person exists who sees the float
-- but not the price, and the masked views still null every amount if one ever does (proven by 1215_hide_prices.test.sql).
reset role;
update organizations set hide_prices_from_requesters = true where id = '18900000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp.act_as('18900000-0000-0000-0000-0000000000aa');
select is((select count(*)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001')), 0,
  'AC-CAE-005 hidden prices: a person without the price right reads no requests through the site cash screen (the float is not theirs to see)');
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001') where request_total is null), 0,
  'AC-CAE-005 hidden prices: a Project Manager (price right) still reads the amounts');
-- AC-CAE-006
reset role;
update imprest_floats set archived_at = now() where id = '18900003-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.act_as('18900000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from get_imprest_open_requests('18900003-0000-0000-0000-000000000001')), 0, 'AC-CAE-006 an archived float suggests nothing');

select * from finish();
rollback;
