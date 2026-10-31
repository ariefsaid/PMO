begin;
create extension if not exists pgtap;
select plan(14);

insert into public.organizations (id,name) values ('04080000-0000-0000-0000-000000000001','Billing kinds rollback test org');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref)
values ('04080000-0000-0000-0000-0000000000d1','04080000-0000-0000-0000-000000000001','Rollback project','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'BK-ROLLBACK');
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,tax_treatment,tax_amount,
                                   currency,status,erp_docstatus,billing_kind)
values ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1','SI-BK-ROLLBACK','2026-01-01',10,'exclusive',0,'USD','Unpaid',1,'other');

\set bk_embedded 1
\ir 0408_billing_kinds_down_runner.sql
select throws_ok('select pg_temp.run_bk_down()','P0001',null,
                 'NFR-005 rollback refuses while Other billing exists');
select has_column('public','sales_invoices','billing_kind','NFR-005 a refused rollback leaves the column in place');
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e1'),'other','NFR-005 a refused rollback keeps the Other classification');
update public.sales_invoices set billing_kind='contract' where id='04080000-0000-0000-0000-0000000000e1';
select lives_ok('select pg_temp.run_bk_down()','NFR-005 rollback runs once no Other billing remains');
select hasnt_column('public','sales_invoices','billing_kind','NFR-005 rollback removes the column');
select ok(to_regprocedure('public.assign_sales_invoice_project(uuid,uuid)') is not null
          and to_regprocedure('public.assign_sales_invoice_project(uuid,uuid,text)') is null,
          'NFR-005 rollback restores the two-argument assignment RPC');
select ok(to_regprocedure('public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)') is not null
          and to_regprocedure('public.create_native_sales_invoice(uuid,uuid,jsonb,uuid,text)') is null,
          'NFR-005 rollback restores the four-argument native create RPC');
select ok(to_regprocedure('public.set_sales_invoice_billing_kind(uuid,text)') is null,
          'NFR-005 rollback removes the kind setter');
select ok(not exists (select 1 from public.record_history_config where entity_type='sales_invoice' and captured ? 'billing_kind'),
          'NFR-005 rollback unclassifies the column in record history');
select ok(position('billing_kind' in pg_get_functiondef('public.sales_invoices_native_mirror_guard()'::regprocedure))=0,
          'NFR-005 rollback restores the mirror guard without the kind pin');
select ok(position('billing_kind' in pg_get_functiondef('public.get_project_finances(uuid)'::regprocedure))=0
          and position('contract_excess' in pg_get_functiondef('public.get_project_finances(uuid)'::regprocedure))=0,
          'NFR-005 rollback restores the prior finance aggregate');
select ok(has_function_privilege('authenticated','public.assign_sales_invoice_project(uuid,uuid)','execute')
          and not has_function_privilege('anon','public.assign_sales_invoice_project(uuid,uuid)','execute')
          and has_function_privilege('authenticated','public.get_project_finances(uuid)','execute')
          and not has_function_privilege('anon','public.get_project_finances(uuid)','execute'),
          'NFR-005 rollback restores the prior grants');
select ok(not has_function_privilege('anon','public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)','execute')
          and has_function_privilege('authenticated','public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)','execute'),
          'NFR-005 rollback restores the prior native create grants');
select ok(exists (select 1 from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e1'),
          'NFR-005 rollback keeps the invoice itself');
select * from finish();
rollback;
