-- #1505 O2 P7 (migration 0507): the purchase page apply and census.
-- AC-OPP-074 DB half (a page and its cursor commit together; a replay writes identical rows; a late record is picked up),
-- AC-OPP-073 DB half (the census tombstones what Odoo no longer returns and clears it when it returns), AC-OPP-072
-- (an Odoo-native document is stored once at its newest figures; an anchored orphan is proposed, never created).
begin;
select plan(44);

insert into organizations (id, name) values
 ('a5070000-0000-0000-0000-000000000001','Apply A'),
 ('a5070000-0000-0000-0000-000000000002','Apply B');
insert into auth.users (id, email) values ('a5070000-0000-0000-0000-0000000000a1','a507-a@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a5070000-0000-0000-0000-0000000000a1','a5070000-0000-0000-0000-000000000001','A Fin','a507-a@example.com','Finance','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a5070000-0000-0000-0000-000000000001','odoo','https://o.example.test','a507_a','active','{"odoo_company_id":1}', now()),
 ('a5070000-0000-0000-0000-000000000002','odoo','https://o.example.test','a507_b','active','{"odoo_company_id":1}', now());
insert into external_domain_ownership (org_id, external_tier, domain) values
 ('a5070000-0000-0000-0000-000000000001','odoo','procurement'),
 ('a5070000-0000-0000-0000-000000000002','odoo','procurement');
insert into projects (id, org_id, name, status) values
 ('a5070000-0000-0000-0000-0000000000d1','a5070000-0000-0000-0000-000000000001','Apply project','Ongoing Project');
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id) values
 ('a5070000-0000-0000-0000-000000000001','a5070000-0000-0000-0000-0000000000d1','odoo','88');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
 ('a5070000-0000-0000-0000-0000000000f1','a5070000-0000-0000-0000-000000000001','A case','a5070000-0000-0000-0000-0000000000a1','IDR',0,'Draft'),
 ('a5070000-0000-0000-0000-0000000000f2','a5070000-0000-0000-0000-000000000002','B case','a5070000-0000-0000-0000-0000000000a1','IDR',0,'Draft');
-- PMO-owned mirror rows of org A, one per kind, each mapped to its model-qualified Odoo ref; org B has the SAME Odoo ids.
insert into purchase_orders (id, org_id, procurement_id, status, amount, currency) values
 ('a5070000-0000-0000-0000-0000000000e1','a5070000-0000-0000-0000-000000000001','a5070000-0000-0000-0000-0000000000f1','Draft',100,'IDR'),
 ('a5070000-0000-0000-0000-0000000000b1','a5070000-0000-0000-0000-000000000002','a5070000-0000-0000-0000-0000000000f2','Draft',100,'IDR');
insert into procurement_receipts (id, org_id, procurement_id, status) values
 ('a5070000-0000-0000-0000-0000000000e2','a5070000-0000-0000-0000-000000000001','a5070000-0000-0000-0000-0000000000f1','Partial');
insert into procurement_invoices (id, org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount) values
 ('a5070000-0000-0000-0000-0000000000e3','a5070000-0000-0000-0000-000000000001','a5070000-0000-0000-0000-0000000000f1','Received',100,'IDR','inclusive',0),
 ('a5070000-0000-0000-0000-0000000000e5','a5070000-0000-0000-0000-000000000001','a5070000-0000-0000-0000-0000000000f1','Received',50,'IDR','inclusive',0),
 ('a5070000-0000-0000-0000-0000000000e6','a5070000-0000-0000-0000-000000000001','a5070000-0000-0000-0000-0000000000f1','Received',60,'IDR','inclusive',0),
 ('a5070000-0000-0000-0000-0000000000e7','a5070000-0000-0000-0000-000000000001','a5070000-0000-0000-0000-0000000000f1','Received',70,'IDR','inclusive',0),
 ('a5070000-0000-0000-0000-0000000000b3','a5070000-0000-0000-0000-000000000002','a5070000-0000-0000-0000-0000000000f2','Received',100,'IDR','inclusive',0);
