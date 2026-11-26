begin;
create extension if not exists pgtap;
select plan(72);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled, quantity_change_approver_roles)
values ('27650000-0000-0000-0000-000000000001', 'Waiting Decisions', 'USD', 'UTC', true, '{project_manager}');

create temp table decision_actors (id uuid, role user_role, job_role text, label text, expected boolean);
insert into decision_actors values
  ('27650000-0000-0000-0000-000000000011', 'Admin', null, 'author', false),
  ('27650000-0000-0000-0000-000000000012', 'Engineer', 'material_coordinator', 'Material Coordinator', true),
  ('27650000-0000-0000-0000-000000000013', 'Engineer', 'storekeeper', 'Storekeeper', false),
  ('27650000-0000-0000-0000-000000000014', 'Project Manager', 'project_manager', 'Project Manager', true),
  ('27650000-0000-0000-0000-000000000015', 'Engineer', null, 'Engineer', false),
  ('27650000-0000-0000-0000-000000000016', 'Finance', null, 'Finance', true),
  ('27650000-0000-0000-0000-000000000017', 'Executive', null, 'Executive', true);
insert into auth.users (id, email)
select id, id || '@example.com' from decision_actors;
insert into profiles (id, org_id, role, built_in_role, email, full_name, status)
select id, '27650000-0000-0000-0000-000000000001', role, job_role, id || '@example.com', label, 'active'
from decision_actors;

insert into stock_units (id, org_id, code, name) values
  ('27650000-0000-0000-0000-000000000021', '27650000-0000-0000-0000-000000000001', 'EA', 'Each');
insert into stock_items (id, org_id, unit_id, code, name) values
  ('27650000-0000-0000-0000-000000000022', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000021', 'PART', 'Part');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('27650000-0000-0000-0000-000000000023', '27650000-0000-0000-0000-000000000001', 'SITE', 'Site', 'site');
insert into stock_balances (org_id, item_id, warehouse_id, qty_on_hand, value_on_hand) values
  ('27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000022', '27650000-0000-0000-0000-000000000023', 3, 30);
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, occurred_on, created_by) values
  ('27650000-0000-0000-0000-000000000024', '27650000-0000-0000-0000-000000000001', 'CNT-1', 'count', 'Draft',
   '27650000-0000-0000-0000-000000000023', current_date, '27650000-0000-0000-0000-000000000011');
insert into stock_document_lines (org_id, document_id, line_no, item_id, counted_quantity) values
  ('27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000024', 1, '27650000-0000-0000-0000-000000000022', 2);

-- Roll back a successful post so every actor decides the same draft.
create function pg_temp.can_post_writeoff(p_id uuid) returns boolean language plpgsql as $$
begin
  perform public.post_stock_document(p_id, 1);
  raise sqlstate 'PT001';
exception
  when sqlstate 'PT001' then return true;
  when sqlstate 'P0001' then
    if sqlerrm like 'STK_RANK:%' or sqlerrm like 'STK_SELF_APPROVE:%' then return false; end if;
    raise;
end $$;

create function pg_temp.writeoff_outcome(p_actor uuid, p_label text, p_expected boolean) returns text language plpgsql as $$
declare
  v_id constant uuid := '27650000-0000-0000-0000-000000000024';
  v_listed boolean;
  v_accepted boolean;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  select exists (select from public.my_waiting_decisions() where kind = 'stock_writeoff' and record_id = v_id) into v_listed;
  v_accepted := pg_temp.can_post_writeoff(v_id);
  return is(array[v_listed, v_accepted], array[p_expected, p_expected], 'AC-WD-2765 stock write-off appears exactly when the gate accepts ' || p_label);
end $$;

insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount) values
  ('27650000-0000-0000-0000-000000000031', '27650000-0000-0000-0000-000000000001', 'Attendance project', 'Ongoing Project', 'USD', 1000, 'exclusive', 0);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27650000-0000-0000-0000-000000000032', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000031', 'Attendance job', 'Issued', 100, 'exclusive', 0);
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id) values
  ('27650000-0000-0000-0000-000000000033', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000031',
   '27650000-0000-0000-0000-000000000032', current_date - 1, 'draft', '27650000-0000-0000-0000-000000000013');
insert into people (id, org_id, kind, name, profile_id) values
  ('27650000-0000-0000-0000-000000000034', '27650000-0000-0000-0000-000000000001', 'own', 'Shift Worker', '27650000-0000-0000-0000-000000000014');
