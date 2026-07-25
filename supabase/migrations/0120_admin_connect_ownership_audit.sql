-- 0106_admin_connect_ownership_audit.sql
-- Admin self-serve ownership + audit RPC for external connect/disconnect (P2 review fix).
-- Mirrors operator_set_domain_ownership's employ/release logic but gates on p_actor_id
-- (coalesce(auth.uid(), p_actor_id)) so it works under service_role.
-- AC-EAC-001, AC-EAC-002, AC-EAC-006, AC-EAC-007, FR-EAC-004/005.
-- Reversibility: supabase db reset. Manual reverse:
--   drop function if exists public.admin_change_domain_ownership(uuid,text,text,text,uuid);
--   revoke execute on function public.admin_change_domain_ownership(uuid,text,text,text,uuid) from authenticated, service_role;

create or replace function public.admin_change_domain_ownership(
  p_org_id uuid,
  p_external_tier text,
  p_domain text,
  p_action text,              -- 'employ' | 'release'
  p_actor_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_is_admin boolean;
  v_is_operator boolean;
begin
  -- Resolve effective actor: JWT path (auth.uid()) takes precedence; service_role path uses p_actor_id
  v_actor := coalesce(auth.uid(), p_actor_id);
  if v_actor is null then
    raise exception 'actor required' using errcode = '42501';
  end if;

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

  -- Audit: use the 5-arg signature of public.log_audit
  -- log_audit(p_action text, p_org_id uuid, p_actor_id uuid, p_entity_id uuid, p_detail jsonb)
  -- entity_id is null since we're logging ownership changes, not a specific entity row
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

revoke all on function public.admin_change_domain_ownership(uuid,text,text,text,uuid) from public;
grant execute on function public.admin_change_domain_ownership(uuid,text,text,text,uuid) to authenticated;
grant execute on function public.admin_change_domain_ownership(uuid,text,text,text,uuid) to service_role;