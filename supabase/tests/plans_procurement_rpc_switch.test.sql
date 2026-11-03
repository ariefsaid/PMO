-- AC-PLN-005 / FR-PLN-006 [pgTAP]: procurement's live RPC writers obey the org feature switch.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency) values
  ('17830000-0000-0000-0000-000000000001', 'Procurement RPC Switch', 'IDR');
insert into auth.users (id, email) values
  ('17830000-0000-0000-0000-0000000000a1', 'procurement-rpc-admin@example.invalid'),
  ('17830000-0000-0000-0000-0000000000a2', 'procurement-rpc-finance@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17830000-0000-0000-0000-0000000000a1', '17830000-0000-0000-0000-000000000001', 'RPC Admin', 'procurement-rpc-admin@example.invalid', 'Admin', 'active'),
  ('17830000-0000-0000-0000-0000000000a2', '17830000-0000-0000-0000-000000000001', 'RPC Finance', 'procurement-rpc-finance@example.invalid', 'Finance', 'active');
insert into platform_operators (user_id) values ('17830000-0000-0000-0000-0000000000a1');
insert into org_plans (org_id, plan_id)
  values ('17830000-0000-0000-0000-000000000001', 'enterprise');
insert into org_features (org_id, feature_key, enabled)
  values ('17830000-0000-0000-0000-000000000001', 'procurement', true);
