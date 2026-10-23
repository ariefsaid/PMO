-- 0358_sweep_full_run_and_expense_backoff.sql — two consequences of the one-minute sweep tick (0356).
--
-- 1. Per-org hourly marker. The sweep's inbound and statement work runs about once an hour per org.
--    Keying that on "UTC minute 0" lost a whole hour whenever the :00 tick could not take the org's lock
--    (an overlapping tick, or a killed worker's 15-minute lease). Instead each org records when its full
--    run last COMPLETED, and the next tick that holds the org's lock after ~55 minutes runs it again.
--    Only the current lock holder can stamp (`mark_erp_full_sweep_done`), so a tick that never got the
--    lock, or whose lease lapsed, leaves the org due.
-- 2. Expense posting backoff. A failed expense posting was retried every tick, each retry re-running the
--    gate and ERP reads. It is now queued again only 2^n minutes after its last attempt (n = failures,
--    capped at one hour); pending postings are queued at once. `attempt_count` counts failures; the
--    queue (`expense_posting_queue`) keeps the round-robin order of 0270's index.
--
-- Rollback: rollback/0358_sweep_full_run_and_expense_backoff_down.sql (roll back 0356 first or together).

create table public.erp_sweep_full_run (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  completed_at timestamptz not null
);

alter table public.erp_sweep_full_run enable row level security;
alter table public.erp_sweep_full_run force row level security;
revoke all on public.erp_sweep_full_run from anon, authenticated;
grant all on public.erp_sweep_full_run to service_role;

create or replace function public.mark_erp_full_sweep_done(p_org_id uuid, p_holder uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.erp_sweep_lock
     where org_id = p_org_id and holder = p_holder and locked_until > now()
  ) then
    return false;
  end if;
  insert into public.erp_sweep_full_run (org_id, completed_at) values (p_org_id, now())
  on conflict (org_id) do update set completed_at = excluded.completed_at;
  return true;
end;
$$;

revoke execute on function public.mark_erp_full_sweep_done(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_erp_full_sweep_done(uuid, uuid) to service_role;

alter table public.expense_posting_erp_mirror add column attempt_count int not null default 0;

-- Returns explicit columns, not the table's row type, so the Posture-B side mirror stays droppable
-- with RESTRICT (AC-XING-004): nothing PMO owns may depend on it.
create or replace function public.expense_posting_queue(p_org_id uuid, p_limit int)
returns table (
  id uuid, posting text, posting_identity text, claim_id uuid, return_id uuid,
  state_stamp timestamptz, push_state text, push_error text, attempt_count int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id, m.posting, m.posting_identity, m.claim_id, m.return_id,
         m.state_stamp, m.push_state, m.push_error, m.attempt_count
    from public.expense_posting_erp_mirror m
   where m.org_id = p_org_id
     and m.erp_cancelled_at is null
     and (
           m.push_state = 'pending'
           or (
                m.push_state = 'failed'
                and (
                      m.last_attempt_at is null
                      or m.last_attempt_at <= now() - least(
                           interval '1 minute' * power(2, least(m.attempt_count, 10)),
                           interval '60 minutes')
                    )
              )
         )
   order by m.last_attempt_at asc nulls first, m.created_at asc
   limit p_limit;
$$;

revoke execute on function public.expense_posting_queue(uuid, int) from public, anon, authenticated;
grant execute on function public.expense_posting_queue(uuid, int) to service_role;
