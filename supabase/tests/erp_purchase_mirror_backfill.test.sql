-- erp_purchase_mirror_backfill.test.sql — 0374. An unchanged ERP document re-read by the purchase feed fills the
-- net total and invoice order list that rows mirrored before those fields existed lack; nothing else changes, and
-- an older ERP snapshot never overwrites a newer one.
begin;
select plan(13);
insert into organizations (id, name, default_currency) values ('03740000-0000-0000-0000-00000000000a','PMB A','IDR');
-- Rows as the mirror stored them before net_total / purchase_orders were sent.
insert into erp_purchase_documents (org_id, erp_doctype, erp_name, supplier, currency, grand_total, net_total, erp_status,
                                    erp_docstatus, erp_modified, purchase_orders) values
  ('03740000-0000-0000-0000-00000000000a','Purchase Invoice','PINV-L','SUP-1','IDR',110,null,'Unpaid',1,'2026-02-01 10:00:00','{}'),
  ('03740000-0000-0000-0000-00000000000a','Purchase Order','PO-L','SUP-1','IDR',220,null,'To Bill',1,'2026-02-01 10:00:00','{}'),
  ('03740000-0000-0000-0000-00000000000a','Purchase Invoice','PINV-NEW','SUP-1','IDR',330,300,'Unpaid',1,'2026-03-01 10:00:00','{PO-9}');

select is(upsert_erp_purchase_documents('03740000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-L","supplier":"SUP-OTHER","currency":"IDR","grand_total":999,"net_total":100,
  "erp_status":"Paid","erp_docstatus":1,"erp_modified":"2026-02-01 10:00:00","purchase_orders":["PO-1","PO-2"]},
 {"erp_doctype":"Purchase Order","erp_name":"PO-L","supplier":"SUP-1","currency":"IDR","grand_total":220,"net_total":200,
  "erp_status":"To Bill","erp_docstatus":1,"erp_modified":"2026-02-01 10:00:00"}
]$$::jsonb), 2, 'an equal-modified re-read backfills both legacy rows');
select is((select net_total from erp_purchase_documents where erp_name = 'PINV-L'), 100.00::numeric(18,2), 'the invoice gains its net total');
select is((select purchase_orders from erp_purchase_documents where erp_name = 'PINV-L'), '{PO-1,PO-2}'::text[], 'the invoice gains its order list');
select is((select net_total from erp_purchase_documents where erp_name = 'PO-L'), 200.00::numeric(18,2), 'the order gains its net total');
select is((select row(supplier, grand_total, erp_status)::text from erp_purchase_documents where erp_name = 'PINV-L'),
  row('SUP-1', 110.00::numeric(18,2), 'Unpaid')::text, 'an equal-modified re-read changes only the missing net total and order list');

select is(upsert_erp_purchase_documents('03740000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-L","supplier":"SUP-1","currency":"IDR","grand_total":110,"net_total":90,
  "erp_status":"Unpaid","erp_docstatus":1,"erp_modified":"2026-02-01 10:00:00","purchase_orders":["PO-3"]}
]$$::jsonb), 0, 'once both fields are present an equal-modified re-read writes nothing');
select is((select row(net_total, purchase_orders)::text from erp_purchase_documents where erp_name = 'PINV-L'),
  row(100.00::numeric(18,2), '{PO-1,PO-2}'::text[])::text, 'present fields are kept on an equal-modified re-read');

select is(upsert_erp_purchase_documents('03740000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-NEW","supplier":"SUP-1","currency":"IDR","grand_total":10,"net_total":5,
  "erp_status":"Draft","erp_docstatus":1,"erp_modified":"2026-02-15 10:00:00","purchase_orders":["PO-OLD"]}
]$$::jsonb), 0, 'an older ERP snapshot is rejected');
select is((select row(grand_total, net_total, purchase_orders, erp_modified)::text from erp_purchase_documents where erp_name = 'PINV-NEW'),
  row(330.00::numeric(18,2), 300.00::numeric(18,2), '{PO-9}'::text[], '2026-03-01 10:00:00')::text, 'the newer row is unchanged');

update erp_purchase_documents set net_total = null, purchase_orders = '{}' where erp_name = 'PINV-NEW';
select is(upsert_erp_purchase_documents('03740000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-NEW","supplier":"SUP-1","currency":"IDR","grand_total":10,"net_total":5,
  "erp_status":"Draft","erp_docstatus":1,"erp_modified":"2026-02-15 10:00:00","purchase_orders":["PO-OLD"]}
]$$::jsonb), 0, 'an older ERP snapshot does not backfill missing fields either');

select is(upsert_erp_purchase_documents('03740000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-NEW","supplier":"SUP-1","currency":"IDR","grand_total":330,
  "erp_status":"Unpaid","erp_docstatus":1,"erp_modified":"2026-03-01 10:00:00","purchase_orders":[]}
]$$::jsonb), 0, 'an equal-modified re-read with nothing to add writes nothing');

select is(upsert_erp_purchase_documents('03740000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-NEW","supplier":"SUP-1","currency":"IDR","grand_total":440,"net_total":400,
  "erp_status":"Paid","erp_docstatus":1,"erp_modified":"2026-04-01 10:00:00","purchase_orders":["PO-9"]}
]$$::jsonb), 1, 'a newer ERP snapshot is written');
select is((select row(grand_total, erp_status)::text from erp_purchase_documents where erp_name = 'PINV-NEW'),
  row(440.00::numeric(18,2), 'Paid')::text, 'a newer ERP snapshot still replaces the row');

select * from finish();
rollback;
