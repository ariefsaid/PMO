-- 0169_contract_value_nonneg.sql — FR-HRD-040.
-- Two halves, one task: the RPC guard gives the good error message, the CHECK constraint is the
-- authority for every writer that reaches the column (an UPDATE; see the INSERT-time caveat below).
-- The RPC body is copied VERBATIM (except comments — several 0076 rationale comments are condensed
-- here; do not read that as code drift if diffing 0076 against this file) from
-- 0076_audit_events.sql:170-219 (the current canonical definition — it supersedes 0014 by adding
-- v_old + the log_audit call). The ONLY code change is the p_value guard immediately after `begin`.
-- All org/role/status SoD guards are intact.
--
-- Guard placement: FIRST, before the row load. An invalid value is input validation and reveals
-- nothing about the project, so ordering leaks no information; putting it first means an obviously
-- invalid write never takes a row lock.
--
-- The CHECK is added NOT VALID then VALIDATEd in the same migration purely for READABILITY (the
-- "new writes enforced immediately, old rows checked after" split documents intent) — it is NOT a
-- locking optimization here: `supabase db reset` (and any single-file migration apply) runs the whole
-- file in one transaction, so the ACCESS EXCLUSIVE lock from the ADD CONSTRAINT is held across both
-- statements regardless. If VALIDATE fails, the migration fails LOUDLY — which is the correct
-- outcome, because it means production already holds a bad contract value that needs a human
-- decision.
--
-- contract_value is NOT NULL (0001_init_schema.sql:77), so the CHECK only ever needs to bound the
-- non-null case — no `is null or` branch. The RPC guard below correspondingly rejects a null p_value
-- with its own friendly error rather than letting it reach the column's raw not-null violation.
--
-- SECURITY (security-auditor HIGH-1, 2026-07-28): `>= 0` alone is NOT sufficient — Postgres numeric
-- orders NaN as greater than every ordinary number, so `'NaN'::numeric >= 0` is TRUE. NaN is
-- representable in numeric(14,2) (Infinity is not — the typmod rejects it, so the hole is NaN
-- specifically), and PostgREST coerces the JSON string `"NaN"` straight into it. Without this fix, a
-- value-write role sending `{"p_value":"NaN"}` passes BOTH the guard and the CHECK, poisons
-- sum(contract_value) org-wide (every Exec/Finance dashboard aggregate), and log_audit records it as
-- a legitimate write. The `< 'Infinity'::numeric` half is defense-in-depth for the same ordering
-- property (kept even though the typmod already blocks Infinity, in case the column's precision ever
-- changes).
--
-- ⚑ NOT closed by this migration (security-auditor MEDIUM, tracked separately, out of scope here):
-- `authenticated` still holds table-level INSERT on `projects.contract_value` (only UPDATE was
-- revoked, in 0014). A Project Manager can INSERT a project already in a won status with an
-- arbitrary (though now non-negative, non-NaN) contract_value and no audit_events row — log_audit is
-- wired to this RPC and to AFTER DELETE, not to INSERT. So "the CHECK is the authority" is true for
-- every writer that reaches the column, but it is NOT true that this RPC is the sole writer of
-- contract_value — INSERT-time authority is a separate, pre-existing gap.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback:
--   alter table public.projects drop constraint projects_contract_value_nonneg;
--   -- then re-apply the 0076 body of set_project_contract_value verbatim.

alter table public.projects
  add constraint projects_contract_value_nonneg
  check (contract_value >= 0 and contract_value < 'Infinity'::numeric) not valid;

alter table public.projects validate constraint projects_contract_value_nonneg;

create or replace function set_project_contract_value(p_id uuid, p_value numeric)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_status project_status;
  v_org    uuid;
  v_old    numeric;
  v_role   user_role := auth_role();
  v_on_hand constant text[] := array['Won, Pending KoM','Ongoing Project','On Hold','Close Out'];
begin
  -- FR-HRD-040: reject an invalid value here for the human-readable message; the column CHECK/
  -- NOT NULL are the authority for every UPDATE writer. Null is distinguished from out-of-range
  -- (negative/NaN/Infinity) so the diagnosis is useful; the out-of-range message is asserted
  -- verbatim by pgTAP 0162 for both the negative and the NaN case, so keep it exact.
  if p_value is null then
    raise exception 'contract value is required' using errcode = '23502';
  end if;
  if not (p_value >= 0 and p_value < 'Infinity'::numeric) then
    raise exception 'contract value must be a non-negative number' using errcode = '23514';
  end if;

  select status, org_id, contract_value
    into v_status, v_org, v_old
    from public.projects where id = p_id for update;
  if v_status is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- SECURITY: this role/status gate MUST stay (ADR-0019 SoD).
  if v_status::text = any(v_on_hand) then
    if v_role is null or v_role not in ('Admin','Executive','Finance') then
      raise exception 'changing the contract value on a won project requires Executive or Finance'
        using errcode = '42501';
    end if;
  else
    if v_role is null or v_role not in ('Admin','Executive','Project Manager') then
      raise exception 'not authorized to set the contract value' using errcode = '42501';
    end if;
  end if;

  update public.projects
    set contract_value = p_value,
        last_update    = now()
  where id = p_id;

  perform public.log_audit('project.contract_value.set', v_org, auth.uid(), p_id,
                           jsonb_build_object('from', v_old, 'to', p_value));
end; $$;