insert into payments (id, org_id, procurement_id, status, amount, currency) values
 ('a5070000-0000-0000-0000-0000000000e4','a5070000-0000-0000-0000-000000000001','a5070000-0000-0000-0000-0000000000f1','Scheduled',10,'IDR');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id, created_at) values
 ('a5070000-0000-0000-0000-000000000001','procurement','a5070000-0000-0000-0000-0000000000e1','odoo','purchase.order:7', now() - interval '1 day'),
 ('a5070000-0000-0000-0000-000000000001','procurement','a5070000-0000-0000-0000-0000000000e2','odoo','stock.picking:7', now() - interval '1 day'),
 ('a5070000-0000-0000-0000-000000000001','procurement','a5070000-0000-0000-0000-0000000000e3','odoo','account.move:7', now() - interval '1 day'),
 ('a5070000-0000-0000-0000-000000000001','procurement','a5070000-0000-0000-0000-0000000000e4','odoo','account.payment:7', now() - interval '1 day'),
 ('a5070000-0000-0000-0000-000000000001','procurement','a5070000-0000-0000-0000-0000000000e5','odoo','account.move:8', now() - interval '1 day'),
 ('a5070000-0000-0000-0000-000000000002','procurement','a5070000-0000-0000-0000-0000000000b1','odoo','purchase.order:7', now() - interval '1 day'),
 ('a5070000-0000-0000-0000-000000000002','procurement','a5070000-0000-0000-0000-0000000000b3','odoo','account.move:7', now() - interval '1 day'),
 ('a5070000-0000-0000-0000-000000000001','companies','a5070000-0000-0000-0000-0000000000c9','odoo','Vendor:41', now());

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- AC-OPP-074 a linked bill: the whole money header, the derived status and the state land together with the cursor.
select is(public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"7","name":"BILL/2026/0007","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"posted","status":"Paid","docstatus":1,"cancelled":false,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","due_date":"2026-11-30",
            "bill_no":"INV-7","currency":"IDR","analytic_ids":["88"],"amount_total":"98.00","amount_untaxed":"100.00","residual":"0.00",
            "money":{"gross":"100.00","vat":"11.00","withheld":"2.00","outstanding":"0.00"}}}]$$::jsonb, 'cur-1'), 1,
  'AC-OPP-074 a page of one linked bill applies');
reset role;
select results_eq($$select status::text, amount, tax_amount, withheld_amount, erp_outstanding_amount, erp_state, erp_docstatus, erp_modified, erp_attention from procurement_invoices where id='a5070000-0000-0000-0000-0000000000e3'$$,
  $$values ('Paid'::text, 100.00::numeric, 11.00::numeric, 2.00::numeric, 0.00::numeric, 'posted'::text, 1::smallint, '2026-11-01 10:00:00'::text, null::text)$$,
  'AC-OPP-074 the linked bill carries Odoo''s figures, derived status and state');
select is((select watermark_cursor from external_sync_watermarks where org_id='a5070000-0000-0000-0000-000000000001' and domain='purchase:bill'), 'cur-1', 'AC-OPP-074 the cursor advanced with the page');
select is((select erp_read_at is not null from procurement_invoices where id='a5070000-0000-0000-0000-0000000000e3'), true, 'AC-OPP-071 the read time is stamped');

-- an older write_date never overwrites a newer row
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"7","name":"BILL/2026/0007","active":true,"source_write_date":"2026-11-01 09:00:00",
   "attrs":{"state":"draft","status":"Received","docstatus":0,"cancelled":false,"amount_total":"1.00","residual":"1.00",
            "money":{"gross":"1.00","vat":"0.00","withheld":"0.00","outstanding":"1.00"}}}]$$::jsonb, 'cur-2');
