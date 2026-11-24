-- HR Officer and HR Manager maintain medical person status/date records.
-- Restated write policies from 1536; visibility, medical shape, notices and storage rules stay in force.
-- Rollback: rollback/2360_hr_medical_document_writers_down.sql
alter policy expiry_documents_insert on public.expiry_documents with check (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) = 'Admin'
       or ((select public.auth_role()) = 'Project Manager' and subject_kind = 'equipment')
       or (subject_kind = 'person' and ((not is_medical and (select public.actor_has_person_documents_access()))
         or (is_medical and ((select public.actor_holds_job_role('hr_officer')) or (select public.actor_holds_job_role('hr_manager'))))) /* mut:hr_medical_write */)));
alter policy expiry_documents_update on public.expiry_documents using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) = 'Admin'
       or ((select public.auth_role()) = 'Project Manager' and subject_kind = 'equipment')
       or (subject_kind = 'person' and ((not is_medical and (select public.actor_has_person_documents_access()))
         or (is_medical and ((select public.actor_holds_job_role('hr_officer')) or (select public.actor_holds_job_role('hr_manager'))))) /* mut:hr_medical_write */)));
