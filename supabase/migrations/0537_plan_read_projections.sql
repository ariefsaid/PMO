-- 0537_plan_read_projections.sql — the read-only projections S3's console and Admin page need.
--
-- 0530 revoked every API role from plans/plan_features/org_plans/global_features, and 0532's
-- projections answer "what is on for an org" but not "what does a plan contain", "which plan is
-- this org on" or "which switches are off for every org". Without those three answers the Operator
-- console cannot show plan defaults, limits or the all-orgs column, and the Admin "Your plan" page
-- (FR-PLN-014) cannot name the plan.
--
-- Everything here is READ-ONLY: three stable security-definer functions, no table grants, no
-- trigger, no write path. Each function re-asserts its own authority in the body (ADR-0016: the FE
-- gate is clarity, the function is the boundary); all three pin search_path and are revoked from
-- public/anon/service_role. Because none of them contains a write statement, 0178's
-- SECURITY DEFINER write sweep neither flags them nor needs an allow-list entry.
--
-- Proven by supabase/tests/plans_read_projections.test.sql. Reversible: see
-- rollback/0537_plan_read_projections_down.sql.

-- ── Operator console: plans + limits + matrix + all-orgs flags in ONE read ──────────────────────
-- One row per (plan, feature) keeps the all-orgs flag addressable per key without a second call.
-- `global_enabled` is null for the Admin-owned feedback key, which deliberately has no global row
-- (0531); the console renders that key read-only rather than inventing an all-orgs switch for it.
create or replace function public.operator_plan_catalogue()
returns table (
  plan_id text,
  plan_name text,
  seat_limit integer,
  project_limit integer,
  ai_monthly_messages integer,
  feature_key text,
  feature_enabled boolean,
  global_enabled boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_active_operator();
  return query
    select p.id, p.name, p.seat_limit, p.project_limit, p.ai_monthly_messages,
           f.feature_key, f.enabled, g.enabled
      from public.plans p
      join public.plan_features f on f.plan_id = p.id
      left join public.global_features g on g.feature_key = f.feature_key
     order by p.id, f.feature_key;
end $$;
revoke all on function public.operator_plan_catalogue() from public, anon, authenticated, service_role;
grant execute on function public.operator_plan_catalogue() to authenticated;

-- The assigned plan for the org the Operator is looking at. Null means "no row", which the
-- resolver treats as Enterprise (0532:150) — the console shows that as Enterprise, not as missing.
create or replace function public.operator_org_plan(p_org_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_active_operator();
  if p_org_id is null or not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  return (select op.plan_id from public.org_plans op where op.org_id = p_org_id);
end $$;
revoke all on function public.operator_org_plan(uuid) from public, anon, authenticated, service_role;
grant execute on function public.operator_org_plan(uuid) to authenticated;

-- ── Admin "Your plan": the caller's OWN org plan + limits (FR-PLN-014) ─────────────────────────
-- ⚑ The signature is frozen: S4 reads it for the analytics group property. Own-org only — there is
-- no org parameter to tamper with, and a null/absent assignment resolves to the Enterprise row.
create or replace function public.resolved_org_plan()
returns table (
  plan_id text,
  plan_name text,
  seat_limit integer,
  project_limit integer,
  ai_monthly_messages integer
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_plan_id text;
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  v_org_id := public.auth_org_id();
  if v_org_id is null then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  select coalesce(
    (select op.plan_id from public.org_plans op where op.org_id = v_org_id),
    'enterprise'
  ) into v_plan_id;
  return query
    select p.id, p.name, p.seat_limit, p.project_limit, p.ai_monthly_messages
      from public.plans p
     where p.id = v_plan_id;
end $$;
revoke all on function public.resolved_org_plan() from public, anon, authenticated, service_role;
grant execute on function public.resolved_org_plan() to authenticated;

comment on function public.operator_plan_catalogue() is
  'Operator-only read: every plan, its limits, its feature matrix and the all-orgs switch per key. Read-only.';
comment on function public.operator_org_plan(uuid) is
  'Operator-only read: the plan assigned to one organisation, or null when unassigned (resolves as Enterprise).';
comment on function public.resolved_org_plan() is
  'Own-org read for the Admin "Your plan" page: the caller''s plan name and limits (FR-PLN-014).';

notify pgrst, 'reload schema';
