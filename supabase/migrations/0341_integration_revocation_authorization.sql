-- Integration revocation is authorized and applied in one transaction.
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

create or replace function public.unlink_external_integration(
  p_org_id uuid, p_external_tier text, p_project_id uuid, p_actor_id uuid
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_touched integer;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not public.is_active_member(p_actor_id) then
    raise exception 'active member required' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_actor_id and org_id = p_org_id;
  if not found then raise exception 'actor not in organization' using errcode = '42501'; end if;

  if p_external_tier = 'clickup' then
    if v_role not in ('Admin', 'Project Manager') and not exists (
      select 1 from public.platform_operators where user_id = p_actor_id
    ) then raise exception 'Admin, Operator, or project manager required' using errcode = '42501'; end if;
    update public.external_project_bindings b set disconnected_at = now()
    where b.org_id = p_org_id and b.project_id = p_project_id and b.external_tier = 'clickup'
      and b.disconnected_at is null
      and (v_role in ('Admin') or exists (
        select 1 from public.projects p where p.id = b.project_id and p.org_id = p_org_id
          and p.project_manager_id = p_actor_id
      ) or exists (select 1 from public.platform_operators where user_id = p_actor_id));
  elsif p_external_tier = 'erpnext' then
    if v_role <> 'Admin' and not exists (
      select 1 from public.platform_operators where user_id = p_actor_id
    ) then raise exception 'Admin or Operator required' using errcode = '42501'; end if;
    update public.external_org_bindings set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('company', null)
    where org_id = p_org_id and external_tier = 'erpnext' and config ? 'company'
      and config->'company' <> 'null'::jsonb;
  else
    raise exception 'unsupported integration tier' using errcode = '22023';
  end if;
  get diagnostics v_touched = row_count;
  return v_touched;
end;
$$;
revoke all on function public.unlink_external_integration(uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.unlink_external_integration(uuid,text,uuid,uuid) to service_role;

-- The generic Vault deletion primitive is internal-only. External callers use the
-- actor-aware disconnect transaction; existing definer functions retain owner execution.
revoke execute on function public.delete_vault_secret(text) from service_role;
