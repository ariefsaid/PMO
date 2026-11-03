-- 0533_plans_s1_followups.sql — S1 follow-ups (#1734): the complete never-gatable (core) key set,
-- and platform-level audit rows for changes that are not made on behalf of a single organisation.
--
-- 1. Core keys. D5 fixes projects, budgets vs actual, approvals with SoD, roles, expense claims,
--    dashboard and administration as rules rather than entitlements, and the spec keeps tasks core
--    until a ticket says otherwise. 0532 carried only the first four in its resolver, its
--    write-guard and its three projections, so a slice that gates one of the other four would hide
--    a never-switchable module (the resolver would answer false / 'unknown') and an Operator would
--    get `unknown_feature` instead of AC-PLN-004's `core_not_gatable`. The list now has ONE home —
--    public.core_feature_keys() — read by every site that decides core-ness.
--
-- 2. Audit scope. A global switch, a plan default or a plan limit is a platform-wide change. 0532
--    logged them against the Operator's HOME org, so that org's Admin saw platform edits in its own
--    audit trail while every org affected by the change saw nothing. Those three writers now record
--    a platform row: no org (audit_events.org_id is nullable), scope 'platform', with the actor and
--    the old/new values kept. An org plan assignment and a per-org override stay org-scoped rows on
--    the affected org. A check constraint pairs the two, so a row cannot claim a scope it does not
--    have, and the single audit SELECT policy gives platform rows to the active platform Operator
--    only — never to an org Admin, not even the Operator's own.
--
-- Proven by supabase/tests/plans_resolution.test.sql (AC-PLN-004 core keys and every write path),
-- supabase/tests/plans_audit_scope.test.sql (the scope contract end to end) and by the existing
-- plans_permissions / plans_compatibility suites. Reversible: see rollback/0533_plans_s1_followups_down.sql.

-- ── 1. One home for the never-gatable keys ──────────────────────────────────────────────────────
create or replace function public.core_feature_keys() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'projects', 'dashboard', 'approvals', 'administration',
    'expense_claims', 'roles', 'budgets', 'tasks'
  ]::text[];
$$;
revoke all on function public.core_feature_keys() from public, anon, authenticated, service_role;

-- ── 2. Audit scope: the table can express a platform row ────────────────────────────────────────
-- Every existing row was written for one org, so 'org' is the backfilled default. The constraint is
-- the pairing rule: platform rows carry no org, org rows must carry one. There is no third scope.
alter table public.audit_events
  add column scope text not null default 'org';
alter table public.audit_events
  alter column org_id drop not null;
alter table public.audit_events
  add constraint audit_events_scope_check check (
    (scope = 'platform' and org_id is null)
    or (scope = 'org' and org_id is not null)
  );

comment on table public.audit_events is
  'Durable, append-only audit trail for security-sensitive events (audit finding C-3). '
  'Org-scoped rows (scope = org, org_id set) are readable by that org Admin/Operator only; '
  'platform rows (scope = platform, org_id null) record platform-wide changes and are readable by '
  'the active platform Operator only. Written solely by log_audit() / log_platform_audit() '
  '(security definer) — no client role may INSERT/UPDATE/DELETE, and no row can claim a scope it '
  'does not have.';

