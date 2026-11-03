-- Reverses 0510_odoo_revenue_enable.sql: the employ verb comes back as migration 0505 wrote it (procurement preconditions only); the
-- revenue helper goes. Ownership rows written meanwhile stay (they are data).
create or replace function public.admin_change_domain_ownership(
  p_org_id uuid, p_external_tier text, p_domain text, p_action text, p_actor_id uuid default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_is_admin boolean;
  v_is_operator boolean;
  v_blocker text;
begin
  -- Resolve effective actor: JWT path (auth.uid()) takes precedence; service_role path uses p_actor_id
  v_actor := coalesce(auth.uid(), p_actor_id);
  if v_actor is null then
    raise exception 'actor required' using errcode = '42501';
  end if;

  -- ⚑ 0180 (FR-AMG-002): the RESOLVED actor must be an active member.
  perform public.assert_is_active_member(p_actor_id);

  -- Gate: actor must be Admin of p_org_id OR platform Operator
  select exists (
    select 1 from public.profiles
    where id = v_actor
      and org_id = p_org_id
      and role = 'Admin'
  ) into v_is_admin;

  select exists (
    select 1 from public.platform_operators
    where user_id = v_actor
  ) into v_is_operator;

  if not (v_is_admin or v_is_operator) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  -- Validate org exists (FK enforcement via 23503 on insert)
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';
  end if;

  -- ⚑ 0505 (FR-OPP-001): procurement under an ERP is employed only when it can work, and under one ERP at a time.
  if p_action = 'employ' and p_domain = 'procurement' and p_external_tier in ('erpnext', 'odoo') then
    if exists (select 1 from public.external_domain_ownership
                where org_id = p_org_id and domain = 'procurement' and external_tier in ('erpnext', 'odoo')
                  and external_tier <> p_external_tier) then
      raise exception 'procurement is already employed on another ERP' using errcode = 'P0001';
    end if;
    if p_external_tier = 'odoo' then
      v_blocker := public.odoo_procurement_employ_blocker(p_org_id);
      if v_blocker is not null then raise exception '%', v_blocker using errcode = 'P0001'; end if;
    end if;
  end if;

  -- Perform the SAME ownership write as operator_set_domain_ownership
  if p_action = 'employ' then
    insert into public.external_domain_ownership (org_id, external_tier, domain, created_by)
      values (p_org_id, p_external_tier, p_domain, v_actor)
    on conflict (org_id, external_tier, domain) do nothing;
  elsif p_action = 'release' then
    delete from public.external_domain_ownership
    where org_id = p_org_id and external_tier = p_external_tier and domain = p_domain;
  else
    raise exception 'bad_action' using errcode = 'P0001';
  end if;

  perform public.log_audit(
    case p_action when 'employ' then 'integration.domain_ownership.employ'
                  when 'release' then 'integration.domain_ownership.release'
                  else 'integration.domain_ownership.unknown' end,
    p_org_id,
    v_actor,
    null,  -- entity_id
    jsonb_build_object(
      'tier', p_external_tier,
      'domain', p_domain,
      'action', p_action,
      'actor', v_actor
    )
  );
end;
$$;
drop function if exists public.odoo_revenue_employ_blocker(uuid);
