-- rollback of 2050_plain_medical_notice_owner_only.sql: the 2043 and 2047 bodies.
CREATE OR REPLACE FUNCTION public.run_document_expiry_warnings(p_today date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d record; r record; v_sent integer := 0; v_thr integer; v_left integer; v_today date;
  v_subject text; v_inserted integer; v_plain boolean;
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
      v_plain := d.t_medical and r.id is distinct from d.person_profile_id and not public.may_see_medical_documents(r.id);
      perform public.notify_workflow_user(d.org_id, r.id,
        d.type_name || ' expires in ' || v_left || (case when v_left = 1 then ' day' else ' days' end),
        v_subject || ' — ' || d.type_name || ' expires ' || to_char(d.expires_on, 'FMDD Mon YYYY') || '.',
        case when v_thr <= 7 then 'critical' when v_thr <= 14 then 'warning' else 'info' end,
        case when v_plain then null else 'expiry_document' end, case when v_plain then null else d.id end,  -- mut:rr_medical_plain
        v_subject || ' — ' || d.type_name, 'document_expiry');
      v_sent := v_sent + 1;
    end loop;
  end loop;
  insert into public.ops_job_heartbeats (job_name, last_run_at, last_detail)
    values ('document-expiry-warnings', now(), jsonb_build_object('sent', v_sent))
    on conflict (job_name) do update set last_run_at = excluded.last_run_at, last_detail = excluded.last_detail;
  return v_sent;
end $function$
;

CREATE OR REPLACE FUNCTION public.enqueue_notification_email(p_notification uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n record; s record; v_rows integer;
begin
  select * into n from public.notifications where id = p_notification;
  if not found or n.metadata->>'email_event' is null then return 0; end if;
  select * into s from public.email_event_settings where org_id = n.org_id and event_key = n.metadata->>'email_event';
  if not found or not s.enabled then return 0; end if;
  insert into public.email_outbox (org_id, notification_id, recipient_id, event_key)
  select n.org_id, n.id, p.id, s.event_key
    from public.profiles p
   where p.org_id = n.org_id
     and (p.id = n.owner_id or (p.role::text = any (s.extra_roles) and p.id is distinct from auth.uid()))
     and nullif(btrim(p.email), '') is not null
     and public.is_active_member(p.id)
     and not exists (select 1 from public.email_user_prefs u where u.user_id = p.id and u.opted_out)
     -- An extra-role copy passes the same visibility test the in-app notice applies to its addressee (1466):
     -- a notice naming a medical expiry document goes only to a recipient who may see medical documents (1535's one rule),
     -- and a notice naming a categorised register document only to a role that may view its category (1168's rule).
     and (p.id = n.owner_id
          or n.metadata->'entity'->>'type' is distinct from 'expiry_document'
          or not exists (select 1 from public.expiry_documents x
                          where x.id::text = n.metadata->'entity'->>'id' and x.org_id = n.org_id and x.is_medical)
          or public.may_see_medical_documents(p.id))
     and (p.id = n.owner_id
          or n.metadata->'entity'->>'type' is distinct from 'project_document'
          or exists (select 1 from public.project_documents d
                      join public.document_category_roles r
                        on r.category_id = d.category_id and r.org_id = d.org_id and r.role = p.role
                      join public.document_categories c on c.id = d.category_id
                     where d.id::text = n.metadata->'entity'->>'id' and d.org_id = n.org_id
                       and not coalesce(p.built_in_role = any (c.hidden_job_roles), false)))
     -- A work-order billing step notice goes to an extra-role copy only if that recipient may see billing steps (the one gate) and no step
     -- of that work order that is open now is hidden from their role (1775): the notice must not reach a role the step is kept from.
     and (p.id = n.owner_id
          or n.metadata->>'email_event' is distinct from 'billing_step'
          or n.metadata->'entity'->>'type' is distinct from 'work_order'
          or (public.may_see_billing_steps(p.id)
              and not exists (select 1 from public.work_order_billing_steps st
                               where st.work_order_id::text = n.metadata->'entity'->>'id' and st.org_id = n.org_id
                                 and st.started_on is not null and st.done_on is null and st.skipped_on is null
                                 and coalesce(p.built_in_role = any (st.hidden_from_role_keys), false))))
  on conflict (notification_id, recipient_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end; $function$
;
