-- 0151_timesheet_reopen_unpushed.sql — Timesheet re-open (Slice A): Approved → Draft for a sheet
-- with NO confirmed ERP document (spec timesheet-correction-path §0 "Slice A"; plan
-- 2026-07-23-timesheet-reopen-unpushed §3). A pure PMO state transition — NO ERP I/O, NO cancel, NO
-- outbox row from the re-open. The money-safety is structural: the precondition REFUSES unless ERP
-- provably holds no document for the sheet, so the double-count (PMO `Draft` while ERPNext holds a
-- live Timesheet) is unreachable for the un-pushed case.
--
-- Two changes (reversible — NFR-TSC-REV-001):
--   §A create or replace transition_timesheet — the map gains `Approved → [Draft]` and a new authz
--      arm (the APPROVER population + Admin, never the owner; SoD-ordered) evaluates a race-safe
--      precondition (FENCE 2): a live mirror doc OR any non-terminal outbox row ⇒ refuse with a
--      named, actionable P0001. Everything else is byte-for-byte (NFR-TSC-REG-001).
--   §B create insert_timesheet_outbox_pending — the FENCE-2 push-side guard. The timesheet push
--      INSERT acquires the SAME named per-timesheet advisory lock and RE-VERIFIES `Approved` BEFORE
--      inserting, so a sync push racing a re-open cannot create an ERP document for a sheet the
--      re-open just opened. This adds NO command and NO ERP call (F3) — only the lock + status
--      re-check around the EXISTING insert.
--
-- The Luna adversarial money review (findings 1 & 2) is closed for the un-pushed case by the named
-- per-timesheet advisory lock shared by BOTH sides: re-open-wins ⇒ insert sees `Draft` ⇒ raises
-- `timesheet-no-longer-approved` (no orphan, no POST); insert-wins ⇒ re-open sees `pending` ⇒
-- refuses `reopen-push-in-flight`. Whichever side wins, the other sees its effect.
--
-- ⛔ SLICE B (the live-ERP cancel — its OWN issue) extends, never migrates away from, this. The
-- cancel-confirmed ADMIT branch (the `⛔ SLICE B SEAM` below), the `timesheet_correction_intent`
-- table, `reopen_approved_timesheet`/`confirm_timesheet_cancel`/`complete_timesheet_reopen` RPCs,
-- `cancel_origin`, and the lineage uniqueness are NOT built here. Slice A REFUSES where Slice B will
-- fill — a refusal is correct behaviour and Slice B's entry point, not a bug.
--
-- Reversibility: `create or replace transition_timesheet` with the 0007 body +
-- `drop function insert_timesheet_outbox_pending`. No PMO data is lost; no new table/column.

