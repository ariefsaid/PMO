-- 0216_erpnext_activation.sql — #650 / ADR-0073.
-- ERPNext activation becomes a real code path: connect persists site_url, Company selection performs the
-- version handshake and stamps activated_at, disconnect clears it. Three service-role-only SECURITY
-- DEFINER RPCs; NO column is added, dropped or retyped and NO policy/trigger is added to
-- external_org_bindings (authenticated/anon hold SELECT only — a write policy there would be a dead
-- layer that reads like a live control; see ADR-0073 §6 and 0180 §3).
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback, reverse order:
--   drop function if exists public.deactivate_external_binding(uuid, text, uuid);
--   drop function if exists public.activate_external_binding(uuid, text, int, text, jsonb, uuid);
--   drop function if exists public.set_external_binding_site_url(uuid, text, text, uuid);

-- ── FR-EAC-101/102 — persist the connect site URL; a REPOINT un-activates. ───────────────────────
create or replace function public.set_external_binding_site_url(
  p_org_id uuid, p_external_tier text, p_site_url text, p_actor_id uuid
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_prior  text;
  v_result text;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  -- Review #650: this is an HTTPS-scheme check only — NOT a "second SSRF layer". The private-host
  -- rule lives in the edge fn (external-connect / external-set-company); the database cannot resolve
  -- hostnames, so the SSRF boundary cannot be re-enforced here. What this check CAN do is refuse a
  -- future caller pointing the binding at a non-https:// or empty URL (NFR-EAC-SEC-101).
  if p_site_url is null or btrim(p_site_url) = '' or p_site_url !~* '^https://' then
    raise exception 'site_url must be a non-empty https:// URL' using errcode = '22023';
  end if;

  select site_url into v_prior
    from public.external_org_bindings
   where org_id = p_org_id and external_tier = p_external_tier and status = 'active'
   for update;
  if not found then
    raise exception 'no active binding for this org and tier' using errcode = 'P0001';
  end if;

  if coalesce(v_prior, '') <> '' and v_prior is distinct from p_site_url then
    -- FR-EAC-102: activated_at/version_major/config.company describe the OLD site. Keeping them would
    -- let the very next sweep tick push money documents at a different host under a stale company.
    update public.external_org_bindings
       set site_url      = p_site_url,
           activated_at  = null,
           version_major = null,
           config        = coalesce(config, '{}'::jsonb) - 'company',
           updated_at    = now()
     where org_id = p_org_id and external_tier = p_external_tier;
    v_result := 'repointed';
  else
    update public.external_org_bindings
       set site_url = p_site_url, updated_at = now()
     where org_id = p_org_id and external_tier = p_external_tier;
    v_result := 'set';
  end if;

  perform public.log_audit('integration.site_url_set', p_org_id, p_actor_id, null,
    jsonb_build_object('tier', p_external_tier, 'actor', p_actor_id, 'outcome', v_result));
  return v_result;
end;
$$;

-- ── FR-EAC-104/106/107/110 — ONE statement: version + company + defaults + set-once stamp. ───────
-- The supported-major allowlist lives here AS WELL AS in
-- pmo-portal/src/lib/adapterSeam/erpnext/binding.ts (SUPPORTED_VERSION_MAJORS). The edge fn's check is
-- the UX gate; THIS is the authority (FR-EAC-110). Keep the two in step — each has its own test.
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

-- ── FR-EAC-108 — disconnect un-activates in the SAME statement. ──────────────────────────────────
-- The sweep's employ predicates (erpnext-sweep listEmployingOrgsLive, org_has_active_erpnext_binding
-- mig 0160) read activated_at and NEVER read status, so leaving the stamp keeps a disconnected org
-- "employing" until the deleted Vault secret happens to fail. Fail-closed by accident is not a control.
-- No audit here on purpose: external-disconnect emits the single 'integration.disconnect' event, and
-- AC-EAC-019 asserts exactly one.
create or replace function public.deactivate_external_binding(
  p_org_id uuid, p_external_tier text, p_actor_id uuid
) returns int
language plpgsql security definer set search_path = public
as $$
declare v_n int;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.external_org_bindings
     set status          = 'disconnected',
         disconnected_at = now(),
         activated_at    = null,
         version_major   = null,
         config          = coalesce(config, '{}'::jsonb) - 'company',
         updated_at      = now()
   where org_id = p_org_id and external_tier = p_external_tier
  returning 1 into v_n;
  return coalesce(v_n, 0);
end;
$$;

-- ── NFR-EAC-SEC-102 — service-role-only EXECUTE, asserted on THIS database. ──────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.set_external_binding_site_url(uuid, text, text, uuid)',
    'public.activate_external_binding(uuid, text, int, text, jsonb, uuid)',
    'public.deactivate_external_binding(uuid, text, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception '0216: % is still executable by anon/authenticated', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '0216: % lost service_role EXECUTE', fn;
    end if;
  end loop;
end $$;