reset role;
select results_eq($$select status::text, amount, erp_state from procurement_invoices where id='a5070000-0000-0000-0000-0000000000e3'$$,
  $$values ('Paid'::text, 100.00::numeric, 'posted'::text)$$, 'AC-OPP-074 an older write_date never overwrites a newer row');
select is((select watermark_cursor from external_sync_watermarks where org_id='a5070000-0000-0000-0000-000000000001' and domain='purchase:bill'), 'cur-2', 'AC-OPP-074 the cursor still advances past a no-op page');

-- FR-OPP-082 a change missing part of the money header writes none of it (state still refreshes, the reason is recorded)
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"7","name":"BILL/2026/0007","active":true,"source_write_date":"2026-11-02 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"cancelled":false,"amount_total":"5.00","residual":"5.00","money":null}}]$$::jsonb, 'cur-3');
reset role;
select results_eq($$select status::text, amount, tax_amount, withheld_amount, erp_outstanding_amount, erp_modified, erp_attention from procurement_invoices where id='a5070000-0000-0000-0000-0000000000e3'$$,
  $$values ('Paid'::text, 100.00::numeric, 11.00::numeric, 2.00::numeric, 0.00::numeric, '2026-11-02 10:00:00'::text, 'money-header-incomplete'::text)$$,
  'AC-OPP-043 a header missing a part writes none of the money or the status, and says so');
-- a header the database''s own bound would refuse is not written either, and the page still applies
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $j$[
  {"external_id":"7","name":"BILL/2026/0007","active":true,"source_write_date":"2026-11-03 10:00:00",
   "attrs":{"state":"posted","status":"Paid","docstatus":1,"cancelled":false,"amount_total":"5.00","residual":"0.00",
            "money":{"gross":"5.00","vat":"0.00","withheld":"9.00","outstanding":"0.00"}}}]$j$::jsonb, 'cur-4')$$,
  'AC-OPP-043 a withheld total above the gross does not poison the page');
reset role;
select results_eq($$select amount, withheld_amount, erp_attention from procurement_invoices where id='a5070000-0000-0000-0000-0000000000e3'$$,
  $$values (100.00::numeric, 2.00::numeric, 'money-header-invalid'::text)$$, 'AC-OPP-043 an out-of-bounds header is flagged, not written');

-- a recovered header clears the reason
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"7","name":"BILL/2026/0007","active":true,"source_write_date":"2026-11-04 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"cancelled":false,"amount_total":"98.00","residual":"98.00",
            "money":{"gross":"100.00","vat":"11.00","withheld":"2.00","outstanding":"98.00"}}}]$$::jsonb, 'cur-5');
reset role;
select results_eq($$select status::text, erp_outstanding_amount, erp_attention from procurement_invoices where id='a5070000-0000-0000-0000-0000000000e3'$$,
  $$values ('Received'::text, 98.00::numeric, null::text)$$, 'AC-OPP-043 a whole header refreshes the money and clears the reason');

-- order, receipt, payment (linked)
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','purchase-order', $$[
  {"external_id":"7","name":"P00007","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"purchase","status":"Issued","docstatus":1,"cancelled":false,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","currency":"IDR","analytic_ids":["88"],"amount_total":"111.00","amount_untaxed":"100.00"}}]$$::jsonb, 'po-1');
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','receipt', $$[
  {"external_id":"7","name":"WH/IN/00007","active":true,"source_write_date":"2026-11-01 11:00:00",
   "attrs":{"state":"done","status":"Complete","docstatus":1,"cancelled":false}}]$$::jsonb, 'gr-1');
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','payment', $$[
  {"external_id":"7","name":"PBNK/2026/0007","active":true,"source_write_date":"2026-11-01 12:00:00",
   "attrs":{"state":"paid","status":"Paid","docstatus":1,"cancelled":false,"amount":"98.00"}}]$$::jsonb, 'pay-1');
