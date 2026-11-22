-- 1630_loan_needs_scheduled_host.sql — a lent worker is never lost: a loan moves the worker to the host crew only on
-- days the host crew is on a work order. On any other loan day the worker stays in the home crew, so on every day the
-- worker is in exactly one roster (the home crew's, or the scheduled host crew's). Copy of the 1246 definition (the only
-- one); the loan branch gains the "host crew is rostered that day" test. With no loans, or loans into scheduled crews,
-- the output is identical to 1246.
-- Proven by supabase/tests/1630_loan_one_roster.test.sql. Reverse: supabase/migrations/rollback/1630_loan_needs_scheduled_host_down.sql
create or replace function public.worker_effective_crew(p_worker_id uuid, p_date date)
  returns uuid language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(
    (select l.host_crew_id from public.crew_loans l
      where l.worker_id = p_worker_id and p_date between l.valid_from and l.valid_to
        and exists (select 1 from public.work_order_crews r
                     where r.crew_id = l.host_crew_id
                       and p_date between r.valid_from and coalesce(r.valid_to, 'infinity'::date))
      limit 1),
    (select m.crew_id from public.crew_members m
      where m.worker_id = p_worker_id
        and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
        and not exists (select 1 from public.crew_members n   -- a newer placement covering the day wins (host crew)
                         where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                           and p_date between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
      order by m.valid_from desc, m.id
      limit 1))
$$;
revoke all on function public.worker_effective_crew(uuid, date) from public, anon;
grant execute on function public.worker_effective_crew(uuid, date) to authenticated;