insert into attendance_days (org_id, worker_id, work_order_id, project_id, work_date, status, hours, source, recorded_by_ids) values
  ('27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000034', '27650000-0000-0000-0000-000000000032',
   '27650000-0000-0000-0000-000000000031', current_date - 1, 'present', 8, 'roster_tick', '{27650000-0000-0000-0000-000000000013}');
insert into attendance_second_records (org_id, worker_id, work_order_id, work_date, status, hours, recorded_by_ids) values
  ('27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000034', '27650000-0000-0000-0000-000000000032',
   current_date - 1, 'present', 6, '{27650000-0000-0000-0000-000000000015}');

insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at) values
  ('27650000-0000-0000-0000-000000000035', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000031',
   '27650000-0000-0000-0000-000000000032', current_date - 2, 'submitted', '27650000-0000-0000-0000-000000000011', now());
insert into storage.objects (bucket_id, name, owner) values
  ('site-report-photos', '27650000-0000-0000-0000-000000000001/27650000-0000-0000-0000-000000000035/27650000-0000-0000-0000-000000000036/form.jpg',
   '27650000-0000-0000-0000-000000000011');
insert into dsr_photos (org_id, report_id, kind, file_path) values
  ('27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000035', 'paper_form',
   '27650000-0000-0000-0000-000000000001/27650000-0000-0000-0000-000000000035/27650000-0000-0000-0000-000000000036/form.jpg');
update projects set project_manager_id = '27650000-0000-0000-0000-000000000014' where id = '27650000-0000-0000-0000-000000000031';
insert into quantity_change_requests (id, org_id, project_id, work_order_id, status, author_id, editor_ids, submitted_by, submitted_at)
values ('27650000-0000-0000-0000-000000000037', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000031',
        '27650000-0000-0000-0000-000000000032', 'pending_approval', '27650000-0000-0000-0000-000000000011',
        '{27650000-0000-0000-0000-000000000011}', '27650000-0000-0000-0000-000000000011', now());

insert into auth.users (id, email) values ('27650000-0000-0000-0000-000000000041', 'value-witness@example.test');
insert into profiles (id, org_id, role, email, full_name, status) values
  ('27650000-0000-0000-0000-000000000041', '27650000-0000-0000-0000-000000000001', 'Finance',
   'value-witness@example.test', 'Value Witness', 'active');
select set_config('request.jwt.claims', '{"sub":"27650000-0000-0000-0000-000000000041","role":"authenticated"}', true);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27650000-0000-0000-0000-000000000038', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000031',
   'Work to issue', 'Draft', 100, 'exclusive', 0);
select set_config('request.jwt.claims', '', true);