reset role;
select results_eq($$select status, erp_docstatus, erp_state, amount from purchase_orders where id='a5070000-0000-0000-0000-0000000000e1'$$,
  $$values ('Issued'::text, 1::smallint, 'purchase'::text, 111.00::numeric)$$, 'AC-OPP-071 a confirmed order is Issued at Odoo''s total (the oracle, ADR-0048)');
select results_eq($$select status::text, erp_docstatus, erp_state from procurement_receipts where id='a5070000-0000-0000-0000-0000000000e2'$$,
  $$values ('Complete'::text, 1::smallint, 'done'::text)$$, 'AC-OPP-071 a done transfer is Complete');
select results_eq($$select status, erp_docstatus, erp_state, amount from payments where id='a5070000-0000-0000-0000-0000000000e4'$$,
  $$values ('Paid'::text, 1::smallint, 'paid'::text, 98.00::numeric)$$, 'AC-OPP-071 a posted payment is Paid at Odoo''s amount');

-- a cancelled order is marked, never deleted
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','purchase-order', $$[
  {"external_id":"7","name":"P00007","active":true,"source_write_date":"2026-11-05 10:00:00",
   "attrs":{"state":"cancel","status":"Closed","docstatus":2,"cancelled":true,"amount_total":"111.00"}}]$$::jsonb, 'po-2');
reset role;
select results_eq($$select status, erp_docstatus, erp_cancelled_at is not null, amount from purchase_orders where id='a5070000-0000-0000-0000-0000000000e1'$$,
  $$values ('Closed'::text, 2::smallint, true, 111.00::numeric)$$, 'AC-OPP-071 a cancelled order is Closed with a tombstone, not deleted, its figure kept');

