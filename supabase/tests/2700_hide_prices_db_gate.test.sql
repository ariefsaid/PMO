-- 2700_hide_prices_db_gate.test.sql — #2788: the database applies the hide-prices setting on every way of reading.
-- Migration under test: 2700_hide_prices_db_gate.
-- Mutations (break one, the named assertion goes red, restore):
--   drop policy price_hidden_deny on purchase_orders ........................ AC-HPG-003
--   drop the organisation term from the WHERE of purchase_orders_masked ...... AC-HPG-001
--   drop the ordering-right arm from the WHERE of procurements_masked ........ AC-HPG-001
--   make actor_shown_prices() return true ................................... AC-HPG-003, AC-HPG-014
--   make actor_shown_prices() ignore the setting (= actor_may_see_prices_now) AC-HPG-009
--   drop the gate line from equipment_rental_check ........................... AC-HPG-014
--   drop the mask line from create_procurement_with_items .................... AC-HPG-012
begin;
select plan(24);

insert into organizations (id, name, built_in_roles_enabled) values
  ('27000000-0000-0000-0000-000000000001', 'HPG Org A', true),
  ('27000000-0000-0000-0000-000000000002', 'HPG Org B', false);
insert into org_plans (org_id, plan_id) values ('27000000-0000-0000-0000-000000000001', 'enterprise'), ('27000000-0000-0000-0000-000000000002', 'enterprise');
insert into org_features (org_id, feature_key, enabled) values
  ('27000000-0000-0000-0000-000000000001', 'procurement', true), ('27000000-0000-0000-0000-000000000002', 'procurement', true);
insert into auth.users (id, email)
select ('27000000-0000-0000-0000-0000000000' || n)::uuid, 'hpg-' || n || '@example.com'
from unnest(array['a1','b1','c1','e1','f1','a2','a3','a4','a5','b2']) n;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27000000-0000-0000-0000-0000000000a1','27000000-0000-0000-0000-000000000001','HPG Admin','hpg-a1@example.com','Admin','active',null),
  ('27000000-0000-0000-0000-0000000000b1','27000000-0000-0000-0000-000000000001','HPG PM','hpg-b1@example.com','Project Manager','active',null),
  ('27000000-0000-0000-0000-0000000000c1','27000000-0000-0000-0000-000000000001','HPG Finance','hpg-c1@example.com','Finance','active',null),
  ('27000000-0000-0000-0000-0000000000e1','27000000-0000-0000-0000-000000000001','HPG Engineer','hpg-e1@example.com','Engineer','active',null),
  ('27000000-0000-0000-0000-0000000000f1','27000000-0000-0000-0000-000000000001','HPG Buyer','hpg-f1@example.com','Engineer','active','buyer'),
  ('27000000-0000-0000-0000-0000000000a2','27000000-0000-0000-0000-000000000001','HPG Storekeeper','hpg-a2@example.com','Engineer','active','storekeeper'),
  ('27000000-0000-0000-0000-0000000000a3','27000000-0000-0000-0000-000000000001','HPG Foreman','hpg-a3@example.com','Engineer','active','foreman'),
  ('27000000-0000-0000-0000-0000000000a4','27000000-0000-0000-0000-000000000001','HPG Inactive','hpg-a4@example.com','Engineer','disabled',null),
  ('27000000-0000-0000-0000-0000000000a5','27000000-0000-0000-0000-000000000001','HPG Equipment','hpg-a5@example.com','Engineer','active','equipment_officer'),
  ('27000000-0000-0000-0000-0000000000b2','27000000-0000-0000-0000-000000000002','HPG Engineer B','hpg-b2@example.com','Engineer','active',null);
-- The Storekeeper holds the ordering right, so the ordering-right read arm is exercised (a person who may not see prices may still order).
insert into purchase_order_settings (org_id, order_job_roles) values ('27000000-0000-0000-0000-000000000001', '{storekeeper}')
  on conflict (org_id) do update set order_job_roles = excluded.order_job_roles;

