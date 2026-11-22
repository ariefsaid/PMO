-- 2720_hide_prices_base_tables.test.sql — a person who may not see prices reads none from the priced tables (#2699).
-- Migrations under test: 1540_hide_prices_base_table_gate, 1541_hide_prices_hidden_actor_paths, 1542_hide_prices_other_tables,
-- 1544_hide_prices_setting_audit.
-- Mutations (break one, the named assertion must go red, restore):
--   drop policy price_hidden_deny on purchase_orders ............ 'a person who may not see prices reads no row'
--   drop the org predicate from purchase_orders_row_readable .... 'the masked views return what the table returned'
--   make actor_may_see_prices_now() return true ................. 'a person who may not see prices reads no row'
begin;
select plan(24);

insert into organizations (id, name) values
  ('27200000-0000-0000-0000-000000000001', 'HP2 Org A'),
  ('27200000-0000-0000-0000-000000000002', 'HP2 Org B');
insert into org_plans (org_id, plan_id) values ('27200000-0000-0000-0000-000000000001', 'enterprise'), ('27200000-0000-0000-0000-000000000002', 'enterprise');
insert into org_features (org_id, feature_key, enabled) values
  ('27200000-0000-0000-0000-000000000001', 'procurement', true), ('27200000-0000-0000-0000-000000000002', 'procurement', true);
insert into auth.users (id, email)
select ('27200000-0000-0000-0000-0000000000' || n)::uuid, 'hp2-' || n || '@example.com'
from unnest(array['a1','b1','c1','e1','f1','a2','a3','a4','b2']) n;
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27200000-0000-0000-0000-0000000000a1','27200000-0000-0000-0000-000000000001','HP2 Admin','hp2-a1@example.com','Admin','active'),
  ('27200000-0000-0000-0000-0000000000b1','27200000-0000-0000-0000-000000000001','HP2 PM','hp2-b1@example.com','Project Manager','active'),
  ('27200000-0000-0000-0000-0000000000c1','27200000-0000-0000-0000-000000000001','HP2 Finance','hp2-c1@example.com','Finance','active'),
  ('27200000-0000-0000-0000-0000000000e1','27200000-0000-0000-0000-000000000001','HP2 Engineer','hp2-e1@example.com','Engineer','active'),
  ('27200000-0000-0000-0000-0000000000f1','27200000-0000-0000-0000-000000000001','HP2 Buyer','hp2-f1@example.com','Engineer','active'),
  ('27200000-0000-0000-0000-0000000000a2','27200000-0000-0000-0000-000000000001','HP2 Storekeeper','hp2-a2@example.com','Engineer','active'),
  ('27200000-0000-0000-0000-0000000000a3','27200000-0000-0000-0000-000000000001','HP2 Foreman','hp2-a3@example.com','Engineer','active'),
  ('27200000-0000-0000-0000-0000000000a4','27200000-0000-0000-0000-000000000001','HP2 Inactive','hp2-a4@example.com','Engineer','disabled'),
  ('27200000-0000-0000-0000-0000000000b2','27200000-0000-0000-0000-000000000002','HP2 Engineer B','hp2-b2@example.com','Engineer','active');
update organizations set built_in_roles_enabled = true where id = '27200000-0000-0000-0000-000000000001';
update profiles set built_in_role = 'buyer' where id = '27200000-0000-0000-0000-0000000000f1';
update profiles set built_in_role = 'storekeeper' where id = '27200000-0000-0000-0000-0000000000a2';
update profiles set built_in_role = 'foreman' where id = '27200000-0000-0000-0000-0000000000a3';

insert into projects (id, org_id, name, status, project_manager_id) values
  ('27200000-0000-0000-0000-0000000000d1', '27200000-0000-0000-0000-000000000001', 'HP2 project', 'Ongoing Project', '27200000-0000-0000-0000-0000000000b1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('27200000-0000-0000-0000-0000000000e9', '27200000-0000-0000-0000-000000000001', '27200000-0000-0000-0000-0000000000d1', 'HP2-1', 'HP2 item', 'ea', 20, 10);
-- P1 the Engineer's ordered subcontract case, PD the Engineer's draft, P2 the Buyer's, P3 the Storekeeper's, PB organisation B's.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, approved_by_id, budget_category, currency, is_subcontract) values
  ('27200000-0000-0000-0000-000000000101','27200000-0000-0000-0000-000000000001','HP2 P1','27200000-0000-0000-0000-0000000000d1','27200000-0000-0000-0000-0000000000e1','Ordered',100,120,'27200000-0000-0000-0000-0000000000a1','Subcontractors','IDR',true),
  ('27200000-0000-0000-0000-000000000102','27200000-0000-0000-0000-000000000001','HP2 PD','27200000-0000-0000-0000-0000000000d1','27200000-0000-0000-0000-0000000000e1','Draft',null,null,null,'Materials','IDR',false),
  ('27200000-0000-0000-0000-000000000103','27200000-0000-0000-0000-000000000001','HP2 P2','27200000-0000-0000-0000-0000000000d1','27200000-0000-0000-0000-0000000000f1','Ordered',500,500,'27200000-0000-0000-0000-0000000000a1','Materials','IDR',false),
  ('27200000-0000-0000-0000-000000000104','27200000-0000-0000-0000-000000000001','HP2 P3','27200000-0000-0000-0000-0000000000d1','27200000-0000-0000-0000-0000000000a2','Draft',null,null,null,'Materials','IDR',false),
  ('27200000-0000-0000-0000-000000000105','27200000-0000-0000-0000-000000000002','HP2 PB',null,'27200000-0000-0000-0000-0000000000b2','Draft',null,null,null,'Materials','IDR',false);
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('27200000-0000-0000-0000-000000000111','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000101','HP2 I1',2,12.50),
  ('27200000-0000-0000-0000-000000000112','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000102','HP2 ID',2,12.50),
  ('27200000-0000-0000-0000-000000000113','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000103','HP2 I2',2,12.50),
  ('27200000-0000-0000-0000-000000000114','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000104','HP2 I3',2,12.50),
  ('27200000-0000-0000-0000-000000000115','27200000-0000-0000-0000-000000000002','27200000-0000-0000-0000-000000000105','HP2 IB',2,12.50);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('27200000-0000-0000-0000-000000000121','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000101','HP2-PO1','Issued',current_date,100,'IDR'),
  ('27200000-0000-0000-0000-000000000122','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000103','HP2-PO2','Issued',current_date,500,'IDR'),
  ('27200000-0000-0000-0000-000000000123','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000104','HP2-PO3','Issued',current_date,50,'IDR'),
  ('27200000-0000-0000-0000-000000000124','27200000-0000-0000-0000-000000000002','27200000-0000-0000-0000-000000000105','HP2-POB','Issued',current_date,50,'IDR');
insert into purchase_requests (id, org_id, procurement_id, pr_number, status, date, amount, currency) values
  ('27200000-0000-0000-0000-000000000131','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000101','HP2-PR1','Approved',current_date,100,'IDR'),
  ('27200000-0000-0000-0000-000000000132','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000103','HP2-PR2','Approved',current_date,500,'IDR'),
  ('27200000-0000-0000-0000-000000000133','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000104','HP2-PR3','Approved',current_date,50,'IDR'),
  ('27200000-0000-0000-0000-000000000134','27200000-0000-0000-0000-000000000002','27200000-0000-0000-0000-000000000105','HP2-PRB','Approved',current_date,50,'IDR');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('27200000-0000-0000-0000-000000000121', 1, '27200000-0000-0000-0000-0000000000e9', 10, 10, 'ea');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('27200000-0000-0000-0000-000000000121', '27200000-0000-0000-0000-000000000101', 1, 'Issued', 100, '27200000-0000-0000-0000-0000000000a1', 'standard');
select set_config('pmo.po_variation_write', 'on', true);
insert into po_variations (id, po_id, number, origin, status, reason, amount, requested_by, approved_by, approved_at) values
  ('27200000-0000-0000-0000-000000000141', '27200000-0000-0000-0000-000000000121', 'HP2-VAR-1', 'pre_work', 'Approved', 'HP2 fixture', 10,
   '27200000-0000-0000-0000-0000000000a1', '27200000-0000-0000-0000-0000000000a1', now());
insert into po_variation_lines (variation_id, boq_item_id, additional_quantity, rate) values
  ('27200000-0000-0000-0000-000000000141', '27200000-0000-0000-0000-0000000000e9', 1, 10);
select set_config('pmo.po_variation_write', '', true);
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, currency, tax_treatment, tax_amount, erp_docstatus) values
  ('27200000-0000-0000-0000-000000000151','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000101','HP2-VI1',current_date,'Approved',100,'IDR','none',0,1);
insert into stock_units (id, org_id, code, name) values ('27200000-0000-0000-0000-000000000161','27200000-0000-0000-0000-000000000001','m','metre');
insert into stock_items (id, org_id, code, name, unit_id) values ('27200000-0000-0000-0000-000000000162','27200000-0000-0000-0000-000000000001','CBL','Cable','27200000-0000-0000-0000-000000000161');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('27200000-0000-0000-0000-000000000163','27200000-0000-0000-0000-000000000001','HP2C','Central','central',null);
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, occurred_on, created_by) values
  ('27200000-0000-0000-0000-000000000164','27200000-0000-0000-0000-000000000001','RCV-HP2-1','receive','Draft','27200000-0000-0000-0000-000000000163','2026-11-16','27200000-0000-0000-0000-0000000000a1');
