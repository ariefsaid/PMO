-- 1413_safety_photos_storage_history.sql — #2596 daily safety records: the private photo bucket and change history.
-- Spec: docs/specs/daily-safety-records.spec.md (FR-DSF-003, 009, 017; NFR-DSF-001). Proven by supabase/tests/safety_days.test.sql.
-- Photos are personal data of site workers: private bucket, image types only, 10 MB, organisation-keyed policies.
-- History: the day (create, submit, correction) is in record history under the project; its parts are written only
-- while the day is a draft and carry their writer and time. Reversal: rollback/1413_safety_photos_storage_history_down.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('safety-photos', 'safety-photos', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;
-- Object path {org}/{day}/{photo}/{filename}. Read: the photo row's own policy (OD-DSF-6) decides. Write: an enterer
-- of a draft day in the caller's own organisation.
create policy storage_objects_safety_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'safety-photos' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.safety_toolbox_photos p where p.id::text = split_part(objects.name, '/', 3)));
create policy storage_objects_safety_photo_write on storage.objects for insert to authenticated
  with check (bucket_id = 'safety-photos' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and public.safety_day_writable(nullif(split_part(objects.name, '/', 2), '')::uuid));

-- record history: the day, under its project
insert into public.record_history_config (entity_type, table_name, parent_type, parent_col, parent_via, captured, flag_cols, omit_cols) values
('safety_day', 'safety_days', 'project', 'project_id', null,
 '{"project_id":"ref","work_order_id":"ref","work_date":"date","status":"enum","version":"number","supersedes_id":"ref",
   "correction_reason":"text","author_id":"ref","submitted_at":"timestamp","archived_at":"timestamp"}',
 '{}', '{id,org_id,created_at}');
create trigger safety_days_zz_record_change after insert or update on public.safety_days
  for each row execute function public.record_change_capture();

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
  when 'safety_day' then return exists(select 1 from public.safety_days where id=p_entity_id);
  else raise exception 'record_history_visible: no visibility arm for entity type %',p_entity_type using errcode='P0001';
 end case;
end $$;
revoke all on function public.record_history_visible(text,uuid) from public,anon;
grant execute on function public.record_history_visible(text,uuid) to authenticated,service_role;
