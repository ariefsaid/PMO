begin;
create extension if not exists pgtap;
-- #2282 issued material cost through the ledger feed (AC-IMC-001, 002, 004, 006). Plan docs/plans/2026-11-15-2282-issued-material-cost.md.

insert into organizations (id, name, default_currency, default_timezone) values
  ('22820000-0000-0000-0000-000000000001', 'IMC Org',   'IDR', 'Asia/Jakarta'),
  ('22820000-0000-0000-0000-000000000002', 'IMC Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('22820000-0000-0000-0000-0000000000a1', 'imc-admin@example.com'),
  ('22820000-0000-0000-0000-0000000000a3', 'imc-pm@example.com'),
  ('22820000-0000-0000-0000-0000000000b1', 'imc-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-000000000001', 'IMC Admin', 'imc-admin@example.com', 'Admin', 'active'),
  ('22820000-0000-0000-0000-0000000000a3', '22820000-0000-0000-0000-000000000001', 'IMC PM',    'imc-pm@example.com',    'Project Manager', 'active'),
  ('22820000-0000-0000-0000-0000000000b1', '22820000-0000-0000-0000-000000000002', 'IMC XOrg',  'imc-xorg@example.com',  'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('22820000-0000-0000-0000-0000000000f1', '22820000-0000-0000-0000-000000000001', 'IMC Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('22820000-0000-0000-0000-0000000000c1', '22820000-0000-0000-0000-000000000001', 'IMC Project', 'Ongoing Project', 1000000, 'exclusive', 0, '22820000-0000-0000-0000-0000000000f1', '22820000-0000-0000-0000-0000000000a3');
insert into stock_units (id, org_id, code, name, whole_only) values
  ('22820000-0000-0000-0000-0000000000d1', '22820000-0000-0000-0000-000000000001', 'bag', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('22820000-0000-0000-0000-000000001001', '22820000-0000-0000-0000-000000000001', 'CEM', 'Cement', '22820000-0000-0000-0000-0000000000d1'),
  ('22820000-0000-0000-0000-000000001002', '22820000-0000-0000-0000-000000000001', 'CAB', 'Cable',  '22820000-0000-0000-0000-0000000000d1');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('22820000-0000-0000-0000-000000002002', '22820000-0000-0000-0000-000000000001', 'SITE-A', 'Site A', 'site');

insert into public.external_domain_ownership (org_id, external_tier, domain, created_at) values
  ('22820000-0000-0000-0000-000000000001', 'odoo', 'inventory', now() - interval '30 days'),
  ('22820000-0000-0000-0000-000000000002', 'odoo', 'inventory', now() - interval '30 days');
-- Connected fixture, as superuser with triggers off (the documents' posting path is 0879's, proven in odoo_stock_posting.test.sql).
set local session_replication_role = replica;
insert into public.stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, occurred_on, created_by, posted_by, posted_at) values
  ('22820000-0000-0000-0000-000000003001', '22820000-0000-0000-0000-000000000001', 'I1', 'issue', 'Posted', '22820000-0000-0000-0000-000000002002', '22820000-0000-0000-0000-0000000000c1', current_date, '22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000a1', now()),
  ('22820000-0000-0000-0000-000000003002', '22820000-0000-0000-0000-000000000001', 'I2', 'issue', 'Posted', '22820000-0000-0000-0000-000000002002', '22820000-0000-0000-0000-0000000000c1', current_date, '22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000a1', now()),
  ('22820000-0000-0000-0000-000000003003', '22820000-0000-0000-0000-000000000001', 'I3', 'issue', 'Draft',  '22820000-0000-0000-0000-000000002002', '22820000-0000-0000-0000-0000000000c1', current_date, '22820000-0000-0000-0000-0000000000a1', null, null);
insert into public.stock_document_lines (id, org_id, document_id, line_no, item_id, quantity) values
  ('22820000-0000-0000-0000-000000004001', '22820000-0000-0000-0000-000000000001', '22820000-0000-0000-0000-000000003001', 1, '22820000-0000-0000-0000-000000001001', 2),
  ('22820000-0000-0000-0000-000000004002', '22820000-0000-0000-0000-000000000001', '22820000-0000-0000-0000-000000003002', 1, '22820000-0000-0000-0000-000000001001', 1),
  ('22820000-0000-0000-0000-000000004003', '22820000-0000-0000-0000-000000000001', '22820000-0000-0000-0000-000000003002', 2, '22820000-0000-0000-0000-000000001001', 1),
  ('22820000-0000-0000-0000-000000004004', '22820000-0000-0000-0000-000000000001', '22820000-0000-0000-0000-000000003003', 1, '22820000-0000-0000-0000-000000001001', 1);
insert into public.stock_erp_mirror (org_id, stock_document_id, company_id, external_model, external_id, external_reference, state,
    completed_quantity, completed_value, source_written_at, fetched_at, command_generation) values
  ('22820000-0000-0000-0000-000000000001', '22820000-0000-0000-0000-000000003001', 42, 'stock.picking', '9001', 'WH/OUT/9001', 'confirmed', 2, 999, now(), now(), 1),
  ('22820000-0000-0000-0000-000000000001', '22820000-0000-0000-0000-000000003002', 42, 'stock.picking', '9002', 'WH/OUT/9002', 'confirmed', 2, 999, now(), now(), 1),
  ('22820000-0000-0000-0000-000000000001', '22820000-0000-0000-0000-000000003003', 42, 'stock.picking', '9003', 'WH/OUT/9003', 'pending', null, null, null, now(), 1);
set local session_replication_role = origin;
insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('22820000-0000-0000-0000-000000000001', 'stock_items', '22820000-0000-0000-0000-000000001001', 'odoo', '77');
insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
  ('22820000-0000-0000-0000-000000000001', 'odoo', 'fixture', 'fixture', 'active', '{"odoo_company_id":42}', now()),
  ('22820000-0000-0000-0000-000000000002', 'odoo', 'fixture', 'fixture', 'active', '{"odoo_company_id":43}', now());

create function public.imc_t_as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.imc_t_row(p_line bigint, p_picking bigint, p_debit numeric, p_credit numeric, p_qty numeric,
                                 p_write text default '2026-11-15 08:00:00', p_company int default 42, p_return_of bigint default null,
                                 p_posting date default current_date, p_account_id text default '600') returns jsonb language sql as $$
  select jsonb_build_object('analytic_line_id', p_line, 'company_id', p_company, 'analytic_account_id', p_account_id,
    'picking_ref', 'WH/OUT/' || p_picking, 'odoo_picking_id', p_picking, 'odoo_return_of', p_return_of, 'odoo_product_id', 77,
    'unit_amount', p_qty, 'debit', p_debit, 'credit', p_credit, 'account', '5100', 'posting_date', p_posting, 'fiscal_year', '2026',
    'source_write_date', p_write) $$;
create function public.imc_t_apply(p_org uuid, p_rows jsonb) returns integer language plpgsql as $$
declare v int;
begin
  execute 'set local role service_role';
  v := public.apply_odoo_stock_cost_page(p_org, p_rows, '{"w":"2026-11-15 08:00:00","id":1}');
  execute 'reset role';
  return v;
end $$;
create function public.imc_t_state(p_line bigint) returns text language sql as $$
  select tie_state from public.odoo_stock_cost_lines where org_id = '22820000-0000-0000-0000-000000000001' and analytic_line_id = p_line $$;

select plan(31);

-- AC-IMC-006: the table, its RLS and its grants (read from the catalog, not from the policy text).
select has_table('public', 'odoo_stock_cost_lines', 'AC-IMC-006 the side table exists');
select is((select relforcerowsecurity from pg_class where oid = 'public.odoo_stock_cost_lines'::regclass), true, 'AC-IMC-006 RLS is forced');
select is((select count(*)::int from information_schema.column_privileges where table_schema = 'public' and table_name = 'odoo_stock_cost_lines'
            and grantee = 'authenticated' and column_name in ('debit','credit')), 0, 'AC-IMC-006 members cannot select the amounts');
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'odoo_stock_cost_lines'
            and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE')), 0, 'AC-IMC-006 no member write grant on the table');
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'odoo_stock_cost_lines'
            and grantee = 'service_role' and privilege_type in ('INSERT','UPDATE','DELETE')), 0, 'AC-IMC-006 even the service role writes only through the definer functions');
