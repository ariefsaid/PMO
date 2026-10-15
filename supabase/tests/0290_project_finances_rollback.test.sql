begin;
create extension if not exists pgtap;
select plan(9);

insert into public.organizations (id,name) values
  ('02900000-0000-0000-0000-000000000001','Project finance rollback test org');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref)
values ('02900000-0000-0000-0000-0000000000d1','02900000-0000-0000-0000-000000000001',
        'Rollback project','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'ROLLBACK-TEST');
insert into public.sales_invoices (id,org_id,project_id,erp_project,si_number,invoice_date,amount,tax_treatment,tax_amount,
                                   currency,status,erp_docstatus)
values ('02900000-0000-0000-0000-0000000000e1','02900000-0000-0000-0000-000000000001',
        '02900000-0000-0000-0000-0000000000d1','ERP-PROJECT','SI-ROLLBACK','2026-01-01',10,'exclusive',0,
        'USD','Unpaid',1);
insert into public.record_changes (org_id,entity_type,entity_id,parent_type,parent_id,op,actor_id,changes)
values ('02900000-0000-0000-0000-000000000001','sales_invoice','02900000-0000-0000-0000-0000000000e1',
        'project','02900000-0000-0000-0000-0000000000d1','update',null,
        '{"project_id":{"old":null,"new":"02900000-0000-0000-0000-0000000000d1"}}'),
       ('02900000-0000-0000-0000-000000000001','sales_invoice','02900000-0000-0000-0000-0000000000e1',
        'project','02900000-0000-0000-0000-0000000000d1','update',null,
        '{"project_id":{"old":"02900000-0000-0000-0000-0000000000d2","new":"02900000-0000-0000-0000-0000000000d1"}}');

\set pfin_embedded 1
\ir 0290_project_finances_down_runner.sql
select throws_ok('select pg_temp.run_pfin_down()','P0001',null,
                 'AC-PFIN-008 rollback refuses provenance loss before DDL');
select has_column('public','sales_invoices','erp_project','AC-PFIN-008 failed rollback leaves provenance in place');
select has_function('public','get_project_finances','{uuid}','AC-PFIN-014 failed rollback leaves finance RPC in place');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
update public.sales_invoices set erp_project=null where id='02900000-0000-0000-0000-0000000000e1';
reset role;
select lives_ok('select pg_temp.run_pfin_down()','AC-PFIN-006 rollback preserves attribution after provenance export');
select col_is_null('public','sales_invoices','project_id','AC-PFIN-006 rollback retains the established project attribution column');
select is((select project_id::text from public.sales_invoices where id='02900000-0000-0000-0000-0000000000e1'),
          '02900000-0000-0000-0000-0000000000d1','AC-PFIN-006 rollback preserves the assigned project');
select is((select count(*)::int from public.record_changes where entity_type='sales_invoice'
            and entity_id='02900000-0000-0000-0000-0000000000e1' and op='update'),2,
          'AC-PFIN-008 rollback preserves both attribution history events');
select ok(to_regprocedure('public.get_project_finances(uuid)') is null
          and to_regprocedure('public.project_mapped_actuals(uuid,text)') is null
          and to_regprocedure('public.assign_sales_invoice_project(uuid,uuid)') is null
          and to_regprocedure('public.fill_sales_invoice_project(uuid,uuid,uuid,text)') is null,
          'AC-PFIN-014 rollback removes only the 0290 RPC surfaces');
select ok(position('project_mapped_actuals' in pg_get_functiondef('public.get_budget_projection(uuid,text)'::regprocedure))=0
          and position('erp_project' in pg_get_functiondef('public.sales_invoices_native_mirror_guard()'::regprocedure))=0,
          'AC-PFIN-014 rollback restores the prior budget projection and invoice guard');
select * from finish();
rollback;
