-- 1291 — spend_approvers_for_amount: the approver list narrowed to the tier of a request amount (#2695).
-- Spec: docs/specs/approval-amount-tiers.spec.md §2. Proven by supabase/tests/spend_approval_tiers.test.sql.
-- Rollback: rollback/1291_spend_approvers_for_amount_down.sql.
--
-- Tiers off (no settings row, or tiers_enabled = false): every row of the scope, so routing is unchanged.
-- Tiers on: the tier is the highest minimum at most the amount; below every minimum, the lowest tier; an unknown or
-- negative amount, or one in a currency other than the organisation's, takes the highest tier (amounts route up).
-- SECURITY INVOKER: spend_approvers RLS is the boundary, exactly as for the direct reads it replaces.
create function public.spend_approvers_for_amount(
  p_org_id uuid, p_project_id uuid, p_amount numeric, p_currency text
) returns setof public.spend_approvers
  language sql stable security invoker set search_path = public, pg_temp as $$
  with s as (
    select sa.* from public.spend_approvers sa
     where sa.org_id = p_org_id and sa.project_id is not distinct from p_project_id
  ),
  cfg as (
    select coalesce((select st.tiers_enabled from public.spend_approval_settings st where st.org_id = p_org_id), false) as tiers_on,
           (select o.default_currency from public.organizations o where o.id = p_org_id) as org_currency
  ),
  tgt as (
    select case
             when p_amount is null or p_amount < 0 or p_currency is distinct from (select org_currency from cfg)
               then max(coalesce(s.min_amount, 0))
             else coalesce(max(coalesce(s.min_amount, 0)) filter (where coalesce(s.min_amount, 0) <= p_amount),
                           min(coalesce(s.min_amount, 0)))
           end as tier
      from s
  )
  select s.* from s
   where not (select tiers_on from cfg) or coalesce(s.min_amount, 0) = (select tier from tgt)
$$;
revoke all on function public.spend_approvers_for_amount(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.spend_approvers_for_amount(uuid, uuid, numeric, text) to authenticated;
