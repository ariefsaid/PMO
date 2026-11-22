-- rollback/1536: restore the 1535 expiry_documents_select, the 0970 people_select and expiry_documents write policies, the
-- 1039 storage helpers, then drop the gate.
alter policy people_select on public.people using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) in ('Admin','Project Manager','Finance','Executive') or manager_id = (select auth.uid()) or profile_id = (select auth.uid())));

alter policy expiry_documents_select on public.expiry_documents using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) = 'Admin'
       or (subject_kind = 'equipment' and (select public.auth_role()) = 'Project Manager')
       or (not is_medical and person_id is not null and exists
           (select 1 from public.people p where p.id = person_id and p.manager_id = (select auth.uid())))
       or (is_medical and (select public.actor_may_see_medical_documents()))));

alter policy expiry_documents_insert on public.expiry_documents with check (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) = 'Admin' or ((select public.auth_role()) = 'Project Manager' and subject_kind = 'equipment')));
alter policy expiry_documents_update on public.expiry_documents using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) = 'Admin' or ((select public.auth_role()) = 'Project Manager' and subject_kind = 'equipment')));

create or replace function public.expiry_document_object_writable(p_name text) returns boolean
  language sql stable security invoker set search_path = public, pg_temp as $$
  select split_part(p_name, '/', 1) = public.auth_org_id()::text
     and array_length(string_to_array(p_name, '/'), 1) = 5
     and public.is_active_member()
     and case split_part(p_name, '/', 2)
           when 'equipment' then public.auth_role() in ('Admin', 'Project Manager')
             and exists (select 1 from public.equipment_assets a where a.id::text = split_part(p_name, '/', 3) and a.org_id = public.auth_org_id())
           when 'person' then public.auth_role() = 'Admin'
             and exists (select 1 from public.people p where p.id::text = split_part(p_name, '/', 3) and p.org_id = public.auth_org_id())
           else false end;
$$;

drop function if exists public.actor_has_person_documents_access();
