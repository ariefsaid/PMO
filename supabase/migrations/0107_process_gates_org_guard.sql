-- 0107_process_gates_org_guard — Luna money audit SHOULD-FIX 8.
--
-- get_process_gates(p_org) (0105 §A) is SECURITY DEFINER and accepted an ARBITRARY p_org with no
-- caller-org check → an authenticated user could read ANY org's process-gate configuration
-- (cross-org config leak). Re-create it to enforce p_org = auth_org_id() (raise 42501 on mismatch).
-- Return shape unchanged (the same jsonb with safe defaults).
--
-- Rollback: re-create the 0105 §A body (the unguarded sql function).

create or replace function public.get_process_gates(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  -- A SECURITY DEFINER reader must not hand back another org's config. The caller may only read
  -- its OWN org's gates; a mismatched p_org is a 42501 (not a silent empty — surfaces misuse).
  if p_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce(
    (select (config -> 'process_gates') from public.external_org_bindings
       where org_id = p_org and external_tier = 'erpnext'),
    '{"require_so_before_si":false,"require_bast_before_si":false,"require_project_on_si":true}'::jsonb
  );
end; $$;
