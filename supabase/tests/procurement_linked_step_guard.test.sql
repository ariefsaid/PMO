begin;
create extension if not exists pgtap;
select plan(29);

insert into organizations (id, name, default_currency) values
  ('91120000-0000-0000-0000-000000000001', 'W9 ERP Link Verify', 'IDR');
insert into auth.users (id, email) values
  ('91120000-0000-0000-0000-00000000a001', 'w9-admin@example.test'),
  ('91120000-0000-0000-0000-00000000f001', 'w9-finance@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('91120000-0000-0000-0000-00000000a001', '91120000-0000-0000-0000-000000000001', 'W9 Admin', 'w9-admin@example.test', 'Admin', 'active'),
  ('91120000-0000-0000-0000-00000000f001', '91120000-0000-0000-0000-000000000001', 'W9 Finance', 'w9-finance@example.test', 'Finance', 'active');

insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, version_major, config, activated_at, status) values
  ('91120000-0000-0000-0000-000000000001', 'erpnext', 'https://w9.example.test', 'fixture-only', 16, '{"company":"W9 Example"}', now() - interval '1 day', 'active');
insert into external_domain_ownership (org_id, external_tier, domain, created_at) values
  ('91120000-0000-0000-0000-000000000001', 'erpnext', 'procurement', now() - interval '12 hours');

insert into procurements (id, org_id, code, title, status, requested_by_id, currency, total_value, origin) values
  ('91120000-0000-0000-0000-00000000c001', '91120000-0000-0000-0000-000000000001', 'W9-RCP', 'Existing ERP receipt', 'Draft', '91120000-0000-0000-0000-00000000f001', 'IDR', 100, 'erp_link'),
  ('91120000-0000-0000-0000-00000000c002', '91120000-0000-0000-0000-000000000001', 'W9-INV', 'Existing ERP invoice', 'Draft', '91120000-0000-0000-0000-00000000f001', 'IDR', 100, 'erp_link'),
  ('91120000-0000-0000-0000-00000000c003', '91120000-0000-0000-0000-000000000001', 'W9-PAY', 'Existing ERP payment', 'Draft', '91120000-0000-0000-0000-00000000f001', 'IDR', 100, 'erp_link'),
  ('91120000-0000-0000-0000-00000000c004', '91120000-0000-0000-0000-000000000001', 'W9-NEXT', 'ERP order with no receipt yet', 'Draft', '91120000-0000-0000-0000-00000000f001', 'IDR', 100, 'erp_link');

select upsert_erp_purchase_documents('91120000-0000-0000-0000-000000000001', $$[
  {"erp_doctype":"Purchase Receipt","erp_name":"W9-RCP-EXISTING","supplier":"S-W9","supplier_name":"W9 Supplier","currency":"IDR","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_modified":"2026-11-12T00:00:00Z"},
  {"erp_doctype":"Purchase Invoice","erp_name":"W9-PI-EXISTING","supplier":"S-W9","supplier_name":"W9 Supplier","currency":"IDR","grand_total":100,"net_total":100,"outstanding_amount":0,"erp_docstatus":1,"erp_modified":"2026-11-12T00:00:00Z"},
  {"erp_doctype":"Purchase Invoice","erp_name":"W9-PI-PAYMENT","supplier":"S-W9","supplier_name":"W9 Supplier","currency":"IDR","grand_total":100,"net_total":100,"outstanding_amount":0,"erp_docstatus":1,"erp_modified":"2026-11-12T00:00:00Z"},
  {"erp_doctype":"Payment Entry","erp_name":"W9-PE-EXISTING","supplier":"S-W9","supplier_name":"W9 Supplier","currency":"IDR","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_modified":"2026-11-12T00:00:00Z"},
  {"erp_doctype":"Purchase Order","erp_name":"W9-PO-EXISTING","supplier":"S-W9","supplier_name":"W9 Supplier","currency":"IDR","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_modified":"2026-11-12T00:00:00Z"}
]$$::jsonb);

insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id, linked_by)
select '91120000-0000-0000-0000-000000000001', v.procurement_id, d.id, '91120000-0000-0000-0000-00000000a001'
  from (values
    ('91120000-0000-0000-0000-00000000c001'::uuid, 'Purchase Receipt', 'W9-RCP-EXISTING'),
    ('91120000-0000-0000-0000-00000000c002'::uuid, 'Purchase Invoice', 'W9-PI-EXISTING'),
    ('91120000-0000-0000-0000-00000000c003'::uuid, 'Purchase Invoice', 'W9-PI-PAYMENT'),
    ('91120000-0000-0000-0000-00000000c003'::uuid, 'Payment Entry', 'W9-PE-EXISTING'),
    ('91120000-0000-0000-0000-00000000c004'::uuid, 'Purchase Order', 'W9-PO-EXISTING')
  ) as v(procurement_id, erp_doctype, erp_name)
  join erp_purchase_documents d on d.org_id = '91120000-0000-0000-0000-000000000001'
    and d.erp_doctype = v.erp_doctype and d.erp_name = v.erp_name;


