-- 0704 rollback (#1817): refused while a native invoice shares an id with a T&M claim; otherwise drops the RPC and restores the
-- work-order fence as 0262 shipped it.
begin;
create extension if not exists pgtap;
select plan(7);

insert into organizations (id, name) values ('17040000-0000-0000-0000-0000000000a1', 'TMN rollback org');
insert into auth.users (id, email) values ('17040000-0000-0000-0000-0000000000b1', 'tmn-rb@example.com');
insert into profiles (id, org_id, full_name, email, role, status)
values ('17040000-0000-0000-0000-0000000000b1', '17040000-0000-0000-0000-0000000000a1', 'TMN RB', 'tmn-rb@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values ('17040000-0000-0000-0000-0000000000cc', '17040000-0000-0000-0000-0000000000a1', 'Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id)
values ('17040000-0000-0000-0000-0000000000c1', '17040000-0000-0000-0000-0000000000a1', 'P', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0, 0, 1, 1, false, '17040000-0000-0000-0000-0000000000cc');
insert into tm_claims (id, org_id, project_id, prepared_by, period_from, period_to, status, currency, gross_amount)
values ('17040000-0000-0000-0000-0000000000e1', '17040000-0000-0000-0000-0000000000a1', '17040000-0000-0000-0000-0000000000c1', '17040000-0000-0000-0000-0000000000b1', '2026-10-01', '2026-10-31', 'Draft', 'IDR', 0);
insert into sales_invoices (id, org_id, project_id, customer_id, native_lines, amount, currency, tax_treatment, tax_rate, tax_amount,
                            tax_base_numerator, tax_base_denominator, status, pmo_native)
values ('17040000-0000-0000-0000-0000000000e1', '17040000-0000-0000-0000-0000000000a1', '17040000-0000-0000-0000-0000000000c1', '17040000-0000-0000-0000-0000000000cc',
        '[{"item_code":null,"description":"x","qty":1,"rate":10,"amount":10}]', 10, 'IDR', 'exclusive', 0, 0, 1, 1, 'Draft', true);

\set tmn_embedded 1
\ir 0704_native_tm_invoice_down_runner.sql
select throws_ok('select pg_temp.run_tmn_down()', 'P0001', null, 'NFR-005 rollback refuses while a native invoice shares an id with a T&M claim');
select ok(to_regprocedure('public.create_native_tm_invoice(uuid)') is not null, 'NFR-005 a refused rollback leaves the RPC in place');
delete from sales_invoices where id = '17040000-0000-0000-0000-0000000000e1';
select lives_ok('select pg_temp.run_tmn_down()', 'NFR-005 rollback runs once no such invoice remains');
select ok(to_regprocedure('public.create_native_tm_invoice(uuid)') is null, 'NFR-005 rollback drops the RPC');
select ok(position('native_tm_invoice' in pg_get_functiondef('public.assert_sales_invoice_within_work_order()'::regprocedure)) = 0,
          'NFR-005 rollback restores the work-order fence without the marker exception');
select ok(not has_function_privilege('authenticated', 'public.assert_sales_invoice_within_work_order()', 'execute')
          and not has_function_privilege('anon', 'public.assert_sales_invoice_within_work_order()', 'execute'),
          'NFR-005 rollback leaves the fence unreachable to clients');
select ok(exists (select 1 from tm_claims where id = '17040000-0000-0000-0000-0000000000e1'), 'NFR-005 rollback keeps the claim');
select * from finish();
rollback;