insert into stock_document_lines (id, org_id, document_id, line_no, item_id, quantity, unit_cost) values
  ('27200000-0000-0000-0000-000000000165','27200000-0000-0000-0000-000000000001','27200000-0000-0000-0000-000000000164',1,'27200000-0000-0000-0000-000000000162',5,10);

-- The nine actors and the six tables that have a masked view and a base read for a requester.
create temp table hp_actor (uid text primary key, label text, hidden_when_on boolean);
insert into hp_actor values
  ('a1','Admin',false), ('b1','Project Manager',false), ('c1','Finance',false), ('e1','legacy Engineer',true), ('f1','Buyer',false),
  ('a2','Storekeeper',true), ('a3','Foreman',true), ('a4','inactive member',true), ('b2','Engineer of the other organisation',false);
create temp table hp_pair (base text, vw text, price_cols text[]);
insert into hp_pair values
  ('procurements','procurements_masked','{total_value,approved_total_value}'),
  ('procurement_items','procurement_items_masked','{rate,amount,erp_line_amount}'),
  ('purchase_orders','purchase_orders_masked','{amount}'),
  ('purchase_requests','purchase_requests_masked','{amount}'),
  ('purchase_order_lines','purchase_order_lines_masked','{rate,amount}'),
  ('po_variation_lines','po_variation_lines_masked','{rate,amount}');
