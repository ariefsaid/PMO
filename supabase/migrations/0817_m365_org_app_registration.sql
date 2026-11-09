-- 0817_m365_org_app_registration.sql (#1017 S2) — per-org Microsoft 365 app registration, held server-side.
-- An org Admin enters their own Entra tenant id, client id and client secret; the secret lives only in Vault.
-- The table has no policy and no grant to any API role (0530 pattern): the three service-only definers below
-- are the only path. The edge function (S3) calls them with the verified caller as p_actor_id.
-- Reversal: rollback/0817_m365_org_app_registration_down.sql.

create table public.m365_org_apps (
  org_id        uuid primary key references public.organizations(id) on delete cascade,
  tenant_id     text not null,
  client_id     text not null,
  secret_ref    text not null,
  validated_at  timestamptz not null,
  configured_by uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  -- GUIDs only: 'common'/'organizations' cannot satisfy the callback's tenant binding.
  constraint m365_org_apps_tenant_guid check
    (tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint m365_org_apps_client_guid check
    (client_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
comment on table public.m365_org_apps is
  'Per-org Microsoft 365 app registration (#1017). Secret held in Vault (secret_ref). RLS forced, no policy, no '
  'grant to any API role: service-only definers m365_set_org_app / m365_org_app_resolve / m365_clear_org_app only.';

alter table public.m365_org_apps enable row level security;
alter table public.m365_org_apps force row level security;
revoke all on table public.m365_org_apps from public, anon, authenticated, service_role;

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
  return jsonb_build_object('changed_app', coalesce(v_changed, false));
end;
$$;
revoke all on function public.m365_set_org_app(uuid,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.m365_set_org_app(uuid,text,text,text,uuid) to service_role;

-- The org's app and its secret. Zero rows = the org has no app of its own.
create or replace function public.m365_org_app_resolve(p_org_id uuid)
returns table(tenant_id text, client_id text, client_secret text)
language plpgsql security definer set search_path = public, vault as $$
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query
    select a.tenant_id, a.client_id, s.decrypted_secret::text
      from public.m365_org_apps a
      join vault.decrypted_secrets s on s.name = a.secret_ref
     where a.org_id = p_org_id;
end;
$$;
revoke all on function public.m365_org_app_resolve(uuid) from public, anon, authenticated;
grant execute on function public.m365_org_app_resolve(uuid) to service_role;

-- Remove the org's own app: the org falls back to the deployment app.
create or replace function public.m365_clear_org_app(p_org_id uuid, p_actor_id uuid)
returns void
language plpgsql security definer set search_path = public, vault as $$
declare
  v_old public.m365_org_apps%rowtype;
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
  delete from public.m365_org_apps where org_id = p_org_id;
  delete from vault.secrets where name = v_old.secret_ref;
  perform public.log_audit('m365.app.cleared', p_org_id, p_actor_id, null,
    jsonb_build_object('tenant_id', v_old.tenant_id, 'client_id', v_old.client_id, 'actor', p_actor_id));
end;
$$;
revoke all on function public.m365_clear_org_app(uuid,uuid) from public, anon, authenticated;
grant execute on function public.m365_clear_org_app(uuid,uuid) to service_role;
