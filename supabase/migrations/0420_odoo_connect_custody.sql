-- 0420_odoo_connect_custody.sql (#1504 O1-S2)
-- Odoo connect custody: the ClickUp atomic pattern (0147/0259/0346) extended for tier `odoo`.
--   1. finalize_odoo_connect      — the commit point after stage_vault_secret_for_org: records site + database,
--                                   refuses while another ERP tier is active, guards a reconnect to another
--                                   database (confirm discard; refused while Odoo documents reference it),
--                                   and revokes the previous key only after the new row commits.
--   2. discard_odoo_mirror        — internal seam the confirmed discard calls (S4 re-creates it for its table).
--   3. activate_odoo_binding      — set-once activation with the chosen Odoo company (PQ-8).
--   4. assert_odoo_activated      — the activation gate every later Odoo read/sweep/mapping path calls.
--   5. disconnect_external_integration — 0341 body plus the Odoo ownership release.
--   6. Column privileges: signed-in readers lose the two secret-reference columns (AC-ODC-009).
-- Reversal: rollback/0420_odoo_connect_custody_down.sql.

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
  v_prev := v_row.config -> 'prev_binding';
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
         config = (coalesce(config, '{}'::jsonb) - 'prev_binding')
                  || jsonb_build_object('database', p_database, 'key_expires_on', p_key_expires_on),
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

-- Discard seam (PQ-9); S4's migration re-creates it to also clear the mirror table. Callable only from finalize.
create or replace function public.discard_odoo_mirror(p_org_id uuid, p_actor_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.external_sync_watermarks where org_id = p_org_id and external_tier = 'odoo';
  delete from public.external_project_bindings where org_id = p_org_id and external_tier = 'odoo';
  delete from public.external_refs where org_id = p_org_id and external_tier = 'odoo';
  update public.external_org_bindings
     set config = config - 'odoo_company_id' - 'odoo_company_name' - 'analytic_plan_id' - 'account_defaults'
                         - 'unit_map' - 'default_warehouse_id' - 'capabilities'
   where org_id = p_org_id and external_tier = 'odoo';
  perform public.log_audit('integration.odoo.discard', p_org_id, p_actor_id, null, jsonb_build_object('tier', 'odoo'));
end $$;
revoke all on function public.discard_odoo_mirror(uuid,uuid) from public, anon, authenticated, service_role;

create or replace function public.activate_odoo_binding(
  p_org_id uuid, p_version_major int, p_company_id int, p_company_name text, p_config_patch jsonb, p_actor_id uuid
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; v_stamp timestamptz;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if p_actor_id is null or not public.is_active_member(p_actor_id) or not (
       exists (select 1 from public.profiles where id = p_actor_id and org_id = p_org_id and role = 'Admin')
       or exists (select 1 from public.platform_operators where user_id = p_actor_id)) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if p_version_major is null or p_version_major < 20 then   -- FR-ODC-022 tested minimum; keep in step with odoo/discovery.ts
    raise exception 'unsupported odoo major version %', coalesce(p_version_major::text, 'null') using errcode = 'P0001';
  end if;
  if p_company_id is null then raise exception 'company is required to activate' using errcode = '22023'; end if;
  select config into v_cfg from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active' and coalesce(site_url, '') <> '' for update;
  if not found then raise exception 'binding is not connectable' using errcode = 'P0001'; end if;
  if v_cfg ? 'odoo_company_id' and (v_cfg ->> 'odoo_company_id')::int <> p_company_id then
    raise exception 'company already chosen' using errcode = 'P0001';
  end if;
  update public.external_org_bindings
     set version_major = p_version_major,
         config = coalesce(config, '{}'::jsonb) || coalesce(p_config_patch, '{}'::jsonb)
                  || jsonb_build_object('odoo_company_id', p_company_id, 'odoo_company_name', p_company_name),
         activated_at = coalesce(activated_at, now()), updated_at = now()
   where org_id = p_org_id and external_tier = 'odoo'
  returning activated_at into v_stamp;
  perform public.log_audit('integration.activate', p_org_id, p_actor_id, null,
    jsonb_build_object('tier', 'odoo', 'actor', p_actor_id, 'company_id', p_company_id, 'version_major', p_version_major));
  return v_stamp;
end $$;
revoke all on function public.activate_odoo_binding(uuid,int,int,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.activate_odoo_binding(uuid,int,int,text,jsonb,uuid) to service_role;

create or replace function public.assert_odoo_activated(p_org_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.external_org_bindings
                  where org_id = p_org_id and external_tier = 'odoo' and status = 'active' and activated_at is not null) then
    raise exception 'Odoo connection is not activated' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.assert_odoo_activated(uuid) from public, anon, authenticated;
grant execute on function public.assert_odoo_activated(uuid) to service_role;

-- 0341 body, plus the Odoo ownership release. The `- 'company'` strip leaves `odoo_company_id`, so a reconnect
-- to the same database resumes (FR-ODC-007).
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

-- AC-ODC-009: signed-in readers keep every column but the two secret references. A column added later must be
-- granted here too (odoo_connect_custody.test.sql fails until it is).
revoke select on public.external_org_bindings from authenticated, anon;
grant select (id, org_id, external_tier, site_url, version_major, config, activated_at, created_at, updated_at,
              status, connected_by, connected_at, disconnected_at, statement_full_ledger_replay_needed,
              statement_update_delayed, statement_last_attempt_at, statement_calendar)
  on public.external_org_bindings to authenticated;