insert into projects (id, org_id, name, status, project_manager_id) values
  ('27000000-0000-0000-0000-0000000000d1', '27000000-0000-0000-0000-000000000001', 'HPG project', 'Ongoing Project', '27000000-0000-0000-0000-0000000000b1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('27000000-0000-0000-0000-0000000000e9', '27000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-0000000000d1', 'HPG-1', 'HPG item', 'ea', 20, 10);
-- P1 the Engineer's ordered case, PD the Engineer's draft, P2 the Buyer's, P3 a Project Manager's, PB organisation B's.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, approved_by_id, budget_category, currency, is_subcontract) values
  ('27000000-0000-0000-0000-000000000101','27000000-0000-0000-0000-000000000001','HPG P1','27000000-0000-0000-0000-0000000000d1','27000000-0000-0000-0000-0000000000e1','Ordered',100,120,'27000000-0000-0000-0000-0000000000a1','Subcontractors','IDR',true),
  ('27000000-0000-0000-0000-000000000102','27000000-0000-0000-0000-000000000001','HPG PD','27000000-0000-0000-0000-0000000000d1','27000000-0000-0000-0000-0000000000e1','Draft',0,null,null,'Materials','IDR',false),
  ('27000000-0000-0000-0000-000000000103','27000000-0000-0000-0000-000000000001','HPG P2','27000000-0000-0000-0000-0000000000d1','27000000-0000-0000-0000-0000000000f1','Ordered',500,500,'27000000-0000-0000-0000-0000000000a1','Materials','IDR',false),
  ('27000000-0000-0000-0000-000000000104','27000000-0000-0000-0000-000000000001','HPG P3','27000000-0000-0000-0000-0000000000d1','27000000-0000-0000-0000-0000000000b1','Draft',0,null,null,'Materials','IDR',false),
  ('27000000-0000-0000-0000-000000000105','27000000-0000-0000-0000-000000000002','HPG PB',null,'27000000-0000-0000-0000-0000000000b2','Draft',0,null,null,'Materials','IDR',false);
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('27000000-0000-0000-0000-000000000111','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000101','HPG I1',2,12.50),
  ('27000000-0000-0000-0000-000000000112','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000102','HPG ID',2,12.50),
  ('27000000-0000-0000-0000-000000000113','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000103','HPG I2',2,12.50),
  ('27000000-0000-0000-0000-000000000114','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000104','HPG I3',2,12.50),
  ('27000000-0000-0000-0000-000000000115','27000000-0000-0000-0000-000000000002','27000000-0000-0000-0000-000000000105','HPG IB',2,12.50);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('27000000-0000-0000-0000-000000000121','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000101','HPG-PO1','Issued','2026-11-20',100,'IDR'),
  ('27000000-0000-0000-0000-000000000122','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000103','HPG-PO2','Issued','2026-11-20',500,'IDR'),
  ('27000000-0000-0000-0000-000000000123','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000104','HPG-PO3','Issued','2026-11-20',50,'IDR'),
  ('27000000-0000-0000-0000-000000000124','27000000-0000-0000-0000-000000000002','27000000-0000-0000-0000-000000000105','HPG-POB','Issued','2026-11-20',50,'IDR');
insert into purchase_requests (id, org_id, procurement_id, pr_number, status, date, amount, currency) values
  ('27000000-0000-0000-0000-000000000131','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000101','HPG-PR1','Submitted','2026-11-20',100,'IDR'),
  ('27000000-0000-0000-0000-000000000132','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000103','HPG-PR2','Submitted','2026-11-20',500,'IDR'),
  ('27000000-0000-0000-0000-000000000133','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000104','HPG-PR3','Submitted','2026-11-20',50,'IDR'),
  ('27000000-0000-0000-0000-000000000134','27000000-0000-0000-0000-000000000002','27000000-0000-0000-0000-000000000105','HPG-PRB','Submitted','2026-11-20',50,'IDR');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('27000000-0000-0000-0000-000000000121', 1, '27000000-0000-0000-0000-0000000000e9', 10, 10, 'ea'),
  ('27000000-0000-0000-0000-000000000123', 1, '27000000-0000-0000-0000-0000000000e9', 5, 10, 'ea');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('27000000-0000-0000-0000-000000000121', '27000000-0000-0000-0000-000000000101', 1, 'Issued', 100, '27000000-0000-0000-0000-0000000000a1', 'standard');
select set_config('pmo.po_variation_write', 'on', true);
insert into po_variations (id, po_id, number, origin, status, reason, amount, requested_by, approved_by, approved_at) values
  ('27000000-0000-0000-0000-000000000141', '27000000-0000-0000-0000-000000000121', 'HPG-VAR-1', 'pre_work', 'Approved', 'HPG fixture', 10,
   '27000000-0000-0000-0000-0000000000a1', '27000000-0000-0000-0000-0000000000a1', now());
insert into po_variation_lines (variation_id, boq_item_id, additional_quantity, rate) values
  ('27000000-0000-0000-0000-000000000141', '27000000-0000-0000-0000-0000000000e9', 1, 10);
select set_config('pmo.po_variation_write', '', true);
insert into procurement_status_events (id, org_id, procurement_id, to_status, created_at) values
  ('27000000-0000-0000-0000-000000000181','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000101','Ordered', now());
insert into procurement_receipts (id, org_id, procurement_id, status) values
  ('27000000-0000-0000-0000-000000000182','27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000101','Partial');
insert into companies (id, org_id, name, type) values
  ('27000000-0000-0000-0000-0000000000c9', '27000000-0000-0000-0000-000000000001', 'HPG Rental Co', 'Vendor');
insert into equipment_assets (id, org_id, code, name, default_unit, ownership) values
  ('27000000-0000-0000-0000-0000000000f9', '27000000-0000-0000-0000-000000000001', 'HPG-EQ', 'Crane', 'hours', 'rented');
insert into equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from) values
  ('27000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-0000000000f9', '27000000-0000-0000-0000-0000000000c9', 300.00, 'day', 'IDR', '2026-09-01');
