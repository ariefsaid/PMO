-- csr_cost_attribution.test.sql — #2585 client material requisitions, Migration C (1085_receive_work_order_attribution.sql).
-- Spec docs/specs/client-material-requisitions.spec.md · plan docs/plans/2026-11-20-client-material-requisitions.md (Slice 2a).
-- AC-CSR-020 a receive into a site, yard or staging location of project P may name a work order of P; another
--   project's work order is refused COST_WO_PROJECT; a Draft receive cannot be re-pointed (save_stock_draft) to a
--   central location after attribution (the trigger fires on warehouse_id) · AC-CSR-021 a receive into a central
--   location naming a work order is refused COST_WO_NO_PROJECT, one naming none is accepted · AC-CSR-023 a receive
--   naming a work order never enters work_order_cost_lines · AC-CSR-022 the existing issue/return/transfer cases
--   stay green (0950_work_order_cost_attribution.test.sql runs unchanged) · a location cannot be moved away from the
--   project of a receive that names a work order (guard_warehouse_move_with_work_orders extended).
begin;
create extension if not exists pgtap;
select plan(17);

insert into organizations (id, name, default_currency) values ('25850000-0000-0000-0000-00000000000a', 'CSR Cost Org', 'IDR');
insert into auth.users (id, email) values ('25850000-0000-0000-0000-0000000000a1', 'csrc-keeper@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25850000-0000-0000-0000-0000000000a1', '25850000-0000-0000-0000-00000000000a', 'CSRC Keeper', 'csrc-keeper@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status) values
  ('25850000-0000-0000-0000-0000000000d1', '25850000-0000-0000-0000-00000000000a', 'CSRC P1', 'Ongoing Project'),
  ('25850000-0000-0000-0000-0000000000d2', '25850000-0000-0000-0000-00000000000a', 'CSRC P2', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25850000-0000-0000-0000-000000000401', '25850000-0000-0000-0000-00000000000a', '25850000-0000-0000-0000-0000000000d1', 'CSRC WO1', 'Issued', 10000, 'exclusive', 0),
  ('25850000-0000-0000-0000-000000000402', '25850000-0000-0000-0000-00000000000a', '25850000-0000-0000-0000-0000000000d2', 'CSRC WO2', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('25850000-0000-0000-0000-000000001301', '25850000-0000-0000-0000-00000000000a', 'BAG', 'Bag', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('25850000-0000-0000-0000-000000001311', '25850000-0000-0000-0000-00000000000a', 'CEM', 'Cement', '25850000-0000-0000-0000-000000001301');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('25850000-0000-0000-0000-000000000801', '25850000-0000-0000-0000-00000000000a', 'C-C',  'Central', 'central', null),
  ('25850000-0000-0000-0000-000000000802', '25850000-0000-0000-0000-00000000000a', 'C-S1', 'Site 1',  'site',    '25850000-0000-0000-0000-0000000000d1'),
  ('25850000-0000-0000-0000-000000000803', '25850000-0000-0000-0000-00000000000a', 'C-Y1', 'Yard 1',  'yard',    '25850000-0000-0000-0000-0000000000d1'),
  ('25850000-0000-0000-0000-000000000804', '25850000-0000-0000-0000-00000000000a', 'C-G1', 'Staging 1', 'staging', '25850000-0000-0000-0000-0000000000d1'),
  ('25850000-0000-0000-0000-000000000805', '25850000-0000-0000-0000-00000000000a', 'C-S0', 'Site no job', 'site', null);
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id)
select '25850000-0000-0000-0000-00000000000a', w.id, '25850000-0000-0000-0000-0000000000a1' from stock_warehouses w
 where w.org_id = '25850000-0000-0000-0000-00000000000a';

-- Draft receives, one per location, written as the owner (this file proves the rule, not the create path).
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, occurred_on, created_by) values
  ('25850000-0000-0000-0000-000000000811', '25850000-0000-0000-0000-00000000000a', 'RCV-C-1', 'receive', 'Draft', '25850000-0000-0000-0000-000000000802', '2026-11-16', '25850000-0000-0000-0000-0000000000a1'),
  ('25850000-0000-0000-0000-000000000812', '25850000-0000-0000-0000-00000000000a', 'RCV-C-2', 'receive', 'Draft', '25850000-0000-0000-0000-000000000803', '2026-11-16', '25850000-0000-0000-0000-0000000000a1'),
  ('25850000-0000-0000-0000-000000000813', '25850000-0000-0000-0000-00000000000a', 'RCV-C-3', 'receive', 'Draft', '25850000-0000-0000-0000-000000000804', '2026-11-16', '25850000-0000-0000-0000-0000000000a1'),
  ('25850000-0000-0000-0000-000000000814', '25850000-0000-0000-0000-00000000000a', 'RCV-C-4', 'receive', 'Draft', '25850000-0000-0000-0000-000000000801', '2026-11-16', '25850000-0000-0000-0000-0000000000a1'),
  ('25850000-0000-0000-0000-000000000815', '25850000-0000-0000-0000-00000000000a', 'RCV-C-5', 'receive', 'Draft', '25850000-0000-0000-0000-000000000805', '2026-11-16', '25850000-0000-0000-0000-0000000000a1'),
  ('25850000-0000-0000-0000-000000000816', '25850000-0000-0000-0000-00000000000a', 'RCV-C-6', 'receive', 'Draft', '25850000-0000-0000-0000-000000000802', '2026-11-16', '25850000-0000-0000-0000-0000000000a1'),
  ('25850000-0000-0000-0000-000000000817', '25850000-0000-0000-0000-00000000000a', 'RCV-C-7', 'receive', 'Draft', '25850000-0000-0000-0000-000000000802', '2026-11-16', '25850000-0000-0000-0000-0000000000a1');
insert into stock_document_lines (org_id, document_id, line_no, item_id, quantity, unit_cost)
select '25850000-0000-0000-0000-00000000000a', '25850000-0000-0000-0000-000000000816', 1, '25850000-0000-0000-0000-000000001311', 5, 10;

-- AC-CSR-020 accepted: site, yard, staging of P1 naming a work order of P1.
select lives_ok($$ update stock_documents set work_order_id = '25850000-0000-0000-0000-000000000401' where id = '25850000-0000-0000-0000-000000000811' $$,
  'AC-CSR-020 a receive into a site of P1 may name a work order of P1');
select lives_ok($$ update stock_documents set work_order_id = '25850000-0000-0000-0000-000000000401' where id = '25850000-0000-0000-0000-000000000812' $$,
  'AC-CSR-020 a receive into a yard of P1 may name a work order of P1');
select lives_ok($$ update stock_documents set work_order_id = '25850000-0000-0000-0000-000000000401' where id = '25850000-0000-0000-0000-000000000813' $$,
  'AC-CSR-020 a receive into a staging location of P1 may name a work order of P1');

-- AC-CSR-020 refused: another project's work order.
select throws_ok($$ update stock_documents set work_order_id = '25850000-0000-0000-0000-000000000402' where id = '25850000-0000-0000-0000-000000000817' $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project',
  'AC-CSR-020 a receive into a site of P1 naming a work order of P2 is refused');

-- AC-CSR-021: central or project-less location refuses; no work order is accepted.
select throws_ok($$ update stock_documents set work_order_id = '25850000-0000-0000-0000-000000000401' where id = '25850000-0000-0000-0000-000000000814' $$,
  '23514', 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order',
  'AC-CSR-021 a receive into a central location naming a work order is refused');
select throws_ok($$ update stock_documents set work_order_id = '25850000-0000-0000-0000-000000000401' where id = '25850000-0000-0000-0000-000000000815' $$,
  '23514', 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order',
  'AC-CSR-021 a receive into a site that has no project naming a work order is refused');
select lives_ok($$ update stock_documents set note = 'no work order' where id = '25850000-0000-0000-0000-000000000814' $$,
  'AC-CSR-021 a receive into a central location naming no work order is accepted as before');
select lives_ok($$ insert into stock_documents (org_id, number, kind, status, warehouse_id, occurred_on, created_by)
  values ('25850000-0000-0000-0000-00000000000a', 'RCV-C-8', 'receive', 'Draft', '25850000-0000-0000-0000-000000000801', '2026-11-16', '25850000-0000-0000-0000-0000000000a1') $$,
  'AC-CSR-021 a new central receive naming no work order is accepted');
select throws_ok($$ insert into stock_documents (org_id, number, kind, status, warehouse_id, work_order_id, occurred_on, created_by)
  values ('25850000-0000-0000-0000-00000000000a', 'RCV-C-9', 'receive', 'Draft', '25850000-0000-0000-0000-000000000801', '25850000-0000-0000-0000-000000000401', '2026-11-16', '25850000-0000-0000-0000-0000000000a1') $$,
  '23514', 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order',
  'AC-CSR-021 an INSERT of a central receive naming a work order is refused');

-- AC-CSR-020 re-point: a Draft receive naming a work order of P1, moved to a central warehouse by save_stock_draft.
update stock_documents set work_order_id = '25850000-0000-0000-0000-000000000401' where id = '25850000-0000-0000-0000-000000000816';
create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
set local role authenticated;
select pg_temp._as('25850000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.save_stock_draft('25850000-0000-0000-0000-000000000816',
    '{"kind":"receive","warehouse_id":"25850000-0000-0000-0000-000000000801"}'::jsonb,
    '[{"item_id":"25850000-0000-0000-0000-000000001311","quantity":5,"unit_cost":10}]'::jsonb) $$,
  '23514', 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order',
  'AC-CSR-020 a draft receive naming a work order cannot be re-pointed to a central warehouse by save_stock_draft');
select lives_ok($$ select public.save_stock_draft('25850000-0000-0000-0000-000000000816',
    '{"kind":"receive","warehouse_id":"25850000-0000-0000-0000-000000000803"}'::jsonb,
    '[{"item_id":"25850000-0000-0000-0000-000000001311","quantity":5,"unit_cost":10}]'::jsonb) $$,
  'AC-CSR-020 it may move between locations of the same project');
reset role;

-- The trigger itself fires on warehouse_id (save_stock_draft also sets other columns, so this binds the column list).
select throws_ok($$ update stock_documents set warehouse_id = '25850000-0000-0000-0000-000000000801' where id = '25850000-0000-0000-0000-000000000816' $$,
  '23514', 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order',
  'AC-CSR-020 a change of only the receiving location of a receive naming a work order is checked (trigger column list)');

-- A warehouse cannot be moved off the project of a receive that names a work order.
select throws_ok($$ update stock_warehouses set project_id = '25850000-0000-0000-0000-0000000000d2' where id = '25850000-0000-0000-0000-000000000803' $$,
  '23514', 'COST_WO_PROJECT_MOVE: transfers to this warehouse name a work order of its project',
  'AC-CSR-020 a location holding a receive that names a work order cannot move to another project');
select throws_ok($$ update stock_warehouses set kind = 'central', project_id = null where id = '25850000-0000-0000-0000-000000000804' $$,
  '23514', 'COST_WO_PROJECT_MOVE: transfers to this warehouse name a work order of its project',
  'AC-CSR-020 nor become a central location');

-- AC-CSR-023: a posted receive naming a work order never enters work_order_cost_lines.
set local session_replication_role = replica;
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, work_order_id, occurred_on, created_by, posted_by, posted_at) values
  ('25850000-0000-0000-0000-000000000821', '25850000-0000-0000-0000-00000000000a', 'RCV-C-P', 'receive', 'Posted', '25850000-0000-0000-0000-000000000802',
   '25850000-0000-0000-0000-000000000401', '2026-11-16', '25850000-0000-0000-0000-0000000000a1', '25850000-0000-0000-0000-0000000000a1', now());
set local session_replication_role = origin;
select is((select count(*)::int from work_order_cost_lines where record_id in
           ('25850000-0000-0000-0000-000000000821', '25850000-0000-0000-0000-000000000811')), 0,
  'AC-CSR-023 a receive naming a work order has no row in work_order_cost_lines');
select is((select count(*)::int from work_order_cost_lines where work_order_id = '25850000-0000-0000-0000-000000000401'), 0,
  'AC-CSR-023 the work order has no cost lines after receipts that name it');
select is((select count(*)::int from stock_documents where work_order_id = '25850000-0000-0000-0000-000000000401' and kind = 'receive'), 5,
  'FR-CSR-014 the receives that name the work order are kept for the stock balance');

select * from finish();
rollback;
