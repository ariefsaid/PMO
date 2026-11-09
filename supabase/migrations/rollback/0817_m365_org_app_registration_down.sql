-- Rolls back 0817: drops the definers, deletes the Vault secrets the table references, drops the table.
-- Org Admins' own app values are lost; orgs fall back to the deployment app.
drop function if exists public.m365_clear_org_app(uuid, uuid);
drop function if exists public.m365_org_app_resolve(uuid);
drop function if exists public.m365_set_org_app(uuid, text, text, text, uuid);
delete from vault.secrets where name in (select secret_ref from public.m365_org_apps);
drop table if exists public.m365_org_apps;
