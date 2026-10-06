-- Reverses 0259: drops stage_vault_secret_for_org and restores 0147's cleanup/finalize bodies verbatim.
-- Any in-flight config.prev_secret_ref marker is cleared; a previous secret still retained would be orphaned.
update public.external_org_bindings set config = config - 'prev_secret_ref' where config ? 'prev_secret_ref';
drop function if exists public.stage_vault_secret_for_org(uuid,text,text,text,uuid);
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
    -- Cleanup is part of the database transaction boundary. The edge function also revokes the
    -- external Vault object, but a failed readiness proof can never leave an active binding here.
    delete from public.external_org_bindings
     where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref;
    perform public.delete_vault_secret(p_secret_ref);
    perform public.log_audit('integration.connect.cleanup',p_org_id,p_actor_id,null,
      jsonb_build_object('tier',p_external_tier,'actor',p_actor_id,'cleanup','readiness_failed'));
    return 'rejected';
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
