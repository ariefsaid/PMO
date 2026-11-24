-- 2080_waiting_stock_writeoff_attendance.test.sql — a stock write-off and an undecided attendance day each wait on the person who may decide.
-- Migration under test: 2080_waiting_stock_writeoff_attendance.sql (my_waiting_decisions, my_decision_standing).
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   drop `sd.created_by is distinct from v_uid` ......................... 'author of the count is not told to post it'
--   drop the role_rank test ............................................ 'an Engineer is not asked to post a write-off'
--   drop the counted-versus-on-hand test ................................ 'a count with no difference is not listed'
--   drop `not (v_uid = any (asr.recorded_by_ids))` ...................... 'the foreman who ticked the day is not asked to decide it'
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name, default_currency, attendance_backdate_days, built_in_roles_enabled) values
  ('20800000-0000-0000-0000-00000000020a', 'WS Org', 'IDR', 60, true);
insert into auth.users (id, email) values
  ('20800000-0000-0000-0000-0000000000a2', 'ws-fc@example.com'), ('20800000-0000-0000-0000-0000000000a3', 'ws-sv@example.com'), ('20800000-0000-0000-0000-0000000000a4', 'ws-pm@example.com'),
  ('20800000-0000-0000-0000-0000000000a5', 'ws-pm2@example.com'), ('20800000-0000-0000-0000-0000000000a6', 'ws-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20800000-0000-0000-0000-0000000000a2', '20800000-0000-0000-0000-00000000020a', 'WS FC',  'ws-fc@example.com',  'Project Manager', 'active', null),
  ('20800000-0000-0000-0000-0000000000a3', '20800000-0000-0000-0000-00000000020a', 'WS SV',  'ws-sv@example.com',  'Engineer', 'active', 'quantity_surveyor'),
  ('20800000-0000-0000-0000-0000000000a4', '20800000-0000-0000-0000-00000000020a', 'WS PM',  'ws-pm@example.com',  'Project Manager', 'active', null),
  ('20800000-0000-0000-0000-0000000000a5', '20800000-0000-0000-0000-00000000020a', 'WS PM2', 'ws-pm2@example.com', 'Project Manager', 'active', null),
  ('20800000-0000-0000-0000-0000000000a6', '20800000-0000-0000-0000-00000000020a', 'WS Eng', 'ws-eng@example.com', 'Engineer', 'active', null);
insert into projects (id, org_id, name, status, project_manager_id) values
  ('20800000-0000-0000-0000-0000000000d1', '20800000-0000-0000-0000-00000000020a', 'WS Site', 'Ongoing Project', '20800000-0000-0000-0000-0000000000a4');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('20800000-0000-0000-0000-000000000401', '20800000-0000-0000-0000-00000000020a', '20800000-0000-0000-0000-0000000000d1', 'WS WO', 'Issued', 1000, 'exclusive', 0);
insert into cost_disciplines (id, org_id, code, name) values ('20800000-0000-0000-0000-000000000501', '20800000-0000-0000-0000-00000000020a', 'MEC', 'Mechanical');
insert into crews (id, org_id, code, name, field_controller_id, discipline_id) values
  ('20800000-0000-0000-0000-000000000c01', '20800000-0000-0000-0000-00000000020a', 'WS-A', 'Crew A', '20800000-0000-0000-0000-0000000000a2', '20800000-0000-0000-0000-000000000501');
insert into people (id, org_id, kind, name, profile_id) values ('20800000-0000-0000-0000-000000000f01', '20800000-0000-0000-0000-00000000020a', 'vendor', 'No Login One', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from) values ('20800000-0000-0000-0000-00000000020a', '20800000-0000-0000-0000-000000000c01', '20800000-0000-0000-0000-000000000f01', current_date - 50);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values ('20800000-0000-0000-0000-00000000020a', '20800000-0000-0000-0000-000000000401', '20800000-0000-0000-0000-000000000c01', current_date - 50);
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id) values
  ('20800000-0000-0000-0000-000000000601', '20800000-0000-0000-0000-00000000020a', '20800000-0000-0000-0000-0000000000d1', '20800000-0000-0000-0000-000000000401', date_trunc('week', current_date)::date - 13, 'draft', '20800000-0000-0000-0000-0000000000a2');

-- Stock: one item with 10 on hand at one site; a count of 8 (a difference), a count of 10 (none), and an adjustment.
insert into stock_units (id, org_id, code, name) values ('20800000-0000-0000-0000-000000000701', '20800000-0000-0000-0000-00000000020a', 'bag', 'Bag');
insert into stock_items (id, org_id, code, name, unit_id) values ('20800000-0000-0000-0000-000000000702', '20800000-0000-0000-0000-00000000020a', 'CEM', 'Cement', '20800000-0000-0000-0000-000000000701');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values ('20800000-0000-0000-0000-000000000703', '20800000-0000-0000-0000-00000000020a', 'WS1', 'WS site', 'site', '20800000-0000-0000-0000-0000000000d1');
insert into stock_balances (org_id, item_id, warehouse_id, qty_on_hand, value_on_hand) values ('20800000-0000-0000-0000-00000000020a', '20800000-0000-0000-0000-000000000702', '20800000-0000-0000-0000-000000000703', 10, 1000);
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, occurred_on, created_by, reason) values
  ('20800000-0000-0000-0000-000000000801', '20800000-0000-0000-0000-00000000020a', 'CNT-WS1', 'count', 'Draft', '20800000-0000-0000-0000-000000000703', current_date, '20800000-0000-0000-0000-0000000000a4', null),
  ('20800000-0000-0000-0000-000000000802', '20800000-0000-0000-0000-00000000020a', 'CNT-WS2', 'count', 'Draft', '20800000-0000-0000-0000-000000000703', current_date, '20800000-0000-0000-0000-0000000000a4', null),
  ('20800000-0000-0000-0000-000000000803', '20800000-0000-0000-0000-00000000020a', 'ADJ-WS3', 'adjustment', 'Draft', '20800000-0000-0000-0000-000000000703', current_date, '20800000-0000-0000-0000-0000000000a2', 'damaged');
