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

revoke select on public.external_org_bindings from authenticated;
grant select on public.external_org_bindings to authenticated, anon;
