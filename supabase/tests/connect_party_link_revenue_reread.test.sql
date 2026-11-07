set search_path = public, extensions;
-- #1607 blocker B (FR-ECA-040 / NFR-ECA-002, migration 0750): an ERP invoice copied before its client was linked has no client,
-- so it never pairs and counts twice. Linking a party makes the ERP revenue feed re-read, so the copy gets its client.
begin;
select plan(16);

insert into organizations (id, name) values
 ('a7500000-0000-0000-0000-000000000001','Heal A'),
 ('a7500000-0000-0000-0000-000000000002','Heal B');
insert into companies (id, org_id, name, type) values
 ('a7500000-0000-0000-0000-0000000000d1','a7500000-0000-0000-0000-000000000001','Heal Client','Client'),
 ('a7500000-0000-0000-0000-0000000000d2','a7500000-0000-0000-0000-000000000001','Heal Client Two','Client'),
 ('a7500000-0000-0000-0000-0000000000d3','a7500000-0000-0000-0000-000000000002','Heal B Client','Client');
-- A has an ERP-copied invoice with no client; B too, but B links nothing.
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, erp_outstanding_amount, tax_treatment, tax_amount,
                            currency, status, erp_docstatus, reference_number) values
 ('a7500000-0000-0000-0000-0000000005e1','a7500000-0000-0000-0000-000000000001', null, 'SI-H1', '2026-03-20', 5000, 5000, 'inclusive', 0, 'IDR', 'Unpaid', 1, 'PO-H1'),
 ('a7500000-0000-0000-0000-0000000005e2','a7500000-0000-0000-0000-000000000002', null, 'SI-H2', '2026-03-20', 5000, 5000, 'inclusive', 0, 'IDR', 'Unpaid', 1, 'PO-H2');
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor) values
 ('a7500000-0000-0000-0000-000000000001','erpnext','revenue::Sales Invoice','2026-03-21 00:00:00'),
 ('a7500000-0000-0000-0000-000000000001','erpnext','revenue::Payment Entry','2026-03-21 00:00:00'),
 ('a7500000-0000-0000-0000-000000000001','erpnext','procurement::Purchase Invoice','2026-03-21 00:00:00'),
 ('a7500000-0000-0000-0000-000000000001','odoo','revenue:sales-invoice','2026-03-21 00:00:00'),
 ('a7500000-0000-0000-0000-000000000002','erpnext','revenue::Sales Invoice','2026-03-21 00:00:00');

select is(public.apply_connect_link('a7500000-0000-0000-0000-000000000001','erpnext','party','a7500000-0000-0000-0000-0000000000d1','Customer:CLI','{}'::jsonb,null), null,
  'the party link is written');
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000001' and domain='revenue::Sales Invoice'), '',
  'linking a party resets the org''s ERP sales-invoice cursor so the copy is re-read');
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000001' and domain='revenue::Payment Entry'), '2026-03-21 00:00:00',
  'a receipt cursor is untouched (receipts take their client from the invoice)');
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000001' and domain='procurement::Purchase Invoice'), '2026-03-21 00:00:00',
  'a non-revenue cursor is untouched');
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000001' and external_tier='odoo'), '2026-03-21 00:00:00',
  'another ERP tier''s cursor is untouched');
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000002'), '2026-03-21 00:00:00',
  'another org''s cursor is untouched');

-- A repeat of the same link writes nothing, so it does not re-read again.
update external_sync_watermarks set watermark_cursor = '2026-03-22 00:00:00' where org_id='a7500000-0000-0000-0000-000000000001' and domain='revenue::Sales Invoice';
select public.apply_connect_link('a7500000-0000-0000-0000-000000000001','erpnext','party','a7500000-0000-0000-0000-0000000000d1','Customer:CLI','{}'::jsonb,null);
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000001' and domain='revenue::Sales Invoice'), '2026-03-22 00:00:00',
  'an already-written link does not reset the cursor again');

-- Once every ERP copy has its client there is nothing to heal, so a new link leaves the cursor alone.
update sales_invoices set customer_id = 'a7500000-0000-0000-0000-0000000000d1' where id = 'a7500000-0000-0000-0000-0000000005e1';
select public.apply_connect_link('a7500000-0000-0000-0000-000000000001','erpnext','party','a7500000-0000-0000-0000-0000000000d2','Customer:CLI2','{}'::jsonb,null);
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000001' and domain='revenue::Sales Invoice'), '2026-03-22 00:00:00',
  'no client-less ERP copy: the cursor is not reset');
select is((select customer_id from sales_invoices where id='a7500000-0000-0000-0000-0000000005e1'), 'a7500000-0000-0000-0000-0000000000d1'::uuid,
  'a copy that already has its client is not changed');

-- ── Odoo: copies sit in the side mirror and carry the ERP partner id; only the linked partner's copy triggers the re-read ─────────
insert into organizations (id, name) values
 ('a7500000-0000-0000-0000-000000000003','Heal C'),
 ('a7500000-0000-0000-0000-000000000004','Heal D'),
 ('a7500000-0000-0000-0000-000000000005','Heal E'),
 ('a7500000-0000-0000-0000-000000000006','Heal F');