insert into stock_document_lines (org_id, document_id, line_no, item_id, counted_quantity) values
  ('20800000-0000-0000-0000-00000000020a', '20800000-0000-0000-0000-000000000801', 1, '20800000-0000-0000-0000-000000000702', 8), ('20800000-0000-0000-0000-00000000020a', '20800000-0000-0000-0000-000000000802', 1, '20800000-0000-0000-0000-000000000702', 10);
insert into stock_document_lines (org_id, document_id, line_no, item_id, quantity, direction) values
  ('20800000-0000-0000-0000-00000000020a', '20800000-0000-0000-0000-000000000803', 1, '20800000-0000-0000-0000-000000000702', 2, 'out');

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.ids(p_uid uuid, p_kind text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.act_as(p_uid);
  select coalesce(string_agg(record_id::text, ',' order by record_id), '') into v from public.my_waiting_decisions() where kind = p_kind;
  return v;
end $$;

set local role authenticated;
select pg_temp.act_as('20800000-0000-0000-0000-0000000000a2');
select attendance_record('20800000-0000-0000-0000-000000000401', date_trunc('week', current_date)::date - 13, 'roster_tick',
  '[{"worker_id":"20800000-0000-0000-0000-000000000f01","status":"present","hours":8}]');
select pg_temp.act_as('20800000-0000-0000-0000-0000000000a3');
select attendance_second_record('20800000-0000-0000-0000-000000000401', date_trunc('week', current_date)::date - 13,
  '[{"worker_id":"20800000-0000-0000-0000-000000000f01","status":"present","hours":5}]');

select is(pg_temp.ids('20800000-0000-0000-0000-0000000000a5', 'stock_writeoff'), '20800000-0000-0000-0000-000000000801,20800000-0000-0000-0000-000000000803',
  'a Project Manager who wrote neither is told about the count with a difference and the adjustment');
select is(pg_temp.ids('20800000-0000-0000-0000-0000000000a4', 'stock_writeoff'), '20800000-0000-0000-0000-000000000803', 'the author of the count is not told to post it (only the adjustment is theirs to post)');
select is(pg_temp.ids('20800000-0000-0000-0000-0000000000a2', 'stock_writeoff'), '20800000-0000-0000-0000-000000000801', 'the author of the adjustment is not told to post it');
select is(pg_temp.ids('20800000-0000-0000-0000-0000000000a6', 'stock_writeoff'), '', 'an Engineer is not asked to post a write-off');
select pg_temp.act_as('20800000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.my_waiting_decisions() where kind = 'stock_writeoff' and record_id = '20800000-0000-0000-0000-000000000802'), 0,
  'a count with no difference is not listed: its author posts it');
select is((select title from public.my_waiting_decisions() where kind = 'stock_writeoff' and record_id = '20800000-0000-0000-0000-000000000803'), 'ADJ-WS3 · WS site',
  'the row names the document and the site');

select is(pg_temp.ids('20800000-0000-0000-0000-0000000000a4', 'attendance_decision'), '20800000-0000-0000-0000-000000000601', 'the manager who decides is told about the day where 8 hours meet 5, on that day''s site report');
select is(pg_temp.ids('20800000-0000-0000-0000-0000000000a2', 'attendance_decision'), '', 'the foreman who ticked the day is not asked to decide it');
select is(pg_temp.ids('20800000-0000-0000-0000-0000000000a3', 'attendance_decision'), '', 'the surveyor who entered the second record is not asked to decide it');
select is(pg_temp.ids('20800000-0000-0000-0000-0000000000a6', 'attendance_decision'), '', 'an Engineer who is not a decider is not asked');

select pg_temp.act_as('20800000-0000-0000-0000-0000000000a4');
select attendance_second_record_decide('20800000-0000-0000-0000-000000000f01', '20800000-0000-0000-0000-000000000401', date_trunc('week', current_date)::date - 13, 'day', 'site report figure stands');
select is(pg_temp.ids('20800000-0000-0000-0000-0000000000a4', 'attendance_decision'), '', 'once decided the day leaves the list');

reset role;
select pg_temp.act_as('20800000-0000-0000-0000-0000000000a3');
set local role authenticated;
select is(my_decision_standing(), false, 'a surveyor with no decision role has no standing');
reset role;
update organizations set attendance_decider_roles = '{quantity_surveyor}' where id = '20800000-0000-0000-0000-00000000020a';
set local role authenticated;
select is(my_decision_standing(), true, 'when the organisation names the surveyor role as decider, the Approvals entry is theirs');
select is((select count(*)::int from public.my_waiting_decisions() where kind in ('attendance_decision', 'stock_writeoff')), 0, 'the surveyor has nothing waiting (Engineer rank, and the day is decided)');

select * from finish();
rollback;
