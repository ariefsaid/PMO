drop trigger if exists project_document_metadata_author_guard on public.project_documents;
drop function if exists public.guard_project_document_metadata_author();
grant update (id, created_at) on public.project_documents to authenticated;
grant update (id, created_at) on public.procurements to authenticated;
create or replace function public.assert_procurement_routing_inputs_frozen() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() or old.status in ('Draft','Rejected') then return new; end if;
  if new.project_id is distinct from old.project_id then
    raise exception 'procurements.project_id cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  if new.budget_category is distinct from old.budget_category then
    raise exception 'procurements.budget_category cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  if new.total_value is distinct from old.total_value
     and not (old.status = 'Vendor Quoted' and new.status = 'Quote Selected'
       and exists (select 1 from public.procurement_quotations q
                    where q.procurement_id = old.id and q.is_selected
                      and q.total_amount = new.total_value and q.vendor_id is not distinct from new.vendor_id)) then
    raise exception 'procurements.total_value cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  -- No client holds an UPDATE grant on currency today; this keeps the freeze if one is ever added.
  if new.currency is distinct from old.currency then
    raise exception 'procurements.currency cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  return new;
end; $$;
