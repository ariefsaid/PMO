-- Rolls back 0420. Odoo bindings stay as rows; nothing user-authored is lost.
drop function if exists public.finalize_odoo_connect(uuid,text,text,text,date,boolean,boolean,uuid);
drop function if exists public.discard_odoo_mirror(uuid,uuid);
drop function if exists public.activate_odoo_binding(uuid,int,int,text,jsonb,uuid);
drop function if exists public.assert_odoo_activated(uuid);

-- disconnect_external_integration -> migration 0341's body.
create or replace function public.disconnect_external_integration(
  p_org_id uuid, p_external_tier text, p_actor_id uuid
) returns integer
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_binding public.external_org_bindings%rowtype;
  v_touched integer;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not public.is_active_member(p_actor_id) or not exists (
    select 1 from public.profiles p where p.id = p_actor_id and p.org_id = p_org_id
  ) then
    raise exception 'active organization member required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.org_id = p_org_id and p.role = 'Admin'
  ) and not exists (select 1 from public.platform_operators po where po.user_id = p_actor_id) then
    raise exception 'Admin or Operator required' using errcode = '42501';
  end if;

  select * into v_binding from public.external_org_bindings
  where org_id = p_org_id and external_tier = p_external_tier for update;
  if not found then return 0; end if;

  if v_binding.secret_ref is not null then
    delete from vault.secrets where name = v_binding.secret_ref;
  end if;
  if v_binding.webhook_secret_ref is not null then
    delete from vault.secrets where name = v_binding.webhook_secret_ref;
  end if;
  update public.external_org_bindings
     set status = 'disconnected', disconnected_at = now(), activated_at = null,
         version_major = null, config = coalesce(config, '{}'::jsonb) - 'company', updated_at = now()
   where org_id = p_org_id and external_tier = p_external_tier;
  get diagnostics v_touched = row_count;
  if p_external_tier = 'clickup' then
    delete from public.external_domain_ownership
    where org_id = p_org_id and external_tier = 'clickup' and domain = 'tasks';
    perform public.log_audit('integration.domain_ownership.release', p_org_id, p_actor_id, null,
      jsonb_build_object('tier', 'clickup', 'domain', 'tasks', 'actor', p_actor_id));
  end if;
  return v_touched;
