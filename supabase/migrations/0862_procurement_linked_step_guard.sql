-- The linked document state is shared by the outbox and the dispatch boundary.
create function public.linked_step_state(p_org_id uuid, p_procurement_id uuid, p_step text)
returns text language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_doctype text;
begin
  if not exists (select 1 from public.procurements where id = p_procurement_id and org_id = p_org_id) then
    raise exception 'purchase not found' using errcode = '42501';
  end if;
  v_doctype := case p_step when 'goods-receipt' then 'Purchase Receipt' when 'purchase-invoice' then 'Purchase Invoice' else null end;
  if v_doctype is null then return 'not_applicable'; end if;
  if exists (select 1 from public.procurement_erp_links l join public.erp_purchase_documents d
      on d.id = l.erp_purchase_document_id and d.org_id = l.org_id
      where l.org_id = p_org_id and l.procurement_id = p_procurement_id and d.erp_doctype = v_doctype) then
    return 'already_in_erp';
  end if;
  if exists (select 1 from public.procurement_erp_links l where l.org_id = p_org_id and l.procurement_id = p_procurement_id) then
    return 'new_step';
  end if;
  return 'not_applicable';
end $$;
revoke all on function public.linked_step_state(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.linked_step_state(uuid,uuid,text) to service_role;

create function public.guard_linked_procurement_step() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_case uuid;
begin
  if new.domain = 'procurement' and new.operation = 'create'
     and new.payload->>'erp_doc_kind' in ('goods-receipt','purchase-invoice') then
    v_case := public.procurement_case_uuid(new.payload->>'procurementId');
    perform 1 from public.procurements where id = v_case and org_id = new.org_id for update;
    if public.linked_step_state(new.org_id, v_case, new.payload->>'erp_doc_kind') = 'already_in_erp' then
      raise exception 'step_already_recorded' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_linked_procurement_step() from public, anon, authenticated;
create trigger external_command_outbox_linked_step before insert on public.external_command_outbox
for each row execute function public.guard_linked_procurement_step();