-- ============================================================================
-- §A — transition_timesheet: map + the Approved→Draft authz/precondition arm.
-- The Draft/Submitted/Rejected arms, the SoD, and the existing stamps are byte-for-byte with 0007
-- (NFR-TSC-REG-001). Three additive changes only: (1) the map, (2) the new Approved→Draft arm,
-- (3) the existing Draft arm narrowed to `and v_from = 'Rejected'`.
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
  -- Slice A (FR-TSC-001): `Approved` is no longer terminal — `Approved → Draft` is the one new edge.
  v_legal jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted'),
    'Submitted', jsonb_build_array('Approved','Rejected'),
    'Rejected',  jsonb_build_array('Draft'),
    'Approved',  jsonb_build_array('Draft')
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
  elsif p_to = 'Draft' and v_from = 'Approved' then
    -- Slice A (FR-TSC-020/021): re-open an Approved sheet. The AUTHORITY is the same approver
    -- population as the approve arm above — line manager, Admin/Exec-when-manager-null, or Admin
    -- break-glass — and the OWNER is excluded. SoD FIRST (mirrors the approve arm ordering): an
    -- owner can never re-open their own approved sheet, even if they are Admin.
    if v_uid = v_owner then
      raise exception 'separation of duties: cannot re-open own approved timesheet' using errcode = '42501';
    end if;
    if not (v_uid is not distinct from v_mgr
            or (v_mgr is null and v_role in ('Admin','Executive'))
            or v_role = 'Admin') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    -- FENCE 2 (FR-TSC-008/010, scoped): serialize against a concurrent push insert. The SAME named
    -- per-timesheet advisory lock is acquired by insert_timesheet_outbox_pending (§B), so whichever
    -- side wins the lock the other sees its effect — the double-count is unreachable.
    perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || p_timesheet_id::text, 0));
    -- Refuse if ERP may hold a LIVE document — a mirror row with ts_number set and not cancelled
    -- (Luna f1, mirror side). A pushed sheet is refused here; Slice B will fill the cancel-confirmed
    -- admit branch for it. Fail closed on any doubt.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.ts_number is not null and m.erp_cancelled_at is null) then
      raise exception 'reopen-erp-document-held' using errcode = 'P0001';
    end if;
    -- Refuse if ANY non-terminal outbox row exists for this sheet — the after-commit-before-mirror
    -- seam (a `committed` row whose mirror finalize has not run — Luna f1) AND a bare `pending` (a
    -- queued push still claimable/POSTable while this re-open commits — Luna f2). `failed`/`confirmed`
    -- are terminal ⇒ do not block (a rejected push minted no document).
    if exists (select 1 from public.external_command_outbox o
                 where o.org_id = v_org and o.domain = 'timesheets'
                   and o.pmo_record_id = p_timesheet_id::text
                   and o.state in ('pending','committing','committed','quarantined','held')) then
      raise exception 'reopen-push-in-flight' using errcode = 'P0001';
    end if;
    -- ⛔ SLICE B SEAM: the cancel-confirmed ADMIT branch (FR-TSC-008 full) lands HERE — when a
    -- generation-specific correction intent is consumed + its cancel outbox confirmed + mirror
    -- tombstoned, a PUSHED sheet may flip. Slice A admits ONLY the un-pushed case (no live doc, no
    -- non-terminal outbox row); a pushed sheet is refused above (Slice B's entry point). Do NOT
    -- widen without the intent table + cancel machinery.
  elsif p_to = 'Draft' and v_from = 'Rejected' then
    -- Rework: only the owner reworks a Rejected sheet back to Draft (FR-TS-006). Byte-for-byte with
    -- 0007 (the arm is narrowed by `v_from`, not widened in authority).
    if v_uid is distinct from v_owner then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;

  -- Atomic single update: status + the relevant stamp(s) in the SAME statement ⇒ no observable partial
  -- state (NFR-TS-ATOM-001). Approved→Draft leaves submitted_at/approved_by/approved_at as-is (OD-TS-4-A:
  -- audit trail of the last cycle; overwritten on the next submit/approve). Unchanged from 0007.
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

-- ============================================================================
-- §B — insert_timesheet_outbox_pending: the FENCE-2 push-side guard.
-- The timesheet push INSERT acquires the SAME named per-timesheet advisory lock as the Approved→Draft
-- arm and RE-VERIFIES status='Approved' BEFORE inserting. A re-open that flipped the sheet to Draft
-- between the dispatch gate read and this insert MUST NOT create an ERP document — it raises BEFORE
-- inserting (no orphan row ⇒ no wedge of the next generation, no POST, no reconcile loop; the
-- dispatch's insertOutboxPending catch rethrows the non-23505). SECURITY DEFINER over the policy-less
-- outbox; search_path pinned to public; schema-qualified refs.
-- ============================================================================
create function public.insert_timesheet_outbox_pending(
  p_org uuid, p_domain text, p_record_id text, p_key text, p_tier text, p_operation text,
  p_payload jsonb, p_digest text, p_actor uuid
) returns public.external_command_outbox
  language plpgsql security definer set search_path = public as $$
declare
  v_status timesheet_status;
  v_row    public.external_command_outbox;
  -- ⚑ ONE IDENTITY PER SHEET (Luna code review BLOCK 3). `p_record_id` arrives as TEXT from a caller
  -- that may spell the same uuid differently ('…FA' vs '…fa' — `approved_timesheet_for_push(uuid)` casts
  -- and passes either). Hashing/storing the RAW text made two spellings take DIFFERENT advisory locks
  -- and write DIFFERENT text-keyed `pmo_record_id`s, so the re-open's in-flight-push predicate could not
  -- see the push it was racing (and the one-in-flight partial index, also text-keyed, did not catch it):
  -- PMO goes Draft while ERP is handed the original hours ⇒ the corrected week double-counts. Round-trip
  -- through `uuid` FIRST, and use ONLY the canonical text below — the lock key, the status read, and the
  -- persisted row identity. A non-uuid id raises 22P02 here, before any lock or write.
  v_record_id text := (p_record_id::uuid)::text;
begin
  -- FENCE 2: serialize the push INSERT against a concurrent re-open (the SAME named lock the
  -- Approved→Draft arm holds, keyed on the SAME canonical uuid text) so the status re-check below
  -- observes the re-open's committed effect.
  perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || v_record_id, 0));
  select status into v_status from public.timesheets where id = v_record_id::uuid;
  if v_status is distinct from 'Approved' then
    raise exception 'timesheet-no-longer-approved' using errcode = 'P0001';
  end if;
  -- Same insert columns as the generic path (moneyOutboxDeps.ts:insertOutboxPending). state is
  -- 'pending' (the dispatch claims it next). org_id is the explicit, definer-trusted arg — never the
  -- client (the outbox is machine-written; the service-role edge fn supplies the verified org).
  insert into public.external_command_outbox
    (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state,
     payload, payload_digest, actor_user_id)
  values (p_org, p_domain, v_record_id, p_key, p_tier, p_operation, 'pending',
          p_payload, p_digest, p_actor)
  returning * into v_row;
  return v_row;
