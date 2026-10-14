begin;
create extension if not exists pgtap;
select plan(43);

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
insert into auth.users (id,email) values
  ('02870000-0000-0000-0000-0000000000a2','admin-reader@example.test'),
  ('02870000-0000-0000-0000-0000000000a3','executive-reader@example.test'),
  ('02870000-0000-0000-0000-0000000000a4','manager-reader@example.test'),
  ('02870000-0000-0000-0000-0000000000a5','engineer-reader@example.test'),
  ('02870000-0000-0000-0000-0000000000a6','inactive-reader@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
  ('02870000-0000-0000-0000-0000000000a1','02870000-0000-0000-0000-000000000001','Finance','reader@example.test','Finance','active'),
  ('02870000-0000-0000-0000-0000000000a2','02870000-0000-0000-0000-000000000001','Admin','admin-reader@example.test','Admin','active'),
  ('02870000-0000-0000-0000-0000000000a3','02870000-0000-0000-0000-000000000001','Executive','executive-reader@example.test','Executive','active'),
  ('02870000-0000-0000-0000-0000000000a4','02870000-0000-0000-0000-000000000001','Manager','manager-reader@example.test','Project Manager','active'),
  ('02870000-0000-0000-0000-0000000000a5','02870000-0000-0000-0000-000000000001','Engineer','engineer-reader@example.test','Engineer','active'),
  ('02870000-0000-0000-0000-0000000000a6','02870000-0000-0000-0000-000000000001','Inactive','inactive-reader@example.test','Finance','disabled');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref)
