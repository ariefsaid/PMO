-- 1246_worker_effective_crew.sql — #2704: the one definition of "which crew is this worker in on this date".
-- On a loan day the host crew; otherwise the placement (the newer placement wins the handover day, as in 1035/1036).
-- Readers (the roster 1247, attendance recording 1248) call it, so they cannot disagree.
-- security invoker: the caller's RLS decides what is visible; the definer attendance writer runs it as itself.
create function public.worker_effective_crew(p_worker_id uuid, p_date date)
  returns uuid language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(
    (select l.host_crew_id from public.crew_loans l
      where l.worker_id = p_worker_id and p_date between l.valid_from and l.valid_to
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
