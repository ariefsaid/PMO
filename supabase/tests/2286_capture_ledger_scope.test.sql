-- AC-CAPV-001 / AC-CAPV-003 (#2286): the capture-scope ledger read pages only the capture-relevant lines and summarizes
-- the lines it leaves out, per kind, with an exact net total (null when an amount is missing) and the finest decimal scale
-- among the kind's amounts (the edge formats the total at it, as it did line by line). 'all' keeps every line.
begin;
select plan(28);
insert into organizations (id, name, default_currency) values ('22860300-0000-0000-0000-000000000001','Ledger scope test','USD');
insert into auth.users (id, email) values ('22860300-0000-0000-0000-000000000002','scope-admin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('22860300-0000-0000-0000-000000000002','22860300-0000-0000-0000-000000000001','Admin','scope-admin@example.test','Admin','active');
insert into projects (id, org_id, name, status) values
  ('22860300-0000-0000-0000-000000000004','22860300-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('22860300-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref',
   '{"company":"Example","project_map":{"22860300-0000-0000-0000-000000000004":"PROJECT"}}',now(),'active');
insert into erp_gl_entry_mirror(id,org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('22860300-0000-0000-0000-000000000101','22860300-0000-0000-0000-000000000001','GL-1','Example','Cost','PROJECT','Journal Entry','JV-1','2026-02-01',4.00,0,false,'2026-02-01'),
 ('22860300-0000-0000-0000-000000000102','22860300-0000-0000-0000-000000000001','GL-2','Example','Cost',null,'Purchase Invoice','INV-1','2026-02-01',9.00,0,false,'2026-02-01'),
 ('22860300-0000-0000-0000-000000000103','22860300-0000-0000-0000-000000000001','GL-3','Other','Cost',null,'Journal Entry','JV-2','2026-02-01',1.00,0,false,'2026-02-01'),
 ('22860300-0000-0000-0000-000000000104','22860300-0000-0000-0000-000000000001','GL-4','Example','Bank',null,'Payment Entry','PAY-1','2026-02-01',7.00,0,false,'2026-02-01'),
 ('22860300-0000-0000-0000-000000000105','22860300-0000-0000-0000-000000000001','GL-5','Example','Bank',null,'Payment Entry','PAY-2','2026-02-01',3.50,0,false,'2026-02-01'),
 ('22860300-0000-0000-0000-000000000106','22860300-0000-0000-0000-000000000001','GL-6','Example','Cost',null,'Journal Entry','JV-3','2026-02-01',null,2.00,false,'2026-02-01'),
 ('22860300-0000-0000-0000-000000000110','22860300-0000-0000-0000-000000000001','GL-10','Example','Cost',null,'Journal Entry','JV-5','2026-02-01',5.00,0,false,'2026-02-01');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22860300-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select jsonb_agg(l->>'erp_name') from jsonb_array_elements(public.purchase_capture_ledger_page(null,500,null,'capture')->'lines') l),
  '["GL-1","GL-2","GL-3"]'::jsonb,'AC-CAPV-001 the capture scope pages only the mapped-project, purchase-kind and other-company lines');
select is(public.purchase_capture_ledger_page(null,500,null,'capture')->'other_summary',
  '[{"kind":"journal","count":2,"total":null,"scale":0},{"kind":"supplier_payment","count":2,"total":"10.50","scale":1}]'::jsonb,
  'AC-CAPV-001 AC-CAPV-003 the first page summarizes each left-out kind with its count and exact net total, null when an amount is missing');
select is((select jsonb_agg(l->>'erp_name') from jsonb_array_elements(public.purchase_capture_ledger_page(null,500,null,'all')->'lines') l),
  '["GL-1","GL-2","GL-3","GL-4","GL-5","GL-6","GL-10"]'::jsonb,'AC-CAPV-001 the all scope still pages every line in id order');
select is((select jsonb_agg(l->>'erp_name') from jsonb_array_elements(public.purchase_capture_ledger_page(null,500)->'lines') l),
  '["GL-1","GL-2","GL-3","GL-4","GL-5","GL-6","GL-10"]'::jsonb,'AC-CAPV-001 the default scope is all, as before');
select ok(not (public.purchase_capture_ledger_page(null,500,null,'all') ? 'other_summary'),'AC-CAPV-001 the all scope carries no summary');
select is(public.purchase_capture_ledger_page(null,500,null,'capture')->'lines'->0,public.purchase_capture_ledger_page(null,500,null,'all')->'lines'->0,
  'AC-CAPV-001 a capture-scope line carries exactly the fields of the all-scope line');
select is(public.purchase_capture_ledger_page(null,500,null,'capture')->'lines'->0->>'project_id','22860300-0000-0000-0000-000000000004','AC-CAPV-001 a mapped project still resolves');
select is(public.purchase_capture_ledger_page(null,500,null,'capture')->>'revision',public.purchase_capture_source_page(null,null,1)->>'revision',
  'AC-CAPV-001 the ledger page revision equals the source page revision');
-- Paging inside the capture scope.
select is(public.purchase_capture_ledger_page(null,2,null,'capture')->>'next_cursor','22860300-0000-0000-0000-000000000102','AC-CAPV-001 a capture page ends at its last relevant line');
select is((select jsonb_agg(l->>'erp_name') from jsonb_array_elements(public.purchase_capture_ledger_page('22860300-0000-0000-0000-000000000102',2,null,'capture')->'lines') l),
  '["GL-3"]'::jsonb,'AC-CAPV-001 the next capture page skips the left-out lines');
select is(public.purchase_capture_ledger_page('22860300-0000-0000-0000-000000000102',2,null,'capture')->>'next_cursor',null,'AC-CAPV-001 the last capture page has no cursor although left-out lines follow');
select ok(not (public.purchase_capture_ledger_page('22860300-0000-0000-0000-000000000102',2,null,'capture') ? 'other_summary'),'AC-CAPV-001 only the first page carries the summary');
select is(public.purchase_capture_ledger_page(null,2,null,'capture')->'other_summary',public.purchase_capture_ledger_page(null,500,null,'capture')->'other_summary',
  'AC-CAPV-001 the summary covers the whole scope whatever the page size');
-- A project scope leaves nothing out: every line it reads has a project.
select is((select jsonb_agg(l->>'erp_name') from jsonb_array_elements(public.purchase_capture_ledger_page(null,500,'22860300-0000-0000-0000-000000000004','capture')->'lines') l),
  '["GL-1"]'::jsonb,'AC-CAPV-001 a project capture scope reads the project lines');
select is(public.purchase_capture_ledger_page(null,500,'22860300-0000-0000-0000-000000000004','capture')->'other_summary','[]'::jsonb,'AC-CAPV-001 a project capture scope summarizes nothing');
select throws_ok($$select public.purchase_capture_ledger_page(null,500,null,'everything')$$,'22023',null,'AC-CAPV-001 an unknown scope is refused');
select throws_ok($$select public.purchase_capture_ledger_page(null,500,null,null)$$,'22023',null,'AC-CAPV-001 a null scope is refused');
reset role;

-- A payment mirrored as a purchase document stays line by line (its document decides its source classification);
-- a line of no known kind is summarized as other.
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,currency,net_total,grand_total,erp_docstatus,erp_status,project_ids,purchase_orders,erp_modified) values
 ('22860300-0000-0000-0000-000000000201','22860300-0000-0000-0000-000000000001','Payment Entry','PAY-1','SUP-1','USD',7,7,1,'Paid','{}','{}','2026-02-01');
