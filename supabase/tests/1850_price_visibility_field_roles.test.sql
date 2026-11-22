-- 1850_price_visibility_field_roles.test.sql — a Foreman and a Field user read no price through any channel (docs/specs/price-visibility-roles.spec.md).
-- No migration: the base already answers the ask (field accounts are refused the purchase and stock tables, the masked views read through
-- those tables, and the priced definer reads refuse a field account). This file is the acceptance proof, one assertion per channel, with the
-- hide setting both on and off. A control (an Admin, a Finance person, a Buyer) must read prices through the same channels, so the proof cannot pass
-- because the fixtures are empty.
-- MUTATION CHECKS (break the rule, the named assertion must go red, restore):
--   drop policy light_account_deny_select on procurement_items               -> 'AC-PVF-001 procurement_items ...' and 'AC-PVF-002 procurement_items_masked ...'
--   create or replace actor_is_light() to return false                       -> every AC-PVF-001/002/003 assertion that reads fixture rows
--   remove `perform public.assert_not_light();` / the guard from get_stock_on_hand -> 'AC-PVF-004 get_stock_on_hand is refused ...'
--   drop policy light_account_deny_select on purchase_orders                  -> 'AC-PVF-001 purchase_orders ...' and 'AC-PVF-002 purchase_orders_masked ...'
--   delete the fixture row from purchase_orders (as superuser)               -> 'AC-PVF-007 the control reads prices ...' (the proof cannot pass on empty data)
begin;
select plan(42);


insert into organizations (id, name) values
  ('18500000-0000-0000-0000-000000000001', 'PVF Org A'),
  ('18500000-0000-0000-0000-000000000002', 'PVF Org B');
insert into org_plans (org_id, plan_id) values ('18500000-0000-0000-0000-000000000001', 'enterprise'), ('18500000-0000-0000-0000-000000000002', 'enterprise');
insert into org_features (org_id, feature_key, enabled) values
  ('18500000-0000-0000-0000-000000000001', 'procurement', true), ('18500000-0000-0000-0000-000000000002', 'procurement', true);
insert into auth.users (id, email)
select ('18500000-0000-0000-0000-0000000000' || n)::uuid, 'pvf-' || n || '@example.com'
from unnest(array['a1','b1','c1','e1','f1','a2','a3','a4','b2']) n;
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18500000-0000-0000-0000-0000000000a1','18500000-0000-0000-0000-000000000001','PVF Admin','pvf-a1@example.com','Admin','active'),
  ('18500000-0000-0000-0000-0000000000b1','18500000-0000-0000-0000-000000000001','PVF PM','pvf-b1@example.com','Project Manager','active'),
  ('18500000-0000-0000-0000-0000000000c1','18500000-0000-0000-0000-000000000001','PVF Finance','pvf-c1@example.com','Finance','active'),
  ('18500000-0000-0000-0000-0000000000e1','18500000-0000-0000-0000-000000000001','PVF Engineer','pvf-e1@example.com','Engineer','active'),
  ('18500000-0000-0000-0000-0000000000f1','18500000-0000-0000-0000-000000000001','PVF Buyer','pvf-f1@example.com','Engineer','active'),
  ('18500000-0000-0000-0000-0000000000a2','18500000-0000-0000-0000-000000000001','PVF Storekeeper','pvf-a2@example.com','Engineer','active'),
  ('18500000-0000-0000-0000-0000000000a3','18500000-0000-0000-0000-000000000001','PVF Foreman','pvf-a3@example.com','Engineer','active'),
  ('18500000-0000-0000-0000-0000000000a4','18500000-0000-0000-0000-000000000001','PVF Inactive','pvf-a4@example.com','Engineer','disabled'),
  ('18500000-0000-0000-0000-0000000000b2','18500000-0000-0000-0000-000000000002','PVF Engineer B','pvf-b2@example.com','Engineer','active');
update organizations set built_in_roles_enabled = true where id = '18500000-0000-0000-0000-000000000001';
update profiles set built_in_role = 'buyer' where id = '18500000-0000-0000-0000-0000000000f1';
update profiles set built_in_role = 'storekeeper' where id = '18500000-0000-0000-0000-0000000000a2';
update profiles set built_in_role = 'foreman' where id = '18500000-0000-0000-0000-0000000000a3';