select is(has_function_privilege('authenticated', 'public.apply_odoo_stock_cost_page(uuid,jsonb,text)', 'execute')
       or has_function_privilege('authenticated', 'public.mark_odoo_stock_cost_census_seen(uuid,timestamptz,text[])', 'execute')
       or has_function_privilege('authenticated', 'public.finish_odoo_stock_cost_census(uuid,timestamptz,integer)', 'execute')
       or has_function_privilege('authenticated', 'public.mark_odoo_stock_cost_double_counts(uuid,bigint[])', 'execute')
       or has_function_privilege('authenticated', 'public.record_odoo_stock_cost_check(uuid,timestamptz,jsonb,text,text,integer,integer)', 'execute')
       or has_function_privilege('authenticated', 'public.odoo_stock_cost_tie(uuid,integer,bigint,text,bigint,boolean)', 'execute')
       or has_function_privilege('authenticated', 'public.project_consumption_moves(uuid,uuid)', 'execute'), false,
  'AC-IMC-006 no member (any role) can execute a writer or a definer helper');
select public.imc_t_as_user('22820000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.apply_odoo_stock_cost_page('22820000-0000-0000-0000-000000000001', '[]', '') $$, '42501', null,
  'AC-IMC-006 an Admin calling the writer is refused');
reset role;