insert into procurements (id, org_id, title, project_id, status, requested_by_id, approved_by_id) values
  ('27650000-0000-0000-0000-000000000039', '27650000-0000-0000-0000-000000000001', 'Materials',
   '27650000-0000-0000-0000-000000000031', 'Ordered', '27650000-0000-0000-0000-000000000015', '27650000-0000-0000-0000-000000000011');
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('27650000-0000-0000-0000-00000000003a', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000039', 'PO-WAIT', 'Issued', current_date, 'USD');
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('27650000-0000-0000-0000-00000000003d', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000039', 'Part', 1, 10);
insert into order_receiving_settings (org_id, enabled) values ('27650000-0000-0000-0000-000000000001', true);
insert into order_receiving_requests (id, org_id, po_id, receiver_id, warehouse_id, receipt_date, counted_lines) values
  ('27650000-0000-0000-0000-00000000003b', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-00000000003a',
   '27650000-0000-0000-0000-000000000011', '27650000-0000-0000-0000-000000000023', current_date,
   '[{"item_id":"27650000-0000-0000-0000-00000000003d","quantity":2}]');
insert into org_equipment_plan_settings (org_id, enabled, approval_step) values
  ('27650000-0000-0000-0000-000000000001', true, 'senior_role');
insert into equipment_plans (id, org_id, project_id, plan_month, status, created_by, submitted_at) values
  ('27650000-0000-0000-0000-00000000003c', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000031',
   date_trunc('month', current_date)::date, 'Submitted', '27650000-0000-0000-0000-000000000014', now());

update organizations set stock_transfer_mode = 'two_step' where id = '27650000-0000-0000-0000-000000000001';
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('27650000-0000-0000-0000-000000000042', '27650000-0000-0000-0000-000000000001', 'SOURCE', 'Source', 'central'),
  ('27650000-0000-0000-0000-000000000043', '27650000-0000-0000-0000-000000000001', 'TRANSIT', 'Transit', 'site');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000023', '27650000-0000-0000-0000-000000000011');
insert into stock_transfers (id, org_id, number, from_warehouse_id, to_warehouse_id, transit_warehouse_id, to_user_id, status, sent_by) values
  ('27650000-0000-0000-0000-000000000044', '27650000-0000-0000-0000-000000000001', 'TR-WAIT',
   '27650000-0000-0000-0000-000000000042', '27650000-0000-0000-0000-000000000023', '27650000-0000-0000-0000-000000000043',
   '27650000-0000-0000-0000-000000000015', 'Sent', '27650000-0000-0000-0000-000000000014');
insert into stock_transfer_lines (id, org_id, transfer_id, line_no, item_id, qty_sent) values
  ('27650000-0000-0000-0000-000000000045', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000044', 1,
   '27650000-0000-0000-0000-000000000022', 1);

insert into companies (id, org_id, name, type) values
  ('27650000-0000-0000-0000-000000000046', '27650000-0000-0000-0000-000000000001', 'Vendor', 'Vendor');
insert into procurements (id, org_id, title, project_id, status, requested_by_id, vendor_id, is_subcontract) values
  ('27650000-0000-0000-0000-00000000004a', '27650000-0000-0000-0000-000000000001', 'Subcontract',
   '27650000-0000-0000-0000-000000000031', 'Ordered', '27650000-0000-0000-0000-000000000014', '27650000-0000-0000-0000-000000000046', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency, work_order_id) values
  ('27650000-0000-0000-0000-00000000004b', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-00000000004a',
   'PO-CERT', 'Issued', current_date, 'USD', '27650000-0000-0000-0000-000000000032');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('27650000-0000-0000-0000-000000000047', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000031',
   'ITEM', 'Part', 'ea', 2, 10);
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('27650000-0000-0000-0000-00000000004b', 1, '27650000-0000-0000-0000-000000000047', 2, 10, 'ea');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('27650000-0000-0000-0000-00000000004b', '27650000-0000-0000-0000-00000000004a', 1, 'Issued', 20,
   '27650000-0000-0000-0000-000000000011', 'standard');
insert into subcontract_acceptances (id, org_id, project_id, po_id, acceptance_date, prepared_by) values
  ('27650000-0000-0000-0000-000000000048', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000031',
   '27650000-0000-0000-0000-00000000004b', current_date, '27650000-0000-0000-0000-000000000014');
insert into subcontract_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('27650000-0000-0000-0000-000000000048', '27650000-0000-0000-0000-000000000047', 1);
update subcontract_acceptances set status = 'Confirmed', confirmed_by = '27650000-0000-0000-0000-000000000011',
  confirmed_at = now(), confirm_basis = 'standard'
where id = '27650000-0000-0000-0000-000000000048';
select set_config('pmo.spc_transition', 'on', true);
insert into subcontract_certificates
  (id, org_id, procurement_id, po_id, project_id, work_order_id, vendor_company_id, currency, period_start, period_end,
   status, prepared_by, submitted_by, submitted_at, gross, backcharge_total, net)
values ('27650000-0000-0000-0000-000000000049', '27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-00000000004a',
        '27650000-0000-0000-0000-00000000004b', '27650000-0000-0000-0000-000000000031', '27650000-0000-0000-0000-000000000032',
        '27650000-0000-0000-0000-000000000046', 'USD', date_trunc('month', current_date)::date,
        (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'draft',
        '27650000-0000-0000-0000-000000000014', null, null, null, null, null);
update subcontract_certificates set status = 'submitted', submitted_by = prepared_by, submitted_at = now(),
  gross = 10, backcharge_total = 0, net = 10
where id = '27650000-0000-0000-0000-000000000049';
select set_config('pmo.spc_transition', '', true);
select set_config('pmo.spc_freeze', 'on', true);
insert into subcontract_certificate_lines (org_id, certificate_id, boq_item_id, item_code, unit, measured_quantity, rate, po_rate) values
  ('27650000-0000-0000-0000-000000000001', '27650000-0000-0000-0000-000000000049', '27650000-0000-0000-0000-000000000047',
   'ITEM', 'ea', 1, 10, 10);
select set_config('pmo.spc_freeze', '', true);

create function pg_temp.can_decide(p_command text) returns boolean language plpgsql as $$
begin
  execute p_command;
  raise sqlstate 'PT001';
exception
  when sqlstate 'PT001' then return true;
  when insufficient_privilege then return false;
  when sqlstate 'P0001' then
    if sqlerrm like 'STK_NOT_RECEIVER:%' or sqlerrm like 'STK_SELF_RECEIVE:%' then return false; end if;
    raise;
end $$;

create function pg_temp.decision_outcome(p_actor uuid, p_label text, p_kind text, p_id uuid, p_command text, p_expected boolean)
  returns text language plpgsql as $$
declare
  v_listed boolean;
  v_accepted boolean;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  select exists (select from public.my_waiting_decisions() where kind = p_kind and record_id = p_id) into v_listed;
  v_accepted := pg_temp.can_decide(p_command);
  return is(array[v_listed, v_accepted], array[p_expected, p_expected],
            'AC-WD-2765 ' || p_kind || ' appears exactly when the gate accepts ' || p_label);
end $$;

grant select on decision_actors to authenticated;
set local role authenticated;
select pg_temp.writeoff_outcome(id, label, expected) from decision_actors order by id;
select pg_temp.decision_outcome(id, label, 'daily_report', '27650000-0000-0000-0000-000000000035',
  $$ select public.dsr_validate('27650000-0000-0000-0000-000000000035') $$, role in ('Project Manager', 'Finance'))
from decision_actors order by id;
select pg_temp.decision_outcome(id, label, 'quantity_change', '27650000-0000-0000-0000-000000000037',
  $$ select public.qcr_approve('27650000-0000-0000-0000-000000000037') $$, role in ('Project Manager', 'Finance', 'Executive'))
from decision_actors order by id;
select pg_temp.decision_outcome(id, label, 'work_order_issue', '27650000-0000-0000-0000-000000000038',
  $$ select public.transition_work_order('27650000-0000-0000-0000-000000000038', 'Issued') $$, role in ('Project Manager', 'Admin', 'Finance', 'Executive'))
from decision_actors order by id;
select pg_temp.decision_outcome(id, label, 'delivery_record', '27650000-0000-0000-0000-000000000039',
  $$ select public.transition_procurement('27650000-0000-0000-0000-000000000039', 'Received') $$, role in ('Project Manager', 'Admin') or label = 'Engineer')
from decision_actors order by id;
select pg_temp.decision_outcome(id, label, 'order_receiving', '27650000-0000-0000-0000-00000000003a',
  $$ select public.approve_order_receiving('27650000-0000-0000-0000-00000000003b', 'Count verified') $$, role in ('Project Manager', 'Finance', 'Executive'))
from decision_actors order by id;
select pg_temp.decision_outcome(id, label, 'equipment_plan', '27650000-0000-0000-0000-00000000003c',
  $$ select public.reject_equipment_plan('27650000-0000-0000-0000-00000000003c', 'Update the plan') $$, role in ('Admin', 'Finance', 'Executive'))
from decision_actors order by id;
select pg_temp.decision_outcome(id, label, 'transfer_receipt', '27650000-0000-0000-0000-000000000044',
  $$ select public.receive_stock_transfer('27650000-0000-0000-0000-000000000044',
       '[{"line_id":"27650000-0000-0000-0000-000000000045","counted":0,"accepted":0}]') $$, role = 'Admin' or label = 'Engineer')
from decision_actors order by id;
select pg_temp.decision_outcome(id, label, 'certificate', '27650000-0000-0000-0000-000000000049',
  $$ select public.approve_subcontract_certificate('27650000-0000-0000-0000-000000000049') $$, role in ('Admin', 'Finance', 'Executive'))
from decision_actors order by id;
select pg_temp.decision_outcome(id, label, 'attendance_decision', '27650000-0000-0000-0000-000000000033',
  $$ select public.attendance_second_record_decide(
    '27650000-0000-0000-0000-000000000034', '27650000-0000-0000-0000-000000000032', current_date - 1, 'day', 'Verified hours') $$,
  role in ('Admin', 'Executive'))
from decision_actors order by id;
select set_config('request.jwt.claims', '{"sub":"27650000-0000-0000-0000-000000000014","role":"authenticated"}', true);
select is_empty($$ select record_id from public.my_waiting_decisions() where kind = 'attendance_decision' $$,
  'AC-WD-2765 the person whose day is in dispute is offered no decision');
select throws_ok($$ select public.attendance_second_record_decide(
    '27650000-0000-0000-0000-000000000034', '27650000-0000-0000-0000-000000000032', current_date - 1, 'day', 'Verified hours') $$,
  '42501', 'ATT_DECIDE_SELF: this is your own working day; someone else decides which hours stand',
  'AC-WD-2765 the attendance gate refuses the person whose day is in dispute');
reset role;
select * from finish();
rollback;
