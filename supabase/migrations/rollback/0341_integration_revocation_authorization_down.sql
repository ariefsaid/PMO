drop function if exists public.unlink_external_integration(uuid,text,uuid,uuid);
drop function if exists public.disconnect_external_integration(uuid,text,uuid);
grant execute on function public.delete_vault_secret(text) to service_role;
