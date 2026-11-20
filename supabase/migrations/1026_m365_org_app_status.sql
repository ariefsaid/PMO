-- 1026_m365_org_app_status.sql — #2260: read an organization's own Microsoft 365 app WITHOUT its secret,
-- with the moment Microsoft last accepted those values.
--
-- The values are already recorded: 0817's m365_org_apps stamps validated_at on every validated save, but
-- the only read that returns them (m365_org_app_resolve) also returns the decrypted secret, so the setup
-- card cannot use it. This definer is that read: the ids, the validation time and whether a secret is
-- stored — never the secret or its Vault reference. The table keeps its 0817 lockdown (forced RLS, no
-- policy, no grant to any API role).
--
-- Reverse: rollback/1026_m365_org_app_status_down.sql
create function public.m365_org_app_status(p_org_id uuid)
returns table(tenant_id text, client_id text, validated_at timestamptz, secret_set boolean)
language plpgsql stable security definer set search_path = public, vault as $$
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query
    select a.tenant_id, a.client_id, a.validated_at,
           exists (select 1 from vault.secrets s where s.name = a.secret_ref)
      from public.m365_org_apps a
     where a.org_id = p_org_id;
end;
$$;
comment on function public.m365_org_app_status(uuid) is
  'Service-only read of an organization''s own Microsoft 365 app (#2260): tenant id, client id, the '
  'validation time and whether the Vault secret is present. Never the secret.';
revoke all on function public.m365_org_app_status(uuid) from public, anon, authenticated;
grant execute on function public.m365_org_app_status(uuid) to service_role;
