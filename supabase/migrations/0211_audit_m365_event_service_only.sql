-- 0211 — audit_m365_event is a service-only wrapper: EXECUTE for service_role/postgres, not authenticated.
--
-- The wrapper takes org AND actor from its arguments and writes through log_audit with no body check
-- — by design, because its only production caller is m365-token-custody with the service key
-- (supabase/functions/m365-token-custody/audit.ts). Its 0110 `revoke all from public` does not remove
-- the explicit EXECUTE grant hosted Supabase gives `authenticated`, so on the cloud any signed-in user
-- could write an audit row into any organisation with any actor id. Found by the #490 adversarial
-- probe on 2026-09-08 (tenant B forged an entry into tenant A; rows removed). Same class as 0210.
do $$
begin
  execute 'revoke execute on function public.audit_m365_event(text, uuid, uuid, uuid, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.audit_m365_event(text, uuid, uuid, uuid, jsonb) to service_role';
  if has_function_privilege('authenticated', 'public.audit_m365_event(text, uuid, uuid, uuid, jsonb)', 'EXECUTE') then
    raise exception '0211: audit_m365_event still executable by authenticated on this database';
  end if;
  if not has_function_privilege('service_role', 'public.audit_m365_event(text, uuid, uuid, uuid, jsonb)', 'EXECUTE') then
    raise exception '0211: audit_m365_event lost service_role EXECUTE';
  end if;
end $$;
