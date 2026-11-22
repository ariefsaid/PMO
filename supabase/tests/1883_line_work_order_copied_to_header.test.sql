-- 1883_line_work_order_copied_to_header.test.sql — when every line names the same work order it becomes the purchase header's
-- (docs/specs/wo-per-purchase-line.spec.md). Migrations under test: 1880, 1883_line_work_order_copied_to_header.sql.
-- AC-WPL-005 every line on one work order -> the header takes it (also when it replaces a hand-set header); lines that differ, or a line
-- with none, leave the header exactly as it is · AC-WPL-006 the copy changes only the header: the request record the header
-- would stamp is untouched, a cancelled work order is never copied, another purchase's header is untouched.
--
-- MUTATION CHECKS (each must turn this file RED, then be restored):
--   1. In 1883's copy_line_work_order_to_header, drop the status condition (the line marked `-- mut:copy_before_submit`)
--      -> the 'after submit the header stays as it is' test goes red.
--   2. In 1883's copy_line_work_order_to_header, break the line marked
-- `-- mut:copy_all_same` (e.g. `v_named >= 0 and v_distinct >= 1`, copying when lines differ or any line has none)
--   -> the 'lines that differ leave the header' and 'a line with none leaves the header' tests go red.
begin;
create extension if not exists pgtap;
select plan(11);

