-- 0491_reserve_credits_stale_hold_down.sql — the STAGED rollback of 0491.
--
-- Lives in supabase/migrations/rollback/ so `supabase db reset` never applies it. Run deliberately:
--   psql "$DB_URL" -f supabase/migrations/rollback/0491_reserve_credits_stale_hold_down.sql
--
-- Restores the 0077 body (every unreleased hold counts, however old). Grants are untouched.

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
       - coalesce((select sum(amount) from public.credit_reservations where org_id = p_org_id and released_at is null), 0)
    into v_available;

  if v_available >= p_amount then
    insert into public.credit_reservations (org_id, run_id, amount)
      values (p_org_id, p_run_id, p_amount)
      returning id into v_id;
    return v_id;
  end if;

  raise exception 'insufficient_credits' using errcode = '23514';
end $$;