values
  ('02870000-0000-0000-0000-0000000000d3','02870000-0000-0000-0000-000000000001','No Reading','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'READ-EMPTY'),
  ('02870000-0000-0000-0000-0000000000d4','02870000-0000-0000-0000-000000000002','Foreign Project','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'READ-FOREIGN'),
  ('02870000-0000-0000-0000-0000000000d5','02870000-0000-0000-0000-000000000001','Contract Basis','Ongoing Project','USD',220,'inclusive',0,0,1,1,false,'READ-BASIS'),
  ('02870000-0000-0000-0000-0000000000d6','02870000-0000-0000-0000-000000000001','Budget Selection','Ongoing Project','USD',500,'exclusive',0,0,1,1,false,'READ-BUDGET');
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
update public.sales_invoices set project_id='02870000-0000-0000-0000-0000000000d6'
 where id='02870000-0000-0000-0000-0000000000e1';
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,tax_amount,
                                   currency,status,erp_docstatus)
values
 ('02870000-0000-0000-0000-0000000000e2','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','SI-USD-1','2026-01-01',100,25,'exclusive',0,'USD','Submitted',1),
 ('02870000-0000-0000-0000-0000000000e3','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','SI-USD-2','2027-01-01',80,0,'exclusive',0,'USD','Paid',1),
 ('02870000-0000-0000-0000-0000000000e4','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','SI-USD-3',null,20,null,'exclusive',0,'USD','Unpaid',1),
 ('02870000-0000-0000-0000-0000000000e5','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','SI-IDR-1','2026-05-01',1000,200,'inclusive',0,'IDR','Submitted',1),
 ('02870000-0000-0000-0000-0000000000e6','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','SI-DRAFT','2026-06-01',500,500,'exclusive',0,'USD','Draft',0),
 ('02870000-0000-0000-0000-0000000000e7','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','SI-CANCELLED','2026-06-01',600,600,'exclusive',0,'USD','Cancelled',2),
 ('02870000-0000-0000-0000-0000000000e8','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d3','SI-MISSING-AMOUNT','2026-01-01',null,0,'exclusive',0,'USD','Submitted',1),
 ('02870000-0000-0000-0000-0000000000e9','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d2','SI-CLAIM','2024-01-01',100,30,'exclusive',0,'USD','Submitted',1),
 ('02870000-0000-0000-0000-0000000000ea','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d2','SI-ADVANCE','2027-01-01',50,20,'exclusive',0,'USD','Submitted',1),
 ('02870000-0000-0000-0000-0000000000eb','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d5','SI-BASIS','2026-01-01',100,0,'exclusive',10,'USD','Submitted',1),
 ('02870000-0000-0000-0000-0000000000ec','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d1','SI-FOREIGN','2026-02-01',1000,0,'exclusive',0,'EUR','Submitted',1);
insert into public.progress_claims (id,org_id,project_id,kind,currency,gross_amount,dp_recovery_amount,dp_item_code,created_by,
                                    down_payment_amount,recovery_pct)
values
 ('02870000-0000-0000-0000-0000000000e9','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d2','progress','USD',100,30,'ADV','02870000-0000-0000-0000-0000000000a1',null,null),
 ('02870000-0000-0000-0000-0000000000ea','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d2','down_payment','USD',50,0,'ADV','02870000-0000-0000-0000-0000000000a1',50,50);
insert into public.budget_versions (id,org_id,project_id,version,name,status,created_at) values
 ('02870000-0000-0000-0000-0000000000c1','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d6',1,'Active budget','Draft','2026-01-01'),
 ('02870000-0000-0000-0000-0000000000c2','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d6',2,'Draft two','Draft','2026-02-01'),
 ('02870000-0000-0000-0000-0000000000c3','02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d6',3,'Draft three','Draft','2026-03-01');
insert into public.budget_line_items (org_id,budget_version_id,category,description,budgeted_amount,fiscal_year) values
 ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000c1','Labor','Active line',40,'FY-2026'),
 ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000c1','Materials','Unphased line',60,null),
 ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000c2','Labor','Draft two line',200,null),
 ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000c3','Labor','Draft three line',300,null);
update public.budget_versions set status='Active' where id='02870000-0000-0000-0000-0000000000c1';
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

select is((select value->>'invoice_count' from jsonb_array_elements(public.get_project_finances('02870000-0000-0000-0000-0000000000d1')->'invoices') value where value->>'currency'='USD'),
          '3','AC-PFIN-017 submitted USD invoice count excludes Draft and Cancelled mirrors');
select is((select (value->>'invoiced')::numeric from jsonb_array_elements(public.get_project_finances('02870000-0000-0000-0000-0000000000d1')->'invoices') value where value->>'currency'='USD'),
          200::numeric,'AC-PFIN-017 known Invoiced amount remains complete when one ERP outstanding is NULL');
select is((select value->>'settled' from jsonb_array_elements(public.get_project_finances('02870000-0000-0000-0000-0000000000d1')->'invoices') value where value->>'currency'='USD'),
          null,'AC-PFIN-017 missing outstanding withholds Settled');
select is((select jsonb_typeof(value->'invoiced') from jsonb_array_elements(public.get_project_finances('02870000-0000-0000-0000-0000000000d1')->'invoices') value where value->>'currency'='IDR'),
          'string','AC-PFIN-017 JSON money values are exact strings');
select is((select (value->>'outstanding')::numeric from jsonb_array_elements(public.get_project_finances('02870000-0000-0000-0000-0000000000d1')->'invoices') value where value->>'currency'='IDR'),
          200::numeric,'AC-PFIN-017 IDR outstanding is aggregated independently');
select is((public.get_project_finances('02870000-0000-0000-0000-0000000000d3')->'invoices'->0->>'invoiced'),
          null,'AC-PFIN-017 missing invoice amount is unknown rather than zero');
select is((select (value->>'work_revenue')::numeric from jsonb_array_elements(public.get_project_finances('02870000-0000-0000-0000-0000000000d2')->'invoices') value where value->>'currency'='USD'),
          130::numeric,'AC-PFIN-018 undated lifetime billed work uses net plus claim recovery and excludes advances');
select is((select (value->>'invoiced')::numeric from jsonb_array_elements(public.get_project_finances('02870000-0000-0000-0000-0000000000d2')->'invoices') value where value->>'currency'='USD'),
          150::numeric,'AC-PFIN-018 down-payment invoice remains in Invoiced totals');
select is((public.get_project_finances('02870000-0000-0000-0000-0000000000d6')->'budget'->>'amount')::numeric,100::numeric,
          'AC-PFIN-012 Active budget version wins over newer Drafts and sums all selected-version lines');
set local role service_role;
update public.budget_versions set status='Archived' where id='02870000-0000-0000-0000-0000000000c1';
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.get_project_finances('02870000-0000-0000-0000-0000000000d6')->'budget'->>'id','02870000-0000-0000-0000-0000000000c3',
          'AC-PFIN-012 latest Draft wins when no Active version remains');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.get_project_finances('02870000-0000-0000-0000-0000000000d1')$$,'AC-PFIN-014 Admin can read project finances');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.get_project_finances('02870000-0000-0000-0000-0000000000d1')$$,'AC-PFIN-014 Finance can read project finances');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$select public.get_project_finances('02870000-0000-0000-0000-0000000000d1')$$,'AC-PFIN-014 Executive can read project finances');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$select public.get_project_finances('02870000-0000-0000-0000-0000000000d1')$$,'AC-PFIN-014 Project Manager can read project finances');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.get_project_finances('02870000-0000-0000-0000-0000000000d1')$$,'42501',null,'AC-PFIN-014 Engineer cannot read project finances');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$select public.get_project_finances('02870000-0000-0000-0000-0000000000d1')$$,'42501',null,'AC-PFIN-014 inactive Finance cannot read project finances');
