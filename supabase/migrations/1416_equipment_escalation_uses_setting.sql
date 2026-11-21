-- 1416_equipment_escalation_uses_setting.sql — #2701 FR-ETS-004/005: the escalation rule reads the organisation's limit
-- (organizations.equipment_escalation_down_days, default 2) instead of the constant 2 that 1033 wrote. Same signatures,
-- owners and grants as 1033. At the default the flags, the notices and the notice title are unchanged.
-- Reverse: rollback/1416_equipment_escalation_uses_setting_down.sql

create or replace function public.equipment_downtime_escalations(p_org uuid, p_as_of date)
returns table (asset_id uuid, period_start date, down_days int)
language sql stable set search_path = public, pg_temp as $$
  with recorded as (
    select a.id, d.status_date, d.period_start,
           d.status_date - row_number() over (partition by a.id, d.period_start order by d.status_date)::int as streak
      from public.equipment_assets a
      cross join lateral public.equipment_downtime_days(p_org, a.id, date '0001-01-01', p_as_of) d
     where a.org_id = p_org and a.archived_at is null and d.period_end is null
  )
  select id, period_start, count(*)::int from recorded
   group by id, period_start, streak
  having count(*) > (select o.equipment_escalation_down_days from public.organizations o where o.id = p_org)
     and max(status_date) >= p_as_of - 1
$$;

create or replace function public.run_equipment_downtime_escalations(p_as_of date default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org record; v_e record; v_today date; v_r record; v_n int := 0; v_ins int; v_label text;
begin
  for v_org in select o.id, o.equipment_escalation_down_days as lim from public.organizations o loop
    v_today := coalesce(p_as_of, public.equipment_org_today(v_org.id));
    for v_e in select * from public.equipment_downtime_escalations(v_org.id, v_today) loop
      insert into public.equipment_escalation_log (org_id, asset_id, period_start, sent_on, down_days)
      values (v_org.id, v_e.asset_id, v_e.period_start, v_today, v_e.down_days) on conflict do nothing;
      get diagnostics v_ins = row_count;
      if v_ins = 0 then continue; end if;
      select a.code || ' ' || a.name into v_label from public.equipment_assets a where a.id = v_e.asset_id;
      for v_r in select p.id from public.profiles p where p.org_id = v_org.id and p.role in ('Admin','Project Manager') loop
        perform public.notify_workflow_user(v_org.id, v_r.id, 'Equipment down more than ' || v_org.lim::text || ' days',
          v_label || ': down since ' || v_e.period_start::text, 'warning', 'equipment_asset', v_e.asset_id, v_label);
      end loop;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;
