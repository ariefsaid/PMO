-- 0259_connect_rotate_compensation.sql (#653)
-- A failed reconnect must compensate to the PRIOR binding, not to nothing.
--
-- Before: create_vault_secret_for_org overwrote the org's one binding row and revoked the previous
-- Vault secret immediately; a later finalize/readiness failure then deleted that row, leaving the org
-- with no connection at all.
--
-- Now (ClickUp connect path): stage_vault_secret_for_org writes the new secret and repoints the binding
-- but records the row's prior state under config.prev_binding (secret_ref, status, connected_by,
-- connected_at, disconnected_at). The attempt then ends one of two ways:
--   * finalize_external_connect(ready=true)  -> the marker is cleared; the previous secret is revoked
--                                               only when the prior binding was ACTIVE (a disconnected
--                                               binding's secret was already removed at disconnect);
--   * cleanup / finalize(ready=false)        -> the row is restored exactly to its prior state (an
--                                               active binding stays active on its old secret, a
--                                               disconnected one stays disconnected) and only the NEW
--                                               secret is removed. With no marker (first connect) the
--                                               row is deleted exactly as before.
-- Ordering: stage, cleanup and finalize each take the binding row lock (select ... for update) before
-- reading the marker, so concurrent attempts for one (org, tier) serialise: the later caller reads the
-- marker as the earlier one committed it. stage's upsert computes the marker from the row version it
-- updates, so even two first-connects racing on the insert never overwrite a live binding unrecorded.
-- create_vault_secret_for_org is unchanged (ERPNext and any other caller keep their behaviour).
-- Reversal: rollback/0259_connect_rotate_compensation_down.sql.

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
    -- Record the row's prior state until finalize commits. A re-stage over an unfinalised attempt
    -- keeps the ORIGINAL marker, so compensation always returns to the pre-attempt row. Computed from
    -- the row version being updated (not v_old_*), so a racing insert is recorded too.
    config = case
      when b.secret_ref <> excluded.secret_ref and not (coalesce(b.config, '{}'::jsonb) ? 'prev_binding')
        then coalesce(b.config, '{}'::jsonb)
             || jsonb_build_object('prev_binding', jsonb_build_object(
                  'secret_ref', b.secret_ref, 'status', b.status, 'connected_by', b.connected_by,
                  'connected_at', b.connected_at, 'disconnected_at', b.disconnected_at))
      else b.config end,
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

-- Compensate a failed attempt: restore the row to its pre-attempt state (marker present) or delete it
-- (first connect). The edge function separately removes the attempt's own (new) Vault secret; the
-- previous one is never touched here.
create or replace function public.cleanup_external_connect_attempt(
  p_org_id uuid, p_external_tier text, p_secret_ref text, p_actor_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_prev jsonb;
  v_found boolean;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  select true, config->'prev_binding' into v_found, v_prev
    from public.external_org_bindings
   where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref
     for update;
  if v_prev is not null then
    update public.external_org_bindings
       set secret_ref      = v_prev->>'secret_ref',
           status          = v_prev->>'status',
           connected_by    = (v_prev->>'connected_by')::uuid,
           connected_at    = (v_prev->>'connected_at')::timestamptz,
           disconnected_at = (v_prev->>'disconnected_at')::timestamptz,
           config          = config - 'prev_binding',
           updated_at      = now()
     where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref;
  elsif v_found then
    delete from public.external_org_bindings
     where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref;
  end if;
  perform public.log_audit('integration.connect.cleanup',p_org_id,p_actor_id,null,
    jsonb_build_object('tier',p_external_tier,'actor',p_actor_id,
      'cleanup', case when v_prev is not null then 'restored_prior' else 'binding' end));
end;
$$;
revoke all on function public.cleanup_external_connect_attempt(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.cleanup_external_connect_attempt(uuid,text,text,uuid) to service_role;

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
    -- Compensate to the prior state: the row returns to exactly what it was before the attempt (cleanup
    -- takes the row lock); a first connect deletes the row. Only THIS attempt's secret is removed.
    perform public.cleanup_external_connect_attempt(p_org_id, p_external_tier, p_secret_ref, p_actor_id);
    perform public.delete_vault_secret(p_secret_ref);
    perform public.log_audit('integration.connect.cleanup',p_org_id,p_actor_id,null,
      jsonb_build_object('tier',p_external_tier,'actor',p_actor_id,'cleanup','readiness_failed'));
    return 'rejected';
  end if;
  -- Row lock: serialises against a concurrent stage/cleanup of the same binding.
  select status, config->'prev_binding' into v_status, v_prev
    from public.external_org_bindings
   where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref
     for update;
  if v_status is distinct from 'active' then
    raise exception 'binding is not active' using errcode = 'P0001';
  end if;

  insert into public.external_domain_ownership (org_id, external_tier, domain, created_by)
    values (p_org_id, p_external_tier, 'tasks', p_actor_id)
    on conflict (org_id, external_tier, domain) do nothing;

  -- Commit point: the attempt succeeded. A previously ACTIVE credential is now revoked; a disconnected
  -- binding's secret was already removed at disconnect, so there is nothing to revoke.
  if v_prev is not null then
    update public.external_org_bindings set config = config - 'prev_binding'
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

-- Service-role-only EXECUTE, asserted on THIS database (hosted default grants must not reopen them).
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.stage_vault_secret_for_org(uuid, text, text, text, uuid)',
    'public.cleanup_external_connect_attempt(uuid, text, text, uuid)',
    'public.finalize_external_connect(uuid, text, text, boolean, boolean, uuid)'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception '0259: % is still executable by anon/authenticated', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '0259: % lost service_role EXECUTE', fn;
    end if;
  end loop;
end $$;