create temp table hp_seen (uid text, base text, setting boolean, base_n int, view_n int, view_priced int);
grant all on hp_actor, hp_pair, hp_seen to authenticated;

-- Reads every actor sees from the table and from its masked view, with the setting off and on.
do $$ declare a record; p record; s boolean; bn int; vn int; vp int; begin
  for a in select * from hp_actor loop
    foreach s in array array[false, true] loop
      update organizations set hide_prices_from_requesters = s where id = '27200000-0000-0000-0000-000000000001';
      for p in select * from hp_pair loop
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims', '{"sub":"27200000-0000-0000-0000-0000000000' || a.uid || '","role":"authenticated"}', true);
        execute format('select count(*) from public.%I', p.base) into bn;
        execute format('select count(*) from public.%I', p.vw) into vn;
        execute format('select count(*) from public.%I where %s', p.vw, (select string_agg(c || ' is not null', ' or ') from unnest(p.price_cols) c)) into vp;
        execute 'reset role';
        insert into hp_seen values (a.uid, p.base, s, bn, vn, vp);
      end loop;
    end loop;
  end loop;
  update organizations set hide_prices_from_requesters = false where id = '27200000-0000-0000-0000-000000000001';
end $$;

select is_empty($$ select o.uid, o.base from hp_seen o where o.setting = false and o.base_n <> o.view_n $$,
  'AC-HP2-001 setting off: the masked views return what the table returned, for nine actors on six tables');
select is_empty($$ select n.uid, n.base from hp_seen n join hp_seen o using (uid, base) join hp_actor a using (uid)
  where o.setting = false and n.setting = true and not a.hidden_when_on
    and (n.base_n <> o.base_n or n.view_n <> o.base_n or n.view_priced <> o.view_priced) $$,
  'AC-HP2-002 setting on: people who may see prices read the same rows and the same prices as before');
select is_empty($$ select n.uid, n.base from hp_seen n join hp_seen o using (uid, base) join hp_actor a using (uid)
  where o.setting = false and n.setting = true and a.hidden_when_on and (n.base_n <> 0 or n.view_n <> o.base_n or n.view_priced <> 0) $$,
  'AC-HP2-003 setting on: a person who may not see prices reads no row from the tables and the same rows without prices from the views');
select is_empty($$ select u.uid, u.base from hp_seen u where u.setting = false and
  ((u.uid = 'a1' and u.base_n = 0) or (u.uid = 'e1' and u.base_n = 0) or (u.uid = 'b2' and u.base in ('procurements','procurement_items','purchase_orders','purchase_requests') and u.base_n = 0)) $$,
  'AC-HP2-004 the comparison is not empty: the Admin, the Engineer and the other organisation read rows to compare');
select is((select count(*)::int from hp_seen), 108, 'AC-HP2-005 nine actors, six tables, two settings were all read');

-- Every priced table carries the deny.
select is_empty($$ select t from unnest(array['procurements','procurement_items','purchase_orders','purchase_requests','purchase_order_lines','po_variation_lines','stock_document_lines']) t
  where not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'price_hidden_deny'
                      and permissive = 'RESTRICTIVE' and cmd = 'SELECT' and roles = '{authenticated}') $$,
  'AC-HP2-006 each priced table refuses a person who may not see prices');

-- Setting on, the Engineer who may not see prices: joins, derived amounts, stock.
update organizations set hide_prices_from_requesters = true where id = '27200000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"27200000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select count(*)::int from procurements p join procurement_items i on i.procurement_id = p.id), 0,
  'AC-HP2-007 a person who may not see prices reads no row through a join of the tables');
