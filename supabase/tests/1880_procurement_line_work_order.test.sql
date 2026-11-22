-- 1880_procurement_line_work_order.test.sql — a work order on each purchase line (docs/specs/wo-per-purchase-line.spec.md).
-- Migration under test: 1880_procurement_line_work_order.sql.
-- AC-WPL-001 a line takes a work order of its purchase's project, set and cleared through set_cost_attribution ·
-- AC-WPL-002 another project, another org, a purchase with no project and a newly named cancelled work order are refused for EVERY writer
-- (RPC and direct write), and a line already on a work order keeps it · AC-WPL-003 only a privileged role or the requester may set a
-- line, another org reads it as absent, a line takes no discipline · AC-WPL-009 the masked line view exposes the work order ·
-- a purchase cannot move away from its lines' work orders · every change is audited per line.
-- Every denial asserts the errcode AND the message, so a different gate moving in front cannot pass it.
--
-- MUTATION CHECKS (money-adjacent rule; each must turn this file RED, then be restored):
--   1. In 1880's check_procurement_line_work_order, break the project comparison (the line marked `-- mut:line_project`,
--      e.g. `if false then`)          -> the 'another project', 'another org' and 'direct write' tests go red.
--   2. Break the line marked `-- mut:line_cancelled` (e.g. `v_wo_status = 'Active'`)   -> the cancelled-work-order test goes red.
--   3. In set_cost_attribution's 'procurement_item' arm change `v_priv or p.requested_by_id = v_uid` to `true`
--                                    -> the 'another engineer is refused' test goes red.
--   4. Remove the `if p_source = 'procurement_item' and p_discipline_id is not null` block -> the discipline test goes red.
begin;
create extension if not exists pgtap;
select plan(18);

