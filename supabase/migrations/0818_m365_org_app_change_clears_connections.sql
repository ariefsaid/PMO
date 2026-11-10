-- 0818_m365_org_app_change_clears_connections.sql (#1017 S2) — a changed or removed org app clears the org's
-- personal Microsoft 365 connections. The refresh tokens were issued by the old app and the stored tenant binding
-- is now wrong; users see "Reconnect". A secret-only rotation keeps them (same app, tokens stay valid).
-- Bodies are 0817's with the connection delete added (same transaction, one audit row per connection).
-- Reversal: rollback/0818_m365_org_app_change_clears_connections_down.sql restores 0817's bodies.

-- Save an org's own app. p_secret_value null keeps the stored secret (tenant/client edit only).
create or replace function public.m365_set_org_app(
  p_org_id uuid, p_tenant_id text, p_client_id text, p_secret_value text, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, vault as $$
declare
  v_old public.m365_org_apps%rowtype;
  v_have_old boolean;
  v_ref text;
  v_changed boolean;
  r record;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actor_id is null then
    raise exception 'actor required' using errcode = '42501';
  end if;
  perform public.assert_is_active_member(p_actor_id);
  if not (exists (select 1 from public.profiles
                   where id = p_actor_id and org_id = p_org_id and role = 'Admin')
          or exists (select 1 from public.platform_operators where user_id = p_actor_id)) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if not coalesce((select enabled from public.resolve_feature_internal(p_org_id, 'm365_integration')), false) then
    raise exception 'm365 not enabled for this organisation' using errcode = '42501';
  end if;
  if p_secret_value is not null and length(btrim(p_secret_value)) = 0 then
    raise exception 'secret must not be empty' using errcode = '22023';
  end if;

  -- Row lock first: a concurrent save/clear for this org waits for us to commit.
  select * into v_old from public.m365_org_apps where org_id = p_org_id for update;
  v_have_old := found;
  if not v_have_old and p_secret_value is null then
    raise exception 'secret required for a new app' using errcode = '22023';
  end if;

  if p_secret_value is not null then
    v_ref := 'm365-org-app-' || p_org_id::text || '-' || gen_random_uuid()::text;
    perform vault.create_secret(p_secret_value, v_ref);
  else
    v_ref := v_old.secret_ref;
  end if;

  v_changed := v_have_old and (v_old.tenant_id <> lower(p_tenant_id) or v_old.client_id <> lower(p_client_id));

  insert into public.m365_org_apps as a
    (org_id, tenant_id, client_id, secret_ref, validated_at, configured_by, updated_at)
  values (p_org_id, lower(p_tenant_id), lower(p_client_id), v_ref, now(), p_actor_id, now())
  on conflict (org_id) do update set
    tenant_id = excluded.tenant_id, client_id = excluded.client_id, secret_ref = excluded.secret_ref,
    validated_at = excluded.validated_at, configured_by = excluded.configured_by, updated_at = excluded.updated_at;

  -- The previous secret goes after the upsert, same transaction: no window with a row pointing at nothing.
  if v_have_old and v_old.secret_ref <> v_ref then
    delete from vault.secrets where name = v_old.secret_ref;
  end if;

  -- Tenant and client id only: never the secret or its reference.
  perform public.log_audit(
    case when v_have_old then 'm365.app.rotated' else 'm365.app.configured' end,
    p_org_id, p_actor_id, null,
    jsonb_build_object('tenant_id', lower(p_tenant_id), 'client_id', lower(p_client_id),
                       'actor', p_actor_id, 'changed_app', coalesce(v_changed, false)));
  if coalesce(v_changed, false) then
    -- Lock order: org app row (held above) -> connections, parent first (0115). Audit each removed connection.
    perform 1 from public.ms_graph_connections where org_id = p_org_id for update;
    for r in delete from public.ms_graph_connections where org_id = p_org_id returning id, user_id loop
      perform public.log_audit('m365.connection.cleared', p_org_id, p_actor_id, r.id,
        jsonb_build_object('reason', 'app_changed', 'user_id', r.user_id));
    end loop;
  end if;
  return jsonb_build_object('changed_app', coalesce(v_changed, false));
end;
$$;
revoke all on function public.m365_set_org_app(uuid,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.m365_set_org_app(uuid,text,text,text,uuid) to service_role;

-- Remove the org's own app: the org falls back to the deployment app.
create or replace function public.m365_clear_org_app(p_org_id uuid, p_actor_id uuid)
returns void
language plpgsql security definer set search_path = public, vault as $$
declare
  v_old public.m365_org_apps%rowtype;
  r record;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actor_id is null then
    raise exception 'actor required' using errcode = '42501';
  end if;
  perform public.assert_is_active_member(p_actor_id);
  if not (exists (select 1 from public.profiles
                   where id = p_actor_id and org_id = p_org_id and role = 'Admin')
          or exists (select 1 from public.platform_operators where user_id = p_actor_id)) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  select * into v_old from public.m365_org_apps where org_id = p_org_id for update;
  if not found then
    return;
  end if;
  -- Lock order: org app row (held above) -> connections, parent first (0115). Audit each removed connection.
  perform 1 from public.ms_graph_connections where org_id = p_org_id for update;
  for r in delete from public.ms_graph_connections where org_id = p_org_id returning id, user_id loop
    perform public.log_audit('m365.connection.cleared', p_org_id, p_actor_id, r.id,
      jsonb_build_object('reason', 'app_changed', 'user_id', r.user_id));
  end loop;
  delete from public.m365_org_apps where org_id = p_org_id;
  delete from vault.secrets where name = v_old.secret_ref;
  perform public.log_audit('m365.app.cleared', p_org_id, p_actor_id, null,
    jsonb_build_object('tenant_id', v_old.tenant_id, 'client_id', v_old.client_id, 'actor', p_actor_id));
end;
$$;
revoke all on function public.m365_clear_org_app(uuid,uuid) from public, anon, authenticated;
grant execute on function public.m365_clear_org_app(uuid,uuid) to service_role;
