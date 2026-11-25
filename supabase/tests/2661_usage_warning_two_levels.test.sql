-- 2661_usage_warning_two_levels.test.sql — #2884 (owner ruling OD-R1125-4): issued material raises both warning levels, once each per work order
-- and item, and each reaches the work order's responsible person and the project's manager. Ids 26610000-… (synthetic).
-- MUTATION: replace the recipient loop's `select v_resp union select v_pm` with `select v_resp` -> 'the project manager is told' goes red.
begin;
create extension if not exists pgtap;
select plan(18);
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('26610000-0000-0000-0000-0000000000a1', 'TL Org A', 'IDR', 'UTC', true), ('26610000-0000-0000-0000-0000000000a2', 'TL Org B', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('26610000-0000-0000-0000-0000000000b1', 'tl-eng@example.com'), ('26610000-0000-0000-0000-0000000000b2', 'tl-pm@example.com'),
  ('26610000-0000-0000-0000-0000000000b3', 'tl-other@example.com'), ('26610000-0000-0000-0000-0000000000b4', 'tl-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('26610000-0000-0000-0000-0000000000b1', '26610000-0000-0000-0000-0000000000a1', 'TL Engineer', 'tl-eng@example.com', 'Engineer', 'active', 'engineer'),
  ('26610000-0000-0000-0000-0000000000b2', '26610000-0000-0000-0000-0000000000a1', 'TL PM', 'tl-pm@example.com', 'Project Manager', 'active', 'project_manager'),
  ('26610000-0000-0000-0000-0000000000b3', '26610000-0000-0000-0000-0000000000a1', 'TL Other Engineer', 'tl-other@example.com', 'Engineer', 'active', 'engineer'),
  ('26610000-0000-0000-0000-0000000000b4', '26610000-0000-0000-0000-0000000000a2', 'TL Foreign', 'tl-foreign@example.com', 'Engineer', 'active', 'engineer');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26610000-0000-0000-0000-0000000000c1', '26610000-0000-0000-0000-0000000000a1', 'TL Site', 'Ongoing Project', '26610000-0000-0000-0000-0000000000b2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, responsible_person_id) values
  ('26610000-0000-0000-0000-0000000000d1', '26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000c1', 'TL WO', 'Issued', 10000, 'exclusive', 0, '26610000-0000-0000-0000-0000000000b1'),
  ('26610000-0000-0000-0000-0000000000d2', '26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000c1', 'TL WO none', 'Issued', 10000, 'exclusive', 0, null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26610000-0000-0000-0000-0000000000e1', '26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000c1', 'B1', 'Slab', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000d1', '26610000-0000-0000-0000-0000000000e1', 10),
  ('26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000d2', '26610000-0000-0000-0000-0000000000e1', 10);
insert into stock_units (id, org_id, code, name, whole_only) values ('26610000-0000-0000-0000-0000000000f1', '26610000-0000-0000-0000-0000000000a1', 'BAG', 'Bag', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('26610000-0000-0000-0000-0000000000f2', '26610000-0000-0000-0000-0000000000a1', 'I1', 'Item 1', '26610000-0000-0000-0000-0000000000f1');
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity)
  values ('26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000e1', '26610000-0000-0000-0000-0000000000f2', 100);
insert into stock_warehouses (id, org_id, code, name, kind) values ('26610000-0000-0000-0000-0000000000f3', '26610000-0000-0000-0000-0000000000a1', 'TLC', 'TL central', 'central');
insert into material_request_settings (org_id, usage_warn_pct_1, usage_warn_pct_2, usage_installed_source)
  values ('26610000-0000-0000-0000-0000000000a1', 80, 100, 'stock_issues')
  on conflict (org_id) do update set usage_warn_pct_1 = 80, usage_warn_pct_2 = 100, usage_installed_source = 'stock_issues';

-- A posted issue to a work order: the ledger row first, then the document turns Posted (as stock_post_core does).
create function pg_temp._issue(p_wo uuid, p_num text, p_qty numeric) returns void language plpgsql as $$
declare v_doc uuid := gen_random_uuid(); v_line uuid := gen_random_uuid();
begin
  insert into stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, occurred_on, created_by, work_order_id)
  values (v_doc, '26610000-0000-0000-0000-0000000000a1', p_num, 'issue', 'Draft', '26610000-0000-0000-0000-0000000000f3', (select project_id from work_orders where id = p_wo), current_date, '26610000-0000-0000-0000-0000000000b2', p_wo);
  insert into stock_document_lines (id, org_id, document_id, line_no, item_id, quantity) values (v_line, '26610000-0000-0000-0000-0000000000a1', v_doc, 1, '26610000-0000-0000-0000-0000000000f2', p_qty);
  insert into stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, kind, qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by)
  values ('26610000-0000-0000-0000-0000000000a1', v_doc, v_line, '26610000-0000-0000-0000-0000000000f2', '26610000-0000-0000-0000-0000000000f3', (select project_id from work_orders where id = p_wo), 'issue', -p_qty, 0, 0, 0, current_date, '26610000-0000-0000-0000-0000000000b2');
  update stock_documents set status = 'Posted', posted_by = '26610000-0000-0000-0000-0000000000b2', posted_at = now() where id = v_doc;
end $$;
create function pg_temp._told(p_user uuid, p_like text) returns integer language sql as $$
  select count(*)::int from notifications where owner_id = p_user and title = 'Installed material usage reached' and body like p_like $$;
create function pg_temp._alerts(p_wo uuid) returns integer language sql as $$
  select count(*)::int from material_installed_usage_alerts where work_order_id = p_wo $$;