insert into erp_gl_entry_mirror(id,org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('22860300-0000-0000-0000-000000000107','22860300-0000-0000-0000-000000000001','GL-7','Example','Sales',null,'Sales Invoice','SINV-1','2026-02-01',0,2.25,false,'2026-02-01'),
 ('22860300-0000-0000-0000-000000000108','22860300-0000-0000-0000-000000000001','GL-8','Example','Cost',null,'Purchase Receipt','PR-1','2026-02-01',1.00,0,false,'2026-02-01'),
 ('22860300-0000-0000-0000-000000000109','22860300-0000-0000-0000-000000000001','GL-9','Example','Cost','UNMAPPED','Journal Entry','JV-4','2026-02-01',0,0,true,'2026-02-01');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22860300-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select jsonb_agg(l->>'erp_name') from jsonb_array_elements(public.purchase_capture_ledger_page(null,500,null,'capture')->'lines') l),
  '["GL-1","GL-2","GL-3","GL-4","GL-8"]'::jsonb,'AC-CAPV-001 a line of a mirrored purchase document and a receipt line are read line by line');
select is(public.purchase_capture_ledger_page(null,500,null,'capture')->'other_summary',
  '[{"kind":"journal","count":2,"total":null,"scale":0},{"kind":"other","count":1,"total":"-2.25","scale":2},{"kind":"supplier_payment","count":1,"total":"3.50","scale":1}]'::jsonb,
  'AC-CAPV-001 cancelled lines stay out; a line of no known kind is summarized as other');
