-- #1505 O2 P7 review round: link-existing for Odoo-native documents (AC-OPP-072), end to end through the SHIPPED link RPC.
-- The pages below carry exactly the keys the shipped feed parser emits (feed.ts / feed.test.ts: `currency`, `source_orders`).
--   I-1 a native bill whose currency the feed read links (it was refused as currency_mismatch while the feed sent none);
--   I-3 an order and its bill cannot be linked into two purchases (the feed's `source_orders` fills purchase_orders);
--   I-2 a linked document Odoo cancels, changes or deletes, and the census restores, moves its purchase's total;
--   I-4 the quantities Odoo booked and the ones entered are persisted per receipt, written by the service role only.
begin;
select plan(22);

insert into organizations (id, name, default_currency) values ('a5080000-0000-0000-0000-000000000001','Native A','IDR');
insert into auth.users (id, email) values ('a5080000-0000-0000-0000-0000000000a1','a508-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a5080000-0000-0000-0000-0000000000a1','a5080000-0000-0000-0000-000000000001','A Fin','a508-fin@example.com','Finance','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a5080000-0000-0000-0000-000000000001','odoo','https://o.example.test','a508_a','active','{"odoo_company_id":1}', now());
insert into external_domain_ownership (org_id, external_tier, domain) values ('a5080000-0000-0000-0000-000000000001','odoo','procurement');
insert into projects (id, org_id, name, status) values
 ('a5080000-0000-0000-0000-0000000000d1','a5080000-0000-0000-0000-000000000001','Native project','Ongoing Project');
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id) values
 ('a5080000-0000-0000-0000-000000000001','a5080000-0000-0000-0000-0000000000d1','odoo','88');
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status, origin) values
 ('a5080000-0000-0000-0000-0000000000f1','a5080000-0000-0000-0000-000000000001','Case A','a5080000-0000-0000-0000-0000000000a1','a5080000-0000-0000-0000-0000000000d1','IDR',0,'Ordered','erp_link'),
 ('a5080000-0000-0000-0000-0000000000f2','a5080000-0000-0000-0000-000000000001','Case B','a5080000-0000-0000-0000-0000000000a1','a5080000-0000-0000-0000-0000000000d1','IDR',0,'Ordered','erp_link'),
 ('a5080000-0000-0000-0000-0000000000f3','a5080000-0000-0000-0000-000000000001','Case C','a5080000-0000-0000-0000-0000000000a1','a5080000-0000-0000-0000-0000000000d1','IDR',0,'Ordered','erp_link'),
 ('a5080000-0000-0000-0000-0000000000f4','a5080000-0000-0000-0000-000000000001','Case D','a5080000-0000-0000-0000-0000000000a1','a5080000-0000-0000-0000-0000000000d1','IDR',0,'Ordered','erp_link'),
 ('a5080000-0000-0000-0000-0000000000f5','a5080000-0000-0000-0000-000000000001','Case E','a5080000-0000-0000-0000-0000000000a1','a5080000-0000-0000-0000-0000000000d1','IDR',0,'Ordered','erp_link');
insert into procurement_receipts (id, org_id, procurement_id, status) values
 ('a5080000-0000-0000-0000-0000000000e2','a5080000-0000-0000-0000-000000000001','a5080000-0000-0000-0000-0000000000f1','Partial');

-- The feed's pages (service role): orders P00012 and P00013, their bills, a bill billing nothing, and one whose currency was unreadable.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5080000-0000-0000-0000-000000000001','purchase-order', $$[
  {"external_id":"12","name":"P00012","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"purchase","status":"Issued","docstatus":1,"cancelled":false,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","currency":"IDR","analytic_ids":["88"],"amount_total":"100.00","amount_untaxed":"100.00"}},
  {"external_id":"13","name":"P00013","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"purchase","status":"Issued","docstatus":1,"cancelled":false,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","currency":"IDR","analytic_ids":["88"],"amount_total":"200.00","amount_untaxed":"200.00"}}]$$::jsonb, 'po-1');
