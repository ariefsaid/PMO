-- 0139_budget_version_activated_at.sql — the ADR-0059 §4 deterministic-key STATE STAMP (spec OQ-BUD-2(a)).
--
-- ⚑ OWNER-RATIFIED 2026-07-20 as an explicitly-scoped exception to ADR-0059 §3.1 ("do not modify the PMO
--   transition"). It is a WITNESS, not a rule: additive + nullable, adds NO gate, changes NO state-machine
--   semantics, alters NO existing row, and is read by NO KPI (get_project_budget does not touch it).
--
-- WHY. The P3c budget push has TWO legitimate originators with no shared client state (the activation
-- consequence and the sweep backstop), so ADR-0059 §4 requires a key both DERIVE from DB truth:
--     'bud:' || budget_version_id || ':' || activated_at
-- The version id alone is not that key. It is not merely a duplicate-suppression concern: without a
-- per-activation component the key is a property of the ROW, not of the ACT, so any second activation of a
-- given version id would collide (23505) with the first push and be suppressed — silently leaving ERPNext
-- enforcing a budget PMO no longer holds. `activated_at` makes each activation a distinct command by
-- construction and gives the side mirror (`budget_version_erp_mirror.activated_at_witness`, 0137) a
-- server-resolved witness to record.
--
-- ⚑ NOTE FOR THE READER (correcting spec OQ-BUD-2's rationale): the shipped RPC ALREADY refuses a non-Draft
--   version (`if v_status <> 'Draft' … P0001`, 0005:44), so the spec's "an Archived version can be
--   re-activated, reusing its original key" scenario is NOT reachable today — a roll-back is a
--   clone→activate, which mints a NEW version id. The stamp is therefore defence-in-depth + the ADR-0059 §4
--   contract made explicit, not the repair of a live hole. It is kept because the key must be a property of
--   the activation act, and must not silently become wrong if that Draft-only guard is ever relaxed.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual reverse:
--   alter table public.budget_versions drop column if exists activated_at;
--   -- and restore activate_budget_version's body verbatim from 0005_budget_mutation_rpc.sql.
--
-- pgTAP: supabase/tests/budget_version_activated_at.test.sql (the stamp AND the byte-for-byte preservation
--        of the archive step, the single-Active invariant, the Draft-only guard and get_project_budget).
--        The shipped budget suite (0008-0012, 0060, 0075) stays green unchanged — the other half of the proof.

alter table public.budget_versions add column if not exists activated_at timestamptz;

comment on column public.budget_versions.activated_at is
  'When this version was last set Active by activate_budget_version (null = never activated). The '
  'ADR-0059 §4 deterministic-key state stamp for the P3c ERPNext budget push; read by no KPI.';

-- Re-created from 0005_budget_mutation_rpc.sql. Every line below is lifted from that file — the
-- org/project defence-in-depth checks, the Draft-only guard, the archive-the-current-Active step and
-- the single-Active invariant are unchanged. TWO deltas, both marked inline: the `activated_at = now()`
-- stamp on the final update, and (MEDIUM-F) the `is_active_member()` offboarding conjunct in the
-- authorization re-assertion.
create or replace function activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status;
begin
  select project_id, org_id, status into v_project, v_org, v_status
    from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  -- ⚑ MEDIUM-F (Luna re-audit round 2, 2026-07-21) — THE ONE AUTHORIZATION DELTA vs 0005, and it is
  -- deliberate: `and public.is_active_member()`. Preserving 0005's body verbatim also preserved its
  -- pre-offboarding gap. `auth_role()` reads `profiles.role` with NO status filter (0130's own header
  -- says so) and this function is `grant execute … to authenticated`, i.e. reachable DIRECTLY over
  -- PostgREST — so a DEACTIVATED or raw-banned PM/Finance holding an unexpired JWT could archive the
  -- Active version, make a version of their choosing Active (moving every budget KPI: get_project_budget
  -- / get_budget_projection / margin / at-risk / S-curve) and — new in P3c — trigger a real ERPNext
  -- Budget push that changes the client's GL overspend controls. This is the 0128/0129/0130 offboarding
  -- pass applied to the RPC 0139 rewrote; 0140 closed the identical hole for confirm_erp_employee_link.
  -- The PLAIN conjunct (not 0138's resolved-actor form) is correct: this RPC has NO service-role caller
  -- — every caller is a user JWT (`pmo-portal/src/lib/db/budgets.ts`), so `auth.uid()` is always set.
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Defense-in-depth (audit HIGH-BV-1): also assert the parent project belongs to the caller's org, so a
  -- definer-context archive-by-project_id can never cross orgs even if a grafted version slipped past RLS.
  if (select org_id from public.projects where id = v_project) is distinct from auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be activated' using errcode = 'P0001'; end if;
  update budget_versions set status = 'Archived'
    where project_id = v_project and status = 'Active';
  -- ⚑ THE ONLY DELTA vs 0005: stamp the activation witness (OQ-BUD-2(a)). A previously-Active version
  -- archived above KEEPS its own historical activated_at — it is a witness of when that version was
  -- activated, not a marker of "is currently Active" (status owns that).
  update budget_versions set status = 'Active', activated_at = now() where id = version_id;
end; $$;
revoke all on function activate_budget_version(uuid) from public;
grant execute on function activate_budget_version(uuid) to authenticated;
revoke execute on function activate_budget_version(uuid) from anon;