insert into projects (id, org_id, name, status, project_manager_id) values
  ('18500000-0000-0000-0000-0000000000d1', '18500000-0000-0000-0000-000000000001', 'PVF project', 'Ongoing Project', '18500000-0000-0000-0000-0000000000b1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('18500000-0000-0000-0000-0000000000e9', '18500000-0000-0000-0000-000000000001', '18500000-0000-0000-0000-0000000000d1', 'PVF-1', 'PVF item', 'ea', 20, 10);
-- P1 the Engineer's ordered subcontract case, PD the Engineer's draft, P2 the Buyer's, P3 the Storekeeper's, PB organisation B's.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, approved_by_id, budget_category, currency, is_subcontract) values
  ('18500000-0000-0000-0000-000000000101','18500000-0000-0000-0000-000000000001','PVF P1','18500000-0000-0000-0000-0000000000d1','18500000-0000-0000-0000-0000000000e1','Ordered',100,120,'18500000-0000-0000-0000-0000000000a1','Subcontractors','IDR',true),
  ('18500000-0000-0000-0000-000000000102','18500000-0000-0000-0000-000000000001','PVF PD','18500000-0000-0000-0000-0000000000d1','18500000-0000-0000-0000-0000000000e1','Draft',null,null,null,'Materials','IDR',false),
  ('18500000-0000-0000-0000-000000000103','18500000-0000-0000-0000-000000000001','PVF P2','18500000-0000-0000-0000-0000000000d1','18500000-0000-0000-0000-0000000000f1','Ordered',500,500,'18500000-0000-0000-0000-0000000000a1','Materials','IDR',false),
  ('18500000-0000-0000-0000-000000000104','18500000-0000-0000-0000-000000000001','PVF P3','18500000-0000-0000-0000-0000000000d1','18500000-0000-0000-0000-0000000000a2','Draft',null,null,null,'Materials','IDR',false),
  ('18500000-0000-0000-0000-000000000105','18500000-0000-0000-0000-000000000002','PVF PB',null,'18500000-0000-0000-0000-0000000000b2','Draft',null,null,null,'Materials','IDR',false);
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('18500000-0000-0000-0000-000000000111','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000101','PVF I1',2,12.50),
  ('18500000-0000-0000-0000-000000000112','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000102','PVF ID',2,12.50),
  ('18500000-0000-0000-0000-000000000113','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000103','PVF I2',2,12.50),
  ('18500000-0000-0000-0000-000000000114','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000104','PVF I3',2,12.50),
  ('18500000-0000-0000-0000-000000000115','18500000-0000-0000-0000-000000000002','18500000-0000-0000-0000-000000000105','PVF IB',2,12.50);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('18500000-0000-0000-0000-000000000121','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000101','PVF-PO1','Issued',current_date,100,'IDR'),
  ('18500000-0000-0000-0000-000000000122','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000103','PVF-PO2','Issued',current_date,500,'IDR'),
  ('18500000-0000-0000-0000-000000000123','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000104','PVF-PO3','Issued',current_date,50,'IDR'),
  ('18500000-0000-0000-0000-000000000124','18500000-0000-0000-0000-000000000002','18500000-0000-0000-0000-000000000105','PVF-POB','Issued',current_date,50,'IDR');
insert into purchase_requests (id, org_id, procurement_id, pr_number, status, date, amount, currency) values
  ('18500000-0000-0000-0000-000000000131','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000101','PVF-PR1','Approved',current_date,100,'IDR'),
  ('18500000-0000-0000-0000-000000000132','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000103','PVF-PR2','Approved',current_date,500,'IDR'),
  ('18500000-0000-0000-0000-000000000133','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000104','PVF-PR3','Approved',current_date,50,'IDR'),
  ('18500000-0000-0000-0000-000000000134','18500000-0000-0000-0000-000000000002','18500000-0000-0000-0000-000000000105','PVF-PRB','Approved',current_date,50,'IDR');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('18500000-0000-0000-0000-000000000121', 1, '18500000-0000-0000-0000-0000000000e9', 10, 10, 'ea');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('18500000-0000-0000-0000-000000000121', '18500000-0000-0000-0000-000000000101', 1, 'Issued', 100, '18500000-0000-0000-0000-0000000000a1', 'standard');
select set_config('pmo.po_variation_write', 'on', true);
insert into po_variations (id, po_id, number, origin, status, reason, amount, requested_by, approved_by, approved_at) values
  ('18500000-0000-0000-0000-000000000141', '18500000-0000-0000-0000-000000000121', 'PVF-VAR-1', 'pre_work', 'Approved', 'PVF fixture', 10,
   '18500000-0000-0000-0000-0000000000a1', '18500000-0000-0000-0000-0000000000a1', now());
insert into po_variation_lines (variation_id, boq_item_id, additional_quantity, rate) values
  ('18500000-0000-0000-0000-000000000141', '18500000-0000-0000-0000-0000000000e9', 1, 10);
select set_config('pmo.po_variation_write', '', true);
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, currency, tax_treatment, tax_amount, erp_docstatus) values
  ('18500000-0000-0000-0000-000000000151','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000101','PVF-VI1',current_date,'Approved',100,'IDR','none',0,1);