select public.apply_odoo_purchase_page('a5080000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"21","name":"BILL/2026/0021","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"cancelled":false,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","currency":"IDR","analytic_ids":["88"],"amount_total":"100.00","amount_untaxed":"100.00","residual":"100.00","source_orders":["P00012"],"money":{"gross":"100.00","vat":"0.00","withheld":"0.00","outstanding":"100.00"}}},
  {"external_id":"22","name":"BILL/2026/0022","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"cancelled":false,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","currency":"IDR","analytic_ids":["88"],"amount_total":"200.00","amount_untaxed":"200.00","residual":"200.00","source_orders":["P00013"],"money":{"gross":"200.00","vat":"0.00","withheld":"0.00","outstanding":"200.00"}}},
  {"external_id":"23","name":"BILL/2026/0023","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"cancelled":false,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","currency":"IDR","analytic_ids":["88"],"amount_total":"500.00","amount_untaxed":"500.00","residual":"500.00","source_orders":[],"money":{"gross":"500.00","vat":"0.00","withheld":"0.00","outstanding":"500.00"}}},
  {"external_id":"24","name":"BILL/2026/0024","active":true,"source_write_date":"2026-11-01 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"cancelled":false,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","currency":null,"analytic_ids":["88"],"amount_total":"50.00","amount_untaxed":"50.00","residual":"50.00","source_orders":[],"money":{"gross":"50.00","vat":"0.00","withheld":"0.00","outstanding":"50.00"}}}]$$::jsonb, 'bill-1');
reset role;

select results_eq($$select erp_name, currency, purchase_orders from erp_purchase_documents where org_id='a5080000-0000-0000-0000-000000000001' and erp_doctype='Purchase Invoice' and erp_name in ('BILL/2026/0021','BILL/2026/0023') order by erp_name$$,
  $$values ('BILL/2026/0021'::text, 'IDR'::text, array['P00012']::text[]), ('BILL/2026/0023'::text, 'IDR'::text, '{}'::text[])$$,
  'AC-OPP-072 the stored native bill keeps the currency and the orders the feed read');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a5080000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- I-1
select is(link_erp_purchase_documents('[{"erp_name":"BILL/2026/0023","procurement_id":"a5080000-0000-0000-0000-0000000000f5"}]') #>> '{results,0,outcome}', 'link',
  'AC-OPP-072 I-1 a native bill the feed read with its currency links into an existing purchase');
select is(link_erp_purchase_documents('[{"erp_name":"BILL/2026/0024","project_id":"a5080000-0000-0000-0000-0000000000d1"}]') #>> '{results,0,reason}', 'currency_mismatch',
  'AC-OPP-072 I-1 a document whose currency the feed could not read is refused, not guessed');
select is(link_erp_purchase_documents('[{"erp_name":"P00012","project_id":"a5080000-0000-0000-0000-0000000000d1"}]') #>> '{results,0,outcome}', 'link',
  'AC-OPP-072 I-1 a native order links into a NEW purchase (its currency is the document''s)');
reset role;
select is((select p.currency from procurements p join procurement_erp_links l on l.procurement_id = p.id join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name = 'P00012'), 'IDR',
  'AC-OPP-072 I-1 the new purchase takes the document''s currency');

-- I-3 an order and its bill sit in one purchase (P00012 is in its own new purchase above)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"BILL/2026/0021","procurement_id":"a5080000-0000-0000-0000-0000000000f2"}]') #>> '{results,0,reason}', 'order_linked_to_another_purchase',
  'AC-OPP-072 I-3 a native bill cannot join a purchase other than its order''s');
reset role;
select is((select count(*)::int from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name = 'BILL/2026/0021'), 0, 'AC-OPP-072 I-3 the refused bill is not linked');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"BILL/2026/0022","procurement_id":"a5080000-0000-0000-0000-0000000000f3"},{"erp_name":"P00013","procurement_id":"a5080000-0000-0000-0000-0000000000f4"}]') #>> '{results,1,reason}', 'invoice_linked_to_another_purchase',
  'AC-OPP-072 I-3 a native order cannot join a purchase other than the one holding its bill');

