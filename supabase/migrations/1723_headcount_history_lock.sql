-- 1723_headcount_history_lock.sql — the history lock knows head counts (docs/specs/guard-headcount.spec.md FR-HC-007).
--   labour_class_locked restated from the database at head (1720): a class rate or class change that would re-price an
--   approved head-count line on/after the date is refused, as for a costed attendance day, whatever the switch says.
--   Kind 'rate' = that rate prices the line; 'class' = the line's class; 'assignment' and 'worker' never touch a head
--   count (it names a class, not a person). An unknown kind still locks (fail closed).
-- drops: none (the attendance arm is kept verbatim; the head-count arm is added)
-- Proven by supabase/tests/1722_headcount_cost.test.sql. Reverse: rollback/1723_headcount_history_lock_down.sql.

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
  ) or exists (
    select 1 from public.headcount_days h
     cross join lateral public.labour_class_rate_for(p_org, h.class_id, h.work_date) r
     where h.org_id = p_org and h.approved_at is not null and h.work_date >= p_from
       and case p_kind when 'rate' then r.id = p_id
                       when 'class' then h.class_id = p_id
                       when 'assignment' then false
                       when 'worker' then false
                       else true end
  )
$$;
revoke all on function public.labour_class_locked(uuid, text, uuid, date) from public, anon, authenticated;