insert into stock_units (id, org_id, code, name) values ('18500000-0000-0000-0000-000000000161','18500000-0000-0000-0000-000000000001','m','metre');
insert into stock_items (id, org_id, code, name, unit_id) values ('18500000-0000-0000-0000-000000000162','18500000-0000-0000-0000-000000000001','CBL','Cable','18500000-0000-0000-0000-000000000161');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('18500000-0000-0000-0000-000000000163','18500000-0000-0000-0000-000000000001','PVFC','Central','central',null);
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, occurred_on, created_by) values
  ('18500000-0000-0000-0000-000000000164','18500000-0000-0000-0000-000000000001','RCV-PVF-1','receive','Draft','18500000-0000-0000-0000-000000000163','2026-11-16','18500000-0000-0000-0000-0000000000a1');
insert into stock_document_lines (id, org_id, document_id, line_no, item_id, quantity, unit_cost) values
  ('18500000-0000-0000-0000-000000000165','18500000-0000-0000-0000-000000000001','18500000-0000-0000-0000-000000000164',1,'18500000-0000-0000-0000-000000000162',5,10);

-- the second light account: a Field user (a5), and the two light actors' ids
insert into auth.users (id, email) values ('18500000-0000-0000-0000-0000000000a5', 'pvf-a5@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18500000-0000-0000-0000-0000000000a5','18500000-0000-0000-0000-000000000001','PVF Field user','pvf-a5@example.com','Engineer','active');
update profiles set built_in_role = 'field_user' where id = '18500000-0000-0000-0000-0000000000a5';

-- the channels: relation (table or masked view) and one price column
create temp table pvf_channel (kind text, rel text, col text);
insert into pvf_channel values
  ('table','procurements','total_value'),('table','procurement_items','rate'),('table','procurement_invoices','amount'),
  ('table','purchase_orders','amount'),('table','purchase_requests','amount'),('table','payments','amount'),
  ('table','purchase_order_lines','rate'),('table','po_variation_lines','rate'),('table','stock_document_lines','unit_cost'),
  ('table','stock_ledger','value_after'),('table','stock_balances','value_on_hand'),
  ('view','procurements_masked','total_value'),('view','procurement_items_masked','rate'),('view','procurement_invoices_masked','amount'),
  ('view','purchase_orders_masked','amount'),('view','purchase_requests_masked','amount'),('view','payments_masked','amount'),
  ('view','purchase_order_lines_masked','rate'),('view','po_variation_lines_masked','rate'),('view','stock_document_lines_masked','unit_cost'),
  ('view','stock_ledger_masked','value_after'),('view','stock_balances_masked','value_on_hand');
-- the priced function reads: a count of priced values, or a refusal (SQLSTATE 42501) the guard raises
create temp table pvf_fn (name text primary key, sql text, must_refuse boolean);
insert into pvf_fn values
  ('procurement_open_commitments_masked', $q$ select count(*) from public.procurement_open_commitments_masked(array['18500000-0000-0000-0000-000000000101']::uuid[]) where amount is not null $q$, false),
  ('project_committed_spend_masked', $q$ select count(*) from public.project_committed_spend_masked('18500000-0000-0000-0000-0000000000d1') where amount is not null $q$, false),
  ('procurement_open_commitments', $q$ select count(*) from public.procurement_open_commitments(array['18500000-0000-0000-0000-000000000101']::uuid[]) where amount is not null $q$, false),
  ('project_committed_spend', $q$ select count(*) from public.project_committed_spend('18500000-0000-0000-0000-0000000000d1') where amount is not null $q$, false),
  ('stock_can_see_cost', $q$ select count(*) from (select 1 where public.stock_can_see_cost()) q $q$, false),
  ('get_stock_on_hand', $q$ select count(*) from (select public.get_stock_on_hand()) q $q$, true),
  ('get_stock_ledger', $q$ select count(*) from (select public.get_stock_ledger()) q $q$, true),
  ('get_stock_document_costs', $q$ select count(*) from (select public.get_stock_document_costs('18500000-0000-0000-0000-000000000164')) q $q$, true),
  ('get_stock_erp_value', $q$ select count(*) from (select public.get_stock_erp_value('18500000-0000-0000-0000-000000000164')) q $q$, true),
  ('work_order_cost_amounts', $q$ select count(*) from public.work_order_cost_amounts('18500000-0000-0000-0000-0000000000d1') where amount is not null $q$, true);

