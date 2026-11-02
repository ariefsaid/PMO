-- 0491_reserve_credits_stale_hold.sql — a hold leaked by a killed isolate stops blocking credit.
--
-- reserve_credits (0077) counted EVERY unreleased hold. A unit that dies without running its `finally`
-- (isolate wall-clock/CPU kill, a deploy mid-stream, an OOM) never calls release_credits, so its
-- 0.01 hold stayed against the org pool forever and members of a low-balance org were refused
-- "out of credits" while the balance still showed credit. There is no reaper.
--
-- Fix: the availability sum only counts holds younger than 30 minutes. The longest legitimate hold is
-- an automation run: agent_automations.timeout_s is bounded to 900s (0059), and the hosted edge
-- isolate wall-clock is shorter still (150-400s). 30 minutes is 2x the longest bound, so a live run's
-- hold is never ignored, and a leaked one self-heals within half an hour.
--
-- org_credit_balance (0067) is unchanged: it never subtracted holds, so it has no hold view to align.
-- `create or replace` keeps the function's existing grants and owner exactly as they are.
--
-- Reversibility (ADR-0006): supabase db reset. Staged rollback: rollback/0491_reserve_credits_stale_hold_down.sql

create or replace function public.reserve_credits(
  p_org_id uuid,
  p_amount numeric,
  p_run_id uuid
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_available numeric;
  v_id        uuid;
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if p_org_id is null or p_org_id <> public.auth_org_id() then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_positive' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || p_org_id::text));

  select coalesce((select sum(amount) from public.credits             where org_id = p_org_id), 0)
       - coalesce((select sum(cost)   from public.agent_usage         where org_id = p_org_id), 0)
       - coalesce((select sum(amount) from public.credit_reservations
                    where org_id = p_org_id and released_at is null
                      and created_at > now() - interval '30 minutes'), 0)
    into v_available;

  if v_available >= p_amount then
    insert into public.credit_reservations (org_id, run_id, amount)
      values (p_org_id, p_run_id, p_amount)
      returning id into v_id;
    return v_id;
  end if;

  raise exception 'insufficient_credits' using errcode = '23514';
end $$;
