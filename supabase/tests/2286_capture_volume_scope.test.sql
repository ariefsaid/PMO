-- #2286 AC-ROP-065 companion: the first capture-scope ledger page, which carries the left-out summary, stays inside the
-- database's statement limit at ten times a real organization's volume plus 11,000 unrelated lines with no project.
-- The fixture is 2195_capture_volume.test.sql's (that file stays the owner of the 'all' scope proofs).
begin;
select plan(4);
insert into organizations (id, name, default_currency) values ('22860900-0000-0000-0000-000000000001','Volume scope test','IDR');
insert into auth.users (id, email) values ('22860900-0000-0000-0000-000000000002','volume-scope-admin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('22860900-0000-0000-0000-000000000002','22860900-0000-0000-0000-000000000001','Admin','volume-scope-admin@example.test','Admin','active');
insert into projects (id, org_id, name, status) values
  ('22860900-0000-0000-0000-000000000004','22860900-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('22860900-0000-0000-0000-000000000005','22860900-0000-0000-0000-000000000001','Supplier','Vendor');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
  select '22860900-0000-0000-0000-000000000001','companies','22860900-0000-0000-0000-000000000005','erpnext','Supplier:SUP-1';
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
  select '22860900-0000-0000-0000-000000000001','procurement',gen_random_uuid()::text,'erpnext','REF-'||n from generate_series(1,3379) n;
insert into external_org_bindings (id, org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('22860900-0000-0000-0000-000000000003','22860900-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref',
   '{"company":"Example","project_map":{"22860900-0000-0000-0000-000000000004":"PROJECT"}}',now()-interval '1 day','active');
-- 970 purchase documents: 485 orders, each with one invoice.
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,purchase_orders,erp_modified)
select '22860900-0000-0000-0000-000000000001','Purchase Order','V-ORDER-'||n,'SUP-1','Supplier','IDR',1,1,1,'To Bill','PROJECT',array['22860900-0000-0000-0000-000000000004'::uuid],'{}','2026-02-01'
from generate_series(1,485) n;
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,purchase_orders,erp_modified)
select '22860900-0000-0000-0000-000000000001','Purchase Invoice','V-INV-'||n,'SUP-1','Supplier','IDR',1,1,1,'Unpaid','PROJECT',array['22860900-0000-0000-0000-000000000004'::uuid],array['V-ORDER-'||n],'2026-02-01'
from generate_series(1,485) n;
insert into budget_category_account_map(org_id,category,erp_account) values ('22860900-0000-0000-0000-000000000001','Materials','Cost-1');
-- 1,470 accounts.
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,include_in_gross,disabled,refresh_id)
select '22860900-0000-0000-0000-000000000001','Example','Cost-'||n,'Cost '||n,'Expense','Profit and Loss',false,'IDR',n*2,n*2+1,false,false,gen_random_uuid()
from generate_series(1,1470) n;
-- 15,370 ledger lines: one per invoice, journals (some without a project) for the rest.
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select '22860900-0000-0000-0000-000000000001','GL-I-'||n,'Example','Cost-1','PROJECT','Purchase Invoice','V-INV-'||n,'2026-02-01',1,0,false,'2026-02-01'
from generate_series(1,485) n;
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select '22860900-0000-0000-0000-000000000001','GL-J-'||n,'Example','Cost-'||(1+n%1470),case when n%2=0 then 'PROJECT' end,'Journal Entry','JV-'||n,'2026-02-01',1,1,false,'2026-02-01'
from generate_series(1,14885) n;
-- 2,270 actuals rows.
insert into erp_actuals_snapshot(org_id,project_id,account,debit,credit,net,snapshot_id,as_of)
select '22860900-0000-0000-0000-000000000001','22860900-0000-0000-0000-000000000004','Cost-'||(1+n%1470),1,0,1,'22860900-0000-0000-0000-000000000090',now()
from generate_series(1,2270) n;
-- 5,000 statement rows at about 2.8 kB each.
insert into erp_financial_statement_snapshot(org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,published_at,capture_started_at,capture_completed_at,payload,raw_reports,has_activity,display_precision,display_rounding_method)
select '22860900-0000-0000-0000-000000000001','Example',case when n=1 then '22860900-0000-0000-0000-000000000091'::uuid else gen_random_uuid() end,
  '22860900-0000-0000-0000-000000000092','trial_balance','company','account_breakdown','month',date '1990-01-01'+n,date '1990-01-01'+n,date '1980-01-01'+n,date '1980-01-01'+n,'IDR',now(),now(),now(),now(),
  jsonb_build_object('current',jsonb_build_object('rows',jsonb_build_array(repeat('x',2700))),'prior',jsonb_build_object('rows','[]'::jsonb)),'{"current":"{}","prior":"{}"}',false,2,'erpnext_report_output'
from generate_series(1,5000) n;
insert into erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context)
values ('22860900-0000-0000-0000-000000000001','Example','22860900-0000-0000-0000-000000000091','22860900-0000-0000-0000-000000000092','{"presentation":{"context":{"raw":{"company":{"name":"Example","currency":"IDR"}}}}}');
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at,ledger_currency)
  select org_id,id,k.kind,now(),case when k.kind='ledger' then 'IDR' end from external_org_bindings b cross join (values ('purchases'),('ledger')) k(kind) where b.org_id='22860900-0000-0000-0000-000000000001';
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select '22860900-0000-0000-0000-000000000001','GL-U-'||n,'Example','Cost-'||(1+n%1470),null,case when n%2=0 then 'Journal Entry' else 'Payment Entry' end,'UV-'||n,'2026-02-01',1,0,false,'2026-02-01'
from generate_series(1,11000) n;

set local role authenticated;
set local request.jwt.claims = '{"sub":"22860900-0000-0000-0000-000000000002","role":"authenticated"}';
set local statement_timeout = '8s';
select lives_ok($$select set_config('scope.first',public.purchase_capture_ledger_page(null,500,null,'capture')::text,true)$$,
  'AC-CAPV-001 the first capture page, with its summary, finishes inside the statement limit at ten times the volume');
select is(jsonb_array_length(current_setting('scope.first')::jsonb->'lines'),500,'AC-CAPV-001 the first capture page is full');
select is((select sum((k->>'count')::int) from jsonb_array_elements(current_setting('scope.first')::jsonb->'other_summary') k)::int,18443,
  'AC-CAPV-001 the summary counts every left-out line: 7,443 journals without a project and the 11,000 unrelated lines');
select lives_ok($$select public.purchase_capture_ledger_page((current_setting('scope.first')::jsonb->>'next_cursor')::uuid,500,null,'capture')$$,
  'AC-CAPV-001 a later capture page finishes inside the statement limit');
reset role;
select * from finish();
rollback;