insert into hourly_rental_checks (org_id, asset_id, period_from, period_to, result, created_by) values
  ('27000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-0000000000f9', '2026-09-01', '2026-09-30', '{"rate":"300.00"}', '27000000-0000-0000-0000-0000000000a1');

-- Ten actors; six tables with a masked view; two settings.
create temp table hp_actor (uid text primary key, hidden_when_on boolean);
insert into hp_actor values ('a1',false), ('b1',false), ('c1',false), ('e1',true), ('f1',false), ('a2',true), ('a3',true), ('a4',true), ('a5',true), ('b2',false);
create temp table hp_pair (base text, vw text, price_cols text[], k text);
insert into hp_pair values
  ('procurements','procurements_masked','{total_value,approved_total_value,vendor_id}','id::text'),
  ('procurement_items','procurement_items_masked','{rate,amount,erp_line_amount}','id::text'),
  ('purchase_orders','purchase_orders_masked','{amount}','id::text'),
  ('purchase_requests','purchase_requests_masked','{amount}','id::text'),
  ('purchase_order_lines','purchase_order_lines_masked','{rate,amount}','id::text'),
  ('po_variation_lines','po_variation_lines_masked','{rate,amount}','variation_id::text || boq_item_id::text');
create temp table hp_seen (uid text, base text, setting boolean, base_ids text, view_ids text, view_priced int);
grant all on hp_actor, hp_pair, hp_seen to authenticated;

