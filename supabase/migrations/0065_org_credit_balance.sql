-- 0065_org_credit_balance.sql — org_credit_balance() + operator_grant_credits() (FR-CRE-002/005,
-- FR-OPR-004, AC-CRE-001/004).
--   balance = sum(credits.amount where org_id=X regardless of owner_id) − sum(agent_usage.cost where org_id=X).
--   Security-definer so ANY member of the org can read their own pool for the RateGuard metering path
--   WITHOUT needing credits SELECT (credits SELECT is Admin+Exec only — FR-CRE-003). Asserts p_org_id =
--   auth_org_id() so a member reads only their own org; the Operator cross-org path is
--   operator_usage_summary (0067), not this fn.
--   operator_grant_credits: Operator-only; asserts the org exists; writes owner_id NULL (FR-CRE-001).
-- Reversibility (ADR-0006): supabase db reset. Manual:
--   drop function if exists public.operator_grant_credits(uuid,numeric,text);
--   drop function if exists public.org_credit_balance(uuid);

create or replace function public.org_credit_balance(p_org_id uuid) returns numeric
  language plpgsql stable security definer set search_path = public as $$
declare
  v_balance numeric;
begin
  -- a member reads ONLY their own org pool (no cross-org leak); a disabled caller reaches nothing
  -- (FR-INV-003: security-definer RPCs assert is_active_member() at entry).
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if p_org_id is null or p_org_id <> public.auth_org_id() then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  select coalesce((select sum(amount) from public.credits    where org_id = p_org_id), 0)
       - coalesce((select sum(cost)   from public.agent_usage where org_id = p_org_id), 0)
    into v_balance;
  return v_balance;
end $$;

create or replace function public.operator_grant_credits(
  p_org_id uuid,
  p_amount numeric,
  p_note   text
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  -- is_active_member() entry guard (security review M1): platform_operators is intentionally exempt
  -- from the 0061 RLS conjunction, so a disabled Operator's cached JWT still drives auth.uid() in
  -- PostgREST (GoTrue stops issuing NEW JWTs via banned_until, but cannot revoke a cached one).
  -- Re-asserting is_active_member() here closes the disabled-Operator elevation on every Operator
  -- power, mirroring org_credit_balance / admin_set_user_status. (Inverse-consistent with 0062.)
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';   -- Operators cannot grant into a nonexistent org
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_positive' using errcode = '23514'; -- maps to the CHECK-violation toast
  end if;
  insert into public.credits (org_id, owner_id, amount, note, granted_by)
    values (p_org_id, null, p_amount, p_note, auth.uid());
end $$;

revoke all on function public.org_credit_balance(uuid) from public;
grant execute on function public.org_credit_balance(uuid) to authenticated;
revoke all on function public.operator_grant_credits(uuid,numeric,text) from public;
grant execute on function public.operator_grant_credits(uuid,numeric,text) to authenticated;
