-- Reverse of 1724: end_labour_cost_rate returns to its 1720 body (attendance arm only).
create or replace FUNCTION public.end_labour_cost_rate(p_id uuid, p_end date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid := public.labour_cost_gate(); r public.labour_cost_rates;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into r from public.labour_cost_rates where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'rate not found' using errcode = 'P0002'; end if;
  if p_end is null or p_end < r.effective_from then raise exception 'end date is before the start date' using errcode = '22023'; end if;
  if p_end > coalesce(r.effective_to, p_end) then
    -- Moving the end later adds a span: no approved hour inside it may already be priced.
    if exists (
      select 1 from public.timesheet_entries e
        join public.timesheets t on t.id = e.timesheet_id
       where e.org_id = v_org and t.org_id = v_org and t.status = 'Approved' and e.hours > 0
         and e.entry_date > r.effective_to and e.entry_date <= p_end
         and ((r.subject_kind = 'person' and t.user_id = r.person_id)
              or (r.subject_kind = 'role' and exists (select 1 from public.profiles pr
                   where pr.id = t.user_id and pr.org_id = v_org and pr.role::text = r.role_key)))
         and exists (select 1 from public.labour_rate_for(v_org, t.user_id, e.entry_date) x where x.id <> r.id)
    ) or (r.subject_kind = 'class' and exists (
      select 1 from public.labour_cost_attendance_days d
       cross join lateral public.labour_attendance_priced_by(v_org, d.worker_id, d.work_date) x
       where d.org_id = v_org and d.work_date > r.effective_to and d.work_date <= p_end
         and x.class_id = r.class_id and x.rate_id <> r.id
    )) then
      raise exception 'LCM_RATE_LOCKED: hours in the added span are already priced' using errcode = '23514';
    end if;
  end if;
  if public.labour_rate_locked(v_org, p_id, null, null, null, p_end + 1)
     or public.labour_class_locked(v_org, 'rate', p_id, p_end + 1) then
    raise exception 'LCM_RATE_LOCKED: hours after that date are already priced by this rate' using errcode = '23514';
  end if;
  update public.labour_cost_rates set effective_to = p_end where id = p_id;
  perform public.log_audit('labour_cost_rate.end', v_org, auth.uid(), p_id,
                           jsonb_build_object('effective_to', p_end, 'previous_effective_to', r.effective_to));
end $function$;
revoke all on function public.end_labour_cost_rate(uuid, date) from public, anon;
grant execute on function public.end_labour_cost_rate(uuid, date) to authenticated;
