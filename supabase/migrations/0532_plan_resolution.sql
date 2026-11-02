-- 0532_plan_resolution.sql — one entitlement resolver, guarded Operator writers and RPC projections.
-- Feature display and policy enforcement share the same entitlement result; revenue ownership only
-- affects display when there is no explicit org override.

create or replace function public.assert_active_operator() returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;
end $$;
revoke all on function public.assert_active_operator() from public, anon, authenticated, service_role;

create or replace function public.assert_switchable_feature_key(p_key text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if p_key in ('projects', 'dashboard', 'approvals', 'administration') then
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
  if p_key in ('projects', 'dashboard', 'approvals', 'administration') then
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

create or replace function public.org_has_feature(p_org_id uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_display_enabled boolean;
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if p_org_id is null or p_org_id is distinct from public.auth_org_id() then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  select r.display_enabled into v_display_enabled
    from public.resolve_feature_internal(p_org_id, p_key) r;
  return coalesce(v_display_enabled, false);
end $$;
revoke all on function public.org_has_feature(uuid, text) from public, anon, service_role;
grant execute on function public.org_has_feature(uuid, text) to authenticated;

create or replace function public.org_feature_enabled(p_org_id uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_enabled boolean;
begin
  if p_org_id is null
     or p_org_id is distinct from public.auth_org_id()
     or not public.is_active_member() then
    return false;
  end if;
  select r.enabled into v_enabled
    from public.resolve_feature_internal(p_org_id, p_key) r;
  return coalesce(v_enabled, false);
end $$;
revoke all on function public.org_feature_enabled(uuid, text) from public, anon, service_role;
grant execute on function public.org_feature_enabled(uuid, text) to authenticated;

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
        union all select 'projects'::text
        union all select 'dashboard'::text
        union all select 'approvals'::text
        union all select 'administration'::text
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
        union all select 'projects'::text
        union all select 'dashboard'::text
        union all select 'approvals'::text
        union all select 'administration'::text
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
        union all select 'projects'::text
        union all select 'dashboard'::text
        union all select 'approvals'::text
        union all select 'administration'::text
      ) k
      cross join lateral public.resolve_feature_internal(p_org_id, k.feature_key) r;
end $$;
revoke all on function public.service_resolved_org_features(uuid) from public, anon, authenticated;
grant execute on function public.service_resolved_org_features(uuid) to service_role;

create or replace function public.operator_set_org_plan(p_org_id uuid, p_plan_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_previous_plan text;
begin
  perform public.assert_active_operator();
  perform 1 from public.organizations o where o.id = p_org_id for update;
  if not found then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  if not exists (select 1 from public.plans p where p.id = p_plan_id) then
    raise exception 'unknown_plan' using errcode = '23503';
  end if;
  select op.plan_id into v_previous_plan
    from public.org_plans op where op.org_id = p_org_id;
  insert into public.org_plans (org_id, plan_id, updated_by)
    values (p_org_id, p_plan_id, auth.uid())
  on conflict (org_id) do update
    set plan_id = excluded.plan_id, updated_at = now(), updated_by = auth.uid();
  perform public.log_audit('plans.org_plan.set', p_org_id, auth.uid(), null,
    jsonb_build_object('from', v_previous_plan, 'to', p_plan_id));
end $$;
revoke all on function public.operator_set_org_plan(uuid, text) from public, anon, service_role;
grant execute on function public.operator_set_org_plan(uuid, text) to authenticated;

create or replace function public.operator_set_global_feature(p_key text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_previous boolean;
begin
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
  perform public.log_audit('plans.global_feature.set', public.auth_org_id(), auth.uid(), null,
    jsonb_build_object('feature_key', p_key, 'scope', 'global', 'from', v_previous, 'to', p_enabled));
end $$;
revoke all on function public.operator_set_global_feature(text, boolean) from public, anon, service_role;
grant execute on function public.operator_set_global_feature(text, boolean) to authenticated;

create or replace function public.operator_toggle_feature(
  p_org_id uuid, p_key text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_active_operator();
  perform public.assert_switchable_feature_key(p_key);
  if p_enabled is null then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  perform 1 from public.organizations o where o.id = p_org_id for update;
  if not found then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  insert into public.org_features (org_id, feature_key, enabled, updated_by)
    values (p_org_id, p_key, p_enabled, auth.uid())
  on conflict (org_id, feature_key) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
end $$;
revoke all on function public.operator_toggle_feature(uuid, text, boolean) from public, anon, service_role;
grant execute on function public.operator_toggle_feature(uuid, text, boolean) to authenticated;

create or replace function public.operator_clear_feature_override(p_org_id uuid, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_active_operator();
  perform public.assert_switchable_feature_key(p_key);
  perform 1 from public.organizations o where o.id = p_org_id for update;
  if not found then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  delete from public.org_features f where f.org_id = p_org_id and f.feature_key = p_key;
end $$;
revoke all on function public.operator_clear_feature_override(uuid, text) from public, anon, service_role;
grant execute on function public.operator_clear_feature_override(uuid, text) to authenticated;

create or replace function public.operator_set_plan_feature(
  p_plan_id text, p_key text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_previous boolean;
begin
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
  perform public.log_audit('plans.plan_feature.set', public.auth_org_id(), auth.uid(), null,
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
  perform public.log_audit('plans.plan_limits.set', public.auth_org_id(), auth.uid(), null,
    jsonb_build_object(
      'plan_id', p_plan_id,
      'from', jsonb_build_object('seats', v_previous_seats, 'projects', v_previous_projects, 'ai_monthly_messages', v_previous_ai),
      'to', jsonb_build_object('seats', p_seat_limit, 'projects', p_project_limit, 'ai_monthly_messages', p_ai_monthly_messages)
    ));
end $$;
revoke all on function public.operator_set_plan_limits(text, integer, integer, integer) from public, anon, service_role;
grant execute on function public.operator_set_plan_limits(text, integer, integer, integer) to authenticated;

create or replace function public.audit_org_feature_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('plans.org_feature.change', new.org_id, auth.uid(), null,
      jsonb_build_object('feature_key', new.feature_key, 'operation', 'insert', 'from', null, 'to', new.enabled));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.org_id is not distinct from new.org_id
       and old.feature_key is not distinct from new.feature_key
       and old.enabled is not distinct from new.enabled then
      return new;
    end if;
    perform public.log_audit('plans.org_feature.change', new.org_id, auth.uid(), null,
      jsonb_build_object('feature_key', new.feature_key, 'operation', 'update', 'from', old.enabled, 'to', new.enabled));
    return new;
  else
    perform public.log_audit('plans.org_feature.change', old.org_id, auth.uid(), null,
      jsonb_build_object('feature_key', old.feature_key, 'operation', 'delete', 'from', old.enabled, 'to', null));
    return old;
  end if;
end $$;
revoke all on function public.audit_org_feature_change() from public, anon, authenticated, service_role;
create trigger org_features_plan_audit
  after insert or update or delete on public.org_features
  for each row execute function public.audit_org_feature_change();

-- Service workers retain the SELECT path used by their entitlement reads, while switch mutations
-- remain on the audited Admin/Operator paths.
revoke insert, update, delete, truncate on table public.org_features from service_role;
grant select on table public.org_features to service_role;
revoke truncate on table public.org_features from public, anon, authenticated, service_role;

-- Keep feedback_surveys exclusively on its Admin-owned own-org policies. The Operator table policy
-- remains available for every other known key; the RPC guard separately blocks feedback writes.
drop policy if exists org_features_write on public.org_features;
create policy org_features_write on public.org_features for all
  using (feature_key <> 'feedback_surveys' and public.is_operator() and public.is_active_member())
  with check (feature_key <> 'feedback_surveys' and public.is_operator() and public.is_active_member());

notify pgrst, 'reload schema';