-- The sole writer for a platform row. Not granted to any client role: only the security-definer
-- Operator RPCs call it, so no API caller can forge a platform-scoped row.
create or replace function public.log_platform_audit(
  p_action   text,
  p_actor_id uuid,
  p_detail   jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events (org_id, scope, actor_id, action, detail)
    values (null, 'platform', p_actor_id, p_action, p_detail);
end $$;
revoke all on function public.log_platform_audit(text, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- One SELECT policy (the append-only contract in 0133): org rows to their own-org Admin/Operator,
-- platform rows to the active platform Operator only. An org Admin never sees a platform row —
-- not even the Operator's own home org, which is how the leak in 0532 was visible.
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select
  using (
    public.is_active_member()
    and (
      (scope = 'platform' and org_id is null and public.is_operator())
      or (scope = 'org' and org_id is not null and org_id = public.auth_org_id()
          and (public.auth_role() = 'Admin' or public.is_operator()))
    )
  );

-- ── 3. The core list at the write guard and in the resolver ─────────────────────────────────────
create or replace function public.assert_switchable_feature_key(p_key text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if p_key = any (public.core_feature_keys()) then
    raise exception 'core_not_gatable' using errcode = 'P0001';
  end if;
  if p_key = 'feedback_surveys' then
    raise exception 'admin_owned_feature' using errcode = 'P0001';
  end if;
  if p_key is null or not exists (
    select 1 from public.global_features where feature_key = p_key
  ) then
    raise exception 'unknown_feature' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.assert_switchable_feature_key(text) from public, anon, authenticated, service_role;

create or replace function public.resolve_feature_internal(p_org_id uuid, p_key text)
returns table(enabled boolean, display_enabled boolean, source text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_global_enabled boolean;
  v_override_enabled boolean;
  v_has_override boolean;
  v_plan_enabled boolean;
  v_plan_id text;
  v_enabled boolean;
  v_display_enabled boolean;
  v_source text;
begin
  if p_key = any (public.core_feature_keys()) then
    return query select true, true, 'core'::text;
    return;
  end if;

  -- The Admin-owned control stays independent of the all-org and plan layers. Its historical
  -- default is on; the presence of an Admin row (on or off) controls the value.
  if p_key = 'feedback_surveys' then
    select f.enabled into v_override_enabled
      from public.org_features f
     where f.org_id = p_org_id and f.feature_key = p_key;
    v_has_override := found;
    v_enabled := case when v_has_override then v_override_enabled else true end;
    v_source := case when v_has_override then 'override' else 'plan' end;
    return query select v_enabled, v_enabled, v_source;
    return;
  end if;

  -- Unknown reads fail closed. Known switch keys are registered by the Enterprise matrix.
  if p_key is null or not exists (
    select 1 from public.plan_features f where f.feature_key = p_key
  ) then
    return query select false, false, 'unknown'::text;
    return;
  end if;

  select g.enabled into v_global_enabled
    from public.global_features g
   where g.feature_key = p_key;
  select f.enabled into v_override_enabled
    from public.org_features f
   where f.org_id = p_org_id and f.feature_key = p_key;
  v_has_override := found;
  select coalesce((select op.plan_id from public.org_plans op where op.org_id = p_org_id), 'enterprise')
    into v_plan_id;
  select f.enabled into v_plan_enabled
    from public.plan_features f
   where f.plan_id = v_plan_id and f.feature_key = p_key;

  if v_global_enabled is false then
    v_enabled := false;
    v_source := 'global';
  elsif v_has_override then
    v_enabled := v_override_enabled;
    v_source := 'override';
  else
    v_enabled := coalesce(v_plan_enabled, false);
    v_source := 'plan';
  end if;

  v_display_enabled := v_enabled;
  if p_key = 'revenue'
     and not v_has_override
     and exists (select 1 from public.external_domain_ownership d
                  where d.org_id = p_org_id and d.domain = 'revenue') then
    v_display_enabled := false;
  end if;

  return query select v_enabled, v_display_enabled, v_source;
end $$;
revoke all on function public.resolve_feature_internal(uuid, text) from public, anon, authenticated, service_role;

-- ── 4. The three projections now include every core key ─────────────────────────────────────────
create or replace function public.resolved_org_features()
returns table(feature_key text, enabled boolean, display_enabled boolean, source text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org_id uuid;
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  v_org_id := public.auth_org_id();
  if v_org_id is null then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  return query
    select k.feature_key, r.enabled, r.display_enabled, r.source
      from (
        select f.feature_key from public.plan_features f where f.plan_id = 'enterprise'
        union all select unnest(public.core_feature_keys())
      ) k
      cross join lateral public.resolve_feature_internal(v_org_id, k.feature_key) r;
end $$;
revoke all on function public.resolved_org_features() from public, anon, service_role;
grant execute on function public.resolved_org_features() to authenticated;

create or replace function public.operator_resolved_org_features(p_org_id uuid)
returns table(feature_key text, enabled boolean, display_enabled boolean, source text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_active_operator();
  if not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  return query
    select k.feature_key, r.enabled, r.display_enabled, r.source
      from (
        select f.feature_key from public.plan_features f where f.plan_id = 'enterprise'
        union all select unnest(public.core_feature_keys())
      ) k
      cross join lateral public.resolve_feature_internal(p_org_id, k.feature_key) r;
end $$;
revoke all on function public.operator_resolved_org_features(uuid) from public, anon, service_role;
grant execute on function public.operator_resolved_org_features(uuid) to authenticated;

create or replace function public.service_resolved_org_features(p_org_id uuid)
returns table(feature_key text, enabled boolean, display_enabled boolean, source text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  return query
    select k.feature_key, r.enabled, r.display_enabled, r.source
      from (
        select f.feature_key from public.plan_features f where f.plan_id = 'enterprise'
        union all select unnest(public.core_feature_keys())
      ) k
      cross join lateral public.resolve_feature_internal(p_org_id, k.feature_key) r;
end $$;
revoke all on function public.service_resolved_org_features(uuid) from public, anon, authenticated;
grant execute on function public.service_resolved_org_features(uuid) to service_role;

-- ── 5. Platform changes are platform rows ──────────────────────────────────────────────────────
-- Bodies are 0532's, with the audit call moved from log_audit(home org) to log_platform_audit.
create or replace function public.operator_set_global_feature(p_key text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_previous boolean;
begin
  if not public.is_active_member() then raise exception 'inactive' using errcode = '42501'; end if;
  perform public.assert_active_operator();
  perform public.assert_switchable_feature_key(p_key);
  if p_enabled is null then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  select g.enabled into v_previous
    from public.global_features g where g.feature_key = p_key for update;
  update public.global_features
     set enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
   where feature_key = p_key;
  perform public.log_platform_audit('plans.global_feature.set', auth.uid(),
    jsonb_build_object('feature_key', p_key, 'scope', 'global', 'from', v_previous, 'to', p_enabled));
end $$;
revoke all on function public.operator_set_global_feature(text, boolean) from public, anon, service_role;
grant execute on function public.operator_set_global_feature(text, boolean) to authenticated;

create or replace function public.operator_set_plan_feature(
  p_plan_id text, p_key text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_previous boolean;
begin
  if not public.is_active_member() then raise exception 'inactive' using errcode = '42501'; end if;
  perform public.assert_active_operator();
  if not exists (select 1 from public.plans p where p.id = p_plan_id) then
    raise exception 'unknown_plan' using errcode = '23503';
  end if;
  perform public.assert_switchable_feature_key(p_key);
  if p_enabled is null then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  select f.enabled into v_previous
    from public.plan_features f where f.plan_id = p_plan_id and f.feature_key = p_key for update;
  if not found then
    raise exception 'unknown_plan_feature' using errcode = 'P0001';
  end if;
  update public.plan_features
     set enabled = p_enabled
   where plan_id = p_plan_id and feature_key = p_key;
  perform public.log_platform_audit('plans.plan_feature.set', auth.uid(),
    jsonb_build_object('plan_id', p_plan_id, 'feature_key', p_key, 'from', v_previous, 'to', p_enabled));
end $$;
revoke all on function public.operator_set_plan_feature(text, text, boolean) from public, anon, service_role;
grant execute on function public.operator_set_plan_feature(text, text, boolean) to authenticated;

create or replace function public.operator_set_plan_limits(
  p_plan_id text, p_seat_limit integer, p_project_limit integer, p_ai_monthly_messages integer
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_previous_seats integer;
  v_previous_projects integer;
  v_previous_ai integer;
begin
  if not public.is_active_member() then raise exception 'inactive' using errcode = '42501'; end if;
  perform public.assert_active_operator();
  if p_seat_limit is not null and p_seat_limit < 0
     or p_project_limit is not null and p_project_limit < 0
     or p_ai_monthly_messages is not null and p_ai_monthly_messages < 0 then
    raise exception 'invalid_limit' using errcode = 'P0001';
  end if;
  select p.seat_limit, p.project_limit, p.ai_monthly_messages
    into v_previous_seats, v_previous_projects, v_previous_ai
    from public.plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'unknown_plan' using errcode = '23503';
  end if;
  update public.plans
     set seat_limit = p_seat_limit,
         project_limit = p_project_limit,
         ai_monthly_messages = p_ai_monthly_messages
   where id = p_plan_id;
  perform public.log_platform_audit('plans.plan_limits.set', auth.uid(),
    jsonb_build_object(
      'plan_id', p_plan_id,
      'from', jsonb_build_object('seats', v_previous_seats, 'projects', v_previous_projects, 'ai_monthly_messages', v_previous_ai),
      'to', jsonb_build_object('seats', p_seat_limit, 'projects', p_project_limit, 'ai_monthly_messages', p_ai_monthly_messages)
    ));
end $$;
revoke all on function public.operator_set_plan_limits(text, integer, integer, integer) from public, anon, service_role;
grant execute on function public.operator_set_plan_limits(text, integer, integer, integer) to authenticated;

notify pgrst, 'reload schema';
