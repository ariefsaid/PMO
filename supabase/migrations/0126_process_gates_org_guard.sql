-- 0126_process_gates_org_guard — Luna money audit SHOULD-FIX 8.
--
-- get_process_gates(p_org) (0124 §A) is SECURITY DEFINER and accepted an ARBITRARY p_org with no
-- caller-org check → an authenticated user could read ANY org's process-gate configuration
-- (cross-org config leak). Re-create it to enforce p_org = auth_org_id() (raise 42501 on mismatch).
-- Return shape unchanged (the same jsonb with safe defaults).
--
-- Rollback: re-create the 0124 §A body (the unguarded sql function).

create or replace function public.get_process_gates(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  -- A SECURITY DEFINER reader must not hand back another org's config to a USER. The machine
  -- (service_role — the adapter-dispatch pre-flight gate check reads the command's own org) is
  -- exempt; a user-JWT caller may read only its OWN org's gates. A cross-org user read is 42501.
  -- (service_role bypass is load-bearing: the dispatch calls this with the serviceClient, where
  --  auth_org_id() is null — without the bypass every revenue create fails 'gate-check-failed'.)
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and p_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce(
    (select (config -> 'process_gates') from public.external_org_bindings
       where org_id = p_org and external_tier = 'erpnext'),
    '{"require_so_before_si":false,"require_bast_before_si":false,"require_project_on_si":true}'::jsonb
  );
end; $$;
