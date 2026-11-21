-- 1218_hide_prices_derived.test.sql — #2699 derived-amount reads and the order/bill masked views, per-surface value assertions.
-- Migration under test: 1218_hide_prices_derived_amounts (and 1216 views).
-- Mutation notes (break, see the named assertion go red, restore):
--   make the ORIGINAL project_committed_spend mask                -> 'the original committed spend is real for a hidden actor'
--   drop the helper test in project_committed_spend_masked       -> 'hidden committed spend amount is NULL'
--   drop the helper test in procurement_open_commitments_masked -> 'hidden open commitment is NULL'
--   drop the helper test in purchase_orders_masked               -> 'hidden purchase order amount is NULL'
--   drop the helper test in procurement_invoices_masked          -> 'hidden bill amount is NULL'
--   the approval-panel assertion fails if spend_approval_project_figures stops withholding below approval rank.
begin;
select plan(15);

insert into organizations (id, name) values ('26991800-0000-0000-0000-000000000001','HPD Org');
insert into auth.users (id, email) values
  ('26991800-0000-0000-0000-0000000000e1','hpd-eng@example.com'),
  ('26991800-0000-0000-0000-0000000000c1','hpd-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26991800-0000-0000-0000-0000000000e1','26991800-0000-0000-0000-000000000001','HPD Engineer','hpd-eng@example.com','Engineer','active'),
  ('26991800-0000-0000-0000-0000000000c1','26991800-0000-0000-0000-000000000001','HPD Finance','hpd-fin@example.com','Finance','active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('26991800-0000-0000-0000-0000000000d1','26991800-0000-0000-0000-000000000001','HPD Site','Ongoing Project','26991800-0000-0000-0000-0000000000c1','IDR');
insert into procurements (id, org_id, title, status, requested_by_id, project_id, total_value, currency) values
  ('26991800-0000-0000-0000-000000000010','26991800-0000-0000-0000-000000000001','HPD Order','Ordered','26991800-0000-0000-0000-0000000000e1','26991800-0000-0000-0000-0000000000d1',1000,'IDR');
insert into purchase_orders (id, org_id, procurement_id, po_number, status, amount) values
  ('26991800-0000-0000-0000-000000000020','26991800-0000-0000-0000-000000000001','26991800-0000-0000-0000-000000000010','HPD-PO-1','Issued',700);
insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount)
  values ('26991800-0000-0000-0000-000000000030','26991800-0000-0000-0000-000000000001','26991800-0000-0000-0000-000000000010','Received','2026-10-07',500,'exclusive',0);
update organizations set hide_prices_from_requesters = true where id = '26991800-0000-0000-0000-000000000001';

set local role authenticated;
-- Hidden: the legacy Engineer.
set local request.jwt.claims = '{"sub":"26991800-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select amount from purchase_orders_masked where id = '26991800-0000-0000-0000-000000000020'), null, 'AC-003 hidden purchase order amount is NULL');
select is((select po_number from purchase_orders_masked where id = '26991800-0000-0000-0000-000000000020'), 'HPD-PO-1', 'AC-003 the purchase order row stays visible');
select is((select amount from procurement_invoices_masked where id = '26991800-0000-0000-0000-000000000030'), null, 'AC-003 hidden bill amount is NULL');
select is((select count(*)::int from project_committed_spend_masked('26991800-0000-0000-0000-0000000000d1') where amount is not null), 0, 'AC-004 hidden committed spend amount is NULL');
select is((select procurement_id::text from procurement_open_commitments_masked(array['26991800-0000-0000-0000-000000000010']::uuid[])), '26991800-0000-0000-0000-000000000010', 'AC-004 the open commitment row stays');
select is((select amount from procurement_open_commitments_masked(array['26991800-0000-0000-0000-000000000010']::uuid[])), null, 'AC-004 hidden open commitment is NULL');
select is((select count(*)::int from spend_approval_project_figures(array['26991800-0000-0000-0000-0000000000d1']::uuid[]) where figures is not null and figures <> '{}'::jsonb), 0, 'AC-004 the approval-panel project figures are withheld below approval rank');

-- Internal callers: the ORIGINAL functions return the real value to a hidden actor (money and approval logic never sees a mask).
select is((select max(amount) from project_committed_spend('26991800-0000-0000-0000-0000000000d1')), 1000.00::numeric, 'AC-004 the original committed spend is real for a hidden actor');
select is((select amount from procurement_open_commitments(array['26991800-0000-0000-0000-000000000010']::uuid[])), 1000.00::numeric, 'AC-004 the original open commitment is real for a hidden actor');

-- Finance sees the values.
set local request.jwt.claims = '{"sub":"26991800-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select amount from purchase_orders_masked where id = '26991800-0000-0000-0000-000000000020'), 700.00, 'AC-003 Finance reads the purchase order amount');
select is((select amount from procurement_invoices_masked where id = '26991800-0000-0000-0000-000000000030'), 500.00, 'AC-003 Finance reads the bill amount');
select is((select max(amount) from project_committed_spend_masked('26991800-0000-0000-0000-0000000000d1')), 1000.00::numeric, 'AC-004 Finance reads the committed spend');
select is((select amount from procurement_open_commitments_masked(array['26991800-0000-0000-0000-000000000010']::uuid[])), 1000.00::numeric, 'AC-004 Finance reads the open commitment');
reset role;

-- Setting off: the Engineer reads the value again.
update organizations set hide_prices_from_requesters = false where id = '26991800-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"26991800-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select amount from purchase_orders_masked where id = '26991800-0000-0000-0000-000000000020'), 700.00, 'AC-001 setting off: the Engineer reads the purchase order amount');
select is((select max(amount) from project_committed_spend_masked('26991800-0000-0000-0000-0000000000d1')), 1000.00::numeric, 'AC-001 setting off: the Engineer reads the committed spend');
reset role;

select * from finish();
rollback;