do $$ declare a record; p record; s boolean; b text; v text; vp int; begin
  for a in select * from hp_actor loop
    foreach s in array array[false, true] loop
      update organizations set hide_prices_from_requesters = s where id = '27000000-0000-0000-0000-000000000001';
      for p in select * from hp_pair loop
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims', '{"sub":"27000000-0000-0000-0000-0000000000' || a.uid || '","role":"authenticated"}', true);
        execute format('select coalesce(string_agg(%s, %L order by %s), %L) from public.%I', p.k, ',', p.k, '', p.base) into b;
        execute format('select coalesce(string_agg(%s, %L order by %s), %L) from public.%I', p.k, ',', p.k, '', p.vw) into v;
        execute format('select count(*) from public.%I where %s', p.vw, (select string_agg(c || ' is not null', ' or ') from unnest(p.price_cols) c)) into vp;
        execute 'reset role';
        insert into hp_seen values (a.uid, p.base, s, b, v, vp);
      end loop;
    end loop;
  end loop;
  update organizations set hide_prices_from_requesters = false where id = '27000000-0000-0000-0000-000000000001';
end $$;

select is_empty($$ select o.uid, o.base from hp_seen o where o.setting = false and o.base_ids is distinct from o.view_ids $$,
  'AC-HPG-001 setting off: each masked view returns exactly the rows of its table, for ten actors on six tables');
select is_empty($$ select n.uid, n.base from hp_seen n join hp_seen o using (uid, base) join hp_actor a using (uid)
  where o.setting = false and n.setting = true and not a.hidden_when_on
    and (n.base_ids is distinct from o.base_ids or n.view_ids is distinct from o.base_ids or n.view_priced <> o.view_priced) $$,
  'AC-HPG-002 setting on: people who may see prices read the same rows and the same prices as before');
select is_empty($$ select n.uid, n.base from hp_seen n join hp_seen o using (uid, base) join hp_actor a using (uid)
  where o.setting = false and n.setting = true and a.hidden_when_on and (n.base_ids <> '' or n.view_ids is distinct from o.base_ids or n.view_priced <> 0) $$,
  'AC-HPG-003 setting on: a person who may not see prices reads no row from the tables, and the same rows without prices from the views');
select is_empty($$ select u.uid, u.base from hp_seen u where u.setting = false and u.base_ids = ''
  and ((u.uid in ('a1','e1','a2') and u.base in ('procurements','procurement_items','purchase_orders','purchase_requests','purchase_order_lines'))
    or (u.uid = 'b2' and u.base in ('procurements','procurement_items','purchase_orders','purchase_requests'))) $$,
  'AC-HPG-004 the comparison is not empty: the Admin, the requester, the ordering Storekeeper and the other organisation read rows');
select is((select count(*)::int from hp_seen), 120, 'AC-HPG-005 ten actors, six tables, two settings were all read');

-- The read rules the views copy are pinned: changing a SELECT policy of these tables must come back here together with the view.
select is((select md5(string_agg(tablename || '|' || policyname || '|' || permissive || '|' || roles::text || '|' || cmd || '|' || coalesce(qual, ''),
                                 E'\n' order by tablename, policyname))
             from pg_policies where schemaname = 'public' and cmd in ('SELECT', 'ALL') and policyname <> 'price_hidden_deny'
              and tablename in ('procurements','procurement_items','purchase_orders','purchase_requests','purchase_order_lines','po_variations','po_variation_lines')),
  '1dc28bfbfbb2e8f665bf61d23ea57621', 'AC-HPG-006 the read rules the masked views copy are unchanged (policy hash of the seven tables)');

-- Every table that carries a price the ruling names refuses a person who may not see prices.
select is_empty($$ select t from unnest(array['procurements','procurement_items','purchase_orders','purchase_requests','purchase_order_lines',
    'po_variations','po_variation_lines','purchase_order_revisions','procurement_quotations','rfqs','procurement_invoices','procurement_invoice_lines',
    'procurement_bill_match_lines','payments','erp_purchase_documents','equipment_rental_terms','equipment_rental_checks','hourly_rental_checks',
    'contract_rate_lines','rate_catalogue_rates','subcontract_certificate_lines','subcontractor_rate_lines','odoo_stock_cost_lines']) t
  where not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'price_hidden_deny'
                      and permissive = 'RESTRICTIVE' and cmd = 'SELECT' and roles = '{authenticated}') $$,
  'AC-HPG-007 each priced table refuses a person who may not see prices');