-- AC-OPP-072 Odoo-native documents: stored once at the newest figures, whether or not the page lists them twice
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"21","name":"BILL/2026/0021","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","due_date":"2026-11-30","bill_no":"INV-21","currency":"IDR","analytic_ids":["88"],"amount_total":"300.00","amount_untaxed":"300.00","residual":"300.00","money":{"gross":"300.00","vat":"0.00","withheld":"0.00","outstanding":"300.00"}}},
  {"external_id":"21","name":"BILL/2026/0021","active":true,"source_write_date":"2026-11-02 10:00:00",
   "attrs":{"state":"posted","status":"Paid","docstatus":1,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","due_date":"2026-11-30","bill_no":"INV-21","currency":"IDR","analytic_ids":["88"],"amount_total":"300.00","amount_untaxed":"300.00","residual":"0.00","money":{"gross":"300.00","vat":"0.00","withheld":"0.00","outstanding":"0.00"}}},
  {"external_id":"22","name":"BILL/2026/0022","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"partner":"99","partner_name":"Stranger","date":"2026-10-30","currency":"IDR","analytic_ids":["777"],"amount_total":"50.00","residual":"50.00"}},
  {"external_id":"23","name":"/","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"draft","status":"Received","docstatus":0,"partner":"41","currency":"IDR","amount_total":"10.00"}},
  {"external_id":"7","name":"BILL/2026/0007","active":true,"source_write_date":"2026-11-04 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"partner":"41","partner_name":"Vendor V","currency":"IDR","analytic_ids":["88"],"amount_total":"98.00","residual":"98.00"}}]$$::jsonb, 'cur-6');
reset role;
select is((select count(*) from erp_purchase_documents where org_id='a5070000-0000-0000-0000-000000000001' and erp_doctype='Purchase Invoice' and external_ref='account.move:21'), 1::bigint, 'AC-OPP-072 a bill listed twice is stored once');
select results_eq($$select outstanding_amount, grand_total, erp_status, erp_docstatus, pmo_owned, bill_no, supplier_name, project_ids, erp_attention from erp_purchase_documents where external_ref='account.move:21' and org_id='a5070000-0000-0000-0000-000000000001'$$,
  $$values (0.00::numeric, 300.00::numeric, 'Paid'::text, 1::smallint, false, 'INV-21'::text, 'Vendor V'::text, array['a5070000-0000-0000-0000-0000000000d1']::uuid[], null::text)$$,
  'AC-OPP-072 a native bill is stored once at its newest figures, attributed to the linked project');
select is((select erp_attention from erp_purchase_documents where external_ref='account.move:22' and org_id='a5070000-0000-0000-0000-000000000001'), 'vendor-unmapped,project-unmapped',
  'AC-OPP-072 an unmapped vendor and project are stored with a needs-attention reason, not dropped');
select is((select count(*) from erp_purchase_documents where external_ref='account.move:23' and org_id='a5070000-0000-0000-0000-000000000001'), 0::bigint, 'AC-OPP-072 a draft native document is not listed');
select is((select pmo_owned from erp_purchase_documents where external_ref='account.move:7' and org_id='a5070000-0000-0000-0000-000000000001'), true, 'AC-OPP-072 a document PMO pushed is flagged as PMO''s, so the case counts it once');
select is((select count(*) from procurement_invoices where org_id='a5070000-0000-0000-0000-000000000001'), 4::bigint, 'AC-OPP-072 the feed never creates a PMO bill');

-- an anchored orphan (the anchor names a PMO bill, no link row): proposed for adoption, never created
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"31","name":"BILL/2026/0031","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"anchor_key":"bill:a5070000-0000-0000-0000-0000000000e9","partner":"41","currency":"IDR","amount_total":"70.00","residual":"70.00"}}]$$::jsonb, 'cur-7');
reset role;
select results_eq($$select adoption_key, pmo_owned from erp_purchase_documents where external_ref='account.move:31' and org_id='a5070000-0000-0000-0000-000000000001'$$,
  $$values ('bill:a5070000-0000-0000-0000-0000000000e9'::text, true)$$, 'AC-OPP-072 an anchored orphan is proposed for adoption, and is PMO''s, so it is not offered as an unlinked document');
select is(public.erp_document_recorded_by_pmo('a5070000-0000-0000-0000-000000000001','Purchase Invoice','BILL/2026/0031'), true, 'AC-OPP-072 link-existing refuses the anchored orphan (the recorded-by-PMO rule)');
select is(public.erp_document_recorded_by_pmo('a5070000-0000-0000-0000-000000000001','Purchase Invoice','BILL/2026/0007'), true, 'AC-OPP-072 link-existing refuses a bill PMO pushed (a case counts it once)');
select is(public.erp_document_recorded_by_pmo('a5070000-0000-0000-0000-000000000001','Purchase Invoice','BILL/2026/0021'), false, 'AC-OPP-072 an Odoo-native bill stays linkable');
select is((select count(*) from procurement_invoices where org_id='a5070000-0000-0000-0000-000000000001'), 4::bigint, 'AC-OPP-072 the orphan created no PMO bill');
-- once the link row exists the proposal clears
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
 ('a5070000-0000-0000-0000-000000000001','procurement','a5070000-0000-0000-0000-0000000000e7','odoo','account.move:31');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"31","name":"BILL/2026/0031","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"anchor_key":"bill:a5070000-0000-0000-0000-0000000000e9","partner":"41","currency":"IDR","amount_total":"70.00","residual":"70.00"}}]$$::jsonb, 'cur-8');
reset role;
select results_eq($$select adoption_key, pmo_owned from erp_purchase_documents where external_ref='account.move:31' and org_id='a5070000-0000-0000-0000-000000000001'$$,
  $$values (null::text, true)$$, 'AC-OPP-072 a linked anchor is no longer a proposal');
delete from external_refs where org_id='a5070000-0000-0000-0000-000000000001' and external_record_id='account.move:31';

-- AC-OPP-074 a replay writes identical rows; a record committed late (earlier write_date) is picked up
create temp table before_replay as select external_ref, erp_name, grand_total, outstanding_amount, erp_status, erp_docstatus, project_ids, pmo_owned, erp_attention, erp_modified
  from erp_purchase_documents where org_id='a5070000-0000-0000-0000-000000000001';
grant select on before_replay to public;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"21","name":"BILL/2026/0021","active":true,"source_write_date":"2026-11-02 10:00:00",
   "attrs":{"state":"posted","status":"Paid","docstatus":1,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","due_date":"2026-11-30","bill_no":"INV-21","currency":"IDR","analytic_ids":["88"],"amount_total":"300.00","amount_untaxed":"300.00","residual":"0.00","money":{"gross":"300.00","vat":"0.00","withheld":"0.00","outstanding":"0.00"}}}]$$::jsonb, 'cur-9');
reset role;
select is((select count(*) from before_replay b join erp_purchase_documents d on d.org_id='a5070000-0000-0000-0000-000000000001' and d.external_ref=b.external_ref
            where (b.erp_name, b.grand_total, b.outstanding_amount, b.erp_status, b.erp_docstatus, b.project_ids, b.pmo_owned, b.erp_attention, b.erp_modified)
               is not distinct from (d.erp_name, d.grand_total, d.outstanding_amount, d.erp_status, d.erp_docstatus, d.project_ids, d.pmo_owned, d.erp_attention, d.erp_modified)),
  (select count(*) from before_replay), 'AC-OPP-074 a replayed window leaves identical rows');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"41","name":"BILL/2026/0041","active":true,"source_write_date":"2026-10-15 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"partner":"41","currency":"IDR","amount_total":"12.00","residual":"12.00"}}]$$::jsonb, 'cur-10');
reset role;
select is((select count(*) from erp_purchase_documents where external_ref='account.move:41' and org_id='a5070000-0000-0000-0000-000000000001'), 1::bigint, 'AC-OPP-074 a record committed late with an earlier write_date is picked up');

-- AC-OPP-074 a failure leaves the cursor (and every earlier row of the page) where it was
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $j$[
  {"external_id":"51","name":"BILL/2026/0051","active":true,"source_write_date":"2026-11-01 10:00:00","attrs":{"state":"posted","status":"Received","docstatus":1,"amount_total":"1.00"}},
  {"external_id":"52","name":"BILL/2026/0052","active":true,"source_write_date":"not a date","attrs":{"state":"posted","status":"Received","docstatus":1}}]$j$::jsonb, 'cur-FAIL')$$,
  '22023', null, 'AC-OPP-074 a malformed row fails the whole page');
reset role;
select is((select watermark_cursor from external_sync_watermarks where org_id='a5070000-0000-0000-0000-000000000001' and domain='purchase:bill'), 'cur-10', 'AC-OPP-074 the cursor did not advance');
select is((select count(*) from erp_purchase_documents where external_ref='account.move:51' and org_id='a5070000-0000-0000-0000-000000000001'), 0::bigint, 'AC-OPP-074 no row of the failed page was written');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $j$[{"external_id":"x","name":"n","active":true,"source_write_date":"2026-11-01 10:00:00","attrs":{"docstatus":1}}]$j$::jsonb, 'c')$$,
  '22023', null, 'AC-OPP-074 a non-numeric Odoo id fails the page');
select throws_ok($$select public.apply_odoo_purchase_page('a5070000-0000-0000-0000-000000000001','bill', $j$[{"external_id":"5","name":"n","active":true,"source_write_date":"2026-11-01 10:00:00","attrs":{"docstatus":9}}]$j$::jsonb, 'c')$$,
  '22023', null, 'AC-OPP-074 an impossible document status fails the page');
reset role;

-- AC-OPP-073 the census: ids Odoo still returns are marked; the rest are tombstoned at finish; a returning id clears it.
-- Org A holds linked bills 7 and 8 and native bills 21, 22, 31 and 41; the census sees 7 and 21.
create temp table runs as select now() + interval '10 minutes' as r1, now() + interval '20 minutes' as r2, now() + interval '30 minutes' as r3;
grant select on runs to public;
update external_refs set created_at = now() - interval '1 day' where org_id='a5070000-0000-0000-0000-000000000001';
update erp_purchase_documents set updated_at = now() - interval '1 day' where org_id='a5070000-0000-0000-0000-000000000001';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.mark_odoo_purchase_census_seen('a5070000-0000-0000-0000-000000000001','bill', (select r1 from runs), array['7','21']);
select is(public.finish_odoo_purchase_census('a5070000-0000-0000-0000-000000000001','bill', (select r1 from runs), 'cen-1'), 4,
  'AC-OPP-073 the census finish tombstones what the census did not see (linked bill 8; native 22, 31, 41; and nothing else)');
reset role;
select results_eq($$select erp_docstatus, erp_state, erp_cancelled_at is not null from procurement_invoices where id='a5070000-0000-0000-0000-0000000000e5'$$,
  $$values (2::smallint, 'deleted'::text, true)$$, 'AC-OPP-073 a PMO bill Odoo no longer returns is tombstoned, so it stops counting');
select results_eq($$select erp_docstatus, erp_state from procurement_invoices where id='a5070000-0000-0000-0000-0000000000e3'$$,
  $$values (1::smallint, 'posted'::text)$$, 'AC-OPP-073 a bill the census saw is untouched');
select is((select erp_docstatus from erp_purchase_documents where external_ref='account.move:22' and org_id='a5070000-0000-0000-0000-000000000001'), 2::smallint, 'AC-OPP-073 a native bill Odoo no longer returns is tombstoned');
select is((select erp_docstatus from erp_purchase_documents where external_ref='account.move:21' and org_id='a5070000-0000-0000-0000-000000000001'), 1::smallint, 'AC-OPP-073 a native bill the census saw is untouched');
select is((select watermark_cursor from external_sync_watermarks where org_id='a5070000-0000-0000-0000-000000000001' and domain='purchase:bill'), 'cen-1', 'AC-OPP-073 the census finish writes the cursor');
select is((select erp_docstatus from procurement_invoices where id='a5070000-0000-0000-0000-0000000000b3'), null, 'AC-OPP-073 org B''s bill with the same Odoo id is untouched');
select is((select count(*) from purchase_orders where org_id='a5070000-0000-0000-0000-000000000001' and erp_state = 'deleted'), 0::bigint, 'AC-OPP-073 a census of bills touches no order');
-- a returning id clears the tombstone
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.mark_odoo_purchase_census_seen('a5070000-0000-0000-0000-000000000001','bill', (select r2 from runs), array['8','22']);
reset role;
select results_eq($$select erp_docstatus, erp_state, erp_cancelled_at is null from procurement_invoices where id='a5070000-0000-0000-0000-0000000000e5'$$,
  $$values (1::smallint, null::text, true)$$, 'AC-OPP-073 a returning bill clears its tombstone');
select is((select erp_docstatus from erp_purchase_documents where external_ref='account.move:22' and org_id='a5070000-0000-0000-0000-000000000001'), 1::smallint, 'AC-OPP-073 a returning native bill counts again');
-- a document linked after the run began is never tombstoned by it
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id, created_at) values
 ('a5070000-0000-0000-0000-000000000001','procurement','a5070000-0000-0000-0000-0000000000e6','odoo','account.move:99', now() + interval '1 hour');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.finish_odoo_purchase_census('a5070000-0000-0000-0000-000000000001','bill', (select r3 from runs), 'cen-2');
reset role;
select is((select erp_state from procurement_invoices where id='a5070000-0000-0000-0000-0000000000e6'), null, 'AC-OPP-073 a link made after the run began is never tombstoned by it');

select * from finish();
rollback;
