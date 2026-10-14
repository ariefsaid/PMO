begin;
create extension if not exists pgtap;
select plan(5);

insert into public.organizations (id,name) values
  ('02870000-0000-0000-0000-000000000001','Project finance read test org');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref)
values
  ('02870000-0000-0000-0000-0000000000d1','02870000-0000-0000-0000-000000000001','Project One','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'READ-ONE'),
  ('02870000-0000-0000-0000-0000000000d2','02870000-0000-0000-0000-000000000001','Project Two','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'READ-TWO');

select ok(not exists (select 1 from information_schema.columns where table_schema='public'
                       and table_name='incoming_payments' and column_name='project_id'),
          'AC-PFIN-005 incoming receipts have no duplicated project attribution');
select ok(to_regclass('public.sales_invoice_allocations') is null,
          'AC-PFIN-005 no receipt-allocation relation is introduced');

set local request.jwt.claims = '{}';
set local role service_role;
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,tax_treatment,tax_amount,
                                   currency,status,erp_docstatus)
values ('02870000-0000-0000-0000-0000000000e1','02870000-0000-0000-0000-000000000001',
        '02870000-0000-0000-0000-0000000000d1','SI-RECEIPT-LINK','2026-01-01',100,'exclusive',0,'USD','Unpaid',1);
insert into public.incoming_payments (id,org_id,sales_invoice_id,ip_number,amount,status,erp_docstatus)
values ('02870000-0000-0000-0000-0000000000f1','02870000-0000-0000-0000-000000000001',
        '02870000-0000-0000-0000-0000000000e1','IP-LINKED',50,'Paid',1),
       ('02870000-0000-0000-0000-0000000000f2','02870000-0000-0000-0000-000000000001',
        null,'IP-ON-ACCOUNT',20,'Paid',1);
reset role;

select is((select si.project_id::text from public.incoming_payments ip
           join public.sales_invoices si on si.id=ip.sales_invoice_id and si.org_id=ip.org_id
           where ip.id='02870000-0000-0000-0000-0000000000f1'),
          '02870000-0000-0000-0000-0000000000d1','AC-PFIN-005 linked receipt derives its initial project through the invoice');
set local role service_role;
update public.sales_invoices set project_id='02870000-0000-0000-0000-0000000000d2'
 where id='02870000-0000-0000-0000-0000000000e1';
reset role;
select is((select si.project_id::text from public.incoming_payments ip
           join public.sales_invoices si on si.id=ip.sales_invoice_id and si.org_id=ip.org_id
           where ip.id='02870000-0000-0000-0000-0000000000f1'),
          '02870000-0000-0000-0000-0000000000d2','AC-PFIN-005 linked receipt follows invoice reassignment without a receipt write');
select is((select si.project_id from public.incoming_payments ip
           left join public.sales_invoices si on si.id=ip.sales_invoice_id and si.org_id=ip.org_id
           where ip.id='02870000-0000-0000-0000-0000000000f2'),
          null::uuid,'AC-PFIN-005 on-account receipt has no derived project');

select * from finish();
rollback;
