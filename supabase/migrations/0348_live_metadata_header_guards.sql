-- Enforce the existing author/admin and requester/admin edit rules at the database boundary.
create or replace function public.guard_project_document_metadata_author() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() or auth.uid() is null then return new; end if;
  if (new.title is distinct from old.title
      or new.category is distinct from old.category
      or new.code is distinct from old.code
      or new.doc_date is distinct from old.doc_date
      or new.revision is distinct from old.revision)
     and old.author_id is distinct from auth.uid()
     and public.auth_role() is distinct from 'Admin' then
    raise exception 'Document metadata edit is not permitted.' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.guard_project_document_metadata_author() from public, anon, authenticated;
drop trigger if exists project_document_metadata_author_guard on public.project_documents;
create trigger project_document_metadata_author_guard
  before update of title, category, code, doc_date, revision on public.project_documents
  for each row execute function public.guard_project_document_metadata_author();

create or replace function public.assert_procurement_routing_inputs_frozen() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() then return new; end if;
  if auth.uid() is not null then
    if (new.title is distinct from old.title or new.code is distinct from old.code
        or new.vendor_id is distinct from old.vendor_id) then
      if old.status not in ('Draft','Rejected') then
        raise exception 'Procurement header is not editable in this state.' using errcode = '42501';
      end if;
      if old.requested_by_id is distinct from auth.uid() and public.auth_role() is distinct from 'Admin' then
        raise exception 'Procurement header edit is not permitted.' using errcode = '42501';
      end if;
    end if;
  end if;
  if old.status in ('Draft','Rejected') then return new; end if;
  if new.project_id is distinct from old.project_id then
    raise exception 'Procurement routing inputs are frozen.' using errcode = '42501';
  end if;
  if new.budget_category is distinct from old.budget_category then
    raise exception 'Procurement routing inputs are frozen.' using errcode = '42501';
  end if;
  if new.total_value is distinct from old.total_value then
    raise exception 'Procurement routing inputs are frozen.' using errcode = '42501';
  end if;
  if new.currency is distinct from old.currency then
    raise exception 'Procurement routing inputs are frozen.' using errcode = '42501';
  end if;
  return new;
end; $$;
-- Existing trigger is retained and invokes the replaced function.
