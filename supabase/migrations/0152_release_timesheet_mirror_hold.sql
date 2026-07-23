-- 0152_release_timesheet_mirror_hold.sql — close the held-mirror dead end (Luna FU-1a round-4 BLOCK).
--
-- ⚑ THE DEFECT. A Timesheet POST/submit succeeds; recovery finds the ERP document; `fromDoc`/`mirrorMoney`
-- then fails DETERMINISTICALLY. Two INDEPENDENT rows record that safe hold:
--   • `external_command_outbox` → `held` (the fenced recovery branch, `adapterSeam/dispatch.ts`), and
--   • `timesheet_erp_mirror`    → `push_state='held'` (`markTimesheetPushOutcome`'s `command-held` arm).
-- `release_outbox_hold` (0137 §4) moved only the OUTBOX back to `failed`. The mirror stayed `held`, and
-- NOTHING can re-drive a held mirror: the timesheet backstop selects only `pending`/`failed`
-- (`erpnext-sweep`), generic recovery skips the timesheets domain, and the UI classifies `command-held`
-- as non-retryable and renders no Retry. So the operator's "release" produced a DEAD END on the ERP side
-- while making the PMO side terminal — and terminal is exactly what the re-open ADMITS (0151 treats
-- `failed` as "the push was rejected, so no document was ever minted"). Re-open → re-approve → a new
-- generation POSTs while the ORIGINAL ERP Timesheet is still live: the client's hours DOUBLE-COUNT.
--
-- TWO changes, because these are two different failures:
--   §A `release_outbox_hold` also releases the matching timesheet mirror — an atomic CAS `held → failed`
--      scoped to the released command's OWN record + org, in the same transaction and the same audit
--      row. `failed` is the only mirror state the backstop re-queues, so the release restores the
--      recovery route instead of ending it. Non-timesheet domains are untouched.
--   §B the re-open REFUSES while the mirror is `held`. `held` means PMO DOES NOT KNOW whether ERP holds
--      a document — the precise state this slice must never admit. §A alone would leave the double-count
--      reachable for the whole window before an Admin acts, and reachable again whenever the two rows
--      disagree (either writer can be terminal while the other still holds).
--
-- Reversibility (ADR-0006): re-apply the 0137 body of `release_outbox_hold` and the 0151 body of
-- `transition_timesheet`. No table, column, or data change.

-- ============================================================================
-- §A — release_outbox_hold: ONE operator action over BOTH rows.
-- Byte-for-byte with 0137 except: the row load also reads `domain`/`pmo_record_id`, and a
-- timesheets-domain release CASes the matching mirror out of `held`. The CAS is `held → failed` ONLY —
-- a `pushed` mirror is a REAL ERPNext Timesheet and must never be re-queued, and a `pending`/`pushing`
-- mirror is owned by another path. A non-uuid `pmo_record_id` (legacy/foreign rows) is simply not a
-- timesheet key: it releases the outbox and touches no mirror, never raises 22P02.
-- ============================================================================
create or replace function public.release_outbox_hold(p_outbox_id uuid, p_reason text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_org       uuid;
  v_state     text;
  v_domain    text;
  v_record    text;
  v_sheet     uuid;
  v_mirrors   int := 0;
  v_actor     uuid := auth.uid();
  v_note      text;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Load + LOCK the row: serializes a concurrent release against a live claimant's own fenced
  -- write-back, so the state check below cannot be read stale.
  select o.org_id, o.state, o.domain, o.pmo_record_id
    into v_org, v_state, v_domain, v_record
    from public.external_command_outbox o where o.id = p_outbox_id for update;
  if v_org is null then
    raise exception 'outbox command not found' using errcode = 'P0002';
  end if;

  -- Org + Admin + active-membership re-assertion — MUST STAY (see the header: DEFINER bypasses RLS and
  -- this is directly reachable by any authenticated caller).
  if v_org is distinct from public.auth_org_id()
     or public.auth_role() is distinct from 'Admin'
     or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Only a HELD row has a hold to release. Never resurrect a confirmed/committing/failed row: a
  -- `confirmed` command already landed in the client's ERP, and re-opening it for the backstop would
  -- re-drive a settled money write.
  if v_state is distinct from 'held' then
    raise exception 'outbox command is % — only a held command can be released', v_state using errcode = 'P0001';
  end if;

  v_note := 'hold released by operator ' || v_actor::text || ': ' || coalesce(p_reason, '');

  -- `failed`, never `pending`: the recovery machinery treats both identically as claimable, and `failed`
  -- preserves the fact that this command has a FAILURE HISTORY. `claim_generation` is bumped so any
  -- still-running claimant's late write-back is fenced out (F4).
  update public.external_command_outbox
     set state            = 'failed',
         last_error       = v_note,
         claim_generation = claim_generation + 1,
         updated_at       = now()
   where id = p_outbox_id;

  -- The OTHER half of the hold (the round-4 BLOCK). Same transaction ⇒ the two rows can never be left
  -- disagreeing by this action. Scoped by domain + org + this command's own record: a budget/revenue
  -- release touches no mirror, and no other sheet's hold is cleared by someone else's release.
  if v_domain = 'timesheets' then
    begin
      v_sheet := v_record::uuid;
    exception when others then
      v_sheet := null;   -- not a timesheet key ⇒ no mirror to release (never a 22P02 out of a release)
    end;
    if v_sheet is not null then
      update public.timesheet_erp_mirror m
         set push_state = 'failed',
             push_error = v_note
       where m.timesheet_id = v_sheet
         and m.org_id       = v_org
         and m.push_state   = 'held';
      get diagnostics v_mirrors = row_count;
    end if;
  end if;

  perform public.log_audit(
    'release_outbox_hold',
    v_org,
    v_actor,
    p_outbox_id,
    jsonb_build_object('reason', p_reason, 'released_from', v_state, 'mirror_released', v_mirrors)
  );
end;
$$;

revoke all     on function public.release_outbox_hold(uuid, text) from public;
grant  execute on function public.release_outbox_hold(uuid, text) to   authenticated;
revoke execute on function public.release_outbox_hold(uuid, text) from anon;

-- ============================================================================
-- §B — transition_timesheet: the re-open REFUSES on a HELD mirror.
-- Byte-for-byte with 0151 §A except the one added precondition in the Approved→Draft arm (marked
-- inline). Every other arm, the SoD ordering, the advisory lock, and the stamps are unchanged.
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
    -- ⚑ THE HELD MIRROR (Luna FU-1a round-4 BLOCK, the money half). `push_state='held'` is written by
    -- `markTimesheetPushOutcome`'s `command-held` arm — the POST/submit SUCCEEDED and the read-back then
    -- failed deterministically. It means exactly: PMO DOES NOT KNOW whether ERPNext holds a document for
    -- this week, and it never learned a `ts_number`, so the live-doc check above cannot see it. The
    -- outbox hold covers the same window only while THAT row is non-terminal — the two are written by
    -- independent writers and either can be terminal while the other still holds (an operator release,
    -- a fenced-out write-back). An unknown ERP outcome is the one thing this slice must never admit:
    -- re-open + re-approve would post a SECOND ERP Timesheet for a week ERPNext may already hold and the
    -- client's hours double-count. Fail closed; `release_outbox_hold` (§A above) is the operator's route
    -- out, and after it the ordinary rules apply again.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id and m.push_state = 'held') then
      raise exception 'reopen-push-outcome-unknown' using errcode = 'P0001';
    end if;
    -- Refuse if ANY non-terminal outbox row exists for this sheet — the after-commit-before-mirror
    -- seam (a `committed` row whose mirror finalize has not run — Luna f1) AND a bare `pending` (a
    -- queued push still claimable/POSTable while this re-open commits — Luna f2). `failed`/`confirmed`
    -- are terminal ⇒ do not block (a rejected push minted no document).
    --
    -- ⚑ WHAT MAKES `failed` SAFE TO ADMIT, AND THE ONE POPULATION IT DOES NOT COVER (Luna round-3
    -- SHOULD-FIX 5). For a timesheet command written by THIS release, `failed` means the failure
    -- happened BEFORE or AT the ERP submit — a rejection, which leaves no document. Everything after
    -- the submit is classified `external-unreachable` and stays non-terminal (`postSubmitUnknown`,
    -- `erpnext/adapter.ts`), so it is caught by the check above. That invariant is what this arm
    -- leans on, and it holds only forward.
    --
    -- A row written by the PRE-0151 code carries no such guarantee: an ERP submit that succeeded and
    -- whose read-back failed was marked terminal `failed` with a `ts_number`-less mirror row — i.e.
    -- indistinguishable HERE from a clean rejection, while ERPNext holds a live Timesheet. This
    -- migration deliberately ships NO data treatment for that population: their true ERP outcome is
    -- not knowable from PMO state, and reclassifying historical money rows on a guess is worse than
    -- naming the gap. THE DISPOSITION IS EXPLICIT: pre-0151 `failed` timesheet rows stay terminal,
    -- this arm will ADMIT a re-open for them, and an OPERATOR must establish what ERP holds before
    -- trusting that admit. The census + the operator's action are named in
    -- `docs/plans/2026-07-23-timesheet-reopen-unpushed.md` §9 ("Pre-0151 residue"); an environment
    -- that never ran the P3b push before this migration has an empty census and nothing to do.
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