insert into projects (id, org_id, name, status, project_manager_id) values
  ('17830000-0000-0000-0000-0000000000b1', '17830000-0000-0000-0000-000000000001', 'RPC switch project', 'Ongoing Project', '17830000-0000-0000-0000-0000000000a1');
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('17830000-0000-0000-0000-000000000101', '17830000-0000-0000-0000-000000000001', 'RPC switch order',
   '17830000-0000-0000-0000-0000000000b1', '17830000-0000-0000-0000-0000000000a1', 'Draft', 100, 120,
   '17830000-0000-0000-0000-0000000000a2', 'Materials', 'IDR', false),
  ('17830000-0000-0000-0000-000000000102', '17830000-0000-0000-0000-000000000001', 'RPC issue lines',
   '17830000-0000-0000-0000-0000000000b1', '17830000-0000-0000-0000-0000000000a1', 'Ordered', 100, 120,
   '17830000-0000-0000-0000-0000000000a2', 'Subcontractors', 'IDR', true),
  ('17830000-0000-0000-0000-000000000103', '17830000-0000-0000-0000-000000000001', 'RPC revise and bill',
   '17830000-0000-0000-0000-0000000000b1', '17830000-0000-0000-0000-0000000000a1', 'Ordered', 100, 120,
   '17830000-0000-0000-0000-0000000000a2', 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('17830000-0000-0000-0000-000000000111', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000102', 'PO-RPC-LINES', 'Issued', current_date, 100, 'IDR'),
  ('17830000-0000-0000-0000-000000000112', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-000000000103', 'PO-RPC-REVISION', 'Issued', current_date, 100, 'IDR');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('17830000-0000-0000-0000-0000000000e1', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-0000000000b1', 'RPC-1', 'RPC switch item', 'ea', 20, 10);
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('17830000-0000-0000-0000-000000000111', 1, '17830000-0000-0000-0000-0000000000e1', 10, 10, 'ea'),
  ('17830000-0000-0000-0000-000000000112', 1, '17830000-0000-0000-0000-0000000000e1', 10, 10, 'ea');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('17830000-0000-0000-0000-000000000112', '17830000-0000-0000-0000-000000000103', 1, 'Issued', 100,
   '17830000-0000-0000-0000-0000000000a1', 'standard');
select set_config('pmo.po_variation_write', 'on', true);
insert into po_variations (id, po_id, number, origin, status, reason, amount, requested_by, approved_by, approved_at)
  values ('17830000-0000-0000-0000-000000000121', '17830000-0000-0000-0000-000000000112', 'VAR-RPC-1',
          'pre_work', 'Approved', 'RPC switch fixture', 10, '17830000-0000-0000-0000-0000000000a1',
          '17830000-0000-0000-0000-0000000000a2', now());
insert into po_variation_lines (variation_id, boq_item_id, additional_quantity, rate)
  values ('17830000-0000-0000-0000-000000000121', '17830000-0000-0000-0000-0000000000e1', 1, 10);
select set_config('pmo.po_variation_write', '', true);
insert into subcontract_acceptances (id, org_id, project_id, po_id, acceptance_date, status,
                                     prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('17830000-0000-0000-0000-000000000131', '17830000-0000-0000-0000-000000000001', '17830000-0000-0000-0000-0000000000b1',
   '17830000-0000-0000-0000-000000000112', current_date, 'Confirmed', '17830000-0000-0000-0000-0000000000a1',
   '17830000-0000-0000-0000-0000000000a2', now(), 'standard');
insert into subcontract_acceptance_lines (acceptance_id, boq_item_id, quantity)
  values ('17830000-0000-0000-0000-000000000131', '17830000-0000-0000-0000-0000000000e1', 10);
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, currency,
                                  tax_treatment, tax_amount, erp_docstatus)
  values ('17830000-0000-0000-0000-000000000141', '17830000-0000-0000-0000-000000000001',
          '17830000-0000-0000-0000-000000000103', 'VI-RPC-1', current_date, 'Received', 100, 'IDR', 'exclusive', 0, 1);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('17830000-0000-0000-0000-0000000000a1');
select public.operator_toggle_feature('17830000-0000-0000-0000-000000000001', 'procurement', false);

savepoint off_create_purchase_order;
select throws_ok($$ select public.create_purchase_order(
    '17830000-0000-0000-0000-000000000101', 'PO-RPC-OFF', 'Draft', current_date, 100) $$,
  'P0001', 'feature_off', 'AC-PLN-005 procurement off refuses create_purchase_order with feature_off');
rollback to savepoint off_create_purchase_order;

savepoint off_set_efaktur;
select throws_ok($$ select public.set_procurement_invoice_efaktur(
    '17830000-0000-0000-0000-000000000141', '010.001-26.12345678', current_date) $$,
  'P0001', 'feature_off', 'AC-PLN-005 procurement off refuses set_procurement_invoice_efaktur with feature_off');
rollback to savepoint off_set_efaktur;

savepoint off_issue_subcontract_po_lines;
select throws_ok($$ select public.issue_subcontract_po_lines('17830000-0000-0000-0000-000000000111') $$,
  'P0001', 'feature_off', 'AC-PLN-005 procurement off refuses issue_subcontract_po_lines with feature_off');
rollback to savepoint off_issue_subcontract_po_lines;

savepoint off_issue_po_revision;
select throws_ok($$ select public.issue_po_revision('17830000-0000-0000-0000-000000000121') $$,
  'P0001', 'feature_off', 'AC-PLN-005 procurement off refuses issue_po_revision with feature_off');
rollback to savepoint off_issue_po_revision;

savepoint off_attribute_subcontract_bill_lines;
select throws_ok($$ select public.attribute_subcontract_bill_lines(
    '17830000-0000-0000-0000-000000000141',
    '[{"boq_item_id":"17830000-0000-0000-0000-0000000000e1","quantity":10,"rate":10}]'::jsonb) $$,
  'P0001', 'feature_off', 'AC-PLN-005 procurement off refuses attribute_subcontract_bill_lines with feature_off');
rollback to savepoint off_attribute_subcontract_bill_lines;

select public.operator_toggle_feature('17830000-0000-0000-0000-000000000001', 'procurement', true);
select lives_ok($$ select public.create_purchase_order(
    '17830000-0000-0000-0000-000000000101', 'PO-RPC-ON', 'Draft', current_date, 100) $$,
  'AC-PLN-005 procurement on permits create_purchase_order');
select lives_ok($$ select public.set_procurement_invoice_efaktur(
    '17830000-0000-0000-0000-000000000141', '010.001-26.12345678', current_date) $$,
  'AC-PLN-005 procurement on permits set_procurement_invoice_efaktur');
select lives_ok($$ select public.issue_subcontract_po_lines('17830000-0000-0000-0000-000000000111') $$,
  'AC-PLN-005 procurement on permits issue_subcontract_po_lines');
select lives_ok($$ select public.issue_po_revision('17830000-0000-0000-0000-000000000121') $$,
  'AC-PLN-005 procurement on permits issue_po_revision');
select lives_ok($$ select public.attribute_subcontract_bill_lines(
    '17830000-0000-0000-0000-000000000141',
    '[{"boq_item_id":"17830000-0000-0000-0000-0000000000e1","quantity":10,"rate":10}]'::jsonb) $$,
  'AC-PLN-005 procurement on permits attribute_subcontract_bill_lines');

select * from finish();
rollback;
