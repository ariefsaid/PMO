begin;
create extension if not exists pgtap;
-- #1512 S5: the project consumption report (AC-STK-022, 023, FR-STK-043/044, AC-STK-020 consumption leg, AC-STK-021 report half).
-- Plan docs/plans/2026-10-31-inventory-project-consumption.md (S5.4). Dates are relative to the org's today, so the file is stable on any run date.

insert into organizations (id, name, default_currency, default_timezone) values
  ('15120000-0000-0000-0000-000000000001', 'STK Org',       'IDR', 'Asia/Jakarta'),
  ('15120000-0000-0000-0000-000000000002', 'STK Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15120000-0000-0000-0000-0000000000a1', 'stk-admin@example.com'),
  ('15120000-0000-0000-0000-0000000000a2', 'stk-fin@example.com'),
  ('15120000-0000-0000-0000-0000000000a3', 'stk-pm@example.com'),
  ('15120000-0000-0000-0000-0000000000a4', 'stk-keep1@example.com'),   -- Engineer, keeps site A
  ('15120000-0000-0000-0000-0000000000a5', 'stk-keep2@example.com'),   -- Engineer, keeps site B
  ('15120000-0000-0000-0000-0000000000a6', 'stk-eng@example.com'),     -- Engineer, keeps nothing
  ('15120000-0000-0000-0000-0000000000b1', 'stk-xorg@example.com');    -- other-org Admin
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15120000-0000-0000-0000-0000000000a1', '15120000-0000-0000-0000-000000000001', 'STK Admin', 'stk-admin@example.com', 'Admin', 'active'),
  ('15120000-0000-0000-0000-0000000000a2', '15120000-0000-0000-0000-000000000001', 'STK Fin',   'stk-fin@example.com',   'Finance', 'active'),
  ('15120000-0000-0000-0000-0000000000a3', '15120000-0000-0000-0000-000000000001', 'STK PM',    'stk-pm@example.com',    'Project Manager', 'active'),
  ('15120000-0000-0000-0000-0000000000a4', '15120000-0000-0000-0000-000000000001', 'STK Keep1', 'stk-keep1@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a5', '15120000-0000-0000-0000-000000000001', 'STK Keep2', 'stk-keep2@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a6', '15120000-0000-0000-0000-000000000001', 'STK Eng',   'stk-eng@example.com',   'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000b1', '15120000-0000-0000-0000-000000000002', 'STK XOrg',  'stk-xorg@example.com',  'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-000000000001', 'STK Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000000001', 'STK Ongoing',  'Ongoing Project', 1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3'),
  ('15120000-0000-0000-0000-0000000000c2', '15120000-0000-0000-0000-000000000001', 'STK On Hold',  'On Hold',         1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c1', 'W-1', 'Slab pour',   'm3', 50, 1000),
  ('15120000-0000-0000-0000-0000000000e2', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c2', 'W-2', 'Other pour',  'm3', 50, 1000);

-- S1 adds below (master data, as superuser so the fixture does not depend on the RLS under test):
insert into stock_units (id, org_id, code, name, whole_only) values
  ('15120000-0000-0000-0000-0000000000d1', '15120000-0000-0000-0000-000000000001', 'bag', 'Bag',   true),
  ('15120000-0000-0000-0000-0000000000d2', '15120000-0000-0000-0000-000000000001', 'm',   'Metre', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('15120000-0000-0000-0000-000000001001', '15120000-0000-0000-0000-000000000001', 'CEM', 'Cement 50kg', '15120000-0000-0000-0000-0000000000d1'),
  ('15120000-0000-0000-0000-000000001002', '15120000-0000-0000-0000-000000000001', 'CAB', 'Cable 4mm',   '15120000-0000-0000-0000-0000000000d2');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000000001', 'CEN',    'Central',  'central'),
  ('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000000001', 'SITE-A', 'Site A',   'site'),
  ('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000000001', 'SITE-B', 'Site B',   'site'),
  ('15120000-0000-0000-0000-000000002009', '15120000-0000-0000-0000-000000000002', 'XCEN',   'X Central','central');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000a4'),
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-0000000000a5');

create function public.stk_t_as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function public.stk_t_rcv_on(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric, p_on date) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh,'occurred_on',p_on::text),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.stk_t_issue_on(p_item uuid, p_qty numeric, p_boq uuid, p_on date) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id','15120000-0000-0000-0000-000000002002','project_id','15120000-0000-0000-0000-0000000000c1','occurred_on',p_on::text),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'boq_item_id',p_boq)), true) $$;
create function public.stk_t_line(p_doc uuid) returns uuid language sql as $$
  select id from public.stock_document_lines where document_id = p_doc order by line_no limit 1 $$;
create function public.stk_t_return_on(p_src uuid, p_item uuid, p_qty numeric, p_on date) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','return','warehouse_id','15120000-0000-0000-0000-000000002002','occurred_on',p_on::text),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'source_line_id',p_src)), true) $$;
create function public.stk_t_report(p_from date, p_to date) returns jsonb language sql as $$
  select public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', p_from, p_to) $$;

-- m0 = the first day of the org's current month, m1 = the first day of the previous month.
select set_config('stk.m0', to_char(date_trunc('month', (now() at time zone 'Asia/Jakarta')::date), 'YYYY-MM-DD'), false);
select set_config('stk.m1', to_char(date_trunc('month', (now() at time zone 'Asia/Jakarta')::date) - interval '1 month', 'YYYY-MM-DD'), false);

-- A second work item on P_ON with no allowance; an allowance of 100 cable on BOQ_ON.
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15120000-0000-0000-0000-0000000000e4', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c1', 'W-1B', 'Slab edge', 'm3', 10, 1000);
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity) values
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000001002', 100);

-- Admin receives 500 cable @ 10 at SITE-A and issues 60 (day 5) and 40 (day 20) of last month to BOQ_ON (Admin may date any past day, PQ-2).
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 500, 10, current_setting('stk.m1')::date);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000001002', 60, '15120000-0000-0000-0000-0000000000e1', current_setting('stk.m1')::date + 4);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000001002', 40, '15120000-0000-0000-0000-0000000000e1', current_setting('stk.m1')::date + 19);
reset role;
-- The SITE-A keeper issues 25 (day 1 of this month) to BOQ_ON and 10 to the unplanned W-1B, then returns 5 of the 25.
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select set_config('stk.i25', public.stk_t_issue_on('15120000-0000-0000-0000-000000001002', 25, '15120000-0000-0000-0000-0000000000e1', current_setting('stk.m0')::date)::text, false);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000001002', 10, '15120000-0000-0000-0000-0000000000e4', current_setting('stk.m0')::date);
select public.stk_t_return_on(public.stk_t_line(current_setting('stk.i25')::uuid), '15120000-0000-0000-0000-000000001002', 5, current_setting('stk.m0')::date);
reset role;

