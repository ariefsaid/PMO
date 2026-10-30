-- Actor-checked integration link operations. Rollback: drop the three functions below.
create function public.assert_integration_link_actor(p_org_id uuid, p_actor_id uuid, p_project_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state jsonb;
  v_operator boolean;
  v_manager uuid;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  -- Hold standing and role rows through the write, serializing revocation with linking.
  perform 1 from public.profiles where id = p_actor_id for share;
  perform 1 from auth.users where id = p_actor_id for share;
  select true into v_operator from public.platform_operators
    where user_id = p_actor_id for share;
  v_operator := coalesce(v_operator, false);
  v_state := public.actor_authorization_state(p_org_id, p_actor_id);
  if not coalesce((v_state->>'active')::boolean, false) then
    raise exception 'active organization member required' using errcode = '42501';
  end if;
  if p_project_id is not null then
    select project_manager_id into v_manager from public.projects
      where id = p_project_id and org_id = p_org_id for share;
    if not found then raise exception 'project not found' using errcode = '42501'; end if;
  end if;
  if v_state->>'role' = 'Admin' or v_operator or
    (p_project_id is not null and v_state->>'role' = 'Project Manager' and v_manager = p_actor_id) then
    return;
  end if;
  raise exception 'current authority required' using errcode = '42501';
end $$;
revoke all on function public.assert_integration_link_actor(uuid,uuid,uuid) from public, anon, authenticated, service_role;

create function public.link_external_project(p_org_id uuid, p_actor_id uuid, p_project_id uuid, p_container_id text, p_config jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.assert_integration_link_actor(p_org_id, p_actor_id, p_project_id);
  insert into public.external_project_bindings(org_id, project_id, external_tier, external_container_id, config, linked_by, linked_at)
  values (p_org_id, p_project_id, 'clickup', p_container_id, p_config, p_actor_id, now()) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.link_external_project(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.link_external_project(uuid,uuid,uuid,text,jsonb) to service_role;

create function public.link_external_company(p_org_id uuid, p_actor_id uuid, p_company text, p_site_url text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_integration_link_actor(p_org_id, p_actor_id, null);
  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('company', p_company)
   where org_id = p_org_id and external_tier = 'erpnext' and status = 'active' and site_url = p_site_url;
  return found;
end $$;
revoke all on function public.link_external_company(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.link_external_company(uuid,uuid,text,text) to service_role;