-- Drift check: a table a signed-in person can read that gains a price column must be classified here.
select is_empty($$ select distinct c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.atttypid = 'numeric'::regtype
    and a.attname ~ '(rate|amount|price|cost|value|total|outstanding)' and has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT')
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'price_hidden_deny')
    and c.relname not in (
      -- budgets, bills of quantity, revenue and claims stay visible (owner ruling on what the setting names)
      'boq_items','boq_item_area_rates','budget_line_items','budget_year_distributions','claim_retention','progress_claims','progress_claim_lines',
      'tm_claims','tm_claim_lines','projects','work_orders','work_order_plan_lines','work_order_revenue_plan','sales_invoices','incoming_payments',
      'incoming_payment_allocations','credits','credit_allocations','retention_releases','revenue_erp_mirror','opening_balances','opening_balance_lines',
      -- not purchase, stock or rental prices: settings, tax and FX rates, staff costs, site cash, usage
      'companies','fx_rates','organizations','org_three_way_match_settings','spend_approvers','labour_cost_rates','agent_usage','daily_site_reports',
      'expense_claims','expense_claim_lines','expense_advance_returns','imprest_cash_counts','imprest_float_changes','imprest_floats','imprest_plan_lines',
      'imprest_plans','imprest_replenishments','timesheet_erp_mirror','erp_ap_aging_snapshot','erp_ar_aging_snapshot','erp_payment_ledger_mirror',
      'work_order_consumable_plan_lines','stock_warehouses',
      -- read only at a level that always sees prices (Project Manager, Finance, Executive, Admin)
      'equipment_costing_settings','subcontract_certificates','subcontract_backcharges','subcontract_certificate_backcharges',
      'vendor_withholding_slips','vendor_withholding_slip_bills',
      -- planned equipment rates: not on the ruled list (see the ticket)
      'equipment_plan_lines')
  order by 1 $$,
  'AC-HPG-008 every readable table with a price column is gated or classified as visible');

-- With hiding off, a blind receiver (order receiving on) reads the same purchase rows as before.
set local role authenticated;
set local request.jwt.claims = '{"sub":"27000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
create temp table hp_blind as select count(*)::int n from procurements;
reset role;
insert into order_receiving_settings (org_id, enabled) values ('27000000-0000-0000-0000-000000000001', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"27000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from procurements), (select n from hp_blind),
  'AC-HPG-009 hiding off: order receiving does not take purchase rows away from the storekeeper');
reset role;
delete from order_receiving_settings where org_id = '27000000-0000-0000-0000-000000000001';

-- Hiding on: the requester who may not see prices still does their job.
update organizations set hide_prices_from_requesters = true where id = '27000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"27000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok($$ insert into procurement_items (id, procurement_id, name, quantity, rate) values
  ('27000000-0000-0000-0000-000000000116', '27000000-0000-0000-0000-000000000102', 'HPG added', 3, 4) $$,
  'AC-HPG-010 a person who may not see prices adds a line to their own draft request');
select is((select count(*)::int from procurement_items_masked where id = '27000000-0000-0000-0000-000000000116' and rate is null and quantity = 3), 1,
  'AC-HPG-011 and reads the line back without its price');
select is((select (create_procurement_with_items('27000000-0000-0000-0000-000000000171'::uuid,
  '{"title":"HPG raised","project_id":"27000000-0000-0000-0000-0000000000d1"}'::jsonb,
  '[{"id":"27000000-0000-0000-0000-000000000172","name":"HPG raised line","quantity":1,"rate":5}]'::jsonb)).total_value), null::numeric,
  'AC-HPG-012 raising a request returns the request without its total to a person who may not see prices');