select plan(21);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');                                                              -- U_PM
select set_config('stk.r', public.stk_t_report(current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27)::text, false);
select is(jsonb_path_query_array(current_setting('stk.r')::jsonb -> 'months',
          '$[*] ? (@.month == $m && @.boq_item_id == $b).net_consumed', jsonb_build_object('m', current_setting('stk.m1'), 'b', '15120000-0000-0000-0000-0000000000e1')),
  '["100"]'::jsonb, 'AC-STK-022 last month''s net for the work item is 60 + 40 = 100');
select is((select jsonb_build_object('issued', r->>'issued', 'returned', r->>'returned', 'net_consumed', r->>'net_consumed')
             from (select jsonb_path_query_first(current_setting('stk.r')::jsonb -> 'months', '$[*] ? (@.month == $m && @.boq_item_id == $b)',
                          jsonb_build_object('m', current_setting('stk.m0'), 'b', '15120000-0000-0000-0000-0000000000e1')) as r) x),
  '{"issued":"25","returned":"5","net_consumed":"20"}'::jsonb, 'AC-STK-022 this month''s row: 25 issued, 5 returned, net 20');
select is(current_setting('stk.r')::jsonb #>> '{allowances,0,net_to_date}', '120',
  'AC-STK-022 cumulative net to date equals the sum of the monthly nets (100 + 20)');
