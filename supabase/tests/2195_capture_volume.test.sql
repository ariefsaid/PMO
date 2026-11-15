-- AC-ROP-065 / AC-ROP-066: the census, the ledger pages, the health read and a batch stay inside the
-- database's statement limit at ten times a real organization's volume, including bulky statement rows.
begin;
select plan(40);
insert into organizations (id, name, default_currency) values ('21950650-0000-0000-0000-000000000001','Volume test','IDR');
insert into auth.users (id, email) values ('21950650-0000-0000-0000-000000000002','volume-admin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21950650-0000-0000-0000-000000000002','21950650-0000-0000-0000-000000000001','Admin','volume-admin@example.test','Admin','active');
insert into projects (id, org_id, name, status) values
  ('21950650-0000-0000-0000-000000000004','21950650-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('21950650-0000-0000-0000-000000000005','21950650-0000-0000-0000-000000000001','Supplier','Vendor');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
  select '21950650-0000-0000-0000-000000000001','companies','21950650-0000-0000-0000-000000000005','erpnext','Supplier:SUP-1';
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
  select '21950650-0000-0000-0000-000000000001','procurement',gen_random_uuid()::text,'erpnext','REF-'||n from generate_series(1,3379) n;
insert into external_org_bindings (id, org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('21950650-0000-0000-0000-000000000003','21950650-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref',
   '{"company":"Example","project_map":{"21950650-0000-0000-0000-000000000004":"PROJECT"}}',now()-interval '1 day','active');
-- 970 purchase documents: 485 orders, each with one invoice.
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,purchase_orders,erp_modified)
select '21950650-0000-0000-0000-000000000001','Purchase Order','V-ORDER-'||n,'SUP-1','Supplier','IDR',1,1,1,'To Bill','PROJECT',array['21950650-0000-0000-0000-000000000004'::uuid],'{}','2026-02-01'
from generate_series(1,485) n;
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,purchase_orders,erp_modified)
select '21950650-0000-0000-0000-000000000001','Purchase Invoice','V-INV-'||n,'SUP-1','Supplier','IDR',1,1,1,'Unpaid','PROJECT',array['21950650-0000-0000-0000-000000000004'::uuid],array['V-ORDER-'||n],'2026-02-01'
from generate_series(1,485) n;
insert into budget_category_account_map(org_id,category,erp_account) values ('21950650-0000-0000-0000-000000000001','Materials','Cost-1');
-- 1,470 accounts.
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,include_in_gross,disabled,refresh_id)
select '21950650-0000-0000-0000-000000000001','Example','Cost-'||n,'Cost '||n,'Expense','Profit and Loss',false,'IDR',n*2,n*2+1,false,false,gen_random_uuid()
from generate_series(1,1470) n;
-- 15,370 ledger lines: one per invoice, journals (some without a project) for the rest.
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select '21950650-0000-0000-0000-000000000001','GL-I-'||n,'Example','Cost-1','PROJECT','Purchase Invoice','V-INV-'||n,'2026-02-01',1,0,false,'2026-02-01'
from generate_series(1,485) n;
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select '21950650-0000-0000-0000-000000000001','GL-J-'||n,'Example','Cost-'||(1+n%1470),case when n%2=0 then 'PROJECT' end,'Journal Entry','JV-'||n,'2026-02-01',1,1,false,'2026-02-01'
from generate_series(1,14885) n;
-- 2,270 actuals rows.
insert into erp_actuals_snapshot(org_id,project_id,account,debit,credit,net,snapshot_id,as_of)
select '21950650-0000-0000-0000-000000000001','21950650-0000-0000-0000-000000000004','Cost-'||(1+n%1470),1,0,1,'21950650-0000-0000-0000-000000000090',now()
from generate_series(1,2270) n;
-- 5,000 statement rows at about 2.8 kB each.
insert into erp_financial_statement_snapshot(org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,published_at,capture_started_at,capture_completed_at,payload,raw_reports,has_activity,display_precision,display_rounding_method)
select '21950650-0000-0000-0000-000000000001','Example',case when n=1 then '21950650-0000-0000-0000-000000000091'::uuid else gen_random_uuid() end,
  '21950650-0000-0000-0000-000000000092','trial_balance','company','account_breakdown','month',date '1990-01-01'+n,date '1990-01-01'+n,date '1980-01-01'+n,date '1980-01-01'+n,'IDR',now(),now(),now(),now(),
  jsonb_build_object('current',jsonb_build_object('rows',jsonb_build_array(repeat('x',2700))),'prior',jsonb_build_object('rows','[]'::jsonb)),'{"current":"{}","prior":"{}"}',false,2,'erpnext_report_output'
