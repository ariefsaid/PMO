-- 0238_procurement_external_ref.test.sql — #769 optional external reference on PR / PO / vendor invoice.
-- Migration under test: 0238_procurement_external_ref.sql
--
-- AC-EXT-001  PR, PO and vendor invoice carry an optional external reference (trimmed, ≤100 chars)
-- AC-EXT-002  stored on the record row; written only through the existing create RPCs
begin;
select plan(13);

insert into organizations (id, name) values ('02320000-0000-0000-0000-000000000001', 'Ext Ref Org');
insert into auth.users (id, email) values
  ('02320000-0000-0000-0000-0000000000a1', 'pm-extref@example.com'),
  ('02320000-0000-0000-0000-0000000000a5', 'eng-extref@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('02320000-0000-0000-0000-0000000000a1','02320000-0000-0000-0000-000000000001','PM','pm-extref@example.com','Project Manager'),
  ('02320000-0000-0000-0000-0000000000a5','02320000-0000-0000-0000-000000000001','Eng','eng-extref@example.com','Engineer');
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('02320000-0000-0000-0000-000000000010','02320000-0000-0000-0000-000000000001','Case','Draft','02320000-0000-0000-0000-0000000000a1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02320000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select external_ref from create_purchase_request('02320000-0000-0000-0000-000000000010', null, null, null, null,
     p_external_ref => '  PRQ-0026100001  ')),
  'PRQ-0026100001',
  'AC-EXT-001: create_purchase_request stores the external reference trimmed');

select is(
  (select external_ref from create_purchase_order('02320000-0000-0000-0000-000000000010', null, null, null, null,
     p_external_ref => 'PRO-0026100002')),
  'PRO-0026100002',
  'AC-EXT-001: create_purchase_order stores the external reference');

select is(
  (select external_ref from create_procurement_invoice('02320000-0000-0000-0000-000000000010', 'Received'::procurement_invoice_status,
     current_date, null, 100, p_tax_treatment => 'exclusive', p_tax_amount => 0, p_external_ref => 'PRO-0026100002')),
  'PRO-0026100002',
  'AC-EXT-001: create_procurement_invoice stores the external reference');

select is(
  (select external_ref from create_purchase_request('02320000-0000-0000-0000-000000000010', null, null, null, null,
     p_external_ref => '   ')),
  null,
  'AC-EXT-001: a blank external reference is stored as NULL');

select is(
  (select external_ref from create_purchase_order('02320000-0000-0000-0000-000000000010', null, null, null, null)),
  null,
  'AC-EXT-001: the external reference is optional (omitted → NULL)');

select throws_ok(
  $$ select create_purchase_request('02320000-0000-0000-0000-000000000010', null, null, null, null,
       p_external_ref => repeat('x', 101)) $$,
  '23514', null,
  'AC-EXT-001: an external reference over 100 characters is rejected by the CHECK');

select throws_ok(
  $$ insert into purchase_orders (procurement_id, external_ref) values ('02320000-0000-0000-0000-000000000010', 'X') $$,
  '42501', null,
  'AC-EXT-002: no direct insert path — the column is written only through the create RPC');

select throws_ok(
  $$ update purchase_requests set external_ref = 'X' $$,
  '42501', null,
  'AC-EXT-002: no direct update path on the record row');

select throws_ok(
  $$ insert into procurement_invoices (procurement_id, status, invoice_date, external_ref)
       values ('02320000-0000-0000-0000-000000000010', 'Received', current_date, 'X') $$,
  '42501', null,
  'AC-EXT-002: as PM, no direct insert path on procurement_invoices either (INSERT revoked, 0174)');

select throws_ok(
  $$ update procurement_invoices set external_ref = 'X' $$,
  '42501', null,
  'AC-EXT-002: as PM, no direct update path on procurement_invoices.external_ref (column absent from the UPDATE grant, 0175)');

set local request.jwt.claims = '{"sub":"02320000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok(
  $$ insert into procurement_invoices (procurement_id, status, invoice_date, external_ref)
       values ('02320000-0000-0000-0000-000000000010', 'Received', current_date, 'X') $$,
  '42501', null,
  'AC-EXT-002: as Engineer, direct insert on procurement_invoices is refused');

select throws_ok(
  $$ update procurement_invoices set external_ref = 'X' $$,
  '42501', null,
  'AC-EXT-002: as Engineer, direct update of procurement_invoices.external_ref is refused');

select throws_ok(
  $$ select create_purchase_order('02320000-0000-0000-0000-000000000010', null, null, null, null,
       p_external_ref => 'PRO-1') $$,
  '42501', null,
  'AC-EXT-002: an Engineer cannot write the reference (same role gate as the neighbouring RPC args)');

select * from finish();
rollback;