select is(current_setting('stk.r')::jsonb #>> '{allowances,0,variance}', '20', 'AC-STK-023 variance against the allowance of 100 is +20');
select is(current_setting('stk.r')::jsonb #>> '{allowances,0,over_allowance}', 'true', 'AC-STK-023 the row is flagged over allowance');
select is(jsonb_array_length(current_setting('stk.r')::jsonb -> 'unplanned'), 1,
  'AC-STK-023 one item was issued under a work item with no allowance');
select is(current_setting('stk.r')::jsonb #>> '{unplanned,0,boq_item_id}', '15120000-0000-0000-0000-0000000000e4',
  'AC-STK-023 the unplanned list names that work item');
select is(jsonb_path_exists(current_setting('stk.r')::jsonb -> 'allowances',
          '$[*] ? (@.boq_item_id == $b)', jsonb_build_object('b', '15120000-0000-0000-0000-0000000000e4')), false,
  'AC-STK-023 a work item with no allowance has no variance row and no flag (consumption only)');
select is(jsonb_path_query_array(current_setting('stk.r')::jsonb -> 'months',
          '$[*] ? (@.boq_item_id == $b).issued_by', jsonb_build_object('b', '15120000-0000-0000-0000-0000000000e1')),
  '[["STK Admin"], ["STK Keep1"]]'::jsonb, 'FR-STK-042 each month row names who issued it');
select is(current_setting('stk.r')::jsonb #>> '{months,0,net_value}', '1000.00', 'AC-STK-020 a Project Manager sees the value (60 + 40 at 10)');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');                                                              -- U_ENG
select is(jsonb_path_exists(public.stk_t_report(current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27), '$.**.net_value'), false,
  'AC-STK-020 an Engineer''s consumption report carries no value key');
reset role;
-- AC-STK-021 (report half): an Admin post dated 10 days before last month (always > 31 days ago, and a month no other row uses)
-- lands in that older month and changes no earlier ledger value
select set_config('stk.before', (select string_agg(value_after::text, ',' order by seq) from public.stock_ledger), false);
select set_config('stk.maxseq', (select max(seq)::text from public.stock_ledger), false);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.stk_t_issue_on('15120000-0000-0000-0000-000000001002', 1, '15120000-0000-0000-0000-0000000000e1', current_setting('stk.m1')::date - 10);
reset role;
select is((select string_agg(value_after::text, ',' order by seq) from public.stock_ledger where seq <= current_setting('stk.maxseq')::bigint), current_setting('stk.before'),
  'AC-STK-021 the backdated post changed no earlier ledger value (valuation follows posting order)');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select is(jsonb_path_query_array(public.stk_t_report(current_setting('stk.m1')::date - 40, current_setting('stk.m0')::date) -> 'months',
          '$[*] ? (@.month == $m).net_consumed', jsonb_build_object('m', to_char(date_trunc('month', current_setting('stk.m1')::date - 10), 'YYYY-MM-DD'))), '["1"]'::jsonb,
  'AC-STK-021 the report puts the backdated issue in its own (older) month');
-- FR-STK-044: a report that cannot compute raises; it never returns a fabricated empty report
select throws_like($$ select public.get_project_consumption('15120000-0000-0000-0000-0000000000f1', current_setting('stk.m1')::date, current_setting('stk.m0')::date) $$,
  'STK_NOT_FOUND%', 'FR-STK-044 an unknown project is an error, not an empty report');
reset role;

-- #2282 (AC-IMC-003): a connected document's consumption comes from its tied Odoo analytic lines. Quantity from the PMO line,
-- value from the ERP amount (never stock_erp_mirror.completed_value). Fixture as superuser with triggers off (0879 owns the post path).
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15120000-0000-0000-0000-0000000000e5', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c1', 'W-5', 'Connected pour', 'm3', 10, 1000);
insert into public.external_domain_ownership (org_id, external_tier, domain, created_at) values
  ('15120000-0000-0000-0000-000000000001', 'odoo', 'inventory', now() - interval '90 days');
insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
  ('15120000-0000-0000-0000-000000000001', 'odoo', 'fixture', 'fixture', 'active', '{"odoo_company_id":42}', now());
insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('15120000-0000-0000-0000-000000000001', 'stock_items', '15120000-0000-0000-0000-000000001001', 'odoo', '77');
insert into public.external_project_bindings (org_id, project_id, external_tier, external_container_id) values
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c1', 'odoo', '600');
set local session_replication_role = replica;
insert into public.stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, occurred_on, created_by, posted_by, posted_at) values
  ('15120000-0000-0000-0000-000000005001', '15120000-0000-0000-0000-000000000001', 'OI1', 'issue', 'Posted', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', current_setting('stk.m0')::date, '15120000-0000-0000-0000-0000000000a4', '15120000-0000-0000-0000-0000000000a4', now()),
  ('15120000-0000-0000-0000-000000005002', '15120000-0000-0000-0000-000000000001', 'OI2', 'issue', 'Posted', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', current_setting('stk.m0')::date, '15120000-0000-0000-0000-0000000000a4', '15120000-0000-0000-0000-0000000000a4', now());
insert into public.stock_document_lines (id, org_id, document_id, line_no, item_id, quantity, boq_item_id) values
  ('15120000-0000-0000-0000-000000006001', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000005001', 1, '15120000-0000-0000-0000-000000001001', 2, '15120000-0000-0000-0000-0000000000e5'),
  ('15120000-0000-0000-0000-000000006002', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000005002', 1, '15120000-0000-0000-0000-000000001001', 4, '15120000-0000-0000-0000-0000000000e5');
insert into public.stock_erp_mirror (org_id, stock_document_id, company_id, external_model, external_id, external_reference, state,
    completed_quantity, completed_value, source_written_at, fetched_at, command_generation) values
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000005001', 42, 'stock.picking', '9001', 'WH/OUT/9001', 'confirmed', 2, 999, now(), now(), 1),
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000005002', 42, 'stock.picking', '9002', 'WH/OUT/9002', 'held', null, null, null, now(), 1);
set local session_replication_role = origin;
create function public.stk_t_cost_row(p_line bigint, p_picking bigint, p_debit numeric, p_credit numeric, p_qty numeric, p_return_of bigint default null) returns jsonb language sql as $$
  select jsonb_build_object('analytic_line_id', p_line, 'company_id', 42, 'analytic_account_id', '600', 'picking_ref', 'WH/OUT/' || p_picking,
    'odoo_picking_id', p_picking, 'odoo_return_of', p_return_of, 'odoo_product_id', 77, 'unit_amount', p_qty, 'debit', p_debit, 'credit', p_credit,
    'account', '5100', 'posting_date', current_setting('stk.m0')::date, 'fiscal_year', '2026', 'source_write_date', '2026-11-15 08:00:00') $$;
set local role service_role;
select public.apply_odoo_stock_cost_page('15120000-0000-0000-0000-000000000001', jsonb_build_array(
  public.stk_t_cost_row(701, 9001, 240, 0, 2),                       -- the connected issue of 2 at 240
  public.stk_t_cost_row(702, 9101, 0, 120, -1, 9001),                -- an Odoo return of 1
  public.stk_t_cost_row(703, 8000, 50, 0, 1),                        -- issued directly in Odoo (no document)
  public.stk_t_cost_row(704, 9002, 400, 0, 4)), '');                 -- a held transfer
reset role;

select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');                                                              -- U_PM (cost)
select set_config('stk.c', public.stk_t_report(current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27)::text, false);
select is((select jsonb_build_object('issued', r->>'issued', 'returned', r->>'returned', 'net_consumed', r->>'net_consumed', 'net_value', r->>'net_value')
             from (select jsonb_path_query_first(current_setting('stk.c')::jsonb -> 'months', '$[*] ? (@.boq_item_id == $b)',
                          jsonb_build_object('b', '15120000-0000-0000-0000-0000000000e5')) as r) x),
  '{"issued":"2","returned":"1","net_consumed":"1","net_value":"120.00"}'::jsonb,
  'AC-IMC-003 a connected issue shows the PMO quantity and the ERP amount; the Odoo return reduces both; the held transfer shows nothing');
select is(jsonb_path_query_array(current_setting('stk.c')::jsonb -> 'erp_unattributed', '$[*].picking_ref'), '["WH/OUT/8000"]'::jsonb,
  'AC-IMC-003 an issue made in Odoo with no document is listed, never dropped');
select is(current_setting('stk.c')::jsonb #>> '{erp_unattributed,0,value}', '50.00', 'AC-IMC-003 a cost-permitted member sees its value');
reset role;
select is((select count(*)::int from public.stock_documents d
            where exists (select 1 from public.stock_ledger l where l.document_id = d.id)
              and exists (select 1 from public.stock_erp_mirror m where m.stock_document_id = d.id)), 0,
  'AC-IMC-003 no document is in both the standalone and the connected branch');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');                                                              -- U_ENG (no cost)
select set_config('stk.e', public.stk_t_report(current_setting('stk.m1')::date, current_setting('stk.m0')::date + 27)::text, false);
select is(jsonb_path_query_first(current_setting('stk.e')::jsonb -> 'months', '$[*] ? (@.boq_item_id == $b).issued',
          jsonb_build_object('b', '15120000-0000-0000-0000-0000000000e5')), '"2"'::jsonb, 'AC-IMC-003 a member without cost permission sees the quantity');
select is(jsonb_path_exists(current_setting('stk.e')::jsonb, '$.**.value') or jsonb_path_exists(current_setting('stk.e')::jsonb, '$.**.net_value'), false,
  'AC-IMC-003 and no amount anywhere in the report');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');
select throws_like($$ select public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_setting('stk.m1')::date, current_setting('stk.m0')::date) $$,
  'STK_NOT_FOUND%', 'AC-IMC-003 a foreign-org member still cannot read the project');
reset role;
select * from finish();
rollback;