select throws_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','r1','linked-r1','erpnext','create','pending','{"erp_doc_kind":"goods-receipt","procurementId":"91120000-0000-0000-0000-00000000c001"}','91120000-0000-0000-0000-00000000a001') $$, 'P0001', 'step_already_recorded', 'Admin linked receipt is refused');
select throws_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','r2','linked-r2','erpnext','create','pending','{"erp_doc_kind":"goods-receipt","procurementId":"91120000-0000-0000-0000-00000000c001"}','91120000-0000-0000-0000-00000000f001') $$, 'P0001', 'step_already_recorded', 'Finance linked receipt is refused');
select throws_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','i1','linked-i1','erpnext','create','pending','{"erp_doc_kind":"purchase-invoice","procurementId":"91120000-0000-0000-0000-00000000c002"}','91120000-0000-0000-0000-00000000a001') $$, 'P0001', 'step_already_recorded', 'Admin linked invoice is refused');
select throws_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','i2','linked-i2','erpnext','create','pending','{"erp_doc_kind":"purchase-invoice","procurementId":"91120000-0000-0000-0000-00000000c002"}','91120000-0000-0000-0000-00000000f001') $$, 'P0001', 'step_already_recorded', 'Finance linked invoice is refused');
select is((select count(*)::int from external_command_outbox where org_id='91120000-0000-0000-0000-000000000001'),0,'refused steps create no outbox rows');
select lives_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('91120000-0000-0000-0000-000000000001','procurement','odoo-r','odoo-linked-r','odoo','create','pending','{"erp_doc_kind":"goods-receipt","procurementId":"91120000-0000-0000-0000-00000000c001"}') $$, 'Odoo insert is not judged by the linked-step trigger');
select lives_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','r3','linked-r3','erpnext','create','pending','{"erp_doc_kind":"goods-receipt","procurementId":"91120000-0000-0000-0000-00000000c004"}','91120000-0000-0000-0000-00000000f001') $$, 'new receipt on linked order is allowed');
select is(public.linked_step_state('91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-00000000c004','goods-receipt'), 'new_step', 'order-only case permits a new receipt');
select throws_ok($$ select public.linked_step_state('91120000-0000-0000-0000-000000000099','91120000-0000-0000-0000-00000000c001','goods-receipt') $$, '42501', 'purchase not found', 'another organization cannot inspect a purchase');
insert into procurements (id, org_id, code, title, status, requested_by_id, currency, total_value) values
 ('91120000-0000-0000-0000-00000000c005','91120000-0000-0000-0000-000000000001','W9-NONE','Ordinary purchase','Draft','91120000-0000-0000-0000-00000000f001','IDR',100);
select is(public.linked_step_state('91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-00000000c005','goods-receipt'),'not_applicable','a purchase without links is unaffected');
select lives_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','r4','linked-r4','erpnext','create','pending','{"erp_doc_kind":"goods-receipt","procurementId":"91120000-0000-0000-0000-00000000c005"}','91120000-0000-0000-0000-00000000f001') $$, 'ordinary purchase remains allowed');
select upsert_erp_purchase_documents('91120000-0000-0000-0000-000000000001', $$[
  {"erp_doctype":"Purchase Receipt","erp_name":"W9-RCP-LATER","supplier":"S-W9","currency":"IDR","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_modified":"2026-11-12T00:00:00Z"}
]$$::jsonb);
insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id, linked_by)
select org_id, '91120000-0000-0000-0000-00000000c004', id, '91120000-0000-0000-0000-00000000a001'
  from erp_purchase_documents where org_id='91120000-0000-0000-0000-000000000001' and erp_name='W9-RCP-LATER';
select throws_ok($$ select claim_outbox_for_commit((select id from external_command_outbox where idempotency_key='linked-r3')) $$,
  'P0001', 'procurement-create-refused: step_already_recorded', 'a queued receipt is refused if its step becomes linked before claim');
select is((select state from external_command_outbox where idempotency_key='linked-r3'),'pending','the refused queued receipt is not claimed');

insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','queued-unlinked','queued-unlinked','erpnext','create','pending','{"erp_doc_kind":"purchase-invoice","procurementId":"91120000-0000-0000-0000-00000000c004"}','91120000-0000-0000-0000-00000000f001');
select upsert_erp_purchase_documents('91120000-0000-0000-0000-000000000001', $$[
  {"erp_doctype":"Purchase Receipt","erp_name":"W13-R","currency":"IDR","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_modified":"2026-11-12T00:00:00Z","purchase_orders":["W9-PO-EXISTING"]},
  {"erp_doctype":"Purchase Invoice","erp_name":"W13-I","currency":"IDR","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_modified":"2026-11-12T00:00:00Z","purchase_orders":["W9-PO-EXISTING"]}
]$$::jsonb);
delete from procurement_erp_links where procurement_id='91120000-0000-0000-0000-00000000c004' and erp_purchase_document_id=(select id from erp_purchase_documents where erp_name='W9-RCP-LATER');
select throws_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','W13-R','W13-R','erpnext','create','pending','{"erp_doc_kind":"goods-receipt","procurementId":"91120000-0000-0000-0000-00000000c004"}','91120000-0000-0000-0000-00000000f001') $$, 'P0001', 'ERP W13-R already records this; link it instead of sending a new one.', 'goods-receipt existing ERP document is refused');
select is((select count(*)::int from external_command_outbox where idempotency_key='W13-R'),0,'goods-receipt refusal creates no outbox row');
select throws_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','W13-I','W13-I','erpnext','create','pending','{"erp_doc_kind":"purchase-invoice","procurementId":"91120000-0000-0000-0000-00000000c004"}','91120000-0000-0000-0000-00000000f001') $$, 'P0001', 'ERP W13-I already records this; link it instead of sending a new one.', 'purchase-invoice existing ERP document is refused');
select is((select count(*)::int from external_command_outbox where idempotency_key='W13-I'),0,'purchase-invoice refusal creates no outbox row');
select throws_ok($$ select claim_outbox_for_commit((select id from external_command_outbox where idempotency_key='queued-unlinked')) $$, 'P0001', 'procurement-create-refused: ERP W13-I already records this; link it instead of sending a new one.', 'queued invoice is refused with ERP document name');
select is((select state from external_command_outbox where idempotency_key='queued-unlinked'),'pending','refused queued invoice is not claimed');
update erp_purchase_documents set purchase_orders=array['OTHER'] where erp_name='W13-R';
select is(public.linked_step_state('91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-00000000c004','goods-receipt'),'new_step','goods-receipt on another order is allowed');
update erp_purchase_documents set purchase_orders=array['W9-PO-EXISTING'], erp_docstatus=2 where erp_name='W13-R';
select is(public.linked_step_state('91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-00000000c004','goods-receipt'),'new_step','cancelled goods-receipt is allowed');
update erp_purchase_documents set purchase_orders=array['OTHER'] where erp_name='W13-I';
select is(public.linked_step_state('91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-00000000c004','purchase-invoice'),'new_step','purchase-invoice on another order is allowed');
update erp_purchase_documents set purchase_orders=array['W9-PO-EXISTING'], erp_docstatus=2 where erp_name='W13-I';
select is(public.linked_step_state('91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-00000000c004','purchase-invoice'),'new_step','cancelled purchase-invoice is allowed');
update erp_purchase_documents set erp_docstatus=1, is_return=true where erp_name in ('W13-R','W13-I');
select is(public.linked_step_state('91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-00000000c004','goods-receipt'),'new_step','returned receipt is allowed');
select is(public.linked_step_state('91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-00000000c004','purchase-invoice'),'new_step','returned invoice is allowed');
-- The trigger passes unknown purchases through; claim must refuse every such command.
select lives_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','91120000-0000-0000-0000-00000000c001','nf-missing','erpnext','create','pending','{"erp_doc_kind":"goods-receipt"}','91120000-0000-0000-0000-00000000f001') $$, 'missing procurement id passes the insert trigger');
select throws_ok($$ select claim_outbox_for_commit((select id from external_command_outbox where idempotency_key='nf-missing')) $$, 'P0001', 'procurement-create-refused: purchase_not_found', 'claim refuses missing procurement id');
insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','nf-malformed-record','nf-malformed','erpnext','create','pending','{"erp_doc_kind":"goods-receipt","procurementId":"not-a-uuid"}','91120000-0000-0000-0000-00000000f001');
select throws_ok($$ select claim_outbox_for_commit((select id from external_command_outbox where idempotency_key='nf-malformed')) $$, 'P0001', 'procurement-create-refused: purchase_not_found', 'claim refuses malformed procurement id');
insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','nf-foreign-record','nf-foreign','erpnext','create','pending','{"erp_doc_kind":"goods-receipt","procurementId":"91120000-0000-0000-0000-000000000001"}','91120000-0000-0000-0000-00000000f001');
select throws_ok($$ select claim_outbox_for_commit((select id from external_command_outbox where idempotency_key='nf-foreign')) $$, 'P0001', 'procurement-create-refused: purchase_not_found', 'claim refuses a non-procurement uuid');
select * from finish();
rollback;