insert into organizations (id, name, default_currency) values ('18830000-0000-0000-0000-00000000000a', 'WPL Copy Org', 'IDR');
insert into auth.users (id, email) values ('18830000-0000-0000-0000-0000000000a3', 'wpl-copy-pm@example.com'), ('18830000-0000-0000-0000-0000000000a4', 'wpl-copy-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18830000-0000-0000-0000-0000000000a3', '18830000-0000-0000-0000-00000000000a', 'WPL PM', 'wpl-copy-pm@example.com', 'Project Manager', 'active'),
  ('18830000-0000-0000-0000-0000000000a4', '18830000-0000-0000-0000-00000000000a', 'WPL Eng', 'wpl-copy-eng@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values ('18830000-0000-0000-0000-0000000000d1', '18830000-0000-0000-0000-00000000000a', 'WPL Copy Site', 'Ongoing Project', '18830000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('18830000-0000-0000-0000-000000000401', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-0000000000d1', 'WPL WO one', 'Issued', 10000, 'exclusive', 0),
  ('18830000-0000-0000-0000-000000000402', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-0000000000d1', 'WPL WO two', 'Issued', 10000, 'exclusive', 0);
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, cancelled_at, currency) values
  ('18830000-0000-0000-0000-000000000403', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-0000000000d1', 'WPL WO cancelled', 'Cancelled', 0, 'exclusive', 0, now(), 'IDR');
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, currency) values
  ('18830000-0000-0000-0000-000000000601', '18830000-0000-0000-0000-00000000000a', 'WPL purchase one', '18830000-0000-0000-0000-0000000000d1', '18830000-0000-0000-0000-0000000000a4', 'Draft', 0, 0, 'IDR'),
  ('18830000-0000-0000-0000-000000000602', '18830000-0000-0000-0000-00000000000a', 'WPL purchase on a cancelled work order', '18830000-0000-0000-0000-0000000000d1', '18830000-0000-0000-0000-0000000000a4', 'Draft', 0, 0, 'IDR'),
  ('18830000-0000-0000-0000-000000000603', '18830000-0000-0000-0000-00000000000a', 'WPL other purchase', '18830000-0000-0000-0000-0000000000d1', '18830000-0000-0000-0000-0000000000a4', 'Draft', 0, 0, 'IDR'),
  ('18830000-0000-0000-0000-000000000604', '18830000-0000-0000-0000-00000000000a', 'WPL submitted purchase', '18830000-0000-0000-0000-0000000000d1', '18830000-0000-0000-0000-0000000000a4', 'Requested', 0, 0, 'IDR');
insert into purchase_requests (id, org_id, procurement_id, pr_number, status, date, currency) values
  ('18830000-0000-0000-0000-000000000611', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-000000000601', 'PR-WPL-COPY', 'Draft', '2026-11-16', 'IDR');
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate, work_order_id) values
  ('18830000-0000-0000-0000-0000000006a1', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-000000000601', 'L1', 1, 100, null),
  ('18830000-0000-0000-0000-0000000006a2', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-000000000601', 'L2', 1, 100, null),
  ('18830000-0000-0000-0000-0000000006a3', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-000000000601', 'L3', 1, 100, null),
  ('18830000-0000-0000-0000-0000000006b1', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-000000000602', 'C1', 1, 100, '18830000-0000-0000-0000-000000000403'),
  ('18830000-0000-0000-0000-0000000006b2', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-000000000602', 'C2', 1, 100, '18830000-0000-0000-0000-000000000403'),
  ('18830000-0000-0000-0000-0000000006c1', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-000000000603', 'O1', 1, 100, null),
  ('18830000-0000-0000-0000-0000000006d1', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-000000000604', 'S1', 1, 100, null),
  ('18830000-0000-0000-0000-0000000006d2', '18830000-0000-0000-0000-00000000000a', '18830000-0000-0000-0000-000000000604', 'S2', 1, 100, null);
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('18830000-0000-0000-0000-0000000000a3');

select is(public.set_cost_attribution('procurement_item', array['18830000-0000-0000-0000-0000000006a1', '18830000-0000-0000-0000-0000000006a2']::uuid[], '18830000-0000-0000-0000-000000000401', null), 2, 'fixture: two of three lines name WO-1');
select is((select work_order_id from public.procurements where id = '18830000-0000-0000-0000-000000000601'), null::uuid, 'AC-WPL-005 a line with none leaves the header as it is');
select is(public.set_cost_attribution('procurement_item', array['18830000-0000-0000-0000-0000000006a3']::uuid[], '18830000-0000-0000-0000-000000000401', null), 1, 'fixture: the third line names WO-1 too');
select is((select work_order_id from public.procurements where id = '18830000-0000-0000-0000-000000000601'), '18830000-0000-0000-0000-000000000401'::uuid, 'AC-WPL-005 every line on one work order -> the header takes it');
select is(public.set_cost_attribution('procurement_item', array['18830000-0000-0000-0000-0000000006a3']::uuid[], '18830000-0000-0000-0000-000000000402', null), 1, 'fixture: the third line moves to WO-2');
select is((select work_order_id from public.procurements where id = '18830000-0000-0000-0000-000000000601'), '18830000-0000-0000-0000-000000000401'::uuid, 'AC-WPL-005 lines that differ leave the header as it is');
select is((select work_order_id from public.purchase_requests where id = '18830000-0000-0000-0000-000000000611'), null::uuid, 'AC-WPL-006 the copy changes only the header: the request record is untouched');
select is(public.set_cost_attribution('procurement_item', array['18830000-0000-0000-0000-0000000006b1']::uuid[], '18830000-0000-0000-0000-000000000403', null), 1, 'fixture: a harmless edit of a line already on a cancelled work order');
select is(coalesce((select work_order_id::text from public.procurements where id = '18830000-0000-0000-0000-000000000602'), 'none') || '/' || coalesce((select work_order_id::text from public.procurements where id = '18830000-0000-0000-0000-000000000603'), 'none'),
  'none/none', 'AC-WPL-006 a cancelled work order is never copied, and another purchase''s header is untouched');
select is(public.set_cost_attribution('procurement_item', array['18830000-0000-0000-0000-0000000006d1', '18830000-0000-0000-0000-0000000006d2']::uuid[], '18830000-0000-0000-0000-000000000401', null), 2,
  'fixture: both lines of a submitted purchase name WO-1');
select is((select work_order_id from public.procurements where id = '18830000-0000-0000-0000-000000000604'), null::uuid,
  'AC-WPL-006 after submit the header stays as it is, even when every line names one work order');

select * from finish();
rollback;
