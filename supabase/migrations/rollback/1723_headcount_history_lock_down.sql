-- Reverse of 1723_headcount_history_lock.sql: labour_class_locked returns to its 1720 body (attendance arm only).
create or replace function public.labour_class_locked(p_org uuid, p_kind text, p_id uuid, p_from date)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.labour_cost_attendance_days d
     cross join lateral public.labour_attendance_priced_by(p_org, d.worker_id, d.work_date) x
     where d.org_id = p_org and d.work_date >= p_from
       and case p_kind when 'rate' then x.rate_id = p_id
                       when 'assignment' then x.assignment_id = p_id
                       when 'worker' then d.worker_id = p_id
                       when 'class' then x.class_id = p_id
                       else true end
  )
$$;
revoke all on function public.labour_class_locked(uuid, text, uuid, date) from public, anon, authenticated;