select is(jsonb_array_length(public.purchase_capture_ledger_page(null,500,null,'all')->'lines'),9,'AC-CAPV-001 the all scope still omits cancelled lines');
reset role;

-- A line with no voucher type is of no known kind: summarized as other, never dropped from both lists. Amounts finer than
-- cents keep their scale: 1.005 and 0.005 net to -1.250 together with GL-7, at scale 3.
insert into erp_gl_entry_mirror(id,org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('22860300-0000-0000-0000-000000000111','22860300-0000-0000-0000-000000000001','GL-11','Example','Cost',null,null,'NOTYPE-1','2026-02-01',1.005,0,false,'2026-02-01'),
 ('22860300-0000-0000-0000-000000000112','22860300-0000-0000-0000-000000000001','GL-12','Example','Bank',null,'Bank Entry','BANK-1','2026-02-01',0,0.005,false,'2026-02-01');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22860300-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.purchase_capture_ledger_page(null,500,null,'capture')->'other_summary'->1,
  '{"kind":"other","count":3,"total":"-1.250","scale":3}'::jsonb,'AC-CAPV-001 AC-CAPV-003 a line with no voucher type is summarized as other, at the finest scale of its kind');
select ok(not (public.purchase_capture_ledger_page(null,500,null,'capture')->'lines' @> '[{"erp_name":"GL-11"}]'),'AC-CAPV-001 a line with no voucher type is not read line by line');
select is(jsonb_array_length(public.purchase_capture_ledger_page(null,500,null,'all')->'lines'),11,'AC-CAPV-001 the all scope reads it');
reset role;

-- The edge function compares a line's company with the binding's company exactly as configured, so a padded name makes every
-- line of the trimmed company "another company" there; the capture scope then reads them all line by line and leaves none out.
update external_org_bindings set config = jsonb_set(config,'{company}','" Example"') where org_id='22860300-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22860300-0000-0000-0000-000000000002","role":"authenticated"}';
select is(jsonb_array_length(public.purchase_capture_ledger_page(null,500,null,'capture')->'lines'),11,'AC-CAPV-001 a padded binding company leaves no line out of the capture scope');
select is(public.purchase_capture_ledger_page(null,500,null,'capture')->'other_summary','[]'::jsonb,'AC-CAPV-001 and summarizes nothing');
reset role;

-- One function, so the API sees no overload; the API role may call it, anonymous callers may not.
select is((select count(*)::int from pg_proc where proname='purchase_capture_ledger_page' and pronamespace='public'::regnamespace),1,'AC-CAPV-001 the ledger page has one signature');
select ok(has_function_privilege('authenticated','public.purchase_capture_ledger_page(uuid,integer,uuid,text)','execute'),'AC-CAPV-001 an authenticated Admin may call the scoped page');
select ok(not has_function_privilege('anon','public.purchase_capture_ledger_page(uuid,integer,uuid,text)','execute'),'AC-CAPV-001 anonymous callers may not');
select * from finish();
rollback;
