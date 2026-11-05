-- Link, unlink, disconnect and company activation write their audit event in the SAME transaction as the change.
-- Each wrapper calls the existing definer RPC (unchanged) and then log_audit; if either raises, both roll back.
-- Rollback: supabase/migrations/rollback/0691_integration_changes_audited_atomically_down.sql

create function public.link_external_project_audited(
  p_org_id uuid, p_actor_id uuid, p_project_id uuid, p_container_id text, p_config jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  v_id := public.link_external_project(p_org_id, p_actor_id, p_project_id, p_container_id, p_config);
  perform public.log_audit('integration.link', p_org_id, p_actor_id, v_id, jsonb_build_object(
    'tier', 'clickup', 'project_id', p_project_id, 'list_id', p_container_id,
    'direction', p_config -> 'direction', 'actor', p_actor_id));
  return v_id;
end $$;

create function public.unlink_external_integration_audited(
  p_org_id uuid, p_external_tier text, p_project_id uuid, p_actor_id uuid
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_touched integer;
  v_binding_id uuid;
  v_container text;
  v_company text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_external_tier = 'clickup' then
    select id, external_container_id into v_binding_id, v_container
      from public.external_project_bindings
     where org_id = p_org_id and project_id = p_project_id and external_tier = 'clickup' and disconnected_at is null;
  elsif p_external_tier = 'erpnext' then
    select config ->> 'company' into v_company
      from public.external_org_bindings where org_id = p_org_id and external_tier = 'erpnext';
  end if;
  v_touched := public.unlink_external_integration(p_org_id, p_external_tier, p_project_id, p_actor_id);
  if v_touched > 0 then
    perform public.log_audit('integration.unlink', p_org_id, p_actor_id, v_binding_id,
      case when p_external_tier = 'clickup'
        then jsonb_build_object('tier', 'clickup', 'project_id', p_project_id, 'list_id', v_container, 'actor', p_actor_id)
        else jsonb_build_object('tier', p_external_tier, 'company_id', v_company, 'actor', p_actor_id) end);
  end if;
  return v_touched;
end $$;

create function public.disconnect_external_integration_audited(
  p_org_id uuid, p_external_tier text, p_actor_id uuid
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_touched integer;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  v_touched := public.disconnect_external_integration(p_org_id, p_external_tier, p_actor_id);
  if v_touched > 0 then
    perform public.log_audit('integration.disconnect', p_org_id, p_actor_id, null,
      jsonb_build_object('tier', p_external_tier, 'actor', p_actor_id));
  end if;
  return v_touched;
end $$;

create function public.activate_external_binding_audited(
  p_org_id uuid, p_external_tier text, p_version_major int, p_company text, p_config_patch jsonb, p_actor_id uuid
) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_stamp timestamptz;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  v_stamp := public.activate_external_binding(p_org_id, p_external_tier, p_version_major, p_company, p_config_patch, p_actor_id);
  perform public.log_audit('integration.set_company', p_org_id, p_actor_id, null, jsonb_build_object(
    'tier', 'erpnext', 'company_id', p_company, 'actor', p_actor_id,
    'version_major', p_version_major, 'activated_at', v_stamp));
  return v_stamp;
end $$;

revoke all on function public.link_external_project_audited(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.unlink_external_integration_audited(uuid,text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.disconnect_external_integration_audited(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.activate_external_binding_audited(uuid,text,int,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.link_external_project_audited(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.unlink_external_integration_audited(uuid,text,uuid,uuid) to service_role;
grant execute on function public.disconnect_external_integration_audited(uuid,text,uuid) to service_role;
grant execute on function public.activate_external_binding_audited(uuid,text,int,text,jsonb,uuid) to service_role;
