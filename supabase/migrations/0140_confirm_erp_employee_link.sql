-- 0140_confirm_erp_employee_link.sql (ERPNext P3b, Slice 3 — OQ-TSP-10(C), OPEN: adopt-then-confirm).
--
-- The ONE writer of `erp_employees`' link columns (`profile_id`/`link_state`/`linked_by`/`linked_at`).
-- `erp_employees` (migration 0136) is default-deny for `authenticated` — no INSERT/UPDATE/DELETE policy
-- exists — so this is the ONLY path that ever moves a row past `link_state='unlinked'`/`'proposed'`
-- into `'confirmed'`. SECURITY DEFINER (the table is default-deny), therefore it RE-ASSERTS org +
-- Admin INTERNALLY — DEFINER bypasses RLS, so removing either re-assertion would let a non-Admin (or
-- another org's Admin) re-point whose cost a week of hours becomes (the ADR-0011/0012 lesson).
--
-- WHY A HUMAN CONFIRM (the security property, OQ-TSP-10(C)): the adopt feed (`erpnextFeedDeps.ts`'s
-- `mintMirror` timesheets branch) PROPOSES a link from a unique ERP-side work-email match, but that
-- email is Desk-editable in ERPNext — auto-confirming would let anyone with Desk access silently
-- re-point a PMO user's cost identity. Only THIS function, called by an in-org Admin, authorizes a
-- push (FR-TSP-051); a later ERP-side email edit on an already-CONFIRMED row surfaces action-required
-- (`erpnextFeedDeps.ts`'s `employeeFieldPatch`) and the confirmed link STANDS — it is never re-pointed
-- by the feed.
--
-- `linked_by`/`linked_at` are SERVER-RESOLVED (FR-TSP-014): this function takes no such parameter, so a
-- caller cannot forge the confirming witness — `auth.uid()`/`now()` are the only sources.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual reverse:
--   drop function if exists public.confirm_erp_employee_link(uuid, uuid);

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
  if v_org is distinct from public.auth_org_id() or public.auth_role() is distinct from 'Admin' then
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
