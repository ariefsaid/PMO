-- 1536: who reads, adds and renews every person's non-medical documents (and reads the person list to reach them) is decided
-- by one rule: the people_documents_view capability, through actor_has_person_documents_access().
-- drops: expiry_document_object_writable replaces the person Admin-only expression with Admin or the people-documents capability.
-- Rollback: supabase/migrations/rollback/1536_people_documents_capability_gate_down.sql
-- Medical documents stay with 1535's rule and Admin only for writes. Bodies restated: people_select, expiry_documents_insert and
-- expiry_documents_update from 0970 (the only migration that defines them; 1035 changed the people insert/update policies only);
-- expiry_documents_select from 1535 (the latest); expiry_document_object_writable/readable from 1039 (the only migration that defines them).

create function public.actor_has_person_documents_access() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select public.actor_has_role_capability('people_documents_view')
$$;
revoke all on function public.actor_has_person_documents_access() from public, anon;
grant execute on function public.actor_has_person_documents_access() to authenticated, service_role;

-- people: planners read all; a manager reads their reports; a linked person reads themself; a holder of the capability reads all.
alter policy people_select on public.people using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) in ('Admin','Project Manager','Finance','Executive') or manager_id = (select auth.uid()) or profile_id = (select auth.uid())
       or (select public.actor_has_person_documents_access())));

alter policy expiry_documents_select on public.expiry_documents using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) = 'Admin'
       or (subject_kind = 'equipment' and (select public.auth_role()) = 'Project Manager')
       or (not is_medical and person_id is not null and exists
           (select 1 from public.people p where p.id = person_id and p.manager_id = (select auth.uid())))
       or (not is_medical and subject_kind = 'person' and (select public.actor_has_person_documents_access()))
       or (is_medical and (select public.actor_may_see_medical_documents()))));

-- Admin keeps every document; a Project Manager keeps equipment documents; a holder of the capability keeps non-medical person documents.
alter policy expiry_documents_insert on public.expiry_documents with check (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) = 'Admin'
       or ((select public.auth_role()) = 'Project Manager' and subject_kind = 'equipment')
       or (subject_kind = 'person' and not is_medical and (select public.actor_has_person_documents_access()))));
alter policy expiry_documents_update on public.expiry_documents using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) = 'Admin'
       or ((select public.auth_role()) = 'Project Manager' and subject_kind = 'equipment')
       or (subject_kind = 'person' and not is_medical and (select public.actor_has_person_documents_access()))));

create or replace function public.expiry_document_object_writable(p_name text) returns boolean
  language sql stable security invoker set search_path = public, pg_temp as $$
  select split_part(p_name, '/', 1) = public.auth_org_id()::text
     and array_length(string_to_array(p_name, '/'), 1) = 5
     and public.is_active_member()
     and case split_part(p_name, '/', 2)
           when 'equipment' then public.auth_role() in ('Admin', 'Project Manager')
             and exists (select 1 from public.equipment_assets a where a.id::text = split_part(p_name, '/', 3) and a.org_id = public.auth_org_id())
           when 'person' then (public.auth_role() = 'Admin' or public.actor_has_person_documents_access())
             and exists (select 1 from public.people p where p.id::text = split_part(p_name, '/', 3) and p.org_id = public.auth_org_id())
           else false end;
$$;
create or replace function public.expiry_document_object_readable(p_name text) returns boolean
  language sql stable security invoker set search_path = public, pg_temp as $$
  select public.expiry_document_object_writable(p_name)
      or (split_part(p_name, '/', 1) = public.auth_org_id()::text
          and array_length(string_to_array(p_name, '/'), 1) = 5
          and public.is_active_member()
          and split_part(p_name, '/', 2) = 'person'
          and exists (select 1 from public.people p where p.id::text = split_part(p_name, '/', 3)
                        and p.org_id = public.auth_org_id() and p.manager_id = auth.uid()));
$$;
