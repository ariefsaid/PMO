-- 0104_vault_secret_admin_connect.sql
-- Vault reader + writer RPCs for external-admin-connect (Phase 1 tasks 1.1–1.2)
-- Mirrors Vault pattern from 0082_automation_dispatch_vault.sql / 0094_clickup_sweep_cron.sql
-- Reversibility: supabase db reset. Manual reverse (functions before tables, reverse order):
--   drop function if exists public.create_vault_secret_for_org(uuid, text, text, text, uuid);
--   drop function if exists public.read_vault_secret(text);
--   drop function if exists public.delete_vault_secret(text);
--   alter table public.external_org_bindings drop column if exists status;
--   alter table public.external_org_bindings drop column if exists connected_by;
--   alter table public.external_org_bindings drop column if exists connected_at;
--   alter table public.external_org_bindings drop column if exists disconnected_at;

-- ============================================================================
-- 0. Add missing columns to external_org_bindings for connect/disconnect tracking
-- (additive, does not alter 0096)
-- ============================================================================
alter table public.external_org_bindings
  add column if not exists status text not null default 'active'
    check (status in ('active','disconnected')),
  add column if not exists connected_by uuid,
  add column if not exists connected_at timestamptz,
  add column if not exists disconnected_at timestamptz;

-- ============================================================================
-- 1. Vault READER: public.read_vault_secret(p_secret_ref text) returns text
-- security definer, reads from vault.decrypted_secrets, granted ONLY to service_role
-- ============================================================================
create or replace function public.read_vault_secret(p_secret_ref text)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = p_secret_ref;
$$;

revoke all on function public.read_vault_secret(text) from public;
grant execute on function public.read_vault_secret(text) to service_role;

-- ============================================================================
-- 2. Vault WRITER: public.create_vault_secret_for_org(
--      p_org_id uuid,
--      p_external_tier text,
--      p_secret_value text,
--      p_secret_name text,
--      p_actor_id uuid default null
--    ) returns text
-- security definer, gates on Admin of p_org_id OR is_operator()
-- calls vault.create_secret, upserts external_org_bindings, emits audit
-- Granted to BOTH authenticated (JWT path) AND service_role (edge fn path)
-- ============================================================================
create or replace function public.create_vault_secret_for_org(
  p_org_id uuid,
  p_external_tier text,
  p_secret_value text,
  p_secret_name text,
  p_actor_id uuid default null
) returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_name text;
  v_effective_actor uuid;
  v_old_secret_ref text;
  v_is_admin boolean;
  v_is_operator boolean;
begin
  -- Resolve effective actor: explicit p_actor_id (service_role path) OR auth.uid() (JWT path)
  v_effective_actor := coalesce(p_actor_id, auth.uid());

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

  -- Note: Vault secret rotation (revoking old secret) is deferred to Phase 2
  -- when vault.delete_secret becomes available. For now, we only update secret_ref.
  -- The old secret remains in Vault but is no longer referenced by any binding.
  null;

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

revoke all on function public.create_vault_secret_for_org(uuid, text, text, text, uuid) from public;
grant execute on function public.create_vault_secret_for_org(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.create_vault_secret_for_org(uuid, text, text, text, uuid) to service_role;

-- ============================================================================
-- 3. Vault DELETE (used by writer for rotation, Phase 2 will use for disconnect)
-- public.delete_vault_secret(p_secret_name text) returns void
-- security definer, granted to service_role (edge fn path) and authenticated (reconnect path via writer)
-- ============================================================================
create or replace function public.delete_vault_secret(p_secret_name text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  perform vault.delete_secret(p_secret_name);
end;
$$;

revoke all on function public.delete_vault_secret(text) from public;
grant execute on function public.delete_vault_secret(text) to service_role;
grant execute on function public.delete_vault_secret(text) to authenticated;