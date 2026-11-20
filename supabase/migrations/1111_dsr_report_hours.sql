-- 1111_dsr_report_hours.sql — #2619: one org-scoped read for the hours shown on a site report (FR-DSR-006/007, FR-CRW-016).
-- The report page used to read timesheet lines and equipment usage under their own row rules, which hide other people's
-- rows from an Engineer, and never read attendance that has not become a timesheet line. This read returns the work
-- order's hours for the report's date from timesheet lines, attendance records and equipment usage. Read-only: it never
-- creates hours. An attendance record already turned into a timesheet line is counted once, through the line.
-- Reverse: rollback/1111_dsr_report_hours_down.sql.
create function public.dsr_report_hours(p_report uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.dsr_require_member();
  v_wo uuid; v_date date;
begin
  -- Same audience as the report itself (daily_site_reports_select): an active member of the report's organisation.
  select d.work_order_id, d.work_date into v_wo, v_date
    from public.daily_site_reports d where d.id = p_report and d.org_id = v_org;
  if v_wo is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'people_hours',
      coalesce((select sum(e.hours) from public.timesheet_entries e
                 where e.org_id = v_org and e.work_order_id = v_wo and e.entry_date = v_date), 0)
      + coalesce((select sum(a.hours + coalesce(a.overtime_hours, 0)) from public.attendance_days a
                   where a.org_id = v_org and a.work_order_id = v_wo and a.work_date = v_date
                     and a.status = 'present' and a.timesheet_entry_id is null), 0),
    'equipment',
      coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'asset_name', coalesce(s.name, ''), 'quantity', u.quantity,
                                                     'unit', u.unit, 'kind', u.kind, 'status', u.status) order by u.id)
                  from public.equipment_usage_entries u
                  left join public.equipment_assets s on s.id = u.asset_id and s.org_id = v_org
                 where u.org_id = v_org and u.work_order_id = v_wo and u.work_date = v_date and u.archived_at is null), '[]'::jsonb));
end $$;
revoke all on function public.dsr_report_hours(uuid) from public, anon;
grant execute on function public.dsr_report_hours(uuid) to authenticated;
