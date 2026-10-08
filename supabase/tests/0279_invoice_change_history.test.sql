-- 0279_invoice_change_history.test.sql — #920: PMO-owned invoice facts are auditable, ERP mirror refreshes are quiet.
-- AC-CHG-920: a caller's e-Faktur edit produces one attributed history event; mirror-owned status/balance
-- refreshes on both invoice mirrors produce no event. The catalog gate owns the complete column inventory.
-- Migration under test: 0279_invoice_change_history.sql.
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name) values
  ('02790000-0000-0000-0000-000000000001','AC-CHG-920 invoice history org');
insert into auth.users (id, email) values
  ('02790000-0000-0000-0000-0000000000a1','invoice-history-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02790000-0000-0000-0000-0000000000a1','02790000-0000-0000-0000-000000000001','Finance','invoice-history-finance@example.com','Finance','active');
insert into companies (id, org_id, name, type) values
  ('02790000-0000-0000-0000-0000000000c1','02790000-0000-0000-0000-000000000001','History customer','Client'),
  ('02790000-0000-0000-0000-0000000000c2','02790000-0000-0000-0000-000000000001','History vendor','Vendor');
insert into procurements (id, org_id, title, status, vendor_id) values
  ('02790000-0000-0000-0000-0000000000d1','02790000-0000-0000-0000-000000000001','History case','Vendor Invoiced','02790000-0000-0000-0000-0000000000c2');

set local role service_role;
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, status, erp_outstanding_amount, tax_treatment, tax_amount, tax_rate)
values ('02790000-0000-0000-0000-0000000000e1','02790000-0000-0000-0000-000000000001','02790000-0000-0000-0000-0000000000c1','SI-HISTORY','2026-10-01',100,'Unpaid',100,'exclusive',0,0);
insert into procurement_invoices (id, org_id, procurement_id, status, amount, erp_outstanding_amount, tax_treatment, tax_amount, tax_rate)
values ('02790000-0000-0000-0000-0000000000e2','02790000-0000-0000-0000-000000000001','02790000-0000-0000-0000-0000000000d1','Received',100,100,'exclusive',0,0);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"02790000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.set_sales_invoice_efaktur(
  '02790000-0000-0000-0000-0000000000e1','010.001-26.12345678','2026-10-01') $$,
  'AC-CHG-920 PMO Finance records the sales invoice e-Faktur facts');
select is((select count(*)::int from record_changes where entity_type = 'sales_invoice'
  and entity_id = '02790000-0000-0000-0000-0000000000e1' and changes ? 'efaktur_number'),
  1, 'AC-CHG-920 one e-Faktur edit writes exactly one event');
select is((select actor_id from record_changes where entity_type = 'sales_invoice'
  and entity_id = '02790000-0000-0000-0000-0000000000e1' and changes ? 'efaktur_number'),
  '02790000-0000-0000-0000-0000000000a1'::uuid, 'AC-CHG-920 event records the Finance actor');
select is((select changes from record_changes where entity_type = 'sales_invoice'
  and entity_id = '02790000-0000-0000-0000-0000000000e1' and changes ? 'efaktur_number'),
  '{"efaktur_number":{"old":null,"new":"010.001-26.12345678"},"efaktur_date":{"old":null,"new":"2026-10-01"}}'::jsonb,
  'AC-CHG-920 event carries only the e-Faktur number and date changes');
select lives_ok($$ select public.set_sales_invoice_received_date(
  '02790000-0000-0000-0000-0000000000e1','2026-10-03') $$,
  'AC-CHG-920 authenticated Finance records the sales invoice received date');
select is((select count(*)::int from record_changes where entity_type = 'sales_invoice'
  and entity_id = '02790000-0000-0000-0000-0000000000e1' and changes ? 'received_date'),
  1, 'AC-CHG-920 received-date RPC writes exactly one history event');
select is((select actor_id from record_changes where entity_type = 'sales_invoice'
  and entity_id = '02790000-0000-0000-0000-0000000000e1' and changes ? 'received_date'),
  '02790000-0000-0000-0000-0000000000a1'::uuid, 'AC-CHG-920 received-date event attributes the authenticated caller');
reset role;

-- Service-role body rebuild: updating the author is a backend read-model write, not a user-attributed event.
set local request.jwt.claims = '{}';
set local role service_role;
update sales_invoices set author_user_id = '02790000-0000-0000-0000-0000000000a1'
  where id = '02790000-0000-0000-0000-0000000000e1';
reset role;
select is((select count(*)::int from record_changes where entity_type = 'sales_invoice'
  and entity_id = '02790000-0000-0000-0000-0000000000e1' and op = 'update'),
  2, 'AC-CHG-920 service-role author rebuild does not add a misleading System event');

-- ERP mirror: service role, no caller JWT (the claims set above would otherwise persist)
set local role service_role;
update sales_invoices set status = 'Paid', erp_outstanding_amount = 0, received_date = '2026-10-04' where id = '02790000-0000-0000-0000-0000000000e1';
update procurement_invoices set status = 'Scheduled', erp_outstanding_amount = 50,
  withheld_amount = 10, withheld_pph_type = 'pph23' where id = '02790000-0000-0000-0000-0000000000e2';
reset role;
select is((select count(*)::int from record_changes where entity_type in ('sales_invoice','procurement_invoice')
  and entity_id in ('02790000-0000-0000-0000-0000000000e1','02790000-0000-0000-0000-0000000000e2')
  and op = 'update'),
  2, 'AC-CHG-920 ERP mirror refreshes add no history beyond the two PMO edits');
select is((select captured ->> 'efaktur_number' from record_history_config where entity_type = 'sales_invoice'),
  'text', 'AC-CHG-920 sales invoice e-Faktur number is captured');
select is((select captured ->> 'received_date' from record_history_config where entity_type = 'sales_invoice'),
  'date', 'AC-CHG-920 PMO received date is captured');
select is((select captured ->> 'withheld_amount' from record_history_config where entity_type = 'procurement_invoice'),
  'money', 'AC-CHG-920 PMO-owned vendor withholding amount is captured');
select is((select captured ->> 'withheld_pph_type' from record_history_config where entity_type = 'procurement_invoice'),
  'enum', 'AC-CHG-920 PMO-owned vendor withholding type is captured');
select ok((select 'status' = any(omit_cols) and 'erp_outstanding_amount' = any(omit_cols)
  from record_history_config where entity_type = 'procurement_invoice'),
  'AC-CHG-920 procurement mirror status and outstanding are omitted');

select * from finish();
rollback;
