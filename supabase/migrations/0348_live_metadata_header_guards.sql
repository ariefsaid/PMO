-- Enforce the existing author/admin and requester/admin edit rules at the database boundary.
create or replace function public.guard_project_document_metadata_author() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() then return new; end if;
  if (new.title is distinct from old.title
      or new.category is distinct from old.category
      or new.code is distinct from old.code
      or new.doc_date is distinct from old.doc_date
      or new.revision is distinct from old.revision
      or new.project_id is distinct from old.project_id)
     and old.author_id is distinct from auth.uid()
     and public.auth_role() is distinct from 'Admin' then
    raise exception 'Document metadata edit is not permitted.' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.guard_project_document_metadata_author() from public, anon, authenticated;
drop trigger if exists project_document_metadata_author_guard on public.project_documents;
create trigger project_document_metadata_author_guard
  before update of title, category, code, doc_date, revision, project_id on public.project_documents
  for each row execute function public.guard_project_document_metadata_author();

create or replace function public.assert_procurement_routing_inputs_frozen() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() then return new; end if;
  -- Header edits are allowed only to the requester or Admin while Draft/Rejected.
  -- Filling a missing vendor remains a set-once operation in any state.
  if (new.title is distinct from old.title or new.code is distinct from old.code
      or (old.status in ('Draft','Rejected') and
          (new.project_id is distinct from old.project_id
           or new.budget_category is distinct from old.budget_category))
      or (old.vendor_id is not null and new.vendor_id is distinct from old.vendor_id)) then
    if old.requested_by_id is distinct from auth.uid() and public.auth_role() is distinct from 'Admin' then
      raise exception 'Procurement header edit is not permitted.' using errcode = '42501';
    end if;
    if old.status not in ('Draft','Rejected') then
      raise exception 'Procurement header is not editable in this state.' using errcode = '42501';
    end if;
  end if;
  if old.status in ('Draft','Rejected') then return new; end if;
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
-- Prevent client backdating/identity replacement; no client writer updates these columns.
revoke update (id, created_at) on public.project_documents from authenticated;
revoke update (id, created_at) on public.procurements from authenticated;

