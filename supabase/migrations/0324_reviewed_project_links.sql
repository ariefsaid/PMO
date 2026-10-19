-- 0324_reviewed_project_links.sql — AC-S09-004.
-- Persist one explicit reviewed ERPNext project identity with an org/site/config CAS and audit row.
--
-- Reversible: rollback/0324_reviewed_project_links_down.sql drops only this additive RPC.

create or replace function public.confirm_erp_project_link(
  p_org_id uuid,
  p_actor_id uuid,
  p_project_id uuid,
  p_erp_project text,
  p_expected_config jsonb,
  p_site_url text,
  p_expected_erp_project text
) returns boolean
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_actor_state jsonb;
  v_binding public.external_org_bindings%rowtype;
  v_project_map jsonb;
  v_current_target text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_org_id is null or p_actor_id is null or p_project_id is null then
    raise exception 'organization, actor, and project are required' using errcode = '22023';
  end if;
  if p_expected_config is null or jsonb_typeof(p_expected_config) <> 'object' then
    raise exception 'expected ERP configuration must be an object' using errcode = '22023';
  end if;
  if p_erp_project is null or btrim(p_erp_project) = '' or length(p_erp_project) > 140 then
    return false;
  end if;
  if nullif(btrim(p_expected_erp_project), '') is null and p_expected_erp_project is not null then
    raise exception 'expected ERP project must be null or a canonical identity' using errcode = '22023';
  end if;

  v_actor_state := public.actor_authorization_state(p_org_id, p_actor_id);
  if coalesce(v_actor_state ->> 'role', '') <> 'Admin'
     or not coalesce((v_actor_state ->> 'active')::boolean, false) then
    raise exception 'active organization Admin required' using errcode = '42501';
  end if;

  select * into v_binding
    from public.external_org_bindings
   where org_id = p_org_id
     and external_tier = 'erpnext'
     and status = 'active'
     and site_url = p_site_url
   for update;
  if not found then
    return false;
  end if;
  if nullif(btrim(v_binding.config ->> 'company'), '') is null
     or v_binding.config ->> 'company' is distinct from p_expected_config ->> 'company' then
    return false;
  end if;

  if not (v_binding.config ? 'project_map') then
    v_project_map := '{}'::jsonb;
  elsif jsonb_typeof(v_binding.config -> 'project_map') <> 'object' then
    return false;
  else
    v_project_map := v_binding.config -> 'project_map';
  end if;
  v_current_target := nullif(btrim(v_project_map ->> p_project_id::text), '');

  perform 1
    from public.projects p
   where p.id = p_project_id
     and p.org_id = p_org_id
     and p.archived_at is null
     and p.status::text = any (array[
       'Won, Pending KoM',
       'Ongoing Project',
       'On Hold',
       'Close Out',
       'Internal Project'
     ]::text[])
   for update;
  if not found then
    return false;
  end if;

  -- A retry for the identity already present is harmless. Other changed targets are a reviewed
  -- conflict; the edge handler must ask the Admin to inspect again instead of overwriting them.
  if v_current_target = p_erp_project then
    return true;
  end if;
  if v_current_target is distinct from p_expected_erp_project then
    return false;
  end if;

  -- Compare the complete config only after the identity fence. The edge handler may refresh
  -- unrelated keys after a false CAS, but it never changes the reviewed prior target.
  if v_binding.config is distinct from p_expected_config then
    return false;
  end if;

  update public.external_org_bindings
     set config = jsonb_set(
           v_binding.config,
           '{project_map}',
           v_project_map || jsonb_build_object(p_project_id::text, p_erp_project),
           true
         ),
         updated_at = now()
   where id = v_binding.id;

  perform public.log_audit(
    'integration.project_link_confirmed',
    p_org_id,
    p_actor_id,
    p_project_id,
    jsonb_build_object('previous', v_current_target, 'confirmed', p_erp_project)
  );
  return true;
end;
$$;

revoke all on function public.confirm_erp_project_link(uuid,uuid,uuid,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.confirm_erp_project_link(uuid,uuid,uuid,text,jsonb,text,text)
  to service_role;

comment on function public.confirm_erp_project_link(uuid,uuid,uuid,text,jsonb,text,text) is
  'Confirms one explicitly reviewed ERPNext Project mapping with org, delivery-or-internal stage, site, expected-identity, config-CAS, and same-transaction audit checks.';
