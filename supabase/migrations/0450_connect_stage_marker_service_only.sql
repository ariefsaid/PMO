-- 0450_connect_stage_marker_service_only.sql (#1614)
-- Connect custody follow-ups for the ClickUp and Odoo connect paths:
--   1. The rotation marker a staged connect attempt records (the prior binding: its Vault reference, status and
--      timestamps — 0259) moves out of the member-readable `config` into its own column, `prev_binding`, which no
--      signed-in role can read (column grants since 0420 are explicit; this column is not among them).
--      stage_vault_secret_for_org, cleanup_external_connect_attempt, finalize_external_connect, finalize_odoo_connect
--      and disconnect_external_integration read and clear it there. Bodies are otherwise 0259 / 0346 / 0420's.
--   2. create_vault_secret_for_org is service-role only: external-connect calls it with p_actor_id; nothing calls it
--      under a member's JWT.
-- Reversal: rollback/0450_connect_stage_marker_service_only_down.sql.

alter table public.external_org_bindings add column if not exists prev_binding jsonb;
-- An attempt in flight at deploy keeps its marker: moved, not dropped.
update public.external_org_bindings
   set prev_binding = config -> 'prev_binding', config = config - 'prev_binding'
 where config ? 'prev_binding';
revoke all (prev_binding) on public.external_org_bindings from public, anon, authenticated;

-- 0259 body; the marker is written to prev_binding, config is no longer touched.
create or replace function public.stage_vault_secret_for_org(
  p_org_id uuid, p_external_tier text, p_secret_value text, p_secret_name text, p_actor_id uuid default null)
  returns text language plpgsql security definer set search_path = public, vault as $$
declare
  v_old_secret_ref text;
  v_old_status text;
  v_is_admin boolean;
  v_is_operator boolean;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actor_id is null then
    raise exception 'actor required' using errcode = '42501';
  end if;
  perform public.assert_is_active_member(p_actor_id);
  select exists (select 1 from public.profiles
                  where id = p_actor_id and org_id = p_org_id and role = 'Admin') into v_is_admin;
  select exists (select 1 from public.platform_operators where user_id = p_actor_id) into v_is_operator;
  if not (v_is_admin or v_is_operator) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  -- Row lock first: a concurrent stage/cleanup/finalize for this binding waits for us to commit.
  select secret_ref, status into v_old_secret_ref, v_old_status
    from public.external_org_bindings
   where org_id = p_org_id and external_tier = p_external_tier
     for update;

  perform vault.create_secret(p_secret_value, p_secret_name);

  insert into public.external_org_bindings as b
    (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
  values (p_org_id, p_external_tier, '', p_secret_name, 'active', p_actor_id, now())
  on conflict (org_id, external_tier) do update set
    secret_ref = excluded.secret_ref,
    status = 'active',
    connected_by = excluded.connected_by,
    connected_at = excluded.connected_at,
    -- Record the row's prior state until finalize commits. A re-stage over an unfinalised attempt keeps the
    -- ORIGINAL marker; a DISCONNECTED row always records afresh (a marker left by an attempt the Admin then
    -- disconnected is stale). Computed from the row version being updated, so a racing insert is recorded too.
    prev_binding = case
      when b.secret_ref <> excluded.secret_ref and (b.prev_binding is null or b.status = 'disconnected')
        then jsonb_build_object(
               'secret_ref', b.secret_ref, 'status', b.status, 'connected_by', b.connected_by,
               'connected_at', b.connected_at, 'disconnected_at', b.disconnected_at)
      else b.prev_binding end,
    updated_at = now();

  perform public.log_audit(
    case when v_old_secret_ref is not null and v_old_secret_ref <> p_secret_name
         then 'integration.reconnect' else 'integration.connect' end,
    p_org_id, null, null,
    jsonb_build_object('tier', p_external_tier, 'actor', p_actor_id, 'secret_ref', p_secret_name,
      'rotated', v_old_status = 'active' and v_old_secret_ref <> p_secret_name));
  return p_secret_name;
end;
$$;
revoke all on function public.stage_vault_secret_for_org(uuid,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.stage_vault_secret_for_org(uuid,text,text,text,uuid) to service_role;

-- 0346 body, reading and clearing prev_binding.
create or replace function public.cleanup_external_connect_attempt(
  p_org_id uuid, p_external_tier text, p_secret_ref text, p_actor_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_prev jsonb;
  v_found boolean;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  select true, prev_binding into v_found, v_prev
    from public.external_org_bindings
   where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref
     for update;
  if v_prev is not null then
    update public.external_org_bindings
       set secret_ref=(v_prev->>'secret_ref'), status=v_prev->>'status',
           connected_by=(v_prev->>'connected_by')::uuid,
           connected_at=(v_prev->>'connected_at')::timestamptz,
           disconnected_at=(v_prev->>'disconnected_at')::timestamptz,
           prev_binding=null, updated_at=now()
     where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref;
  elsif v_found then
    delete from public.external_org_bindings
     where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref;
  end if;
  if not exists (select 1 from public.external_org_bindings where secret_ref=p_secret_ref) then
    perform public.delete_vault_secret(p_secret_ref);
  end if;
  perform public.log_audit('integration.connect.cleanup',p_org_id,p_actor_id,null,
    jsonb_build_object('tier',p_external_tier,'actor',p_actor_id,
      'cleanup',case when v_prev is not null then 'restored_prior' else 'binding' end));
end;
$$;
revoke all on function public.cleanup_external_connect_attempt(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.cleanup_external_connect_attempt(uuid,text,text,uuid) to service_role;

-- 0259 body, reading and clearing prev_binding.
create or replace function public.finalize_external_connect(
  p_org_id uuid,
  p_external_tier text,
  p_secret_ref text,
  p_kill_switch_enabled boolean,
  p_ready boolean,
  p_actor_id uuid
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_is_admin boolean;
  v_is_operator boolean;
  v_prev jsonb;
  v_status text;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actor_id is null then
    raise exception 'actor required' using errcode = '42501';
  end if;
  select exists (select 1 from public.profiles where id=p_actor_id and org_id=p_org_id and role='Admin') into v_is_admin;
  select exists (select 1 from public.platform_operators where user_id=p_actor_id) into v_is_operator;
  if not (v_is_admin or v_is_operator) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if p_external_tier <> 'clickup' then
    raise exception 'unsupported finalize tier' using errcode = 'P0001';
  end if;
  if not p_kill_switch_enabled then
    raise exception 'integration disabled by operator' using errcode = 'P0001';
  end if;
  if not p_ready then
    perform public.cleanup_external_connect_attempt(p_org_id, p_external_tier, p_secret_ref, p_actor_id);
    perform public.delete_vault_secret(p_secret_ref);
    perform public.log_audit('integration.connect.cleanup',p_org_id,p_actor_id,null,
      jsonb_build_object('tier',p_external_tier,'actor',p_actor_id,'cleanup','readiness_failed'));
    return 'rejected';
  end if;
  -- Row lock: serialises against a concurrent stage/cleanup of the same binding.
  select status, prev_binding into v_status, v_prev
    from public.external_org_bindings
   where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref
     for update;
  if v_status is distinct from 'active' then
    raise exception 'binding is not active' using errcode = 'P0001';
  end if;

  insert into public.external_domain_ownership (org_id, external_tier, domain, created_by)
    values (p_org_id, p_external_tier, 'tasks', p_actor_id)
    on conflict (org_id, external_tier, domain) do nothing;

  -- Commit point: a previously ACTIVE credential is now revoked; a disconnected binding's secret went at disconnect.
  if v_prev is not null then
    update public.external_org_bindings set prev_binding = null
     where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref;
    if v_prev->>'status' = 'active' and v_prev->>'secret_ref' <> p_secret_ref then
      perform public.delete_vault_secret(v_prev->>'secret_ref');
    end if;
  end if;

  perform public.log_audit('integration.connect.finalize', p_org_id, p_actor_id, null,
    jsonb_build_object('tier',p_external_tier,'actor',p_actor_id,
      'kill_switch_enabled',p_kill_switch_enabled,'readiness','resolved','ownership','employed'));
  return 'active';
end;
$$;
revoke all on function public.finalize_external_connect(uuid,text,text,boolean,boolean,uuid) from public, anon, authenticated;
grant execute on function public.finalize_external_connect(uuid,text,text,boolean,boolean,uuid) to service_role;

-- 0420 body, reading and clearing prev_binding.
create or replace function public.finalize_odoo_connect(
  p_org_id uuid, p_secret_ref text, p_site_url text, p_database text, p_key_expires_on date,
  p_discard boolean, p_kill_switch_enabled boolean, p_actor_id uuid
) returns text language plpgsql security definer set search_path = public as $$
declare v_row public.external_org_bindings%rowtype; v_prev jsonb; v_same boolean;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if p_actor_id is null or not public.is_active_member(p_actor_id) or not (
       exists (select 1 from public.profiles where id = p_actor_id and org_id = p_org_id and role = 'Admin')
       or exists (select 1 from public.platform_operators where user_id = p_actor_id)) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if not p_kill_switch_enabled then raise exception 'integration disabled by operator' using errcode = 'P0001'; end if;
  if exists (select 1 from public.external_org_bindings where org_id = p_org_id and external_tier = 'erpnext' and status = 'active') then
    raise exception 'another ERP tier is active' using errcode = 'P0001';
  end if;
  if coalesce(p_site_url, '') = '' or coalesce(btrim(p_database), '') = '' then
    raise exception 'site and database are required' using errcode = '22023';
  end if;

  -- Row lock: serialises against a concurrent stage/cleanup of the same binding (0259).
  select * into v_row from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'odoo' and secret_ref = p_secret_ref for update;
  if not found or v_row.status <> 'active' then raise exception 'binding is not active' using errcode = 'P0001'; end if;
  v_prev := v_row.prev_binding;
  v_same := coalesce(v_row.site_url, '') in ('', p_site_url) and coalesce(v_row.config ->> 'database', p_database) = p_database;
  if not v_same then
    if not p_discard then raise exception 'different Odoo database; confirm discard' using errcode = 'P0001'; end if;
    if exists (select 1 from public.external_command_outbox where org_id = p_org_id and external_tier = 'odoo' and state <> 'failed') then
      raise exception 'Odoo documents already reference this connection' using errcode = 'P0001';
    end if;
    perform public.discard_odoo_mirror(p_org_id, p_actor_id);
  end if;

  update public.external_org_bindings
     set site_url = p_site_url,
         prev_binding = null,
         config = coalesce(config, '{}'::jsonb) || jsonb_build_object('database', p_database, 'key_expires_on', p_key_expires_on),
         activated_at = case when v_same then activated_at else null end,
         updated_at = now()
   where org_id = p_org_id and external_tier = 'odoo' and secret_ref = p_secret_ref;
  -- Commit point: a previously ACTIVE key is revoked only now; a disconnected binding's key went at disconnect.
  if v_prev is not null and v_prev ->> 'status' = 'active' and v_prev ->> 'secret_ref' <> p_secret_ref then
    perform public.delete_vault_secret(v_prev ->> 'secret_ref');
  end if;
  perform public.log_audit('integration.connect.finalize', p_org_id, p_actor_id, null,
    jsonb_build_object('tier', 'odoo', 'actor', p_actor_id, 'rotated', v_prev is not null, 'discarded', not v_same));
  return 'active';
end $$;
revoke all on function public.finalize_odoo_connect(uuid,text,text,text,date,boolean,boolean,uuid) from public, anon, authenticated;
grant execute on function public.finalize_odoo_connect(uuid,text,text,text,date,boolean,boolean,uuid) to service_role;

-- 0420 body, reading and clearing prev_binding.
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
  -- AC-ODC-007: a second Odoo disconnect succeeds without effect (no new stamp, no second release audit).
  if p_external_tier = 'odoo' and v_binding.status = 'disconnected' then return 1; end if;

  if v_binding.secret_ref is not null then
    delete from vault.secrets where name = v_binding.secret_ref;
  end if;
  -- An attempt stranded between stage and finalize leaves the prior key named only by the marker; remove it too.
  if v_binding.prev_binding ->> 'secret_ref' is distinct from v_binding.secret_ref then
    delete from vault.secrets where name = v_binding.prev_binding ->> 'secret_ref';
  end if;
  if v_binding.webhook_secret_ref is not null then
    delete from vault.secrets where name = v_binding.webhook_secret_ref;
  end if;
  update public.external_org_bindings
     set status = 'disconnected', disconnected_at = now(), activated_at = null, prev_binding = null,
         version_major = null, config = coalesce(config, '{}'::jsonb) - 'company', updated_at = now()
   where org_id = p_org_id and external_tier = p_external_tier;
  get diagnostics v_touched = row_count;
  if p_external_tier = 'clickup' then
    delete from public.external_domain_ownership
    where org_id = p_org_id and external_tier = 'clickup' and domain = 'tasks';
    perform public.log_audit('integration.domain_ownership.release', p_org_id, p_actor_id, null,
      jsonb_build_object('tier', 'clickup', 'domain', 'tasks', 'actor', p_actor_id));
  end if;
  if p_external_tier = 'odoo' then
    delete from public.external_domain_ownership where org_id = p_org_id and external_tier = 'odoo';
    perform public.log_audit('integration.domain_ownership.release', p_org_id, p_actor_id, null,
      jsonb_build_object('tier', 'odoo', 'actor', p_actor_id));
  end if;
  return v_touched;
end;
$$;
revoke all on function public.disconnect_external_integration(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.disconnect_external_integration(uuid,text,uuid) to service_role;

-- §2: the old connect RPC is service-role only.
revoke execute on function public.create_vault_secret_for_org(uuid,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.create_vault_secret_for_org(uuid,text,text,text,uuid) to service_role;

-- Asserted on THIS database (hosted default grants must not reopen any of these).
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.stage_vault_secret_for_org(uuid, text, text, text, uuid)',
    'public.cleanup_external_connect_attempt(uuid, text, text, uuid)',
    'public.finalize_external_connect(uuid, text, text, boolean, boolean, uuid)',
    'public.finalize_odoo_connect(uuid, text, text, text, date, boolean, boolean, uuid)',
    'public.disconnect_external_integration(uuid, text, uuid)',
    'public.create_vault_secret_for_org(uuid, text, text, text, uuid)'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception '0450: % is still executable by anon/authenticated', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '0450: % lost service_role EXECUTE', fn;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.external_org_bindings', 'prev_binding', 'SELECT')
     or has_column_privilege('anon', 'public.external_org_bindings', 'prev_binding', 'SELECT') then
    raise exception '0450: the rotation marker column is readable by a client role';
  end if;
end $$;
