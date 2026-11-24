CREATE OR REPLACE FUNCTION public.run_document_expiry_warnings(p_today date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d record; r record; v_sent integer := 0; v_thr integer; v_left integer; v_today date;
  v_subject text; v_inserted integer; v_plain boolean; v_title text; v_body text; v_sev text;
begin
  for d in
    select x.*, t.name as type_name, t.notify_roles, t.notify_person, t.is_medical as t_medical, o.document_warning_days as days,
           o.default_timezone as tz, pe.name as person_name, pe.manager_id, pe.profile_id as person_profile_id, a.name as asset_name
      from public.expiry_documents x
      join public.document_types t on t.id = x.type_id
      join public.organizations o on o.id = x.org_id
      left join public.people pe on pe.id = x.person_id
      left join public.equipment_assets a on a.id = x.asset_id
     where x.archived_at is null and (pe.id is null or pe.archived_at is null) and (a.id is null or a.archived_at is null)
  loop
    v_today := coalesce(p_today, (now() at time zone coalesce(d.tz, 'UTC'))::date);
    v_left := d.expires_on - v_today;
    continue when v_left < 0;
    select min(z) into v_thr from unnest(d.days) z where z >= v_left;
    continue when v_thr is null;
    v_subject := coalesce(d.person_name, d.asset_name);
    for r in
      select distinct p.id from public.profiles p
       where p.org_id = d.org_id and public.is_active_member(p.id)
         and (p.id = d.manager_id or p.role::text = any (d.notify_roles) or (d.notify_person and p.id = d.person_profile_id))
         -- A medical document's notice goes to the person, the direct manager and those who may see medical documents (1535's one rule).
         and (not d.t_medical or p.id = d.person_profile_id or p.id = d.manager_id                         -- mut:rr_medical_manager
              or public.may_see_medical_documents(p.id))                                                    -- mut:medical
    loop
      insert into public.document_expiry_notices (document_id, expires_on, threshold, recipient_id, org_id)
        values (d.id, d.expires_on, v_thr, r.id, d.org_id) on conflict do nothing;
      get diagnostics v_inserted = row_count;
      continue when v_inserted = 0;
      -- A manager without the medical right is told who, which type and when, and nothing that opens the document.
      v_plain := d.t_medical and r.id is distinct from d.person_profile_id and not public.may_see_medical_documents(r.id);  -- mut:rr_medical_plain
      v_title := d.type_name || ' expires in ' || v_left || (case when v_left = 1 then ' day' else ' days' end);
      v_body := v_subject || ' — ' || d.type_name || ' expires ' || to_char(d.expires_on, 'FMDD Mon YYYY') || '.';
      v_sev := case when v_thr <= 7 then 'critical' when v_thr <= 14 then 'warning' else 'info' end;
      if v_plain then
        -- The plain notice is the manager's alone: it is marked so its email is never copied to the event's extra roles. The
        -- recipient loop above already holds it to this org's active members, and the scheduled run has no acting user.
        insert into public.notifications (org_id, owner_id, severity, title, body, metadata)
        values (d.org_id, r.id, v_sev, v_title, v_body,
                jsonb_build_object('entity', jsonb_build_object('type', null, 'id', null, 'label', v_subject || ' — ' || d.type_name),
                                   'email_event', 'document_expiry',
                                   'email_owner_only', true));                                               -- mut:rr_plain_marker
      else
        perform public.notify_workflow_user(d.org_id, r.id, v_title, v_body, v_sev, 'expiry_document', d.id,
          v_subject || ' — ' || d.type_name, 'document_expiry');
      end if;
      v_sent := v_sent + 1;
    end loop;
  end loop;
  insert into public.ops_job_heartbeats (job_name, last_run_at, last_detail)
    values ('document-expiry-warnings', now(), jsonb_build_object('sent', v_sent))
    on conflict (job_name) do update set last_run_at = excluded.last_run_at, last_detail = excluded.last_detail;
  return v_sent;
end $function$
;

