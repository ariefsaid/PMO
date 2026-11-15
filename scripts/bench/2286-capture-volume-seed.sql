-- #2286 benchmark seed: the 2195_capture_volume.test.sql fixture (ten times a real organization's volume) in its own
-- org, plus 11,000 unrelated journal and payment lines with no project. Included by 2286-capture-volume.sql inside
-- begin; ... rollback; so nothing persists. Not a test: it asserts nothing.
insert into organizations (id, name, default_currency) values ('22860000-0000-0000-0000-000000000001','Volume bench','IDR');
insert into auth.users (id, email) values ('22860000-0000-0000-0000-000000000002','volume-bench-admin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('22860000-0000-0000-0000-000000000002','22860000-0000-0000-0000-000000000001','Admin','volume-bench-admin@example.test','Admin','active');
insert into projects (id, org_id, name, status) values
  ('22860000-0000-0000-0000-000000000004','22860000-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('22860000-0000-0000-0000-000000000005','22860000-0000-0000-0000-000000000001','Supplier','Vendor');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
  select '22860000-0000-0000-0000-000000000001','companies','22860000-0000-0000-0000-000000000005','erpnext','Supplier:SUP-1';
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
  select '22860000-0000-0000-0000-000000000001','procurement',gen_random_uuid()::text,'erpnext','REF-'||n from generate_series(1,3379) n;
insert into external_org_bindings (id, org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('22860000-0000-0000-0000-000000000003','22860000-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref',
   '{"company":"Example","project_map":{"22860000-0000-0000-0000-000000000004":"PROJECT"}}',now()-interval '1 day','active');
-- 970 purchase documents: 485 orders, each with one invoice.
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,purchase_orders,erp_modified)
select '22860000-0000-0000-0000-000000000001','Purchase Order','V-ORDER-'||n,'SUP-1','Supplier','IDR',1,1,1,'To Bill','PROJECT',array['22860000-0000-0000-0000-000000000004'::uuid],'{}','2026-02-01'
from generate_series(1,485) n;
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,purchase_orders,erp_modified)
select '22860000-0000-0000-0000-000000000001','Purchase Invoice','V-INV-'||n,'SUP-1','Supplier','IDR',1,1,1,'Unpaid','PROJECT',array['22860000-0000-0000-0000-000000000004'::uuid],array['V-ORDER-'||n],'2026-02-01'
from generate_series(1,485) n;
insert into budget_category_account_map(org_id,category,erp_account) values ('22860000-0000-0000-0000-000000000001','Materials','Cost-1');
-- 1,470 accounts.
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,include_in_gross,disabled,refresh_id)
select '22860000-0000-0000-0000-000000000001','Example','Cost-'||n,'Cost '||n,'Expense','Profit and Loss',false,'IDR',n*2,n*2+1,false,false,gen_random_uuid()
from generate_series(1,1470) n;
-- 15,370 ledger lines: one per invoice, journals (some without a project) for the rest.
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select '22860000-0000-0000-0000-000000000001','GL-I-'||n,'Example','Cost-1','PROJECT','Purchase Invoice','V-INV-'||n,'2026-02-01',1,0,false,'2026-02-01'
from generate_series(1,485) n;
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select '22860000-0000-0000-0000-000000000001','GL-J-'||n,'Example','Cost-'||(1+n%1470),case when n%2=0 then 'PROJECT' end,'Journal Entry','JV-'||n,'2026-02-01',1,1,false,'2026-02-01'
from generate_series(1,14885) n;
-- #2286: 11,000 unrelated lines with no project (5,500 journals, 5,500 payments) — what a scoped read leaves out.
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select '22860000-0000-0000-0000-000000000001','GL-U-'||n,'Example','Cost-'||(1+n%1470),null,case when n%2=0 then 'Journal Entry' else 'Payment Entry' end,'UV-'||n,'2026-02-01',
  case when n%2=0 then 2 else 0 end,case when n%2=0 then 1 else 3 end,false,'2026-02-01'
from generate_series(1,11000) n;
-- 2,270 actuals rows.
insert into erp_actuals_snapshot(org_id,project_id,account,debit,credit,net,snapshot_id,as_of)
select '22860000-0000-0000-0000-000000000001','22860000-0000-0000-0000-000000000004','Cost-'||(1+n%1470),1,0,1,'22860000-0000-0000-0000-000000000090',now()
from generate_series(1,2270) n;
-- 5,000 statement rows at about 2.8 kB each.
insert into erp_financial_statement_snapshot(org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,published_at,capture_started_at,capture_completed_at,payload,raw_reports,has_activity,display_precision,display_rounding_method)
select '22860000-0000-0000-0000-000000000001','Example',case when n=1 then '22860000-0000-0000-0000-000000000091'::uuid else gen_random_uuid() end,
  '22860000-0000-0000-0000-000000000092','trial_balance','company','account_breakdown','month',date '1990-01-01'+n,date '1990-01-01'+n,date '1980-01-01'+n,date '1980-01-01'+n,'IDR',now(),now(),now(),now(),
  jsonb_build_object('current',jsonb_build_object('rows',jsonb_build_array(repeat('x',2700))),'prior',jsonb_build_object('rows','[]'::jsonb)),'{"current":"{}","prior":"{}"}',false,2,'erpnext_report_output'
from generate_series(1,5000) n;
insert into erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context)
values ('22860000-0000-0000-0000-000000000001','Example','22860000-0000-0000-0000-000000000091','22860000-0000-0000-0000-000000000092','{"presentation":{"context":{"raw":{"company":{"name":"Example","currency":"IDR"}}}}}');
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at,ledger_currency)
  select org_id,id,k.kind,now(),case when k.kind='ledger' then 'IDR' end from external_org_bindings b cross join (values ('purchases'),('ledger')) k(kind) where b.org_id='22860000-0000-0000-0000-000000000001';
-- 30 groups, each an order with its invoice: one batch call takes 25, the resume takes the last 5.
select length(set_config('bench.groups',(select jsonb_agg(g order by o.erp_name)::text from (select o.erp_name,jsonb_build_object('project_id','22860000-0000-0000-0000-000000000004','source_ids',jsonb_build_array(o.id::text,i.id::text)) g
  from erp_purchase_documents o join erp_purchase_documents i on i.org_id=o.org_id and i.erp_doctype='Purchase Invoice' and i.purchase_orders=array[o.erp_name]
  where o.org_id='22860000-0000-0000-0000-000000000001' and o.erp_doctype='Purchase Order' order by o.erp_name limit 30) o),true)) as groups_len;
-- Planner statistics for the seeded rows (rolled back with the seed).
analyze erp_purchase_documents; analyze erp_gl_entry_mirror; analyze erp_account_mirror; analyze external_refs; analyze companies;
analyze procurement_erp_links; analyze erp_journal_line_links; analyze external_org_bindings;