-- AC-IMC-001: apply with the server-side tie.
select is(public.imc_t_apply('22820000-0000-0000-0000-000000000001', jsonb_build_array(
    public.imc_t_row(501, 9001, 240, 0, 2),                         -- the issue of document I1
    public.imc_t_row(502, 9002, 120, 0, 2),                         -- I2 has two lines of the same item
    public.imc_t_row(503, 8000, 50, 0, 1),                          -- issued directly in Odoo
    public.imc_t_row(504, 9003, 30, 0, 1),                          -- I3's transfer is not yet confirmed
    public.imc_t_row(505, 9101, 0, 120, -1, p_return_of => 9001),   -- an Odoo return of 1 from I1
    public.imc_t_row(506, 9001, 70, 0, 1, p_posting => current_date - 40)))  -- before the inventory ownership start
  , 5, 'AC-IMC-001 five rows stored; the line before the ownership start is not');
select is((select (stock_document_id, stock_document_line_id, tie_state)::text from public.odoo_stock_cost_lines where analytic_line_id = 501),
  '(22820000-0000-0000-0000-000000003001,22820000-0000-0000-0000-000000004001,tied)', 'AC-IMC-001 the line ties to its document and its single line');
select is(public.imc_t_state(502), 'ambiguous', 'AC-IMC-001 two lines of the same item cannot be tied: ambiguous');
select is(public.imc_t_state(503), 'no-document', 'AC-IMC-001 an issue made in Odoo has no document');
select is(public.imc_t_state(504), 'pending', 'AC-IMC-001 an unconfirmed transfer is pending');
select is((select (stock_document_line_id, tie_state)::text from public.odoo_stock_cost_lines where analytic_line_id = 505),
  '(22820000-0000-0000-0000-000000004001,return)', 'AC-IMC-004 an Odoo return ties to the original line');
select is((select count(*)::int from public.odoo_stock_cost_lines where analytic_line_id = 506), 0, 'AC-IMC-001 the standalone-epoch line is not stored (D10)');
select is((select (debit, credit)::text from public.odoo_stock_cost_lines where analytic_line_id = 501), '(240.00,0.00)', 'AC-IMC-001 the amount is Odoo''s, stored once');
select is(public.imc_t_apply('22820000-0000-0000-0000-000000000001', jsonb_build_array(public.imc_t_row(501, 9001, 240, 0, 2))), 0,
  'AC-IMC-001 reapplying the same line changes nothing');
select is((select watermark_cursor from public.external_sync_watermarks where org_id = '22820000-0000-0000-0000-000000000001' and domain = 'ledger-stock-cost:odoo'),
  '{"w":"2026-11-15 08:00:00","id":1}', 'AC-IMC-001 the page stores its own cursor domain');

-- The company comes from the binding: a page with a line of another company is refused whole.
select throws_like($$ select public.imc_t_apply('22820000-0000-0000-0000-000000000001', jsonb_build_array(
    public.imc_t_row(510, 9001, 1, 0, 1), public.imc_t_row(511, 9001, 1, 0, 1, p_company => 43))) $$,
  'OSC_COMPANY%', 'AC-IMC-006 a line of another company refuses the page');
reset role;
select is((select count(*)::int from public.odoo_stock_cost_lines where analytic_line_id in (510, 511)), 0, 'AC-IMC-006 nothing of the refused page is written');

-- AC-IMC-004: a correction replaces the amount; the tie re-resolves once the transfer is confirmed.
select is(public.imc_t_apply('22820000-0000-0000-0000-000000000001', jsonb_build_array(public.imc_t_row(501, 9001, 360, 0, 3, p_write => '2026-11-15 09:00:00'))), 1,
  'AC-IMC-004 a new write date replaces the row');
