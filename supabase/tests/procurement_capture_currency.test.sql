-- procurement_capture_currency.test.sql — 0373. A purchase order, vendor invoice or payment recorded on a purchase
-- through the capture RPCs is denominated in the PURCHASE's currency, not the org's default. No conversion is made:
-- the amount is taken as stated, in the purchase's currency.
begin;
select plan(10);

insert into organizations (id, name, default_currency) values ('03731000-0000-0000-0000-0000000000f0','PCC','IDR');
insert into auth.users (id, email) values ('03731000-0000-0000-0000-0000000000f1','pcc-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03731000-0000-0000-0000-0000000000f1','03731000-0000-0000-0000-0000000000f0','Fin','pcc-fin@example.com','Finance','active');
insert into projects (id, org_id, name, status, currency) values
  ('03731000-0000-0000-0000-0000000000d1','03731000-0000-0000-0000-0000000000f0','PCC P1','Ongoing Project','USD');
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  -- e1/e2/e3: native USD purchases in an IDR org, no line items, never approved.
  ('03731000-0000-0000-0000-0000000000e1','03731000-0000-0000-0000-0000000000f0','USD order','03731000-0000-0000-0000-0000000000f1','03731000-0000-0000-0000-0000000000d1','USD',0,'Draft'),
  ('03731000-0000-0000-0000-0000000000e2','03731000-0000-0000-0000-0000000000f0','USD bill','03731000-0000-0000-0000-0000000000f1','03731000-0000-0000-0000-0000000000d1','USD',0,'Draft'),
  ('03731000-0000-0000-0000-0000000000e3','03731000-0000-0000-0000-0000000000f0','USD pay','03731000-0000-0000-0000-0000000000f1','03731000-0000-0000-0000-0000000000d1','USD',0,'Draft'),
  -- e4: the same-currency control.
  ('03731000-0000-0000-0000-0000000000e4','03731000-0000-0000-0000-0000000000f0','IDR order','03731000-0000-0000-0000-0000000000f1',null,'IDR',0,'Draft');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03731000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok($$ select create_purchase_order('03731000-0000-0000-0000-0000000000e1', null, null, current_date, 250) $$,
  'fixture: Finance records a purchase order on the USD purchase');
select lives_ok($$ select create_procurement_invoice(p_procurement_id => '03731000-0000-0000-0000-0000000000e2', p_status => 'Received',
  p_invoice_date => current_date, p_amount => 400, p_tax_treatment => 'exclusive', p_tax_amount => 0) $$,
  'fixture: Finance records a vendor invoice on the USD purchase');
select lives_ok($$ select create_payment('03731000-0000-0000-0000-0000000000e3', null, null, null, current_date, 300) $$,
  'fixture: Finance records a payment on the USD purchase');
select lives_ok($$ select create_purchase_order('03731000-0000-0000-0000-0000000000e4', null, null, current_date, 90) $$,
  'fixture: Finance records a purchase order on the IDR purchase');
reset role;
reset request.jwt.claims;

select is((select currency from purchase_orders where procurement_id = '03731000-0000-0000-0000-0000000000e1'), 'USD',
  'a purchase order recorded on a USD purchase is in USD, not the org default');
select is((select currency from procurement_invoices where procurement_id = '03731000-0000-0000-0000-0000000000e2'), 'USD',
  'a vendor invoice recorded on a USD purchase is in USD');
select is((select currency from payments where procurement_id = '03731000-0000-0000-0000-0000000000e3'), 'USD',
  'a payment recorded on a USD purchase is in USD');
select is((select currency from purchase_orders where procurement_id = '03731000-0000-0000-0000-0000000000e4'), 'IDR',
  'control: a purchase order on an IDR purchase stays IDR');
select results_eq($$ select id::text, total_value from procurements where id in
    ('03731000-0000-0000-0000-0000000000e1','03731000-0000-0000-0000-0000000000e2','03731000-0000-0000-0000-0000000000e3') order by id $$,
  $$ values ('03731000-0000-0000-0000-0000000000e1', 250::numeric), ('03731000-0000-0000-0000-0000000000e2', 400::numeric),
            ('03731000-0000-0000-0000-0000000000e3', 300::numeric) $$,
  'each USD purchase takes its recorded document amount as its total (the amount is counted, not ignored)');
select is((select sum(procurement_open_commitment(p)) from procurements p where p.id in
    ('03731000-0000-0000-0000-0000000000e1','03731000-0000-0000-0000-0000000000e2','03731000-0000-0000-0000-0000000000e3')), 950::numeric,
  'the USD purchases carry their open commitment, unconverted');

select * from finish();
rollback;
