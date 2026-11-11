begin;
select no_plan();
insert into public.organizations (id,name) values ('39900000-0000-0000-0000-000000000001','Identity A'),('39900000-0000-0000-0000-000000000002','Identity B');
insert into auth.users (id,email) values ('39900000-0000-0000-0000-000000000011','identity-a@example.invalid'),('39900000-0000-0000-0000-000000000012','identity-b@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role) values ('39900000-0000-0000-0000-000000000011','39900000-0000-0000-0000-000000000001','A','identity-a@example.invalid','Admin'),('39900000-0000-0000-0000-000000000012','39900000-0000-0000-0000-000000000002','B','identity-b@example.invalid','Admin');
insert into public.procurements (id,org_id,title,status,requested_by_id,import_key) values ('39900000-0000-0000-0000-000000000021','39900000-0000-0000-0000-000000000001','Case A','Draft','39900000-0000-0000-0000-000000000011','  Alpha  '),('39900000-0000-0000-0000-000000000022','39900000-0000-0000-0000-000000000002','Case B','Draft','39900000-0000-0000-0000-000000000012','alpha');
insert into public.procurements (id,org_id,title,status,requested_by_id) values ('39900000-0000-0000-0000-000000000024','39900000-0000-0000-0000-000000000001','Quote','Vendor Quoted','39900000-0000-0000-0000-000000000011');
insert into public.companies (id,org_id,name,type) values ('39900000-0000-0000-0000-000000000031','39900000-0000-0000-0000-000000000001','Vendor','Vendor');
insert into public.purchase_requests (id,procurement_id,import_key,import_batch_id) values ('39900000-0000-0000-0000-000000000041','39900000-0000-0000-0000-000000000021','legacy','39900000-0000-0000-0000-000000000099');
-- SHARED_IDENTITY_VECTORS_BEGIN
-- This JSON is consumed by the writer test as well as these database assertions.
create temporary table identity_vectors as
select * from jsonb_to_recordset($vectors$
[
  {"type":"pr","input":{"reference_number":"PR","status":null,"date":"2026-01-02","amount":"12.30"},"facts":["PR","Draft","2026-01-02","12.30"]},
  {"type":"rfq","input":{"reference_number":"RFQ","status":null,"date":"2026-01-02","amount":"12.30"},"facts":["RFQ","Draft","2026-01-02","12.30"]},
  {"type":"po","input":{"reference_number":"PO","status":null,"date":"2026-01-02","amount":"12.30"},"facts":["PO","Draft","2026-01-02","12.30"]},
  {"type":"quotation","input":{"reference":null,"vendor_id":"39900000-0000-0000-0000-000000000031","total_amount":"12.30","received_date":"2026-01-02"},"facts":[null,"39900000-0000-0000-0000-000000000031","12.30","2026-01-02"]},
  {"type":"receipt","input":{"reference_number":"GR","status":"Complete","receipt_date":"2026-01-02"},"facts":["GR","Complete","2026-01-02"]},
  {"type":"invoice","input":{"reference_number":"VI","status":"Received","invoice_date":"2026-01-02","amount":"100.00","tax_treatment":"exclusive","tax_amount":"10.00"},"facts":["VI","Received","2026-01-02","100.00","exclusive","10.00"]},
  {"type":"invoice_calculated","input":{"reference_number":"VI-calculated","status":"Received","invoice_date":"2026-01-02","amount":"100.00","tax_treatment":"exclusive","tax_amount":"0.00","tax_rate":"10.000"},"facts":["VI-calculated","Received","2026-01-02","100.00","exclusive","10.00"]},
  {"type":"payment","input":{"reference_number":"PAY","invoice_id":null,"status":null,"date":"2026-01-02","amount":"12.30"},"facts":["PAY",null,"Scheduled","2026-01-02","12.30"]},
  {"type":"numeric_max","input":{"reference_number":null,"status":null,"date":null,"amount":"999999999999.99"},"facts":[null,"Draft",null,"999999999999.99"]},
  {"type":"numeric_zero","input":{"reference_number":null,"status":null,"date":null,"amount":"0.00"},"facts":[null,"Draft",null,"0.00"]},
  {"type":"historical_pr","input":{"reference_number":null,"status":"Closed","date":null,"amount":null},"facts":[null,"Closed",null,null]},
  {"type":"historical_quotation","input":{"reference":"Legacy quote","vendor_id":"39900000-0000-0000-0000-000000000031","total_amount":"0.00","received_date":null},"facts":["Legacy quote","39900000-0000-0000-0000-000000000031","0.00",null]},
  {"type":"historical_payment","input":{"reference_number":"Paid","invoice_id":"39900000-0000-0000-0000-000000000051","status":"Paid","date":null,"amount":"1.00"},"facts":["Paid","39900000-0000-0000-0000-000000000051","Paid",null,"1.00"]}
]
$vectors$::jsonb) as v(type text,input jsonb,facts jsonb);
-- SHARED_IDENTITY_VECTORS_END
grant select on identity_vectors to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"39900000-0000-0000-0000-000000000011","role":"authenticated"}';
select has_function('public','start_procurement_import_run',array['uuid'],'run API exists');
select has_function('public','normalize_procurement_import_refs',array['text[]'],'normalization API exists');
select is((select normalized_ref from public.normalize_procurement_import_refs(array['  İΣς  '])), lower(btrim('  İΣς  ')),'normalization uses database Unicode rules');
select throws_ok($$select * from public.normalize_procurement_import_refs(array_fill('x'::text,array[201]))$$,'22023',null,'normalization batch is bounded');
select has_function('public','lookup_procurement_import_cases',array['text[]','text','uuid','integer','uuid'],'lookup API exists');
create temporary table test_run as select public.start_procurement_import_run() id;
select isnt((select id from test_run), null::uuid, 'run ID is generated');
create temporary table test_run2 as select public.start_procurement_import_run() id;
select isnt((select id from test_run2),(select id from test_run),'registrations have distinct generated IDs');
select throws_ok($$select public.start_procurement_import_run('39900000-0000-0000-0000-000000000002')$$,'42501',null,'foreign org rejected');
select is((select count(*) from public.lookup_procurement_import_cases(array[' alpha '])) ,1::bigint,'case normalization remains org scoped');
select throws_ok($$select * from public.lookup_procurement_import_cases(array['alpha'],'alpha',null)$$,'22023',null,'partial cursor rejected');
select is((select import_identity_version from public.purchase_requests where id='39900000-0000-0000-0000-000000000041'),null::smallint,'existing legacy row remains unmarked');
select is((select import_identity_facts from public.create_purchase_request('39900000-0000-0000-0000-000000000021','PR',null,'2026-01-02',12.3,'v2-pr',(select id from test_run))), (select facts from identity_vectors where type='pr'),'PR typed creation facts');
select is((select import_identity_facts from public.create_purchase_request('39900000-0000-0000-0000-000000000021',null,null,null,999999999999.99,'numeric-max',(select id from test_run))),(select facts from identity_vectors where type='numeric_max'),'maximum numeric shared vector');
select throws_ok($$select public.create_purchase_request('39900000-0000-0000-0000-000000000021',null,null,null,1000000000000,'numeric-overflow',(select id from test_run))$$,'22003',null,'out-of-range numeric is rejected');
select is((select import_identity_facts from public.create_rfq('39900000-0000-0000-0000-000000000021',null,null,null,0,'numeric-zero',(select id from test_run))),(select facts from identity_vectors where type='numeric_zero'),'zero numeric shared vector');
select is((select import_identity_facts from public.create_rfq('39900000-0000-0000-0000-000000000021','RFQ',null,'2026-01-02',12.3,'v2-rfq',(select id from test_run))), (select facts from identity_vectors where type='rfq'),'RFQ typed creation facts');
select is((select import_identity_facts from public.create_purchase_order('39900000-0000-0000-0000-000000000021','PO',null,'2026-01-02',12.3,'v2-po',(select id from test_run))), (select facts from identity_vectors where type='po'),'PO typed creation facts');
select is((select import_identity_facts from public.create_procurement_quotation('39900000-0000-0000-0000-000000000021','39900000-0000-0000-0000-000000000031',12.3,'2026-01-02','v2-quote',(select id from test_run))), (select facts from identity_vectors where type='quotation'),'quotation typed creation facts');
select is((select import_identity_facts from public.create_procurement_receipt('39900000-0000-0000-0000-000000000021','Complete','2026-01-02','GR','v2-gr',(select id from test_run))), (select facts from identity_vectors where type='receipt'),'receipt typed creation facts');
select is((select import_identity_facts from public.create_procurement_invoice('39900000-0000-0000-0000-000000000021','Received','2026-01-02','VI',100,'v2-vi',(select id from test_run),p_tax_treatment=>'exclusive',p_tax_amount=>10)), (select facts from identity_vectors where type='invoice'),'invoice typed creation facts');
select is((select import_identity_facts from public.create_procurement_invoice('39900000-0000-0000-0000-000000000021','Received','2026-01-02','VI-calculated',100,'v2-vi-calc',(select id from test_run),p_tax_treatment=>'exclusive',p_tax_amount=>0,p_tax_rate=>10)),(select facts from identity_vectors where type='invoice_calculated'),'snapshot follows typed tax calculation');
select is((select import_identity_facts from public.create_payment('39900000-0000-0000-0000-000000000021',null,'PAY',null,'2026-01-02',12.3,'v2-pay',(select id from test_run))), (select facts from identity_vectors where type='payment'),'payment typed creation facts');
select throws_ok($$select public.create_purchase_request('39900000-0000-0000-0000-000000000021','PR',null,null,1,'v2-pr',(select id from test_run2))$$,'23505',null,'same case key is unique across runs');
select lives_ok($$select public.create_purchase_request('39900000-0000-0000-0000-000000000024','PR',null,null,1,'v2-pr',(select id from test_run))$$,'same key in another case remains independent');
select is((select import_identity_version from public.create_purchase_request('39900000-0000-0000-0000-000000000021',null,null,null,null)), null::smallint,'keyless positional create remains unmarked');
select lives_ok($$select public.create_procurement_quotation('39900000-0000-0000-0000-000000000024','39900000-0000-0000-0000-000000000031',12.3,'2026-01-02','v2-edit',(select id from test_run))$$,'quote create remains allowed');
select lives_ok($$select public.select_procurement_quote((select id from public.procurement_quotations where import_key='v2-edit'))$$,'ordinary quote selection remains allowed');
select is((select import_identity_facts from public.procurement_quotations where import_key='v2-edit'),(select facts from identity_vectors where type='quotation'),'business edit retains original creation facts');
grant select on test_run to service_role;
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into public.procurements(id,org_id,title,status) values ('39900000-0000-0000-0000-000000000023','39900000-0000-0000-0000-000000000001','Historical','Paid');
set local role service_role;
insert into public.procurement_invoices(id,procurement_id,status,amount,tax_treatment,tax_amount) values ('39900000-0000-0000-0000-000000000051','39900000-0000-0000-0000-000000000023','Received',10,'exclusive',0);
insert into public.purchase_requests(procurement_id,status,import_key,import_batch_id) values ('39900000-0000-0000-0000-000000000023','Closed','historical-pr',(select id from test_run));
select is((select import_identity_facts from public.purchase_requests where import_key='historical-pr'),(select facts from identity_vectors where type='historical_pr'),'historical PR shared vector');
insert into public.procurement_quotations(procurement_id,vendor_id,reference,total_amount,import_key,import_batch_id) values ('39900000-0000-0000-0000-000000000023','39900000-0000-0000-0000-000000000031','Legacy quote',0,'historical-quote',(select id from test_run));
select is((select import_identity_facts from public.procurement_quotations where import_key='historical-quote'),(select facts from identity_vectors where type='historical_quotation'),'historical quotation shared vector');
insert into public.payments(procurement_id,invoice_id,reference_number,status,amount,import_key,import_batch_id) values ('39900000-0000-0000-0000-000000000023','39900000-0000-0000-0000-000000000051','Paid','Paid',1,'historical-payment',(select id from test_run));
select is((select import_identity_facts from public.payments where import_key='historical-payment'),(select facts from identity_vectors where type='historical_payment'),'historical linked payment shared vector');
select is((select count(*) from public.procurement_status_events where procurement_id='39900000-0000-0000-0000-000000000023'),0::bigint,'historical terminal rows create no status events');
select * from finish();
rollback;