select is((select (debit, unit_amount)::text from public.odoo_stock_cost_lines where analytic_line_id = 501), '(360.00,3.000)', 'AC-IMC-004 the corrected amount and quantity are stored');
update public.stock_erp_mirror set state = 'confirmed', completed_quantity = 1, completed_value = 30, source_written_at = now()
 where stock_document_id = '22820000-0000-0000-0000-000000003003';
select public.imc_t_apply('22820000-0000-0000-0000-000000000001', '[]');
select is(public.imc_t_state(504), 'tied', 'AC-IMC-001 a line read before its transfer was confirmed ties on a later page');

-- AC-IMC-004: the census cancels a line Odoo no longer has, and an incomplete census changes nothing.
update public.odoo_stock_cost_lines set source_write_date = '2026-01-01 00:00:00' where org_id = '22820000-0000-0000-0000-000000000001';
set local role service_role;
select public.mark_odoo_stock_cost_census_seen('22820000-0000-0000-0000-000000000001', '2026-11-15 10:00:00+00', array['501','502','503','504']);
select throws_like($$ select public.finish_odoo_stock_cost_census('22820000-0000-0000-0000-000000000001', '2026-11-15 10:00:00+00', 5) $$,
  'stock cost census saw 4 lines, expected 5%', 'AC-IMC-004 a census that stopped early is refused');
select is(public.finish_odoo_stock_cost_census('22820000-0000-0000-0000-000000000001', '2026-11-15 10:00:00+00', 4), 1, 'AC-IMC-004 the finished census cancels one row');
reset role;
select is((select is_cancelled from public.odoo_stock_cost_lines where analytic_line_id = 505), true, 'AC-IMC-004 the deleted analytic line is cancelled, not deleted');

-- AC-IMC-005: the double-count flag is the check's full answer.
set local role service_role;
select is(public.mark_odoo_stock_cost_double_counts('22820000-0000-0000-0000-000000000001', array[503::bigint]), 1, 'AC-IMC-005 a flagged line is marked');
reset role;
select is((select double_count_risk from public.odoo_stock_cost_lines where analytic_line_id = 503), true, 'AC-IMC-005 the flag is stored');

-- AC-IMC-006: another org's member reads nothing; a member reads the tie but not the amount.
select public.imc_t_as_user('22820000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.odoo_stock_cost_lines), 0, 'AC-IMC-006 a foreign-org member selects no row');
reset role;
select public.imc_t_as_user('22820000-0000-0000-0000-0000000000a1');
select throws_ok($$ select debit from public.odoo_stock_cost_lines $$, '42501', null, 'AC-IMC-006 an Admin cannot select an amount column');
reset role;

-- AC-IMC-002 / #2282 required: a cost line on an account that maps to NO budget category is shown as uncategorised with its amount and
-- is never dropped from the project's actuals.
insert into public.budget_category_account_map (org_id, category, erp_account) values ('22820000-0000-0000-0000-000000000001', 'Materials', '5100');
insert into public.erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, source_report, snapshot_id) values
  ('22820000-0000-0000-0000-000000000001', '22820000-0000-0000-0000-0000000000c1', '5100', '2026', 100, 0, 100, 'GL Entry',        '22820000-0000-0000-0000-00000000aaaa'),
  ('22820000-0000-0000-0000-000000000001', '22820000-0000-0000-0000-0000000000c1', '5999', '2026', 240, 0, 240, 'Odoo stock issue', '22820000-0000-0000-0000-00000000aaaa');
select public.imc_t_as_user('22820000-0000-0000-0000-0000000000a1');
select is((select jsonb_agg(jsonb_build_object('account', account, 'source', source_report, 'amount', amount))
             from public.project_uncategorised_actuals('22820000-0000-0000-0000-0000000000c1', '2026')),
  '[{"account":"5999","source":"Odoo stock issue","amount":240.00}]'::jsonb,
  'AC-IMC-002 an issued-material cost on an unmapped account is shown as uncategorised with its amount');
select is((select sum(actuals_to_date) from public.project_mapped_actuals('22820000-0000-0000-0000-0000000000c1', '2026'))
          + (select sum(amount) from public.project_uncategorised_actuals('22820000-0000-0000-0000-0000000000c1', '2026')),
  (select sum(net) from public.erp_actuals_snapshot where project_id = '22820000-0000-0000-0000-0000000000c1'),
  'AC-IMC-002 categorised plus uncategorised equals every snapshot cent of the project: nothing is dropped');
reset role;

select * from finish();
rollback;