reset role;
select throws_ok($$select public.get_project_finances('02870000-0000-0000-0000-0000000000d1')$$,'42501',null,'AC-PFIN-014 anonymous caller cannot read project finances');
select throws_ok($$select public.get_project_finances('02870000-0000-0000-0000-0000000000d4')$$,'42501',null,'AC-PFIN-014 foreign-org project has no readable finance payload');
set local role authenticated;
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('02870000-0000-0000-0000-0000000000d5')->>'contract_invoiced')::numeric,110::numeric,
          'AC-PFIN-020 contract comparison normalizes an exclusive invoice to inclusive contract basis');
select is((public.get_project_finances('02870000-0000-0000-0000-0000000000d5')->>'remaining_to_invoice')::numeric,110::numeric,
          'AC-PFIN-020 contract remaining retains normalized contract comparison independently of settlement amount');
select is((select (value->>'invoiced')::numeric from jsonb_array_elements(public.get_project_finances('02870000-0000-0000-0000-0000000000d5')->'invoices') value where value->>'currency'='USD'),
          100::numeric,'AC-PFIN-020 Invoiced card remains the source amount, not normalized contract comparison');
select is(public.get_project_finances('02870000-0000-0000-0000-0000000000d1')->>'contract_invoiced',null,
          'AC-PFIN-020 foreign-currency invoice makes contract comparison unavailable without changing currency totals');

-- ── AC-PFIN-011/018 evidence (plan Task 45): server-side completeness over >1000 submitted
-- invoices and current-generation isolation. The RPC must aggregate the whole set in ONE SQL
-- statement (no client-side scan, no truncated PostgREST page), and mapped actuals must read ONLY
-- the latest org generation — never mixing an older generation's rows for the same project.
set local role service_role;
set local request.jwt.claims='{}';
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref)
values ('02870000-0000-0000-0000-0000000000d7','02870000-0000-0000-0000-000000000001','Volume',
        'Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'READ-VOLUME');
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,
                                   tax_treatment,tax_amount,currency,status,erp_docstatus)
select ('02870000-0000-0000-0000-' || lpad((60000+g)::text,12,'0'))::uuid,
       '02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d7',
       'SI-VOL-' || g,'2026-03-01',2,1,'exclusive',0,'USD','Submitted',1
from generate_series(1,1050) g;
-- Latest generation (newest created_at) lives ONLY on another project (d2). Case 2 asserts that
-- generation's rows are what its own project reads; case 1 asserts the original project does NOT
-- fall back to its older-generation rows.
insert into public.erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at)
values ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000d2','ACC-LABOR-A','FY-2026',12,
        '2026-11-01','02870000-0000-0000-0000-0000000000b4','2026-11-01');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select (value->>'invoiced')::numeric from jsonb_array_elements(public.get_project_finances('02870000-0000-0000-0000-0000000000d7')->'invoices') value where value->>'currency'='USD'),
          2100::numeric,'AC-PFIN-018 RPC aggregates the exact sum of 1050 submitted invoices in one server-side statement');
select is((select value->>'invoice_count' from jsonb_array_elements(public.get_project_finances('02870000-0000-0000-0000-0000000000d7')->'invoices') value where value->>'currency'='USD'),
          '1050','AC-PFIN-018 invoice count is complete beyond a PostgREST page size');
select is((select (value->>'settled')::numeric from jsonb_array_elements(public.get_project_finances('02870000-0000-0000-0000-0000000000d7')->'invoices') value where value->>'currency'='USD'),
          1050::numeric,'AC-PFIN-018 settled derives exactly across the full 1050-invoice set');
select is((select actuals_to_date from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d2',null) where category='Labor'),
          12::numeric,'AC-PFIN-011 latest generation in another project reads only that generation''s rows (12, not 6012)');
select is((select actuals_as_of from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d2',null) limit 1),
          '2026-11-01'::timestamptz,'AC-PFIN-011 reading date follows the latest generation');
select is((select actuals_to_date from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d1',null) where category='Labor'),
          null,'AC-PFIN-011 a project absent from the latest generation withholds actuals instead of mixing old-generation rows');
select is((select has_rows from public.project_mapped_actuals('02870000-0000-0000-0000-0000000000d1',null) where category='Labor'),
          false,'AC-PFIN-011 stale-generation reading reports no rows rather than stale amounts');

select * from finish();
rollback;