-- every observation: who, hide setting, channel, priced values read (or -1 when the table refuses the read), refused by a guard
create temp table pvf_seen (actor text, setting boolean, channel text, priced bigint, refused boolean);
grant all on pvf_seen, pvf_channel, pvf_fn to authenticated;

create or replace function pg_temp.pvf_run(p_setting boolean) returns void language plpgsql as $$
declare a record; c record; f record; n bigint; v_refused boolean;
begin
  update organizations set hide_prices_from_requesters = p_setting where id = '18500000-0000-0000-0000-000000000001';
  for a in select * from (values ('admin','a1'),('finance','c1'),('foreman','a3'),('field_user','a5')) t(label, uid) loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"18500000-0000-0000-0000-0000000000' || a.uid || '","role":"authenticated"}', true);
    for c in select * from pvf_channel loop
      v_refused := false;
      begin
        execute format('select count(*) from public.%I where %I is not null', c.rel, c.col) into n;
      exception when insufficient_privilege then n := 0; v_refused := true;
      end;
      insert into pvf_seen values (a.label, p_setting, c.rel, n, v_refused);
    end loop;
    for f in select * from pvf_fn loop
      v_refused := false;
      begin
        execute f.sql into n;
      exception when insufficient_privilege then n := 0; v_refused := true;
      end;
      insert into pvf_seen values (a.label, p_setting, f.name, n, v_refused);
    end loop;
    execute 'reset role';
  end loop;
end $$;
select pg_temp.pvf_run(true);
select pg_temp.pvf_run(false);

-- AC-PVF-001 the purchase and stock base tables
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'procurements' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-001 procurements: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'procurement_items' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-001 procurement_items: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'procurement_invoices' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-001 procurement_invoices: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'purchase_orders' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-001 purchase_orders: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'purchase_requests' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-001 purchase_requests: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'payments' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-001 payments: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'purchase_order_lines' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-001 purchase_order_lines: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'po_variation_lines' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-001 po_variation_lines: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'stock_document_lines' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-001 stock_document_lines: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'stock_ledger' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-001 stock_ledger: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'stock_balances' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-001 stock_balances: a Foreman and a Field user read no price, hiding on and off');

-- AC-PVF-002 the masked views
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'procurements_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-002 procurements_masked: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'procurement_items_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-002 procurement_items_masked: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'procurement_invoices_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-002 procurement_invoices_masked: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'purchase_orders_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-002 purchase_orders_masked: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'purchase_requests_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-002 purchase_requests_masked: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'payments_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-002 payments_masked: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'purchase_order_lines_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-002 purchase_order_lines_masked: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'po_variation_lines_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-002 po_variation_lines_masked: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'stock_document_lines_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-002 stock_document_lines_masked: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'stock_ledger_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-002 stock_ledger_masked: a Foreman and a Field user read no price, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'stock_balances_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-002 stock_balances_masked: a Foreman and a Field user read no price, hiding on and off');

-- AC-PVF-003 the priced reads that return a count of amounts or a boolean
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'procurement_open_commitments_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-003 procurement_open_commitments_masked: a Foreman and a Field user read no amount, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'project_committed_spend_masked' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-003 project_committed_spend_masked: a Foreman and a Field user read no amount, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'procurement_open_commitments' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-003 procurement_open_commitments: a Foreman and a Field user read no amount, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'project_committed_spend' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-003 project_committed_spend: a Foreman and a Field user read no amount, hiding on and off');
select is((select count(*)::text || '/' || coalesce(sum(priced), 0)::text from pvf_seen where channel = 'stock_can_see_cost' and actor in ('foreman','field_user')), '4/0',
  'AC-PVF-003 stock_can_see_cost: a Foreman and a Field user read no amount, hiding on and off');

-- AC-PVF-004 the priced definer reads refuse a field account
select is((select count(*)::text || '/' || count(*) filter (where refused)::text from pvf_seen where channel = 'get_stock_on_hand' and actor in ('foreman','field_user')), '4/4',
  'AC-PVF-004 get_stock_on_hand is refused to a Foreman and a Field user, hiding on and off');
