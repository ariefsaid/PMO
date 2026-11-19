-- 0972_document_expiry_reads.sql — #2527: the expiry list and the per-org warning-days setting.
-- Reverse: rollback/0972_document_expiry_reads_down.sql

-- SECURITY INVOKER: RLS on expiry_documents/people decides what each caller sees (medical = Admin only).
create function public.list_expiring_documents(p_days integer default 30, p_today date default null)
  returns table (id uuid, subject_kind text, subject_id uuid, subject_name text, type_name text, is_medical boolean,
                 number text, expires_on date, days_left integer, medical_status text, location_note text)
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_today date;
begin
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'days must be between 1 and 365' using errcode = '22023';
  end if;
  select coalesce(p_today, (now() at time zone coalesce(o.default_timezone, 'UTC'))::date) into v_today
    from public.organizations o where o.id = public.auth_org_id();
  return query
    select x.id, x.subject_kind, coalesce(x.person_id, x.asset_id), coalesce(pe.name, a.name)::text, t.name::text, x.is_medical,
           x.number, x.expires_on, (x.expires_on - v_today)::integer, x.medical_status, x.location_note
      from public.expiry_documents x
      join public.document_types t on t.id = x.type_id
      left join public.people pe on pe.id = x.person_id
      left join public.equipment_assets a on a.id = x.asset_id
     where x.archived_at is null and x.org_id = public.auth_org_id() and x.expires_on <= v_today + p_days
     order by x.expires_on, 4
     limit 500;
end $$;
revoke all on function public.list_expiring_documents(integer, date) from public, anon;
grant execute on function public.list_expiring_documents(integer, date) to authenticated;

create function public.set_document_warning_days(p_days integer[]) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'admin only' using errcode = '42501'; end if;
  if p_days is null or cardinality(p_days) not between 1 and 5 or exists (select 1 from unnest(p_days) z where z is null or z not between 1 and 365) then
    raise exception 'warning days: 1 to 5 values, each 1 to 365' using errcode = '22023';
  end if;
  update public.organizations set document_warning_days = (select array_agg(distinct z order by z desc) from unnest(p_days) z)
   where id = public.auth_org_id();
end $$;
revoke all on function public.set_document_warning_days(integer[]) from public, anon;
grant execute on function public.set_document_warning_days(integer[]) to authenticated;
