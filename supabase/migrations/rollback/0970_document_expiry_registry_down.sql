-- Reverse of 0970. Refuses if it would discard records.
do $$ begin
  if exists (select 1 from public.expiry_documents) or exists (select 1 from public.people) then
    raise exception '0970 rollback refused: expiry documents or people exist';
  end if;
end $$;
drop table if exists public.expiry_documents;
drop function if exists public.expiry_documents_guard();
drop table if exists public.document_types;
drop function if exists public.document_types_defaults();
drop table if exists public.people;
alter table public.organizations drop column if exists document_warning_days;
