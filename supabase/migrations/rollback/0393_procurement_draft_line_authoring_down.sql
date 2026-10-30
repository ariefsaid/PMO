drop trigger if exists external_command_outbox_procurement_parent_lock on public.external_command_outbox;
drop function if exists public.lock_procurement_outbox_parent();
drop function if exists public.insert_procurement_outbox_pending(uuid,text,text,text,text,jsonb,text,uuid,uuid,jsonb);
drop function if exists public.procurement_item_values_editable(uuid);
drop trigger if exists procurement_items_zzz_parent_lock on public.procurement_items;
drop function if exists public.lock_procurement_item_parent();
create or replace function public.procurement_items_native_mirror_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then return new; end if;
  if new.quantity is distinct from old.quantity or new.rate is distinct from old.rate
     or new.erp_line_amount is distinct from old.erp_line_amount
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified then
    raise exception 'procurement_items native fields are read-only while procurement is externally-owned' using errcode = '42501';
  end if;
  return new;
end; $$;
drop function if exists public.procurement_case_has_external_evidence(uuid, uuid);
drop index if exists public.external_command_outbox_procurement_case_idx;
drop function if exists public.procurement_case_uuid(text);
alter table public.external_command_outbox drop column if exists procurement_input_digest;
drop function if exists public.update_procurement_header(uuid,jsonb);