end; $$;
-- ⚑ SECURITY (Luna code review BLOCK 2, 2026-07-23) — MACHINE-ONLY. This is SECURITY DEFINER and takes
-- p_org / p_payload / p_actor as ARGUMENTS, so any principal that can execute it can mint an outbox row
-- with a forged org, a forged payload (inflated hours) and a forged actor. The header above says org_id
-- is "definer-trusted — never the client"; granting `authenticated` made that sentence FALSE, because
-- every function in `public` is reachable over PostgREST RPC. The status='Approved' re-check does not
-- help: the attacker's own approved sheet passes it, and the sweep then DRIVES the existing row without
-- replacing its payload, so the forged hours reach ERPNext.
-- The only caller is the served boundary's SERVICE-ROLE client (`adapter-dispatch`, moneyOutboxDeps) —
-- `authenticated` was never needed. ⛔ Do not re-add it.
revoke all on function insert_timesheet_outbox_pending(uuid,text,text,text,text,text,jsonb,text,uuid) from public, anon, authenticated;
grant  execute on function insert_timesheet_outbox_pending(uuid,text,text,text,text,text,jsonb,text,uuid) to service_role;

-- ============================================================================
-- §C — claim_outbox_for_commit: the SAME fence on the CLAIM (Luna code review BLOCK 1).
--
-- The insert-side guard (§B) closes the MINT race. It cannot close the RE-DRIVE race, because on that
-- path there IS no insert: `dispatchMoneyWrite` reads an existing row and goes straight to the claim
-- (`pmo-portal/src/lib/adapterSeam/dispatch.ts` — the `pending`/`failed` branch). Slice A deliberately
-- ADMITS a re-open while a `failed` row exists (a rejected push minted no ERP document), and the plan
-- asserted such a row "is therefore never re-driven" — that is FALSE: both the foreground Retry and the
-- sweep's mirror queue re-drive it through this claim. With no status check and no lock here, a gate
-- read that saw `Approved` could claim and POST the ORIGINAL hours after the re-open committed `Draft`;
-- the corrected week is then pushed as a SECOND Timesheet and the client's project cost double-counts.
--
-- So the claim itself enters the fence: for a `timesheets` row it takes the SAME canonical per-sheet
-- advisory lock and re-reads `timesheets.status` IN THE SAME TRANSACTION as the claiming UPDATE. A
-- TypeScript-side second read could not do this — the check and the claim must be one critical section.
-- REFUSAL is a raise (P0001), never a NULL: a NULL means "not claimable now" and sends the caller back
-- into `reconcileOutbox`, which would re-read the same `failed` row and claim again forever.
--
-- Every other domain is byte-for-byte the 0096 behaviour (no lock, no timesheet coupling) — the guard is
-- keyed off the ROW's own `domain`, so no call site changes and every claim path (foreground dispatch,
-- retry, sweep backstop, recovery reissue) is covered at once.
--
-- Reversibility: re-apply the 0096 body.
-- ============================================================================
create or replace function public.claim_outbox_for_commit(
  p_id uuid, p_lease interval default interval '60 seconds'
) returns public.external_command_outbox
  language plpgsql security definer set search_path = public as $$
  declare
    v public.external_command_outbox;
    v_domain text;
    v_record_id text;
    v_status timesheet_status;
  begin
    select domain, pmo_record_id into v_domain, v_record_id
      from public.external_command_outbox where id = p_id;
    if v_domain = 'timesheets' then
      -- The canonical uuid text — the SAME identity §B stores and the Approved→Draft arm locks on
      -- (BLOCK 3). `domain` and `pmo_record_id` are immutable for the life of a row, so reading them
      -- before the lock is safe; everything that can CHANGE is read after it.
      v_record_id := (v_record_id::uuid)::text;
      perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || v_record_id, 0));
      select status into v_status from public.timesheets where id = v_record_id::uuid;
      if v_status is distinct from 'Approved' then
        raise exception 'timesheet-no-longer-approved' using errcode = 'P0001';
      end if;
    end if;
    update public.external_command_outbox
       set state='committing',
           attempt_count = attempt_count + 1,
           claim_generation = claim_generation + 1,   -- fencing token (F4): monotonic per claim
           claimed_at = now(),
           updated_at = now()
     where id = p_id
       and ( state in ('pending','failed')
             or (state='quarantined' and reconcile_after is not null and reconcile_after < now()) )
    returning * into v;
    return v;   -- v.claim_generation is the caller's fencing token; null ⇒ not claimable now
  end; $$;
revoke all on function public.claim_outbox_for_commit(uuid, interval) from public;
grant execute on function public.claim_outbox_for_commit(uuid, interval) to service_role;