select is((select count(*)::int from procurements_masked p join procurement_items_masked i on i.procurement_id = p.id where i.rate is null and p.total_value is null), 2,
  'AC-HP2-008 the same join over the views returns the rows without prices');
select is((select count(*)::int from procurement_open_commitments(array['27200000-0000-0000-0000-000000000101']::uuid[])), 0,
  'AC-HP2-009 the open commitment of the Engineer''s own case is not returned');
select is((select coalesce(sum(amount), 0)::numeric from project_committed_spend('27200000-0000-0000-0000-0000000000d1')), 0::numeric,
  'AC-HP2-010 the committed spend of the project is not returned');
select is((select count(*)::int from stock_document_lines_masked), 1, 'AC-HP2-011 the stock line view returns the line to a person who may not see prices');
select is((select unit_cost from stock_document_lines_masked), null, 'AC-HP2-012 the stock line view returns no unit cost to that person');
set local request.jwt.claims = '{"sub":"27200000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select coalesce(sum(amount), 0)::numeric from project_committed_spend('27200000-0000-0000-0000-0000000000d1')), 600::numeric,
  'AC-HP2-013 Finance still reads the committed spend of the project');
select is((select unit_cost from stock_document_lines_masked), 10::numeric, 'AC-HP2-014 Finance reads the unit cost through the stock line view');
select is((select count(*)::int from procurement_invoices), 1, 'AC-HP2-015 Finance still reads the vendor bill');
set local request.jwt.claims = '{"sub":"27200000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select count(*)::int from procurement_invoices) + (select count(*)::int from payments), 0, 'AC-HP2-016 the vendor bills and payments stay unreadable to the Engineer');
select is(has_table_privilege('authenticated', 'public.stock_document_lines', 'select') or has_table_privilege('authenticated', 'public.stock_ledger', 'select')
  or has_table_privilege('authenticated', 'public.stock_balances', 'select'), false, 'AC-HP2-017 stock values are readable by no signed-in role directly');

-- The Engineer's own work (1541): a draft line is added without sending the organisation, and a request is raised in one call.
select lives_ok($$ insert into procurement_items (id, procurement_id, name, quantity, rate) values
  ('27200000-0000-0000-0000-000000000116', '27200000-0000-0000-0000-000000000102', 'HP2 new line', 3, 9) $$,
  'AC-HP2-018 a person who may not see prices adds a line to their own draft');
select is((select count(*)::int from procurement_items_masked where id = '27200000-0000-0000-0000-000000000116' and rate is null and quantity = 3), 1,
  'AC-HP2-019 the new line is read back without its price');
select lives_ok($$ select create_procurement_with_items('27200000-0000-0000-0000-000000000171'::uuid,
  '{"title":"HP2 raised","project_id":"27200000-0000-0000-0000-0000000000d1"}'::jsonb,
  '[{"id":"27200000-0000-0000-0000-000000000172","name":"HP2 raised line","quantity":1,"rate":5}]'::jsonb) $$,
  'AC-HP2-020 a person who may not see prices raises a request');
select is((select count(*)::int from procurements_masked where id = '27200000-0000-0000-0000-000000000171' and total_value is null), 1,
  'AC-HP2-021 the raised request is followed without its total');
reset role;

-- The switch is recorded (1544).
update organizations set hide_prices_from_requesters = false where id = '27200000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"27200000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_hide_prices_enabled(true);
select set_hide_prices_enabled(false);
reset role;
select is((select count(*)::int from audit_events where action = 'hide_prices.set' and org_id = '27200000-0000-0000-0000-000000000001'
             and actor_id = '27200000-0000-0000-0000-0000000000a1' and (detail->>'enabled')::boolean in (true, false)), 2,
  'AC-HP2-022 each change of the setting is recorded with who changed it');
select is((select array_agg((detail->>'enabled')::boolean order by created_at, id) from audit_events where action = 'hide_prices.set'), array[true, false],
  'AC-HP2-023 the record says what the setting became');

-- 1542: the other priced tables carry the same deny.
select is_empty($$ select t from unnest(array['procurement_quotations','rfqs','procurement_invoice_lines','procurement_bill_match_lines','po_variations','purchase_order_revisions',
  'equipment_plan_lines','equipment_rental_terms','equipment_rental_checks','contract_rate_lines','rate_catalogue_rates','subcontractor_rate_lines','subcontract_certificate_lines']) t
  where not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'price_hidden_deny'
                      and permissive = 'RESTRICTIVE' and cmd = 'SELECT' and roles = '{authenticated}') $$,
  'AC-HP2-024 each table on the ruled list refuses a person who may not see prices');

select * from finish();
rollback;
