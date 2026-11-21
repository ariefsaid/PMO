-- 1373_equipment_vendor_response_rpc.sql — #2702: record / clear a vendor response (FR-EVR-001..005, 008).
-- Gate = equipment_can_set_status (Admin, Project Manager, Engineer). The server stamps recorder and time.
-- Reverse: rollback/1373_equipment_vendor_response_rpc_down.sql

-- The vendor is the company on the rental term in effect on the breakdown's first day (internal; invoker callers are definers).
create function public.equipment_vendor_on(p_org uuid, p_asset uuid, p_on date) returns uuid
language sql stable set search_path = public, pg_temp as $$
  select t.vendor_id from public.equipment_rental_terms t
   where t.org_id = p_org and t.asset_id = p_asset and t.rented_from <= p_on and coalesce(t.rented_to, 'infinity'::date) >= p_on
   order by t.rented_from desc limit 1
$$;
revoke all on function public.equipment_vendor_on(uuid, uuid, date) from public, anon, authenticated;

create function public.record_equipment_vendor_response(
  p_asset uuid, p_period_start date, p_responded_at timestamptz, p_reported_at timestamptz default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_tz text; v_first timestamptz; v_reported timestamptz; v_vendor uuid; v_id uuid;
begin
  perform public.assert_is_active_member();
  if not public.equipment_can_set_status(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_asset is null or p_period_start is null or p_responded_at is null then
    raise exception 'asset, breakdown start and response time are required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.equipment_assets a where a.id = p_asset and a.org_id = v_org) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  -- the breakdown must exist: a derived downtime period starting on exactly this date
  if not exists (select 1 from public.equipment_downtime_days(v_org, p_asset, p_period_start, p_period_start) d where d.period_start = p_period_start) then
    raise exception 'no breakdown starts on that date' using errcode = '22023';
  end if;
  v_vendor := public.equipment_vendor_on(v_org, p_asset, p_period_start);
  if v_vendor is null then raise exception 'the breakdown has no rental vendor' using errcode = '22023'; end if;
  select coalesce(o.default_timezone, 'UTC') into v_tz from public.organizations o where o.id = v_org;
  v_first := (p_period_start::timestamp) at time zone v_tz;
  v_reported := coalesce(p_reported_at, v_first);
  if v_reported < v_first then raise exception 'reported time precedes the breakdown' using errcode = '22023'; end if;
  if p_responded_at < v_reported then raise exception 'the response cannot precede the report' using errcode = '22023'; end if;
  if p_responded_at > now() then raise exception 'the response cannot be in the future' using errcode = '22023'; end if;
  insert into public.equipment_vendor_responses (org_id, asset_id, period_start, vendor_id, reported_at, responded_at, note)
  values (v_org, p_asset, p_period_start, v_vendor, v_reported, p_responded_at, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (asset_id, period_start) do update
    set vendor_id = excluded.vendor_id, reported_at = excluded.reported_at, responded_at = excluded.responded_at,
        note = excluded.note, recorded_by = auth.uid(), recorded_at = now()
  returning id into v_id;
  return v_id;
end $$;

create function public.clear_equipment_vendor_response(p_asset uuid, p_period_start date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if not public.equipment_can_set_status(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  delete from public.equipment_vendor_responses r
   where r.asset_id = p_asset and r.period_start = p_period_start and r.org_id = public.auth_org_id();
end $$;

alter function public.record_equipment_vendor_response(uuid, date, timestamptz, timestamptz, text) owner to postgres;
alter function public.clear_equipment_vendor_response(uuid, date) owner to postgres;
revoke all on function public.record_equipment_vendor_response(uuid, date, timestamptz, timestamptz, text),
  public.clear_equipment_vendor_response(uuid, date) from public, anon, authenticated;
grant execute on function public.record_equipment_vendor_response(uuid, date, timestamptz, timestamptz, text),
  public.clear_equipment_vendor_response(uuid, date) to authenticated;