select is((select count(*)::int from procurement_status_events where procurement_id = '27000000-0000-0000-0000-000000000101')
          + (select count(*)::int from procurement_receipts where procurement_id = '27000000-0000-0000-0000-000000000101'), 2,
  'AC-HPG-013 that person follows the status events and receipts of their own request');
select lives_ok($$ insert into tasks (org_id, project_id, name, procurement_id, assignee_id) values
  ('27000000-0000-0000-0000-000000000001', null, 'HPG task', '27000000-0000-0000-0000-000000000102', '27000000-0000-0000-0000-0000000000e1') $$,
  'AC-HPG-016 that person links a task to their own request');
select is((select count(*)::int from purchase_order_revisions) + (select count(*)::int from po_variations), 0,
  'AC-HPG-017 that person reads no order revision or order change');

-- The equipment officer, who holds no price right, reads no rental rate by any route while hiding is on.
set local request.jwt.claims = '{"sub":"27000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is((select count(*)::int from equipment_rental_terms) + (select count(*)::int from hourly_rental_checks), 0,
  'AC-HPG-018 hiding on: the equipment officer reads no rental term and no hourly check');
select throws_ok($$ select equipment_rental_check('27000000-0000-0000-0000-0000000000f9', '2026-09-01', '2026-09-30') $$, '42501', null,
  'AC-HPG-014 hiding on: the rental check is refused to a person who may not see prices');
select throws_ok($$ select check_hourly_rental('27000000-0000-0000-0000-0000000000f9', '2026-09-01', '2026-09-30', 10, 10, '[]'::jsonb) $$, '42501', null,
  'AC-HPG-015 hiding on: the hourly rental check is refused to a person who may not see prices');
reset role;
update organizations set hide_prices_from_requesters = false where id = '27000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"27000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok($$ select equipment_rental_check('27000000-0000-0000-0000-0000000000f9', '2026-09-01', '2026-09-30') $$,
  'AC-HPG-019 hiding off: the equipment officer runs the rental check as before');
select is((select count(*)::int from equipment_rental_terms), 1, 'AC-HPG-020 hiding off: the equipment officer reads the rental term as before');

-- The Buyer sees prices: the request it raises comes back with its total.
set local request.jwt.claims = '{"sub":"27000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select isnt((select (create_procurement_with_items('27000000-0000-0000-0000-000000000173'::uuid,
  '{"title":"HPG raised B","project_id":"27000000-0000-0000-0000-0000000000d1"}'::jsonb,
  '[{"id":"27000000-0000-0000-0000-000000000174","name":"HPG raised line","quantity":1,"rate":5}]'::jsonb)).total_value), null::numeric,
  'AC-HPG-021 a person who may see prices gets the total back as before');
reset role;

-- The owner-rights views are read-only and closed to the anonymous role.
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'public'
             and table_name in ('procurements_masked','procurement_items_masked','purchase_orders_masked','purchase_requests_masked','purchase_order_lines_masked','po_variation_lines_masked')
             and grantee in ('authenticated','anon','public') and privilege_type <> 'SELECT'), 0,
  'AC-HPG-022 a signed-in person cannot write through a masked view');
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'
             and table_name in ('procurements_masked','procurement_items_masked','purchase_orders_masked','purchase_requests_masked','purchase_order_lines_masked','po_variation_lines_masked')), 0,
  'AC-HPG-023 the anonymous role reads no masked view');
select is((select count(*)::int from pg_proc where proname = 'actor_shown_prices' and prosecdef
             and proconfig @> array['search_path=public, pg_temp'] and not has_function_privilege('anon', oid, 'EXECUTE')), 1,
  'AC-HPG-024 the price gate is a definer function with a pinned search path, not callable anonymously');

select * from finish();
rollback;
