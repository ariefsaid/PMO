-- 1761_record_document_renewal.sql — expiry-to-manager: the direct manager records the renewal (a later expiry date) for their own people only;
-- Admin keeps the existing write and may also use it. The worker is then told through notify_person (defined in 1750, shared with the medical release).
-- Only expires_on changes. Medical documents are Admin-only (a manager never sees their status). Reverse: rollback/1761_record_document_renewal_down.sql

create function public.record_document_renewal(p_document uuid, p_expires_on date) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare d record; v_uid uuid := auth.uid(); v_type text;
begin
  if v_uid is null or not public.is_active_member(v_uid) then
    raise exception 'DXR_NOT_FOUND: This document was not found.' using errcode = '42501';
  end if;
  select x.id, x.org_id, x.subject_kind, x.is_medical, x.expires_on, x.type_id, pe.id as person_id, pe.manager_id
    into d
    from public.expiry_documents x left join public.people pe on pe.id = x.person_id
   where x.id = p_document and x.org_id = public.auth_org_id() and x.archived_at is null
   for update of x;
  if not found then raise exception 'DXR_NOT_FOUND: This document was not found.' using errcode = '42501'; end if;
  if d.subject_kind <> 'person' then raise exception 'DXR_PERSON_ONLY: Only a person''s document can be renewed here.' using errcode = '22023'; end if;
  if public.auth_role()::text <> 'Admin' then
    if d.is_medical then raise exception 'DXR_MEDICAL_ADMIN: Only an Admin records a medical renewal.' using errcode = '42501'; end if;
    if d.manager_id is distinct from v_uid then raise exception 'DXR_NOT_YOUR_PERSON: You can record renewals only for the people you manage.' using errcode = '42501'; end if;
  end if;
  if p_expires_on is null or p_expires_on <= d.expires_on then
    raise exception 'DXR_DATE_NOT_LATER: The new expiry date must be later than the current one.' using errcode = '22023';
  end if;
  update public.expiry_documents set expires_on = p_expires_on where id = d.id;
  select t.name into v_type from public.document_types t where t.id = d.type_id;
  perform public.notify_person(d.person_id, 'document_renewed', v_type || ' renewed',
    v_type || ' renewed: now valid until ' || to_char(p_expires_on, 'FMDD Mon YYYY') || '.', '/equipment/people/' || d.person_id);
end $$;
revoke all on function public.record_document_renewal(uuid, date) from public, anon;
grant execute on function public.record_document_renewal(uuid, date) to authenticated;
