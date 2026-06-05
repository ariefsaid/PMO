-- 0007_timesheet_approval.sql — Timesheet submit/approve module (timesheets-approval.spec / OD-TS).
-- Follows the ADR-0012 pattern (the procurement transition-RPC: security-definer + internal authz
-- re-assertion + map-as-data legality + pinned search_path = public + revoke-anon + schema-qualified
-- table refs), itself ADR-0011 generalized. No new ADR: single-table whole-week state machine, no
-- doc-number minter, no child tables. Forward-only, additive; reversibility = `supabase db reset`
-- (pre-production, ADR-0006). Calls auth_org_id()/auth_role() from 0002_rls.sql.

-- ============================================================================
-- A1 — profiles.manager_id (FR-TS-007). Nullable self-FK: the employee's line manager (OD-TS-1).
-- ============================================================================
alter table profiles add column manager_id uuid references profiles(id);
create index profiles_manager_id_idx on profiles (manager_id);

-- LOW-TS-3: now that manager_id exists, re-pin profiles_update_self so a non-Admin self-update cannot
-- re-route its own approval line. Mirrors the existing role/org_id pin mechanism (0002): the WITH CHECK
-- requires manager_id to equal the persisted value (`is not distinct from` is null-safe). Only
-- profiles_admin_write may change manager_id. Drop+recreate (the column didn't exist at 0002's apply
-- time, so it could not be pinned there).
drop policy profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (id = auth.uid())
  with check (
    org_id = (select p.org_id from profiles p where p.id = auth.uid())
    and role = (select p.role from profiles p where p.id = auth.uid())
    and manager_id is not distinct from (select p.manager_id from profiles p where p.id = auth.uid()));

-- ============================================================================
-- A2 — RLS read-widening (FR-TS-008, OD-TS-4). drop+recreate timesheets_select adding a manager-of
-- clause so a line-manager (even an Engineer-role one, NOT in the privileged-read set) can SELECT their
-- reports' submitted timesheets — otherwise their approval queue would always be empty and the
-- manager-approve UI path inoperable. Preserves the existing own-row + privileged-role clauses; widens
-- read only (no write change). The same-table subselect on profiles reads own-row style — auth.uid()
-- resolves without recursing into timesheets RLS.
-- ============================================================================
drop policy timesheets_select on timesheets;
create policy timesheets_select on timesheets for select
  using (org_id = auth_org_id() and (user_id = auth.uid()
         or auth_role() in ('Admin','Executive','Project Manager','Finance')
         or exists (select 1 from public.profiles p
                    where p.id = timesheets.user_id and p.manager_id = auth.uid())));

-- ============================================================================
-- A3/A4/A5 — transition_timesheet: the single authority for all timesheet status changes
-- (FR-TS-001..006/009/010, NFR-TS-ATOM-001). map-as-data legality (P0001) + SoD-before-role authz
-- matrix (42501) + atomic status+stamp update.
-- SECURITY DEFINER so the status + stamp write is one indivisible txn; it therefore RE-ASSERTS
-- auth_org_id() + the authorization matrix + SoD INTERNALLY. Removing any of these re-assertions would
-- bypass RLS and permit cross-org / unauthorized / SoD-violating transitions — they MUST stay
-- (ADR-0011/0012 lesson). search_path pinned to public; table refs schema-qualified (LOW-BV-1).
-- ============================================================================
create or replace function transition_timesheet(p_timesheet_id uuid, p_to timesheet_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from  timesheet_status;
  v_org   uuid;
  v_owner uuid;
  v_uid   uuid      := auth.uid();
  v_role  user_role := auth_role();
  v_mgr   uuid;
  -- The transition map (OD-TS-2 config seam): legal (from → [allowed to]) superset, as data.
  v_legal jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted'),
    'Submitted', jsonb_build_array('Approved','Rejected'),
    'Rejected',  jsonb_build_array('Draft'),
    'Approved',  jsonb_build_array()
  );
begin
  -- Load + lock the row (serializes concurrent transitions on the SAME timesheet). P0002 if absent.
  select status, org_id, user_id
    into v_from, v_org, v_owner
    from public.timesheets where id = p_timesheet_id for update;
  if v_from is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation (FR-TS-003): proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality (FR-TS-001): (from,to) must be in the data map, else P0001.
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- Authorization matrix + SoD (OD-TS-1/OD-TS-4, FR-TS-004/005/006). Resolve the owner's line manager.
  -- SECURITY: these re-assertions MUST stay (definer bypasses RLS).
  select manager_id into v_mgr from public.profiles where id = v_owner;

  if p_to = 'Submitted' then
    -- Submit: only the owner may submit their own Draft sheet (FR-TS-004).
    if v_uid is distinct from v_owner then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    -- SoD FIRST, ALWAYS — even an Admin can never approve/reject their own timesheet (OD-TS-4-D, FR-TS-005).
    -- This `actor = owner` check is intentionally ordered BEFORE the role/manager check so break-glass
    -- can never defeat separation of duties. Do not reorder.
    if v_uid = v_owner then
      raise exception 'separation of duties: cannot approve own timesheet' using errcode = '42501';
    end if;
    -- Then: the assigned line manager (exclusive when set); OR Admin/Exec fallback ONLY when manager is
    -- null; OR Admin break-glass (OD-TS-4-D).
    -- HIGH-TS-1: `v_uid is not distinct from v_mgr` is null-safe — it yields FALSE (not NULL) when
    -- v_mgr is null, so `not (false or ...)` no longer short-circuits to NULL and skips the raise.
    -- The Admin/Exec fallback is therefore gated STRICTLY to a null manager; a non-privileged
    -- bystander on a null-manager sheet now correctly hits 42501.
    if not (v_uid is not distinct from v_mgr
            or (v_mgr is null and v_role in ('Admin','Executive'))
            or v_role = 'Admin') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif p_to = 'Draft' then
    -- Rework: only the owner reworks a Rejected sheet back to Draft (FR-TS-006).
    if v_uid is distinct from v_owner then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;

  -- Atomic single update: status + the relevant stamp(s) in the SAME statement ⇒ no observable partial
  -- state (NFR-TS-ATOM-001). Rework → Draft leaves submitted_at/approved_by/approved_at as-is (OD-TS-4-A:
  -- audit trail of the last cycle; overwritten on the next submit/approve).
  update public.timesheets set
    status       = p_to,
    submitted_at = case when p_to = 'Submitted'            then now()  else submitted_at end,
    approved_by  = case when p_to in ('Approved','Rejected') then v_uid else approved_by  end,
    approved_at  = case when p_to in ('Approved','Rejected') then now() else approved_at  end
  where id = p_timesheet_id;
end; $$;
revoke all     on function transition_timesheet(uuid, timesheet_status, text) from public;
grant  execute on function transition_timesheet(uuid, timesheet_status, text) to   authenticated;
revoke execute on function transition_timesheet(uuid, timesheet_status, text) from anon;
