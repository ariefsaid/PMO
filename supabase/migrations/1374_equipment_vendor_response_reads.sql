-- 1374_equipment_vendor_response_reads.sql — #2702: breakdowns with their vendor and recorded response (FR-EVR-006/007/008).
-- One row per breakdown (derived downtime period) starting in [p_from, p_to]; the per-vendor summary is the pure
-- function pmo-portal/src/lib/vendorResponse.ts over these rows. Bounded as equipment_metrics (NFR-EVR-001).
-- Reverse: rollback/1374_equipment_vendor_response_reads_down.sql
create function public.list_equipment_breakdowns(p_asset_ids uuid[], p_from date, p_to date)
returns table (asset_id uuid, period_start date, period_end date, vendor_id uuid, reported_at timestamptz,
               responded_at timestamptz, response_minutes bigint, note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_org uuid := public.auth_org_id(); v_tz text;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Project Manager','Finance','Executive','Engineer') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then
    raise exception 'the period is invalid or too long' using errcode = '22023';
  end if;
  if p_asset_ids is null or cardinality(p_asset_ids) = 0 or cardinality(p_asset_ids) > 200 then
    raise exception 'between 1 and 200 assets' using errcode = '22023';
  end if;
  select coalesce(o.default_timezone, 'UTC') into v_tz from public.organizations o where o.id = v_org;
  return query
  select b.aid, b.ps, b.pe, coalesce(r.vendor_id, public.equipment_vendor_on(v_org, b.aid, b.ps)),
         coalesce(r.reported_at, (b.ps::timestamp) at time zone v_tz), r.responded_at,
         case when r.id is not null then floor(extract(epoch from (r.responded_at - r.reported_at)) / 60)::bigint end, r.note
    from (
      select a.id as aid, d.period_start as ps, max(d.period_end) as pe
        from public.equipment_assets a
        cross join lateral public.equipment_downtime_days(v_org, a.id, date '0001-01-01', date '9999-12-31') d
       where a.org_id = v_org and a.id = any (p_asset_ids)
       group by a.id, d.period_start
    ) b
    left join public.equipment_vendor_responses r on r.asset_id = b.aid and r.period_start = b.ps and r.org_id = v_org
   where b.ps between p_from and p_to
   order by b.ps, b.aid;
end $$;
alter function public.list_equipment_breakdowns(uuid[], date, date) owner to postgres;
revoke all on function public.list_equipment_breakdowns(uuid[], date, date) from public, anon, authenticated;
grant execute on function public.list_equipment_breakdowns(uuid[], date, date) to authenticated;