insert into organizations (id, name, default_currency) values ('18800000-0000-0000-0000-00000000000a', 'WPL Org', 'IDR'), ('18800000-0000-0000-0000-00000000000b', 'WPL Other Org', 'IDR');
insert into auth.users (id, email) values
  ('18800000-0000-0000-0000-0000000000a3', 'wpl-pm@example.com'), ('18800000-0000-0000-0000-0000000000a4', 'wpl-eng@example.com'), ('18800000-0000-0000-0000-0000000000a5', 'wpl-eng2@example.com'), ('18800000-0000-0000-0000-0000000000b1', 'wpl-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18800000-0000-0000-0000-0000000000a3', '18800000-0000-0000-0000-00000000000a', 'WPL PM',   'wpl-pm@example.com',   'Project Manager', 'active'),
  ('18800000-0000-0000-0000-0000000000a4', '18800000-0000-0000-0000-00000000000a', 'WPL Eng',  'wpl-eng@example.com',  'Engineer', 'active'),
  ('18800000-0000-0000-0000-0000000000a5', '18800000-0000-0000-0000-00000000000a', 'WPL Eng2', 'wpl-eng2@example.com', 'Engineer', 'active'),
  ('18800000-0000-0000-0000-0000000000b1', '18800000-0000-0000-0000-00000000000b', 'WPL XOrg', 'wpl-xorg@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('18800000-0000-0000-0000-0000000000d1', '18800000-0000-0000-0000-00000000000a', 'WPL Site',     'Ongoing Project', '18800000-0000-0000-0000-0000000000a3'),
  ('18800000-0000-0000-0000-0000000000d2', '18800000-0000-0000-0000-00000000000a', 'WPL Site Two', 'Ongoing Project', '18800000-0000-0000-0000-0000000000a3'),
  ('18800000-0000-0000-0000-0000000000d9', '18800000-0000-0000-0000-00000000000b', 'WPL Other',    'Ongoing Project', null);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('18800000-0000-0000-0000-000000000401', '18800000-0000-0000-0000-00000000000a', '18800000-0000-0000-0000-0000000000d1', 'WPL WO one',   'Issued', 10000, 'exclusive', 0),
  ('18800000-0000-0000-0000-000000000402', '18800000-0000-0000-0000-00000000000a', '18800000-0000-0000-0000-0000000000d1', 'WPL WO two',   'Issued', 10000, 'exclusive', 0),
  ('18800000-0000-0000-0000-000000000404', '18800000-0000-0000-0000-00000000000a', '18800000-0000-0000-0000-0000000000d2', 'WPL WO other project', 'Issued', 10000, 'exclusive', 0),
  ('18800000-0000-0000-0000-000000000409', '18800000-0000-0000-0000-00000000000b', '18800000-0000-0000-0000-0000000000d9', 'WPL WO other org', 'Issued', 10000, 'exclusive', 0);
-- Rows below are written with triggers off: this file proves the line rule, not each create path.
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, cancelled_at, currency) values
  ('18800000-0000-0000-0000-000000000403', '18800000-0000-0000-0000-00000000000a', '18800000-0000-0000-0000-0000000000d1', 'WPL WO cancelled', 'Cancelled', 0, 'exclusive', 0, now(), 'IDR');
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, currency) values
  ('18800000-0000-0000-0000-000000000601', '18800000-0000-0000-0000-00000000000a', 'WPL purchase', '18800000-0000-0000-0000-0000000000d1', '18800000-0000-0000-0000-0000000000a4', 'Draft', 0, 0, 'IDR'),
  ('18800000-0000-0000-0000-000000000602', '18800000-0000-0000-0000-00000000000a', 'WPL purchase without a project', null, '18800000-0000-0000-0000-0000000000a4', 'Draft', 0, 0, 'IDR');
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate, work_order_id) values
  ('18800000-0000-0000-0000-000000000611', '18800000-0000-0000-0000-00000000000a', '18800000-0000-0000-0000-000000000601', 'line A', 1, 600, null),
  ('18800000-0000-0000-0000-000000000612', '18800000-0000-0000-0000-00000000000a', '18800000-0000-0000-0000-000000000601', 'line B', 1, 400, null),
  ('18800000-0000-0000-0000-000000000613', '18800000-0000-0000-0000-00000000000a', '18800000-0000-0000-0000-000000000602', 'line C', 1, 100, null),
  ('18800000-0000-0000-0000-000000000614', '18800000-0000-0000-0000-00000000000a', '18800000-0000-0000-0000-000000000601', 'line D (already on a work order that was cancelled later)', 1, 50, '18800000-0000-0000-0000-000000000403');
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;

-- AC-WPL-001
select pg_temp.act_as('18800000-0000-0000-0000-0000000000a4');
select is(public.set_cost_attribution('procurement_item', array['18800000-0000-0000-0000-000000000611']::uuid[], '18800000-0000-0000-0000-000000000401', null), 1,
  'AC-WPL-001 the requester sets a line of their own purchase');
select pg_temp.act_as('18800000-0000-0000-0000-0000000000a3');
select is(public.set_cost_attribution('procurement_item', array['18800000-0000-0000-0000-000000000612']::uuid[], '18800000-0000-0000-0000-000000000402', null), 1,
  'AC-WPL-001 a Project Manager sets any line of the org');
select is((select array_agg(work_order_id order by id) from public.procurement_items where id in ('18800000-0000-0000-0000-000000000611', '18800000-0000-0000-0000-000000000612')), array['18800000-0000-0000-0000-000000000401', '18800000-0000-0000-0000-000000000402']::uuid[],
  'AC-WPL-001 each line holds its own work order');
select is(public.set_cost_attribution('procurement_item', array['18800000-0000-0000-0000-000000000611']::uuid[], null, null), 1, 'AC-WPL-001 a line is cleared with a null');
select is((select work_order_id from public.procurement_items where id = '18800000-0000-0000-0000-000000000611'), null::uuid, 'AC-WPL-001 and holds none after');

