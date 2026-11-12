begin;
create extension if not exists pgtap;
select plan(10);

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
select lives_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','r3','linked-r3','erpnext','create','pending','{"erp_doc_kind":"goods-receipt","procurementId":"91120000-0000-0000-0000-00000000c004"}','91120000-0000-0000-0000-00000000f001') $$, 'new receipt on linked order is allowed');
select is(public.linked_step_state('91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-00000000c004','goods-receipt'), 'new_step', 'order-only case permits a new receipt');
select throws_ok($$ select public.linked_step_state('91120000-0000-0000-0000-000000000099','91120000-0000-0000-0000-00000000c001','goods-receipt') $$, '42501', 'purchase not found', 'another organization cannot inspect a purchase');
insert into procurements (id, org_id, code, title, status, requested_by_id, currency, total_value) values
 ('91120000-0000-0000-0000-00000000c005','91120000-0000-0000-0000-000000000001','W9-NONE','Ordinary purchase','Draft','91120000-0000-0000-0000-00000000f001','IDR',100);
select is(public.linked_step_state('91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-00000000c005','goods-receipt'),'not_applicable','a purchase without links is unaffected');
select lives_ok($$ insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('91120000-0000-0000-0000-000000000001','procurement','r4','linked-r4','erpnext','create','pending','{"erp_doc_kind":"goods-receipt","procurementId":"91120000-0000-0000-0000-00000000c005"}','91120000-0000-0000-0000-00000000f001') $$, 'ordinary purchase remains allowed');
select * from finish();
rollback;
