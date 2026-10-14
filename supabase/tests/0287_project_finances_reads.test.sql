begin;
create extension if not exists pgtap;
select plan(14);

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

insert into public.organizations (id,name) values
  ('02870000-0000-0000-0000-000000000002','Foreign project finance read org');
insert into auth.users (id,email) values ('02870000-0000-0000-0000-0000000000a1','reader@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
  ('02870000-0000-0000-0000-0000000000a1','02870000-0000-0000-0000-000000000001','Finance','reader@example.test','Finance','active');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref)
values
  ('02870000-0000-0000-0000-0000000000d3','02870000-0000-0000-0000-000000000001','No Reading','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'READ-EMPTY'),
  ('02870000-0000-0000-0000-0000000000d4','02870000-0000-0000-0000-000000000002','Foreign Project','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'READ-FOREIGN');
set local request.jwt.claims='{}';
set local role service_role;
insert into public.budget_category_account_map (org_id,category,erp_account,is_push_target) values
  ('02870000-0000-0000-0000-000000000001','Labor','ACC-LABOR-A',true),
  ('02870000-0000-0000-0000-000000000001','Labor','ACC-LABOR-B',false),
  ('02870000-0000-0000-0000-000000000001','Materials','ACC-MATERIALS',true),
  ('02870000-0000-0000-0000-000000000001','Equipment','ACC-EQUIPMENT',true),
  ('02870000-0000-0000-0000-000000000001','Contingency','ACC-NULL',true);
insert into public.erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at)
values
  ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','ACC-LABOR-A','FY-OLD',999,'2026-01-01','02870000-0000-0000-0000-0000000000b1','2026-01-01'),
  ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','ACC-LABOR-A','FY-2026',20,'2026-10-01','02870000-0000-0000-0000-0000000000b2','2026-10-02'),
  ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','ACC-LABOR-B','FY-2026',30,'2026-10-01','02870000-0000-0000-0000-0000000000b2','2026-10-02'),
  ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','ACC-LABOR-A',null,4,'2026-10-01','02870000-0000-0000-0000-0000000000b2','2026-10-02'),
  ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','ACC-MATERIALS','FY-2026',7,'2026-10-01','02870000-0000-0000-0000-0000000000b2','2026-10-02'),
  ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','ACC-NULL','FY-2026',null,'2026-10-01','02870000-0000-0000-0000-0000000000b2','2026-10-02'),
  ('02870000-0000-0000-0000-000000000002','02870000-0000-0000-0000-0000000000d4','ACC-LABOR-A','FY-2026',9000,'2026-10-03','02870000-0000-0000-0000-0000000000b3','2026-10-04'),
  ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d2','ACC-LABOR-A','FY-2026',6000,'2026-10-03','02870000-0000-0000-0000-0000000000b2','2026-10-02');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select actuals_to_date from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d1',null) where category='Labor'),
          54::numeric,'AC-PFIN-011 current lifetime Labor sums all mapped accounts and NULL-year facts, excluding old/foreign/project readings');
select is((select actuals_to_date from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d1',null) where category='Materials'),
          7::numeric,'AC-PFIN-011 current mapped Materials reads its project amount');
select is((select actuals_as_of from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d1',null) limit 1),
          '2026-10-01'::timestamptz,'AC-PFIN-011 reading date comes from the current project generation');
select is((select actuals_to_date from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d1',null) where category='Equipment'),
          0::numeric,'AC-PFIN-011 mapped category with a real current reading but no entries is known zero');
select is((select actuals_to_date from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d1',null) where category='Subcontractors'),
          null::numeric,'AC-PFIN-011 unmapped category is unavailable rather than zero');
select is((select actuals_to_date from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d3',null) where category='Labor'),
          null::numeric,'AC-PFIN-011 project without a current reading does not inherit another project reading');
select is((select actuals_to_date from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d1',null) where category='Contingency'),
          null::numeric,'AC-PFIN-011 a mapped category with a NULL net withholds its total');
select is((select source_sum from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d1','FY-2026') where category='Labor'),
          50::numeric,'AC-PFIN-018 explicit-year mapped actuals exclude NULL-year and other-year facts');
select ok(pg_get_functiondef('public.get_budget_projection(uuid,text)'::regprocedure) like '%project_mapped_actuals%',
          'AC-PFIN-018 projection delegates its shared account mapping and reading definition');

select * from finish();
rollback;
