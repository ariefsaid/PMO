-- 1845_order_roles_held_only.sql — tighten ordering by built-in role to people who HOLD the named role.
-- Spec docs/specs/roles-that-decide.spec.md §2.3. Proven by supabase/tests/roles_that_decide_purchasing.test.sql.
-- Rollback: supabase/migrations/rollback/1845_order_roles_held_only_down.sql
-- Approval steps keep the 1840 rule (a person with no built-in role fills the roles built on their access level), so a chain keeps
-- working while people are being given roles. Ordering differs on purpose: it widens who reads purchases and who places orders,
-- so naming Buyer must not reach every Engineer who has no built-in role yet. holds_job_role still decides (active, catalogue key);
-- the person must also hold that key.
-- Body restated from the live definition (1842).
-- drops: actor_may_order_purchases' fill-only test — now fill AND hold the named role.

create or replace function public.actor_may_order_purchases() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((
    select bool_or(public.holds_job_role(auth.uid(), k)
                   and public.actor_built_in_role() is not distinct from k)                             -- mut:order_holds_key
      from public.purchase_order_settings s cross join lateral unnest(s.order_job_roles) k
     where s.org_id = public.auth_org_id()), false)
$$;
