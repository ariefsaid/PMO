-- 0244_sales_invoice_received_date.test.sql — #767 AC-DUE-001: the receipt date is recordable by the
-- revenue write set (draft AND submitted), refused for others, never before the invoice date. Plus:
-- never across orgs, never on a cancelled invoice, and the ERP read-back (service role) is never
-- refused — it stores what ERP holds.
begin;
select plan(12);

insert into organizations (id, name) values
  ('11120000-0000-0000-0000-000000002441','Receipt Org'),
  ('11120000-0000-0000-0000-000000002442','Other Receipt Org');
insert into auth.users (id, email) values
  ('11120000-0000-0000-0000-0000000024a1','rcpt-fin@example.com'),
  ('11120000-0000-0000-0000-0000000024b1','rcpt-pm@example.com'),
  ('11120000-0000-0000-0000-0000000024d1','rcpt-off@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('11120000-0000-0000-0000-0000000024a1','11120000-0000-0000-0000-000000002441','Fin','rcpt-fin@example.com','Finance','active'),
  ('11120000-0000-0000-0000-0000000024b1','11120000-0000-0000-0000-000000002441','PM','rcpt-pm@example.com','Project Manager','active'),
  ('11120000-0000-0000-0000-0000000024d1','11120000-0000-0000-0000-000000002441','Off','rcpt-off@example.com','Finance','disabled');
insert into sales_invoices (tax_treatment, tax_amount, id, org_id, si_number, invoice_date, amount, status) values
  ('exclusive', 0, '11120000-0000-0000-0000-0000000024e1','11120000-0000-0000-0000-000000002441','DRAFT-1','2026-07-01',100,'Draft'),
  ('exclusive', 0, '11120000-0000-0000-0000-0000000024e2','11120000-0000-0000-0000-000000002441','SUB-1','2026-07-01',100,'Submitted'),
  ('exclusive', 0, '11120000-0000-0000-0000-0000000024e3','11120000-0000-0000-0000-000000002441','CAN-1','2026-07-01',100,'Cancelled'),
  ('exclusive', 0, '11120000-0000-0000-0000-0000000024f1','11120000-0000-0000-0000-000000002442','OTHER-1','2026-07-01',100,'Submitted');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000024a1","role":"authenticated"}';

select is((select (set_sales_invoice_received_date('11120000-0000-0000-0000-0000000024e1','2026-07-10')).received_date),
  '2026-07-10'::date, 'AC-DUE-001 Finance records the receipt date on a draft invoice');
select is((select (set_sales_invoice_received_date('11120000-0000-0000-0000-0000000024e2','2026-07-20')).received_date),
  '2026-07-20'::date, 'AC-DUE-001 Finance records the receipt date AFTER submission');
select throws_ok($$ select set_sales_invoice_received_date('11120000-0000-0000-0000-0000000024e1','2026-06-30') $$,
  '23514', 'the received date cannot be before the invoice date', 'AC-DUE-001 a receipt date before the invoice date is refused');
select throws_ok($$ select set_sales_invoice_received_date('11120000-0000-0000-0000-0000000024f1','2026-07-10') $$,
  '42501', 'not authorized', 'AC-DUE-001 Finance cannot record a receipt date on ANOTHER org''s invoice');
select throws_ok($$ select set_sales_invoice_received_date('11120000-0000-0000-0000-0000000024e3','2026-07-10') $$,
  '23514', 'cannot record a receipt date on a cancelled invoice', 'AC-DUE-001 a cancelled invoice is refused');
select is((select (set_sales_invoice_received_date('11120000-0000-0000-0000-0000000024e1', null)).received_date),
  null::date, 'AC-DUE-001 NULL clears the receipt date');
select throws_ok($$ update sales_invoices set received_date = '2026-08-01' where id = '11120000-0000-0000-0000-0000000024e1' $$,
  '42501', null, 'AC-DUE-001 there is no direct UPDATE path — the RPC is the only writer');

set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000024b1","role":"authenticated"}';
select throws_ok($$ select set_sales_invoice_received_date('11120000-0000-0000-0000-0000000024e1','2026-07-10') $$,
  '42501', null, 'AC-DUE-001 a Project Manager is refused');

set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000024d1","role":"authenticated"}';
select throws_ok($$ select set_sales_invoice_received_date('11120000-0000-0000-0000-0000000024e1','2026-07-10') $$,
  '42501', null, 'AC-DUE-001 a disabled (offboarded) Finance member is refused');

reset role;
select is((select received_date from sales_invoices where id='11120000-0000-0000-0000-0000000024e2'),
  '2026-07-20'::date, 'AC-DUE-001 the submitted invoice kept its recorded receipt date');
select is((select received_date from sales_invoices where id='11120000-0000-0000-0000-0000000024f1'),
  null::date, 'AC-DUE-001 the other org''s invoice was not touched');

-- The ERP read-back (service-role mirror writer) stores what ERP holds, even a date the RPC would
-- refuse — refusing it would stall that invoice's status sync.
set local role service_role;
select lives_ok($$ update sales_invoices set received_date = '2026-06-15' where id = '11120000-0000-0000-0000-0000000024e2' $$,
  'AC-DUE-003 the ERP read-back may store a receipt date earlier than the invoice date');
select * from finish();
rollback;
