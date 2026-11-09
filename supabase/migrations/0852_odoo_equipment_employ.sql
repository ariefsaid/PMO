-- 0852_odoo_equipment_employ.sql (#1511 F2): employing `equipment` under Odoo is checked by the database.
--   1. odoo_equipment_employ_blocker — the first thing that stops it, in plain words (twin of odoo/assets/capabilities.ts;
--      keep in step): an active ERPNext connection, an unactivated Odoo connection, or a fleet / maintenance model the stored
--      capability snapshot does not show present, readable and (for the writable ones) creatable and writable.
--   2. admin_change_domain_ownership — 0743's body with `equipment` added: ERPNext is refused outright, Odoo runs the blocker.
--   3. org_employs_odoo_equipment — the sweep's gate and the PMO-asset guard's test (invoker; RLS on ownership applies).
-- Reversal: rollback/0852_odoo_equipment_employ_down.sql.
-- ── REVERSE ─────────────────────────────────────────────────────────────────────────────────────────────
--   restore 0743's admin_change_domain_ownership; drop odoo_equipment_employ_blocker and org_employs_odoo_equipment.

create function public.odoo_equipment_employ_blocker(p_org_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_config jsonb;
  v_m text;
  v_p jsonb;
begin
  if public.org_has_active_erpnext_binding(p_org_id) then return 'an ERPNext connection is active for this organization'; end if;
  select config into v_config from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active' and activated_at is not null;
  if not found then return 'Odoo connection is not activated'; end if;
  foreach v_m in array array['fleet.vehicle','fleet.vehicle.model','maintenance.equipment','maintenance.request','maintenance.stage',
                             'fleet.vehicle.log.services','fleet.service.type','ir.model.data'] loop
    v_p := v_config #> array['capabilities', 'assets', v_m];
    if v_p is null or not coalesce((v_p->>'exists')::boolean, false) or not coalesce((v_p->>'read')::boolean, false) then
      return 'Odoo is missing ' || v_m;
    end if;
    if jsonb_array_length(coalesce(v_p->'fields_missing', '[]'::jsonb)) > 0 then
      return 'Odoo is missing ' || v_m || ':' || (v_p->'fields_missing'->>0);
    end if;
    if v_m in ('fleet.vehicle','maintenance.equipment','maintenance.request','fleet.vehicle.log.services','ir.model.data')
       and not coalesce((v_p->>'create')::boolean, false) then
      return 'Odoo is missing ' || v_m || ':create';
    end if;
    if v_m in ('fleet.vehicle','maintenance.equipment','maintenance.request','fleet.vehicle.log.services')
       and not coalesce((v_p->>'write')::boolean, false) then
      return 'Odoo is missing ' || v_m || ':write';
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.odoo_equipment_employ_blocker(uuid) from public, anon, authenticated;
grant execute on function public.odoo_equipment_employ_blocker(uuid) to service_role;

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

  -- ⚑ 0505 (FR-OPP-001) / 0510 (FR-OCI-001..003) / 0743 / 0852 (FR-OFM-001..002): these domains are employed under an ERP only when
  -- they can work, and under one ERP at a time; the equipment register exists under Odoo only.
  if p_action = 'employ' and p_domain in ('procurement', 'revenue', 'companies', 'equipment') and p_external_tier in ('erpnext', 'odoo') then
    if p_domain = 'equipment' and p_external_tier = 'erpnext' then
      raise exception 'The equipment register is available with Odoo only' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.external_domain_ownership
                where org_id = p_org_id and domain = p_domain and external_tier in ('erpnext', 'odoo')
                  and external_tier <> p_external_tier) then
      raise exception '% is already employed on another ERP', p_domain using errcode = 'P0001';
    end if;
    if p_external_tier = 'odoo' then
      v_blocker := case p_domain when 'procurement' then public.odoo_procurement_employ_blocker(p_org_id)
                                 when 'companies' then public.odoo_companies_employ_blocker(p_org_id)
                                 when 'equipment' then public.odoo_equipment_employ_blocker(p_org_id)
                                 else public.odoo_revenue_employ_blocker(p_org_id) end;
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
-- Grants are those of 0210 §2 and 0185; `create or replace` keeps them.

create function public.org_employs_odoo_equipment(p_org uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.external_domain_ownership
                  where org_id = p_org and external_tier = 'odoo' and domain = 'equipment');
$$;
revoke all on function public.org_employs_odoo_equipment(uuid) from public, anon;
grant execute on function public.org_employs_odoo_equipment(uuid) to authenticated, service_role;