insert into companies (id, org_id, name, type) values
 ('a7500000-0000-0000-0000-0000000000d4','a7500000-0000-0000-0000-000000000003','C Client','Client'),
 ('a7500000-0000-0000-0000-0000000000d5','a7500000-0000-0000-0000-000000000004','D Client','Client'),
 ('a7500000-0000-0000-0000-0000000000d6','a7500000-0000-0000-0000-000000000006','F Client','Client');
insert into revenue_erp_mirror (org_id, erp_doctype, erp_name, external_ref, customer_external_id, erp_status, erp_state, erp_docstatus, erp_modified) values
 ('a7500000-0000-0000-0000-000000000003','Sales Invoice','INV-C1','account.move:1','41','Unpaid','posted',1,'2026-03-20 00:00:00'),
 ('a7500000-0000-0000-0000-000000000003','Credit Note','CN-C2','account.move:2',null,'Posted','posted',1,'2026-03-20 00:00:00'),
 ('a7500000-0000-0000-0000-000000000005','Sales Invoice','INV-E1','account.move:3','7','Unpaid','posted',1,'2026-03-20 00:00:00');
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor) values
 ('a7500000-0000-0000-0000-000000000003','odoo','revenue:sales-invoice','2026-03-21 00:00:00'),
 ('a7500000-0000-0000-0000-000000000003','odoo','revenue:incoming-payment','2026-03-21 00:00:00'),
 ('a7500000-0000-0000-0000-000000000004','odoo','revenue:sales-invoice','2026-03-21 00:00:00');

select public.apply_connect_link('a7500000-0000-0000-0000-000000000003','odoo','party','a7500000-0000-0000-0000-0000000000d4','Client:99','{}'::jsonb,null);
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000003' and domain='revenue:sales-invoice'), '2026-03-21 00:00:00',
  'a link for a partner none of the Odoo copies belong to leaves the cursor alone (a copy with no partner never triggers it)');
delete from external_refs where org_id='a7500000-0000-0000-0000-000000000003';
select public.apply_connect_link('a7500000-0000-0000-0000-000000000003','odoo','party','a7500000-0000-0000-0000-0000000000d4','Client:41','{}'::jsonb,null);
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000003' and domain='revenue:sales-invoice'), '',
  'linking the partner of a client-less Odoo copy resets the Odoo sales-invoice cursor');
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000003' and domain='revenue:incoming-payment'), '2026-03-21 00:00:00',
  'and not the Odoo payment cursor');

-- Another org's client-less copy never rewinds this org: D has no client-less copy (E does, for partner 7).
select public.apply_connect_link('a7500000-0000-0000-0000-000000000004','odoo','party','a7500000-0000-0000-0000-0000000000d5','Client:7','{}'::jsonb,null);
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000004' and domain='revenue:sales-invoice'), '2026-03-21 00:00:00',
  'another org''s client-less Odoo copy does not rewind this org');

-- ── the whole chain: link -> (re-read gives the copy its client) -> the pair is offered ───────────────────────────────────────
insert into auth.users (id, email) values ('a7500000-0000-0000-0000-0000000000f1', 'heal-fin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a7500000-0000-0000-0000-0000000000f1','a7500000-0000-0000-0000-000000000006','Heal Finance','heal-fin@example.test','Finance','active');
insert into sales_invoices (id, org_id, customer_id, invoice_date, amount, erp_outstanding_amount, tax_treatment, tax_amount, currency, status,
                            reference_number, native_lines, pmo_native, author_user_id, pmo_number) values
 ('a7500000-0000-0000-0000-0000000005a1','a7500000-0000-0000-0000-000000000006','a7500000-0000-0000-0000-0000000000d6','2026-03-20',5000,5000,'inclusive',0,'IDR','Unpaid',
  'PO-F','[{"description":"n"}]',true,'a7500000-0000-0000-0000-0000000000f1','PMO-F1');
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, erp_outstanding_amount, tax_treatment, tax_amount, currency, status,
                            erp_docstatus, reference_number) values
 ('a7500000-0000-0000-0000-0000000005e6','a7500000-0000-0000-0000-000000000006',null,'SI-F1','2026-03-20',5000,5000,'inclusive',0,'IDR','Unpaid',1,'PO-F');
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor) values
 ('a7500000-0000-0000-0000-000000000006','erpnext','revenue::Sales Invoice','2026-03-21 00:00:00');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7500000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select count(*)::int from public.invoice_pair_candidates()), 0, 'a client-less ERP copy is offered no pair');
reset role;
select public.apply_connect_link('a7500000-0000-0000-0000-000000000006','erpnext','party','a7500000-0000-0000-0000-0000000000d6','Customer:F','{}'::jsonb,null);
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000006'), '', 'the link queued the re-read');
-- the re-read (erpnextFeedDeps.updateMirror, proven in the Deno suite) writes the client onto the copy
update sales_invoices set customer_id = 'a7500000-0000-0000-0000-0000000000d6' where id = 'a7500000-0000-0000-0000-0000000005e6';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7500000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select results_eq($$select pmo_invoice_id, erp_invoice_id from public.invoice_pair_candidates()$$,
  $$values ('a7500000-0000-0000-0000-0000000005a1'::uuid, 'a7500000-0000-0000-0000-0000000005e6'::uuid)$$,
  'once the copy has its client the PMO invoice and the ERP copy pair');
reset role;

select * from finish();
rollback;