-- AC-WPL-002 through the RPC
select throws_ok($$ select public.set_cost_attribution('procurement_item', array['18800000-0000-0000-0000-000000000611']::uuid[], '18800000-0000-0000-0000-000000000404', null) $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-WPL-002 a work order of another project is refused');
select throws_ok($$ select public.set_cost_attribution('procurement_item', array['18800000-0000-0000-0000-000000000611']::uuid[], '18800000-0000-0000-0000-000000000409', null) $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-WPL-002 a work order of another org is refused');
select throws_ok($$ select public.set_cost_attribution('procurement_item', array['18800000-0000-0000-0000-000000000613']::uuid[], '18800000-0000-0000-0000-000000000401', null) $$,
  '23514', 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order', 'AC-WPL-002 a line of a purchase with no project names none');
select throws_ok($$ select public.set_cost_attribution('procurement_item', array['18800000-0000-0000-0000-000000000611']::uuid[], '18800000-0000-0000-0000-000000000403', null) $$,
  '23514', 'COST_WO_CANCELLED: the work order is cancelled', 'AC-WPL-002 a newly named cancelled work order is refused');
select is(public.set_cost_attribution('procurement_item', array['18800000-0000-0000-0000-000000000614']::uuid[], '18800000-0000-0000-0000-000000000403', null), 1,
  'AC-WPL-002 a line already on a work order keeps it when the work order is cancelled later');
-- AC-WPL-003
select throws_ok($$ select public.set_cost_attribution('procurement_item', array['18800000-0000-0000-0000-000000000611']::uuid[], '18800000-0000-0000-0000-000000000401', '18800000-0000-0000-0000-000000000501') $$,
  '23514', 'COST_LINE_DISCIPLINE: a purchase line takes a work order only; the discipline stays on the purchase records', 'AC-WPL-003 a line takes no discipline');
select pg_temp.act_as('18800000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.set_cost_attribution('procurement_item', array['18800000-0000-0000-0000-000000000611']::uuid[], '18800000-0000-0000-0000-000000000401', null) $$,
  '42501', 'you cannot change the work order or discipline of this record', 'AC-WPL-003 another engineer is refused');
select pg_temp.act_as('18800000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.set_cost_attribution('procurement_item', array['18800000-0000-0000-0000-000000000611']::uuid[], '18800000-0000-0000-0000-000000000409', null) $$,
  'P0002', 'record not found', 'AC-WPL-003 another org reads the line as absent');
-- AC-WPL-009
select pg_temp.act_as('18800000-0000-0000-0000-0000000000a3');
select is((select work_order_id from public.procurement_items_masked where id = '18800000-0000-0000-0000-000000000612'), '18800000-0000-0000-0000-000000000402'::uuid,
  'AC-WPL-009 the masked line view carries the line''s work order');

-- every writer: the table owner (a service-role style direct write) meets the same rule
reset role;
select throws_ok($$ update public.procurement_items set work_order_id = '18800000-0000-0000-0000-000000000404' where id = '18800000-0000-0000-0000-000000000611' $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-WPL-002 a direct write of another project''s work order is refused');
select throws_ok($$ insert into public.procurement_items (id, org_id, procurement_id, name, quantity, rate, work_order_id)
  values ('18800000-0000-0000-0000-000000000615', '18800000-0000-0000-0000-00000000000a', '18800000-0000-0000-0000-000000000601', 'new line', 1, 1, '18800000-0000-0000-0000-000000000403') $$,
  '23514', 'COST_WO_CANCELLED: the work order is cancelled', 'AC-WPL-002 a direct insert on a cancelled work order is refused');
select throws_ok($$ update public.procurements set project_id = '18800000-0000-0000-0000-0000000000d2' where id = '18800000-0000-0000-0000-000000000601' $$,
  '23514', 'COST_LINE_PROJECT_MOVE: lines of this purchase name a work order of its project. Clear their work orders before moving the purchase.',
  'a purchase cannot move away from its lines'' work orders');
select is((select count(*)::int from public.audit_events where action = 'cost_attribution.set' and entity_id = '18800000-0000-0000-0000-000000000611'), 2,
  'every change is audited per line (set, then clear)');

select * from finish();
rollback;
