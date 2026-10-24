-- Round trip for 0371 (recorded-document purchase total): down, then up again. Run by
-- scripts/test-procurement-recorded-total-rollback.sh, which inlines the migration files at the markers.
-- The down half doubles as the mutation check: without the refresh, a purchase started at a vendor invoice stays at 0.
begin;
select plan(8);
insert into organizations (id, name, default_currency) values ('03719000-0000-0000-0000-00000000000a','RDT RT','IDR');
insert into auth.users (id, email) values ('03719000-0000-0000-0000-0000000000a1','rdt-rt@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03719000-0000-0000-0000-0000000000a1','03719000-0000-0000-0000-00000000000a','RT Fin','rdt-rt@example.com','Finance','active');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
  ('03719000-0000-0000-0000-0000000000e1','03719000-0000-0000-0000-00000000000a','RT down','03719000-0000-0000-0000-0000000000a1','IDR',0,'Draft'),
  ('03719000-0000-0000-0000-0000000000e2','03719000-0000-0000-0000-00000000000a','RT up','03719000-0000-0000-0000-0000000000a1','IDR',0,'Draft');
-- @0371_DOWN@
select hasnt_function('public','refresh_procurement_recorded_total', array['uuid'], 'down 0371: the refresh function is gone');
select hasnt_function('public','refresh_procurement_total_on_record', 'down 0371: the trigger function is gone');
select hasnt_trigger('public','payments','zy_payments_recorded_total', 'down 0371: the payment trigger is gone');
set local request.jwt.claims = '{"sub":"03719000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('03719000-0000-0000-0000-0000000000e1','03719000-0000-0000-0000-00000000000a','Received',1500,'IDR','exclusive',0);
reset request.jwt.claims;
select is((select total_value from procurements where id = '03719000-0000-0000-0000-0000000000e1'), 0::numeric,
  'down 0371 (mutation check): without the refresh a purchase started at a vendor invoice stays at 0');
-- @0371_UP@
select has_function('public','refresh_procurement_recorded_total', array['uuid'], 'up again: the refresh function');
select ok(not has_function_privilege('authenticated','public.refresh_procurement_recorded_total(uuid)','execute')
          and not has_function_privilege('anon','public.refresh_procurement_recorded_total(uuid)','execute'),
  'up again: the refresh is not callable by clients');
select has_trigger('public','procurement_invoices','zy_procurement_invoices_recorded_total', 'up again: the invoice trigger');
set local request.jwt.claims = '{"sub":"03719000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('03719000-0000-0000-0000-0000000000e2','03719000-0000-0000-0000-00000000000a','Received',1500,'IDR','exclusive',0);
reset request.jwt.claims;
select is((select total_value from procurements where id = '03719000-0000-0000-0000-0000000000e2'), 1500::numeric,
  'up again: a purchase started at a vendor invoice takes its amount');
select * from finish();
rollback;
