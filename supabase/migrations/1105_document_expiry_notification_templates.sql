-- 1105_document_expiry_notification_templates.sql — #2616 (map #2516): expiry warnings carry a message key and parameters
-- (0971 wrote fixed English text with an English month) so the inbox renders them in the viewer's language and date format.
-- The guard from 1025 accepts the 'documentExpiry' key only from the expiry runner's own owner role; any other caller is stored
-- as a literal. Existing notifications keep their stored text. Reverse: rollback/1105_document_expiry_notification_templates_down.sql

create or replace function public.notifications_message_template_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_budget_owner name;
  v_expiry_owner name;
begin
  if tg_op = 'UPDATE' then
    if new.message_key is distinct from old.message_key or new.message_params is distinct from old.message_params then
      raise exception 'notification message is immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  select pg_get_userbyid(p.proowner) into v_budget_owner
    from pg_catalog.pg_proc p
   where p.oid = 'public.archive_budget_version_with_cancel_intent(uuid,boolean,uuid)'::regprocedure;

  select pg_get_userbyid(p.proowner) into v_expiry_owner
    from pg_catalog.pg_proc p
   where p.oid = 'public.run_document_expiry_warnings(date)'::regprocedure;

  if current_user = v_budget_owner
     and new.metadata->>'action_required' = 'budget-archive-live-erp'
     and new.body = 'ERPNext may still be enforcing a budget for this project after this archive. Cancel the listed ERPNext Budget documents, or activate a new PMO budget.' then
    new.message_key := 'budgetArchiveWarning';
    new.message_params := '{}'::jsonb;
  elsif current_user = v_expiry_owner
     and new.metadata->>'producer' = 'document-expiry'
     and new.message_key = 'documentExpiry'
     and jsonb_typeof(new.message_params) = 'object' then
    null;
  elsif current_user = 'service_role'
     and new.message_key in ('unassignedInvoice', 'budgetCancellationHeld', 'budgetRetryAuthorization', 'budgetPushFailed')
     and jsonb_typeof(new.message_params) = 'object' then
    null;
  else
    new.message_key := 'literal';
    new.message_params := jsonb_build_object('body', new.body);
  end if;
  return new;
end; $$;

create or replace function public.run_document_expiry_warnings(p_today date default null) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d record; r record; v_sent integer := 0; v_thr integer; v_left integer; v_today date;
  v_subject text; v_inserted integer;
begin
  for d in
    select x.*, t.name as type_name, t.notify_roles, t.is_medical as t_medical, o.document_warning_days as days,
           o.default_timezone as tz, pe.name as person_name, pe.manager_id, a.name as asset_name
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
         and (p.id = d.manager_id or p.role::text = any (d.notify_roles))
    loop
      insert into public.document_expiry_notices (document_id, expires_on, threshold, recipient_id, org_id)
        values (d.id, d.expires_on, v_thr, r.id, d.org_id) on conflict do nothing;
      get diagnostics v_inserted = row_count;
      continue when v_inserted = 0;
      -- Same recipient rules as notify_workflow_user (same org, active member, never the acting user), but the row carries
      -- a message key and parameters so the inbox renders it in the viewer's language. The stored title and body stay as the
      -- English fallback for readers that ignore the key. The document type and subject are user text: parameters only.
      continue when r.id is not distinct from auth.uid();
      insert into public.notifications (org_id, owner_id, severity, title, body, metadata, message_key, message_params)
      values (d.org_id, r.id,
        case when v_thr <= 7 then 'critical' when v_thr <= 14 then 'warning' else 'info' end,
        d.type_name || ' expires in ' || v_left || (case when v_left = 1 then ' day' else ' days' end),
        v_subject || ' — ' || d.type_name || ' expires ' || to_char(d.expires_on, 'FMDD Mon YYYY') || '.',
        jsonb_build_object('producer', 'document-expiry',
          'entity', jsonb_build_object('type', 'expiry_document', 'id', d.id, 'label', v_subject || ' — ' || d.type_name)),
        'documentExpiry',
        jsonb_build_object('type', d.type_name, 'subject', v_subject, 'days', v_left, 'expires_on', to_char(d.expires_on, 'YYYY-MM-DD')));
      v_sent := v_sent + 1;
    end loop;
  end loop;
  insert into public.ops_job_heartbeats (job_name, last_run_at, last_detail)
    values ('document-expiry-warnings', now(), jsonb_build_object('sent', v_sent))
    on conflict (job_name) do update set last_run_at = excluded.last_run_at, last_detail = excluded.last_detail;
  return v_sent;
end $$;
