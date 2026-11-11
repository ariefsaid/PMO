-- procurement_recorded_total_witness.test.sql — 0373. A document that never counted toward a purchase's total (another
-- currency, or cancelled) is never evidence that the total was document-derived: editing or deleting it leaves an
-- independently stated total alone. Removing the last document that DID count still takes the total to 0.
begin;
select plan(7);

insert into organizations (id, name, default_currency) values ('03732000-0000-0000-0000-0000000000f0','PRW','IDR');
insert into auth.users (id, email) values ('03732000-0000-0000-0000-0000000000f1','prw-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03732000-0000-0000-0000-0000000000f1','03732000-0000-0000-0000-0000000000f0','Fin','prw-fin@example.com','Finance','active');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
  -- e1: a USD purchase stated at 100, never approved, no line items.
  ('03732000-0000-0000-0000-0000000000e1','03732000-0000-0000-0000-0000000000f0','Stated','03732000-0000-0000-0000-0000000000f1','USD',100,'Draft'),
  -- e2: the same, for a payment in another currency.
  ('03732000-0000-0000-0000-0000000000e2','03732000-0000-0000-0000-0000000000f0','Stated pay','03732000-0000-0000-0000-0000000000f1','USD',100,'Draft'),
  -- e3: the contrast — its only counting document is deleted.
  ('03732000-0000-0000-0000-0000000000e3','03732000-0000-0000-0000-0000000000f0','Counted','03732000-0000-0000-0000-0000000000f1','USD',100,'Draft');

-- The ERP mirror (service role) records an IDR vendor invoice on the USD purchase: ignored, total kept.
set local request.jwt.claims = '{"role":"service_role"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount, erp_docstatus) values
  ('03732000-0000-0000-0000-0000000000e1','03732000-0000-0000-0000-0000000000f0','Received',5000,'IDR','exclusive',0,1);
insert into payments (procurement_id, org_id, status, amount, currency, erp_docstatus) values
  ('03732000-0000-0000-0000-0000000000e2','03732000-0000-0000-0000-0000000000f0','Scheduled',7000,'IDR',1);
reset request.jwt.claims;
select is((select total_value from procurements where id = '03732000-0000-0000-0000-0000000000e1'), 100::numeric,
  'fixture: an invoice in another currency leaves the stated total');

set local request.jwt.claims = '{"role":"service_role"}';
update procurement_invoices set amount = 6000 where procurement_id = '03732000-0000-0000-0000-0000000000e1';
reset request.jwt.claims;
select is((select total_value from procurements where id = '03732000-0000-0000-0000-0000000000e1'), 100::numeric,
  'editing an invoice in another currency leaves the stated total (it never counted)');

set local request.jwt.claims = '{"role":"service_role"}';
update procurement_invoices set erp_docstatus = 2 where procurement_id = '03732000-0000-0000-0000-0000000000e1';
reset request.jwt.claims;
select is((select total_value from procurements where id = '03732000-0000-0000-0000-0000000000e1'), 100::numeric,
  'cancelling an invoice in another currency leaves the stated total');

set local request.jwt.claims = '{"role":"service_role"}';
delete from procurement_invoices where procurement_id = '03732000-0000-0000-0000-0000000000e1';
reset request.jwt.claims;
select is((select total_value from procurements where id = '03732000-0000-0000-0000-0000000000e1'), 100::numeric,
  'deleting a cancelled invoice that never counted leaves the stated total');

set local request.jwt.claims = '{"role":"service_role"}';
update payments set amount = 8000 where procurement_id = '03732000-0000-0000-0000-0000000000e2';
delete from payments where procurement_id = '03732000-0000-0000-0000-0000000000e2';
reset request.jwt.claims;
select is((select total_value from procurements where id = '03732000-0000-0000-0000-0000000000e2'), 100::numeric,
  'editing then deleting a payment in another currency leaves the stated total');

-- Contrast: a USD document counts, and removing it (the last counting document) zeroes the total.
set local request.jwt.claims = '{"role":"service_role"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount, erp_docstatus) values
  ('03732000-0000-0000-0000-0000000000e3','03732000-0000-0000-0000-0000000000f0','Received',40,'USD','exclusive',0,1);
reset request.jwt.claims;
select is((select total_value from procurements where id = '03732000-0000-0000-0000-0000000000e3'), 40::numeric,
  'control: an invoice in the purchase''s currency sets the total');
set local request.jwt.claims = '{"role":"service_role"}';
delete from procurement_invoices where procurement_id = '03732000-0000-0000-0000-0000000000e3';
reset request.jwt.claims;
select is((select total_value from procurements where id = '03732000-0000-0000-0000-0000000000e3'), 0::numeric,
  'control: deleting the last counting document takes the total to 0');

select * from finish();
rollback;