end;
$$;
revoke all on function public.disconnect_external_integration(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.disconnect_external_integration(uuid,text,uuid) to service_role;

-- create_vault_secret_for_org -> 0180's body; activate_external_binding -> 0216's body.
create or replace function public.create_vault_secret_for_org(
  p_org_id uuid, p_external_tier text, p_secret_value text, p_secret_name text, p_actor_id uuid default null)
  returns text language plpgsql security definer set search_path = public, vault as $$
declare
  v_secret_name text;
  v_effective_actor uuid;
  v_old_secret_ref text;
  v_is_admin boolean;
  v_is_operator boolean;
begin
  -- Resolve effective actor: auth.uid() (JWT path) takes precedence; p_actor_id (service_role path) only when auth.uid() is null
  v_effective_actor := coalesce(auth.uid(), p_actor_id);

  -- ⚑ 0180 (FR-AMG-002): the RESOLVED actor must be an active member. Ahead of the privilege check
  -- and of the Vault write, so an offboarded Admin can neither mint a secret nor rotate a live one.
  perform public.assert_is_active_member(p_actor_id);

  -- Gate: effective actor must be Admin of p_org_id OR platform Operator
  -- Check profiles.role = 'Admin' AND profiles.org_id = p_org_id
  select exists (
    select 1 from public.profiles
    where id = v_effective_actor
      and org_id = p_org_id
      and role = 'Admin'
  ) into v_is_admin;

  -- Check platform operator directly for effective actor (bypass is_operator() which runs as function owner)
  select exists (
    select 1 from public.platform_operators
    where user_id = v_effective_actor
  ) into v_is_operator;

  if not (v_is_admin or v_is_operator) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  -- Create Vault secret (idempotent on name); it returns a UUID, we return the name we passed
  perform vault.create_secret(p_secret_value, p_secret_name);
  v_secret_name := p_secret_name;

  -- Capture old secret_ref for rotation revocation (if reconnecting)
  select secret_ref into v_old_secret_ref
  from public.external_org_bindings
  where org_id = p_org_id and external_tier = p_external_tier;

  -- Upsert external_org_bindings row
  insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
  values (p_org_id, p_external_tier, '', v_secret_name, 'active', v_effective_actor, now())
  on conflict (org_id, external_tier) do update set
    secret_ref = excluded.secret_ref,
    status = 'active',
    connected_by = excluded.connected_by,
    connected_at = excluded.connected_at,
    updated_at = now();

  -- AC-EAC-006: reconnect rotates + REVOKES old secret
  if v_old_secret_ref is not null and v_old_secret_ref <> v_secret_name then
    perform public.delete_vault_secret(v_old_secret_ref);
  end if;

  -- Emit audit event (log_audit exists per 0076_audit_events.sql)
  -- Use 'integration.reconnect' when rotating an existing binding
  perform public.log_audit(
    case when v_old_secret_ref is not null and v_old_secret_ref <> v_secret_name
         then 'integration.reconnect' else 'integration.connect' end,
    p_org_id,
    null,  -- entity_type
    null,  -- entity_id
    jsonb_build_object(
      'tier', p_external_tier,
      'actor', v_effective_actor,
      'secret_ref', v_secret_name,
      'rotated', v_old_secret_ref is not null and v_old_secret_ref <> v_secret_name
    )
  );

  return v_secret_name;
end;
$$;

create or replace function public.activate_external_binding(
  p_org_id uuid, p_external_tier text, p_version_major int,
  p_company text, p_config_patch jsonb, p_actor_id uuid
) returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_supported constant int[] := array[15, 16];   -- DD-OPS-10: local bench v15.94.3, RIS target v16.33
  v_prior_stamp timestamptz;
  v_stamp       timestamptz;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_external_tier <> 'erpnext' then
    raise exception 'only the erpnext tier has an activation handshake' using errcode = 'P0001';
  end if;
  if p_version_major is null or not (p_version_major = any (v_supported)) then
    raise exception 'unsupported erpnext major version %', coalesce(p_version_major::text, 'null')
      using errcode = 'P0001';
  end if;
  if p_company is null or btrim(p_company) = '' then
    raise exception 'company is required to activate' using errcode = '22023';
  end if;
  if p_config_patch is not null and jsonb_typeof(p_config_patch) <> 'object' then
    raise exception 'config patch must be a JSON object' using errcode = '22023';
  end if;

  select activated_at into v_prior_stamp
    from public.external_org_bindings
   where org_id = p_org_id and external_tier = p_external_tier
     and status = 'active' and coalesce(site_url, '') <> ''
   for update;
  if not found then
    raise exception 'binding is not connectable (inactive, missing, or no site_url)'
      using errcode = 'P0001';
  end if;

  -- ONE statement: a half-written activation on the money path is the class ADR-0058 exists to remove.
  -- coalesce() is FR-EAC-107's set-once rule: activated_at is DD-XING-2's epoch and the sweep's
  -- `approved_at >= activated_at` floor — moving it forward on a re-select would silently drop every
  -- week approved in between out of recovery scope.
  update public.external_org_bindings
     set version_major = p_version_major,
         config        = coalesce(config, '{}'::jsonb)
                         || coalesce(p_config_patch, '{}'::jsonb)
                         || jsonb_build_object('company', p_company),
         activated_at  = coalesce(activated_at, now()),
         updated_at    = now()
   where org_id = p_org_id and external_tier = p_external_tier
  returning activated_at into v_stamp;

  perform public.log_audit('integration.activate', p_org_id, p_actor_id, null,
    jsonb_build_object('tier', p_external_tier, 'actor', p_actor_id,
                       'company', p_company, 'version_major', p_version_major,
                       'first_activation', v_prior_stamp is null));
  return v_stamp;
end;
$$;

revoke select on public.external_org_bindings from authenticated;
grant select on public.external_org_bindings to authenticated, anon;
