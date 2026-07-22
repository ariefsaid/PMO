-- 0147_atomic_integration_connect_recovery.sql
-- FR-IEM-005..008: service-role-only atomic finalize and operator break-glass recovery.
-- Vault creation is an external side effect, so the edge function deletes the attempt's Vault
-- secret and invokes cleanup when this transaction rejects. Binding + ownership themselves are
-- committed in this single transaction; no client can call the boundary.
-- Reversal: drop the functions below (binding tombstones and audit rows are retained).

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
    raise exception 'ClickUp sync is not ready' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.external_org_bindings
                 where org_id=p_org_id and external_tier=p_external_tier
                   and secret_ref=p_secret_ref and status='active') then
    raise exception 'binding is not active' using errcode = 'P0001';
  end if;

  insert into public.external_domain_ownership (org_id, external_tier, domain, created_by)
    values (p_org_id, p_external_tier, 'tasks', p_actor_id)
    on conflict (org_id, external_tier, domain) do nothing;
  perform public.log_audit('integration.connect.finalize', p_org_id, p_actor_id, null,
    jsonb_build_object('tier',p_external_tier,'actor',p_actor_id,
      'kill_switch_enabled',p_kill_switch_enabled,'readiness','resolved','ownership','employed'));
  return 'active';
end;
$$;

revoke all on function public.finalize_external_connect(uuid,text,text,boolean,boolean,uuid) from public, authenticated;
grant execute on function public.finalize_external_connect(uuid,text,text,boolean,boolean,uuid) to service_role;

-- Remove only a failed attempt's newly written binding. The edge function separately revokes Vault.
create or replace function public.cleanup_external_connect_attempt(
  p_org_id uuid, p_external_tier text, p_secret_ref text, p_actor_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  delete from public.external_org_bindings
   where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref;
  perform public.log_audit('integration.connect.cleanup',p_org_id,p_actor_id,null,
    jsonb_build_object('tier',p_external_tier,'actor',p_actor_id,'cleanup','binding'));
end;
$$;
revoke all on function public.cleanup_external_connect_attempt(uuid,text,text,uuid) from public, authenticated;
grant execute on function public.cleanup_external_connect_attempt(uuid,text,text,uuid) to service_role;

create or replace function public.recover_external_connect_trap(
  p_org_id uuid,
  p_external_tier text,
  p_kill_switch_enabled boolean,
  p_ready boolean,
  p_actor_id uuid
) returns text
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_ready boolean;
  v_action text;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if not exists (select 1 from public.platform_operators where user_id=p_actor_id) then
    raise exception 'platform operator required' using errcode='42501';
  end if;
  if p_external_tier <> 'clickup' then raise exception 'unsupported recovery tier' using errcode='P0001'; end if;

  -- The operator command supplies the effective switch and bounded readiness proof. The Vault
  -- lookup is repeated here so a stale operator assertion cannot retain ownership without a secret.
  v_ready := p_kill_switch_enabled and p_ready and exists (
    select 1 from public.external_org_bindings b
    join vault.decrypted_secrets s on s.name=b.secret_ref
    where b.org_id=p_org_id and b.external_tier='clickup' and b.status='active'
  );
  if v_ready then
    insert into public.external_domain_ownership(org_id,external_tier,domain,created_by)
      values(p_org_id,'clickup','tasks',p_actor_id)
      on conflict(org_id,external_tier,domain) do nothing;
    v_action := 'retained';
  else
    delete from public.external_domain_ownership
     where org_id=p_org_id and external_tier='clickup' and domain='tasks';
    v_action := 'released';
  end if;
  perform public.log_audit('integration.trap_recovery',p_org_id,p_actor_id,null,
    jsonb_build_object('tier','clickup','actor',p_actor_id,
      'kill_switch_enabled',p_kill_switch_enabled,'readiness',v_ready,
      'ownership_action',v_action));
  return v_action;
end;
$$;
revoke all on function public.recover_external_connect_trap(uuid,text,boolean,boolean,uuid) from public, authenticated;
grant execute on function public.recover_external_connect_trap(uuid,text,boolean,boolean,uuid) to service_role;
