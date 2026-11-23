-- Reverse of 1760. Types created with an explicit empty list since 1760 keep it; set them back to the kind default first if needed.
update public.document_types set notify_roles = case applies_to when 'person' then array['Admin'] else array['Admin','Project Manager'] end
  where cardinality(notify_roles) = 0;
revoke insert, update on public.document_types from authenticated;
grant insert (name, applies_to, is_medical, notify_roles) on public.document_types to authenticated;
grant update (name, notify_roles, archived_at) on public.document_types to authenticated;

create or replace function public.document_types_defaults() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(cardinality(new.notify_roles), 0) = 0 and tg_op = 'INSERT' then
    new.notify_roles := case new.applies_to when 'person' then array['Admin'] else array['Admin','Project Manager'] end;
  end if;
  return new;
end $$;

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
      perform public.notify_workflow_user(d.org_id, r.id,
        d.type_name || ' expires in ' || v_left || (case when v_left = 1 then ' day' else ' days' end),
        v_subject || ' — ' || d.type_name || ' expires ' || to_char(d.expires_on, 'FMDD Mon YYYY') || '.',
        case when v_thr <= 7 then 'critical' when v_thr <= 14 then 'warning' else 'info' end,
        'expiry_document', d.id, v_subject || ' — ' || d.type_name);
      v_sent := v_sent + 1;
    end loop;
  end loop;
  insert into public.ops_job_heartbeats (job_name, last_run_at, last_detail)
    values ('document-expiry-warnings', now(), jsonb_build_object('sent', v_sent))
    on conflict (job_name) do update set last_run_at = excluded.last_run_at, last_detail = excluded.last_detail;
  return v_sent;
end $$;

alter table public.document_types alter column notify_roles set default '{}';
alter table public.document_types drop column notify_person;