-- I-2 a bill linked into a new purchase counts; Odoo's cancel, change and delete reach the purchase total
select is(link_erp_purchase_documents('[{"erp_name":"BILL/2026/0023","procurement_id":"a5080000-0000-0000-0000-0000000000f5"}]') #>> '{results,0,reason}', 'already_linked', 'fixture: the bill is already in Case E');
reset role;
select is((select total_value from procurements where id='a5080000-0000-0000-0000-0000000000f5'), 500.00::numeric, 'fixture: Case E counts the 500 bill');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5080000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"23","name":"BILL/2026/0023","active":true,"source_write_date":"2026-11-02 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"cancelled":false,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","currency":"IDR","analytic_ids":["88"],"amount_total":"700.00","amount_untaxed":"700.00","residual":"700.00","source_orders":[],"money":{"gross":"700.00","vat":"0.00","withheld":"0.00","outstanding":"700.00"}}}]$$::jsonb, 'bill-2');
reset role;
select is((select total_value from procurements where id='a5080000-0000-0000-0000-0000000000f5'), 700.00::numeric, 'AC-OPP-072 I-2 an amount change in Odoo reaches the purchase total');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5080000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"23","name":"BILL/2026/0023","active":true,"source_write_date":"2026-11-03 10:00:00",
   "attrs":{"state":"cancel","status":"Cancelled","docstatus":2,"cancelled":true,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","currency":"IDR","analytic_ids":["88"],"amount_total":"700.00","amount_untaxed":"700.00","residual":"0.00","source_orders":[]}}]$$::jsonb, 'bill-3');
reset role;
select is((select total_value from procurements where id='a5080000-0000-0000-0000-0000000000f5'), 0.00::numeric, 'AC-OPP-072 I-2 a bill cancelled in Odoo stops counting in its purchase');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_purchase_page('a5080000-0000-0000-0000-000000000001','bill', $$[
  {"external_id":"23","name":"BILL/2026/0023","active":true,"source_write_date":"2026-11-04 10:00:00",
   "attrs":{"state":"posted","status":"Received","docstatus":1,"cancelled":false,"partner":"41","partner_name":"Vendor V","date":"2026-10-30","currency":"IDR","analytic_ids":["88"],"amount_total":"650.00","amount_untaxed":"650.00","residual":"650.00","source_orders":[],"money":{"gross":"650.00","vat":"0.00","withheld":"0.00","outstanding":"650.00"}}}]$$::jsonb, 'bill-4');
reset role;
select is((select total_value from procurements where id='a5080000-0000-0000-0000-0000000000f5'), 650.00::numeric, 'AC-OPP-072 I-2 a bill reposted in Odoo counts again at its new figure');

-- the census: what Odoo no longer returns is tombstoned and stops counting; when it returns it counts again
update erp_purchase_documents set updated_at = now() - interval '1 day' where org_id = 'a5080000-0000-0000-0000-000000000001';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.mark_odoo_purchase_census_seen('a5080000-0000-0000-0000-000000000001','bill', now(), array['21','22','24']);
select public.finish_odoo_purchase_census('a5080000-0000-0000-0000-000000000001','bill', now() + interval '1 minute', 'cur-c1');
reset role;
select is((select erp_docstatus from erp_purchase_documents where erp_name = 'BILL/2026/0023'), 2::smallint, 'fixture: the census tombstoned the bill Odoo no longer returns');
select is((select total_value from procurements where id='a5080000-0000-0000-0000-0000000000f5'), 0.00::numeric, 'AC-OPP-073 I-2 a tombstoned bill stops counting in its purchase');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.mark_odoo_purchase_census_seen('a5080000-0000-0000-0000-000000000001','bill', now() + interval '2 minutes', array['23']);
reset role;
select is((select total_value from procurements where id='a5080000-0000-0000-0000-0000000000f5'), 650.00::numeric, 'AC-OPP-073 I-2 a bill that returns to Odoo counts again');

-- I-4 the booked and entered quantities of a receipt (the grant is test-only: the guard must hold even where a table grant exists)
grant insert, update on public.procurement_receipts to authenticated;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$update procurement_receipts set odoo_booked = '[{"lineId":11,"productId":55,"quantity":6}]'::jsonb, odoo_entered = '[{"lineId":11,"productId":55,"quantity":6}]'::jsonb where id = 'a5080000-0000-0000-0000-0000000000e2'$$,
  'AC-OPP-030 I-4 the service role persists the quantities Odoo booked and the ones entered');
reset role;
select results_eq($$select odoo_booked, odoo_entered from procurement_receipts where id = 'a5080000-0000-0000-0000-0000000000e2'$$,
  $$values ('[{"lineId":11,"productId":55,"quantity":6}]'::jsonb, '[{"lineId":11,"productId":55,"quantity":6}]'::jsonb)$$, 'AC-OPP-030 I-4 they read back per line');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update procurement_receipts set odoo_booked = '[]'::jsonb where id = 'a5080000-0000-0000-0000-0000000000e2'$$, '42501', 'procurement_receipts Odoo quantities are machine-written',
  'AC-OPP-070 I-4 a user cannot state what Odoo booked');
select throws_ok($$update procurement_receipts set odoo_entered = '[]'::jsonb where id = 'a5080000-0000-0000-0000-0000000000e2'$$, '42501', 'procurement_receipts Odoo quantities are machine-written',
  'AC-OPP-070 I-4 a user cannot state the entered quantities either');
select throws_ok($$insert into procurement_receipts (org_id, procurement_id, status, odoo_booked) values ('a5080000-0000-0000-0000-000000000001','a5080000-0000-0000-0000-0000000000f1','Partial','[]'::jsonb)$$, '42501', 'procurement_receipts Odoo quantities are machine-written',
  'AC-OPP-070 I-4 nor on insert');
reset role;
select throws_ok($$update procurement_receipts set odoo_booked = '{"a":1}'::jsonb where id = 'a5080000-0000-0000-0000-0000000000e2'$$, '23514', null,
  'I-4 the quantities are a list, never another shape');

select * from finish();
rollback;