select pg_temp._issue('26610000-0000-0000-0000-0000000000d1', 'TL-1', 50);
select is(pg_temp._alerts('26610000-0000-0000-0000-0000000000d1'), 0, 'below both levels nothing is raised');
select pg_temp._issue('26610000-0000-0000-0000-0000000000d1', 'TL-2', 35);
select is(pg_temp._alerts('26610000-0000-0000-0000-0000000000d1'), 1, 'issuing past the first level raises the first warning');
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b1', '%80%% usage warning%'), 1, 'the responsible person is told at the first level');
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b2', '%80%% usage warning%'), 1, 'the project manager is told at the first level');
select pg_temp._issue('26610000-0000-0000-0000-0000000000d1', 'TL-3', 20);
select is(pg_temp._alerts('26610000-0000-0000-0000-0000000000d1'), 2, 'issuing past the second level raises the second warning');
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b1', '%100%% usage warning%'), 1, 'the responsible person is told at the second level');
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b2', '%100%% usage warning%'), 1, 'the project manager is told at the second level');
select pg_temp._issue('26610000-0000-0000-0000-0000000000d1', 'TL-4', 10);
select is(pg_temp._alerts('26610000-0000-0000-0000-0000000000d1'), 2, 'more issues raise nothing again (once per level, work order and item)');
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b1', '%usage warning%'), 2, 'and the responsible person has exactly two notices');
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b3', '%'), 0, 'another engineer of the organisation is not told');
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b4', '%'), 0, 'a person of another organisation is not told');
-- no responsible person: the manager alone, at both levels
select pg_temp._issue('26610000-0000-0000-0000-0000000000d2', 'TL-5', 105);
select is(pg_temp._alerts('26610000-0000-0000-0000-0000000000d2'), 2, 'a work order with no responsible person raises both levels');
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b2', '%TL WO none%'), 2, 'and the manager alone is told both');
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b1', '%TL WO none%'), 0, 'nobody else is told');
-- an issue posted first and tied to the work order afterwards still raises the warnings
update work_orders set responsible_person_id = '26610000-0000-0000-0000-0000000000b1' where id = '26610000-0000-0000-0000-0000000000d2';
create function pg_temp._issue_then_tie(p_wo uuid, p_num text, p_qty numeric) returns void language plpgsql as $$
declare v_doc uuid := gen_random_uuid(); v_line uuid := gen_random_uuid();
begin
  insert into stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, occurred_on, created_by)
  values (v_doc, '26610000-0000-0000-0000-0000000000a1', p_num, 'issue', 'Draft', '26610000-0000-0000-0000-0000000000f3', '26610000-0000-0000-0000-0000000000c1', current_date, '26610000-0000-0000-0000-0000000000b2');
  insert into stock_document_lines (id, org_id, document_id, line_no, item_id, quantity) values (v_line, '26610000-0000-0000-0000-0000000000a1', v_doc, 1, '26610000-0000-0000-0000-0000000000f2', p_qty);
  insert into stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, kind, qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by)
  values ('26610000-0000-0000-0000-0000000000a1', v_doc, v_line, '26610000-0000-0000-0000-0000000000f2', '26610000-0000-0000-0000-0000000000f3', '26610000-0000-0000-0000-0000000000c1', 'issue', -p_qty, 0, 0, 0, current_date, '26610000-0000-0000-0000-0000000000b2');
  update stock_documents set status = 'Posted', posted_by = '26610000-0000-0000-0000-0000000000b2', posted_at = now() where id = v_doc;
  update stock_documents set work_order_id = p_wo where id = v_doc;
end $$;
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, responsible_person_id) values
  ('26610000-0000-0000-0000-0000000000d3', '26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000c1', 'TL WO tied', 'Issued', 10000, 'exclusive', 0, '26610000-0000-0000-0000-0000000000b1');
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values ('26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000d3', '26610000-0000-0000-0000-0000000000e1', 10);
select pg_temp._issue_then_tie('26610000-0000-0000-0000-0000000000d3', 'TL-6', 105);
select is(pg_temp._alerts('26610000-0000-0000-0000-0000000000d3'), 2, 'an issue tied to its work order after posting raises both levels');
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b1', '%TL WO tied%'), 2, 'and the responsible person is told both');
-- a project whose manager is a field account: that manager gets no warning, the responsible person still does
insert into auth.users (id, email) values ('26610000-0000-0000-0000-0000000000b5', 'tl-field@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('26610000-0000-0000-0000-0000000000b5', '26610000-0000-0000-0000-0000000000a1', 'TL Field Manager', 'tl-field@example.com', 'Engineer', 'active', 'foreman');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26610000-0000-0000-0000-0000000000c2', '26610000-0000-0000-0000-0000000000a1', 'TL Field Site', 'Ongoing Project', '26610000-0000-0000-0000-0000000000b5');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, responsible_person_id) values
  ('26610000-0000-0000-0000-0000000000d4', '26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000c2', 'TL WO field', 'Issued', 10000, 'exclusive', 0, '26610000-0000-0000-0000-0000000000b1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26610000-0000-0000-0000-0000000000e2', '26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000c2', 'B2', 'Slab', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values ('26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000d4', '26610000-0000-0000-0000-0000000000e2', 10);
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity)
  values ('26610000-0000-0000-0000-0000000000a1', '26610000-0000-0000-0000-0000000000e2', '26610000-0000-0000-0000-0000000000f2', 100);
select pg_temp._issue('26610000-0000-0000-0000-0000000000d4', 'TL-7', 85);
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b5', '%'), 0, 'a project manager who is a field account is not told');
select is(pg_temp._told('26610000-0000-0000-0000-0000000000b1', '%TL WO field%'), 1, 'the responsible person still is');
select * from finish();
rollback;
