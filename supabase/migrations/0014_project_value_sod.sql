-- 0014_project_value_sod.sql — contract_value segregation-of-duties edit RPC (ADR-0019).
--
-- The CRUD+RBAC program (docs/plans/2026-06-07-crud-rbac-program.md §Owner decisions) adds a
-- LIGHT SoD on a project's contract_value: a Project Manager may set/estimate it while a deal is
-- PRE-WIN; once the project is WON/on-hand, changing the value requires Executive or Finance
-- (Admin = break-glass). RLS is the enforcement authority; the FE gate (can('editContractValue',
-- 'project', {record:{status}}) in src/auth/policy.ts) is only a clarity projection.
--
-- Two moving parts, both required:
--   (1) A SECURITY DEFINER RPC `set_project_contract_value(p_id, p_value)` that re-asserts org +
--       role + status internally and is the SOLE writer of contract_value.
--   (2) Removing `contract_value` from the 0008 direct-UPDATE column grant, so a direct
--       `update projects set contract_value = …` by a 4-role insider is denied (42501) and the
--       RPC is the only path — exactly the MED-PR-1 lockdown 0008 applied to the win-capture columns.
--
-- Follows the ADR-0011/0012 transition-RPC pattern (security-definer + INTERNAL authz re-assertion
-- + pinned search_path = public + schema-qualified refs + revoke-anon). Removing either internal
-- re-assertion (org or role/status) would bypass RLS and permit a cross-org / unauthorized value
-- change — they MUST stay. Calls auth_org_id()/auth_role() from 0002_rls.sql.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Forward-only/additive. Manual rollback:
--   drop function if exists public.set_project_contract_value(uuid, numeric);
--   revoke update on projects from authenticated;
--   grant update (id, org_id, code, name, client_id, project_manager_id, contract_value, budget,
--                 spent, start_date, end_date, created_at, last_update, archived_at)
--     on projects to authenticated;

-- ============================================================================
-- A1 — set_project_contract_value: the SOLE writer of projects.contract_value.
-- map-as-data SoD on the project status: ON-HAND/WON (Won, Pending KoM / Ongoing Project /
-- On Hold / Close Out) → Exec·Finance·Admin (money authority); PRE-WIN (pipeline / Loss Tender /
-- Internal Project) → Admin·Exec·Project Manager (delivery origination). Mirrors policy.ts exactly.
-- ============================================================================
create or replace function set_project_contract_value(p_id uuid, p_value numeric)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_status project_status;
  v_org    uuid;
  v_role   user_role := auth_role();
  -- The four WON/on-hand statuses past the pre-win boundary (mirror of ON_HAND_STATUSES in
  -- src/lib/db/projectTransitions.ts + policy.ts). EXACT enum spelling (note the comma).
  v_on_hand constant text[] := array['Won, Pending KoM','Ongoing Project','On Hold','Close Out'];
begin
  -- Load + lock the row (serializes concurrent value edits on the SAME project). P0002 if absent.
  select status, org_id into v_status, v_org from public.projects where id = p_id for update;
  if v_status is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation: proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- SoD role gate, conditioned on the win boundary (ADR-0019).
  -- SECURITY: this role/status gate MUST stay — removing it lets a PM change a won value (the
  -- segregation of duties being enforced) or any authenticated user write the column.
  if v_status::text = any(v_on_hand) then
    -- WON / on-hand: money authority only (Exec/Finance, Admin break-glass).
    if v_role is null or v_role not in ('Admin','Executive','Finance') then
      raise exception 'changing the contract value on a won project requires Executive or Finance'
        using errcode = '42501';
    end if;
  else
    -- Pre-win: delivery origination roles set/estimate the value.
    if v_role is null or v_role not in ('Admin','Executive','Project Manager') then
      raise exception 'not authorized to set the contract value' using errcode = '42501';
    end if;
  end if;

  update public.projects
    set contract_value = p_value,
        last_update    = now()
  where id = p_id;
end; $$;
revoke all     on function set_project_contract_value(uuid, numeric) from public;
grant  execute on function set_project_contract_value(uuid, numeric) to   authenticated;
revoke execute on function set_project_contract_value(uuid, numeric) from anon;

-- ============================================================================
-- A2 — Remove contract_value from the direct-UPDATE column grant (ADR-0019).
-- 0008 revoked the table-wide UPDATE and re-granted an explicit column list (to make the
-- win-capture columns RPC-only); 0012 re-established that list + archived_at. Postgres column
-- privileges are not reduced by a column-level REVOKE on top of a table grant, so we re-issue the
-- pattern: revoke the table-wide UPDATE, then re-grant the column list MINUS contract_value. The
-- omitted column (contract_value) thus becomes writable ONLY by the security-definer RPC above —
-- identical to how status / decided_at / customer_contract_ref / contract_date are already RPC-only.
-- This is a column PRIVILEGE change, NOT an RLS change: projects_write still gates org + role on the
-- row; this only narrows WHICH column the row policy's UPDATE may touch directly.
-- ============================================================================
revoke update on projects from authenticated;
grant  update (id, org_id, code, name, client_id, project_manager_id, budget, spent,
               start_date, end_date, created_at, last_update, archived_at)
  on projects to authenticated;
