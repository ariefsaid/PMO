-- Reverses 1844: the 1536 body of expiry_document_object_writable (taken from the live definition), then drops the helper.
CREATE OR REPLACE FUNCTION public.expiry_document_object_writable(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select split_part(p_name, '/', 1) = public.auth_org_id()::text
     and array_length(string_to_array(p_name, '/'), 1) = 5
     and public.is_active_member()
     and case split_part(p_name, '/', 2)
           when 'equipment' then public.auth_role() in ('Admin', 'Project Manager')
             and exists (select 1 from public.equipment_assets a where a.id::text = split_part(p_name, '/', 3) and a.org_id = public.auth_org_id())
           when 'person' then (public.auth_role() = 'Admin' or public.actor_has_person_documents_access())
             and exists (select 1 from public.people p where p.id::text = split_part(p_name, '/', 3) and p.org_id = public.auth_org_id())
           else false end;
$function$;

drop function public.expiry_document_object_is_medical(text);
