-- Restore the 1536 write policies.
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
