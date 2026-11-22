-- 1844_expiry_person_files_align_medical.sql — align the people-documents right with the medical rule on stored files.
-- The people-documents right (1536) reads, adds and renews a person's NON-medical documents; medical documents stay Admin-only
-- for writes (1535/1536). The stored-file write helper now says the same: for anyone who is not an Admin, the person branch
-- refuses an object that a medical document names. Today a medical document holds no file (the 0970 shape constraint), so this
-- keeps the storage rule in step with the row rule should that ever change. Proven by supabase/tests/roles_that_decide_medical_files.test.sql.
-- Rollback: supabase/migrations/rollback/1844_expiry_person_files_align_medical_down.sql
-- Body restated from the live definition (1536, the latest): only the person branch gains the medical test.
-- drops: expiry_document_object_writable's person branch "(Admin or people-documents right)" line — now Admin, or the right on an
--        object no medical document names.

-- The medical test reads expiry_documents past its row policy (a people-documents holder without the medical right cannot see a
-- medical row), so it is a definer; it answers only for the caller's own organisation and writes nothing.
create function public.expiry_document_object_is_medical(p_name text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.expiry_documents x
                  where x.org_id = public.auth_org_id() and x.attachment_path = p_name and x.is_medical)
$$;
revoke all on function public.expiry_document_object_is_medical(text) from public, anon;
grant execute on function public.expiry_document_object_is_medical(text) to authenticated, service_role;

create or replace function public.expiry_document_object_writable(p_name text) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select split_part(p_name, '/', 1) = public.auth_org_id()::text
     and array_length(string_to_array(p_name, '/'), 1) = 5
     and public.is_active_member()
     and case split_part(p_name, '/', 2)
           when 'equipment' then public.auth_role() in ('Admin', 'Project Manager')
             and exists (select 1 from public.equipment_assets a where a.id::text = split_part(p_name, '/', 3) and a.org_id = public.auth_org_id())
           when 'person' then (public.auth_role() = 'Admin'
                               or (public.actor_has_person_documents_access()
                                   and not public.expiry_document_object_is_medical(p_name)))          -- mut:medical_object
             and exists (select 1 from public.people p where p.id::text = split_part(p_name, '/', 3) and p.org_id = public.auth_org_id())
           else false end;
$$;
