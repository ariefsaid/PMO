-- rollback/0860_odoo_labour_employee_feed_down.sql — reverses 0860_odoo_labour_employee_feed.sql.
-- `erp_employees` itself predates 0860 (0136 §2) and is NOT dropped: only the two machine writers this migration added, the
-- upsert's unique index, and the amended confirm body (restored to 0148's verbatim).
-- Order: confirm first (its new body references nothing this migration adds), then the census finish, then the page writer,
-- then the index.

drop function if exists public.finish_odoo_employee_census(uuid, text, jsonb, text);
drop function if exists public.apply_odoo_employees(uuid, jsonb, text);

create or replace function public.confirm_erp_employee_link(p_erp_employee_id uuid, p_profile_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_org uuid;
  v_actor uuid := auth.uid();
  v_target_org uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Load + lock the row (serializes a concurrent confirm on the SAME Employee). P0002 if absent.
  select e.org_id into v_org from public.erp_employees e where e.id = p_erp_employee_id for update;
  if v_org is null then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;

  -- Org + Admin re-assertion — MUST STAY (SECURITY DEFINER bypasses RLS entirely; without this any
  -- authenticated caller, in ANY org, could confirm ANY org's Employee link).
  --
  -- ⚑ `is_active_member()` is part of that re-assertion, not an extra: `auth_role()` reads
  -- `profiles.role` with NO status filter, and this function is `grant execute … to authenticated`,
  -- i.e. reachable DIRECTLY over PostgREST — the edge fn's own auth guard is not in the path. Without
  -- it, a just-disabled or raw-banned Admin holding a still-valid JWT could keep re-pointing an
  -- employee COST IDENTITY (whose hours post against whose costing rate) until their token expires.
  -- This is the 0128/0129/0130 offboarding pass applied to P3b's new definer function — the same gap
  -- those migrations closed for the P3a money RPCs (0062 status + 0095 banned_until).
  if v_org is distinct from public.auth_org_id()
     or public.auth_role() is distinct from 'Admin'
     or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- The PMO user being linked must be in the SAME org (never link across tenants).
  select p.org_id into v_target_org from public.profiles p where p.id = p_profile_id;
  if v_target_org is distinct from v_org then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- linked_by/linked_at are SERVER-RESOLVED (FR-TSP-014) — no payload parameter exists for either, so
  -- a caller cannot forge the witness. The partial-unique index (0136,
  -- erp_employees_org_profile_confirmed_uidx) rejects a SECOND confirm for the same p_profile_id with
  -- 23505 (OQ-TSP-10(ii) drafted: at most one confirmed Employee per PMO user).
  update public.erp_employees
     set profile_id = p_profile_id,
         link_state = 'confirmed',
         linked_by  = v_actor,
         linked_at  = now()
   where id = p_erp_employee_id;

  perform public.log_audit(
    'confirm_erp_employee_link',
    v_org,
    v_actor,
    p_erp_employee_id,
    jsonb_build_object('profile_id', p_profile_id)
  );
end;
$$;

revoke all     on function public.confirm_erp_employee_link(uuid, uuid) from public;
grant  execute on function public.confirm_erp_employee_link(uuid, uuid) to   authenticated;
revoke execute on function public.confirm_erp_employee_link(uuid, uuid) from anon;

-- Last: the arbiter index. Dropped after the writer that uses it, so the rollback never leaves a writer without its arbiter.
drop index if exists public.erp_employees_org_number_uq;
