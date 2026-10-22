drop trigger if exists project_document_metadata_author_guard on public.project_documents;
drop function if exists public.guard_project_document_metadata_author();
create or replace function public.assert_procurement_routing_inputs_frozen() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() or old.status in ('Draft','Rejected') then return new; end if;
  if new.project_id is distinct from old.project_id then raise exception 'procurements.project_id cannot change after the request is submitted' using errcode='42501'; end if;
  if new.budget_category is distinct from old.budget_category then raise exception 'procurements.budget_category cannot change after the request is submitted' using errcode='42501'; end if;
  if new.total_value is distinct from old.total_value then raise exception 'procurements.total_value cannot change after the request is submitted' using errcode='42501'; end if;
  if new.currency is distinct from old.currency then raise exception 'procurements.currency cannot change after the request is submitted' using errcode='42501'; end if;
  return new;
end; $$;