select is((select count(*)::text || '/' || count(*) filter (where refused)::text from pvf_seen where channel = 'get_stock_ledger' and actor in ('foreman','field_user')), '4/4',
  'AC-PVF-004 get_stock_ledger is refused to a Foreman and a Field user, hiding on and off');
select is((select count(*)::text || '/' || count(*) filter (where refused)::text from pvf_seen where channel = 'get_stock_document_costs' and actor in ('foreman','field_user')), '4/4',
  'AC-PVF-004 get_stock_document_costs is refused to a Foreman and a Field user, hiding on and off');
select is((select count(*)::text || '/' || count(*) filter (where refused)::text from pvf_seen where channel = 'get_stock_erp_value' and actor in ('foreman','field_user')), '4/4',
  'AC-PVF-004 get_stock_erp_value is refused to a Foreman and a Field user, hiding on and off');
select is((select count(*)::text || '/' || count(*) filter (where refused)::text from pvf_seen where channel = 'work_order_cost_amounts' and actor in ('foreman','field_user')), '4/4',
  'AC-PVF-004 work_order_cost_amounts is refused to a Foreman and a Field user, hiding on and off');

-- AC-PVF-005 the price-right answer itself: hiding on, a Foreman and a Field user are told no
update organizations set hide_prices_from_requesters = true where id = '18500000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"18500000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(get_may_see_prices(), false, 'AC-PVF-005 get_may_see_prices: a Foreman is told no, hiding on');
select is(actor_may_see_prices_now(), false, 'AC-PVF-005 actor_may_see_prices_now: a Foreman is told no, hiding on');
set local request.jwt.claims = '{"sub":"18500000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(get_may_see_prices(), false, 'AC-PVF-005 get_may_see_prices: a Field user is told no, hiding on');
select is(actor_may_see_prices_now(), false, 'AC-PVF-005 actor_may_see_prices_now: a Field user is told no, hiding on');
reset role;

-- AC-PVF-006 the field accounts are light accounts: that is why the tables refuse them
select is((select count(*)::int from profiles where built_in_role in ('foreman','field_user') and id in
  ('18500000-0000-0000-0000-0000000000a3','18500000-0000-0000-0000-0000000000a5')), 2, 'AC-PVF-006 the two actors hold the Foreman and Field user job roles');

-- AC-PVF-007 controls: the same channels do hold prices for people who may read them (so the proof is not empty)
select is_empty($$ select c.rel from pvf_channel c
  where c.kind = 'table' and c.rel in ('procurements','procurement_items','procurement_invoices','purchase_orders','purchase_requests','purchase_order_lines','po_variation_lines','stock_document_lines')
    and not exists (select 1 from pvf_seen s where s.channel = c.rel and s.actor = 'admin' and s.setting and s.priced > 0) $$,
  'AC-PVF-007 the control reads prices from every seeded base table, hiding on');
select is_empty($$ select c.rel from pvf_channel c
  where c.kind = 'view' and c.rel in ('procurements_masked','procurement_items_masked','procurement_invoices_masked','purchase_orders_masked','purchase_requests_masked','purchase_order_lines_masked','po_variation_lines_masked','stock_document_lines_masked')
    and not exists (select 1 from pvf_seen s where s.channel = c.rel and s.actor = 'finance' and s.setting and s.priced > 0) $$,
  'AC-PVF-007 the control reads prices from every seeded masked view, hiding on');
select is_empty($$ select c.rel from pvf_channel c
  where c.kind = 'table' and c.rel in ('procurements','procurement_items','purchase_orders','purchase_requests','stock_document_lines')
    and not exists (select 1 from pvf_seen s where s.channel = c.rel and s.actor = 'admin' and not s.setting and s.priced > 0) $$,
  'AC-PVF-007 the control reads prices from the base tables, hiding off');
select is((select priced > 0 from pvf_seen where actor = 'admin' and setting and channel = 'project_committed_spend'), true,
  'AC-PVF-007 the control reads a committed spend amount, hiding on');
set local role authenticated;
set local request.jwt.claims = '{"sub":"18500000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select rate from procurement_items_masked where id = '18500000-0000-0000-0000-000000000113'), 12.50,
  'AC-PVF-007 an office role (the Buyer) reads a unit price through the masked view, hiding on');
reset role;

select * from finish();
rollback;
