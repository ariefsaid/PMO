-- 1181_third_party_inspection_history.sql — #2580 FR-TPI-005: every status step and the waiver is audited in record history.
-- The inspection row is the tracked entity (parent: its work order); its report-file rows are append-only (FR-TPI-015) and are
-- not a second tracked entity. The estimate (a planning figure, hidden from the money-less roles) is a flag: a change is
-- recorded, its value is not. The catalog gate (supabase/tests/record_changes_catalog_gate.test.sql) now counts 18 entities and
-- requires the visibility arm below.
-- ── REVERSE (rollback/1181_third_party_inspection_history_down.sql): delete the registry row, drop the trigger, restore 0448's arm list.

insert into public.record_history_config(entity_type, table_name, parent_type, parent_col, parent_via, captured, flag_cols, omit_cols) values
('third_party_inspection', 'third_party_inspections', 'work_order', 'work_order_id', null,
 '{"title":"text","test_kind":"text","planned_date":"date","vendor_id":"ref","note":"text","required_for":"text","section_id":"ref","status":"enum","result":"enum","procurement_id":"ref","invited_on":"date","invited_who":"text","executed_on":"date","reported_at":"timestamp","waived_at":"timestamp","waiver_reason":"text","cancelled_at":"timestamp","cancel_reason":"text"}',
 '{estimate,estimate_currency,invited_how}',
 '{id,org_id,work_order_id,project_id,purchase_raised_at,purchase_raised_by,invited_by,executed_by,reported_by,waived_by,cancelled_by,overdue_notified_at,created_by,created_at,updated_at}');
create trigger third_party_inspections_zz_record_change after insert or update on public.third_party_inspections
  for each row execute function public.record_change_capture();

-- 0448's body verbatim plus one arm (invoker: the inspection's own RLS decides who sees its history).
create or replace function public.record_history_visible(p_entity_type text,p_entity_id uuid) returns boolean
language plpgsql stable security invoker set search_path=public as $$
begin
 case p_entity_type
  when 'project' then return exists(select 1 from public.projects where id=p_entity_id);
  when 'budget_version' then return exists(select 1 from public.budget_versions where id=p_entity_id);
  when 'budget_line_item' then return exists(select 1 from public.budget_line_items where id=p_entity_id);
  when 'work_order' then return exists(select 1 from public.work_orders where id=p_entity_id);
  when 'procurement' then return exists(select 1 from public.procurements where id=p_entity_id);
  when 'purchase_request' then return exists(select 1 from public.purchase_requests where id=p_entity_id);
  when 'rfq' then return exists(select 1 from public.rfqs where id=p_entity_id);
  when 'purchase_order' then return exists(select 1 from public.purchase_orders where id=p_entity_id);
  when 'payment' then return exists(select 1 from public.payments where id=p_entity_id);
  when 'task' then return exists(select 1 from public.tasks where id=p_entity_id);
  when 'company' then return exists(select 1 from public.companies where id=p_entity_id);
  when 'contact' then return exists(select 1 from public.contacts where id=p_entity_id);
  when 'sales_invoice' then return exists(select 1 from public.sales_invoices where id=p_entity_id);
  when 'procurement_invoice' then return exists(select 1 from public.procurement_invoices where id=p_entity_id);
  when 'vendor_withholding_slip' then return exists(select 1 from public.vendor_withholding_slips where id=p_entity_id);
  when 'vendor_withholding_slip_bill' then return exists(select 1 from public.vendor_withholding_slip_bills where id=p_entity_id);
  when 'project_stage_entry' then return exists(select 1 from public.project_stage_entries where id=p_entity_id);
  when 'third_party_inspection' then return exists(select 1 from public.third_party_inspections where id=p_entity_id);
  else raise exception 'record_history_visible: no visibility arm for entity type %',p_entity_type using errcode='P0001';
 end case;
end $$;
revoke all on function public.record_history_visible(text,uuid) from public,anon;
grant execute on function public.record_history_visible(text,uuid) to authenticated,service_role;
