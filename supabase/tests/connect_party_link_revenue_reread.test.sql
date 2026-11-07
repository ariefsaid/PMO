set search_path = public, extensions;
-- #1607 blocker B (FR-ECA-040 / NFR-ECA-002, migration 0750): an ERP invoice copied before its client was linked has no client,
-- so it never pairs and counts twice. Linking a party makes the ERP revenue feed re-read, so the copy gets its client.
begin;
select plan(9);

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
select is((select watermark_cursor from external_sync_watermarks where org_id='a7500000-0000-0000-0000-000000000001' and domain='revenue::Payment Entry'), '',
  'and its receipt cursor');
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

select * from finish();
rollback;
