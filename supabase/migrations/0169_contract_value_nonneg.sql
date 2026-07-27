-- 0169_contract_value_nonneg.sql — FR-HRD-040.
-- Two halves, one task: the RPC guard gives the good error message, the CHECK constraint is the
-- authority. The RPC body is copied verbatim from 0076_audit_events.sql:170-219 (the current
-- canonical definition — it supersedes 0014 by adding v_old + the log_audit call). The ONLY change
-- is the p_value sign guard immediately after `begin`. All org/role/status SoD guards are intact.
--
-- Guard placement: FIRST, before the row load. A negative value is input validation and reveals
-- nothing about the project, so ordering leaks no information; putting it first means an obviously
-- invalid write never takes a row lock.
--
-- The CHECK is added NOT VALID then VALIDATEd in the same migration: NOT VALID enforces on all new
-- writes without a table scan, VALIDATE then proves no existing row violates it. If VALIDATE fails,
-- the migration fails LOUDLY — which is the correct outcome, because it means production already
-- holds a negative contract value that needs a human decision.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback:
--   alter table public.projects drop constraint projects_contract_value_nonneg;
--   -- then re-apply the 0076 body of set_project_contract_value verbatim.

alter table public.projects
  add constraint projects_contract_value_nonneg
  check (contract_value is null or contract_value >= 0) not valid;

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
  -- FR-HRD-040: reject negatives here for the human-readable message; the column CHECK is the
  -- authority for every other writer.
  if p_value is not null and p_value < 0 then
    raise exception 'contract value cannot be negative' using errcode = '23514';
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