from generate_series(1,5000) n;
insert into erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context)
values ('21950650-0000-0000-0000-000000000001','Example','21950650-0000-0000-0000-000000000091','21950650-0000-0000-0000-000000000092','{"presentation":{"context":{"raw":{"company":{"name":"Example","currency":"IDR"}}}}}');
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at,ledger_currency)
  select org_id,id,k.kind,now(),case when k.kind='ledger' then 'IDR' end from external_org_bindings b cross join (values ('purchases'),('ledger')) k(kind) where b.org_id='21950650-0000-0000-0000-000000000001';
select length(set_config('capture.groups',(select jsonb_agg(g)::text from (select jsonb_build_object('project_id','21950650-0000-0000-0000-000000000004','source_ids',jsonb_build_array(id::text)) g
  from erp_purchase_documents where org_id='21950650-0000-0000-0000-000000000001' and erp_doctype='Purchase Order' order by erp_name limit 25) s),true));
-- One cursor per ledger page boundary, read before the role switch; each page is then its own statement,
-- as it is when the served function calls them.
select set_config('capture.cursors',(select string_agg(id::text,',' order by id) from (select id,row_number() over (order by id) rn
  from erp_gl_entry_mirror where org_id='21950650-0000-0000-0000-000000000001' and not is_cancelled) t where rn % 500 = 0),true);
select is((select count(*)::int from erp_purchase_documents where org_id='21950650-0000-0000-0000-000000000001'),970,'AC-ROP-065 the fixture holds ten times the purchase documents');
select is((select count(*)::int from erp_gl_entry_mirror where org_id='21950650-0000-0000-0000-000000000001'),15370,'AC-ROP-065 the fixture holds ten times the ledger lines');

set local role authenticated;
set local request.jwt.claims = '{"sub":"21950650-0000-0000-0000-000000000002","role":"authenticated"}';
set local statement_timeout = '8s';
select lives_ok($$select public.purchase_capture_source_page(null,null,500)$$,'AC-ROP-065 the census read finishes inside the statement limit');
select lives_ok($$select public.purchase_capture_feed_health()$$,'AC-ROP-065 the health read finishes inside the statement limit');
select set_config('capture.t0',clock_timestamp()::text,true);
select lives_ok($$select public.purchase_capture_source_page(null,null,1)$$,'AC-ROP-065 the revision witness read finishes inside the statement limit');
-- The witness read is what every ledger page, apply and batch call repeats; the fingerprint keeps it well under a second.
select ok(clock_timestamp()-current_setting('capture.t0')::timestamptz < interval '2 seconds','AC-ROP-065 the revision witness read takes under two seconds');
select lives_ok($$select public.purchase_capture_ledger_page(null,500,null)$$,'AC-ROP-065 the first ledger page finishes inside the statement limit');
select format($q$select lives_ok($l$select public.purchase_capture_ledger_page(%L,500,null)$l$,'AC-ROP-065 ledger page after cursor %s finishes inside the statement limit')$q$,c,n)
  from unnest(string_to_array(current_setting('capture.cursors'),',')) with ordinality t(c,n) \gexec
select set_config('capture.revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select set_config('capture.batch',public.capture_history_batch('21950650-0000-0000-0000-000000000002','21950650-0000-0000-0000-000000000004','21950650-0000-0000-0000-000000000012',
  current_setting('capture.revision'),'{"order":2}'::jsonb,current_setting('capture.groups')::jsonb)::text,true)$$,'AC-ROP-066 a 25-group batch call finishes inside the statement limit');
select is(current_setting('capture.batch')::jsonb->>'next_index','25','AC-ROP-066 the batch call processed the whole page of groups');
select is(current_setting('capture.batch')::jsonb->>'complete','true','AC-ROP-066 the batch is complete');
reset role;
select * from finish();
rollback;
