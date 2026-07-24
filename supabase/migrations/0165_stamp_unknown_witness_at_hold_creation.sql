-- 0158_stamp_unknown_witness_at_hold_creation.sql — stamp the post-submit-unknown witness WHERE THE HOLD
-- IS BORN, so coverage is by CONSTRUCTION rather than by enumerating producers
-- (Luna FU-1a round-10 BLOCK, reproduced end-to-end against the migrated DB).
--
-- ⚑ THE DEFECT, AND IT IS 0157'S OWN SHAPE ONE LEVEL OVER. 0157 made "PMO does not know what ERPNext
-- holds" durable (`timesheet_erp_mirror.post_submit_unknown_at`) and the re-open refuses while it is set.
-- But it stamped that witness in the two DOWNSTREAM RECORDERS:
--   • `record_timesheet_command_held` (0157 §3) — reached ONLY from the SERVED dispatch's best-effort
--     `recordTimesheetPushFailure` (`adapter-dispatch/index.ts`), which SWALLOWS its own throw; and
--   • the sweep's `parkTimesheetMirrorRow` held-park — a LATER tick.
-- The hold itself is created by `money.markOutboxHeld` → THIS function, from FOUR sites in
-- `adapterSeam/dispatch.ts`. When `dispatchMoneyWrite` runs under the SWEEP
-- (`erpnext-sweep/index.ts:1621`) the resulting `command-held` throw is only `console.warn`'d: THE SWEEP
-- HAS NO MIRROR FAILURE RECORDER AT ALL (it imports only `getReadModelWriter`, the success writer). So a
-- sweep-created hold was fenced by nothing but the OUTBOX state — precisely the state
-- `release_outbox_hold` clears:
--
--   mark_outbox_held      -> outbox=held  mirror=failed  NO WITNESS
--   re-open               -> refused, BY THE OUTBOX ALONE (`reopen-push-in-flight`)
--   release_outbox_hold   -> outbox=failed; 0152 §A's mirror CAS is `where push_state='held'`, so on a
--                            `failed` mirror it matches 0 rows and the release learns nothing to preserve
--   re-open               -> *** ADMITTED WITH AN UNKNOWN ERP OUTCOME *** -> Draft
--   re-submit/re-approve  -> a new approval generation -> a new idempotency key -> a SECOND ERPNext
--                            Timesheet for the same week. The client's project costing carries both weeks
--                            of hours PERMANENTLY, and the original command can never be adopted
--                            afterwards (`timesheet-approval-superseded`, 0151 §C) so it never learns the
--                            `ts_number` that would have fenced the second push.
-- That is round-8 BLOCK 1, unchanged in consequence, reached through a door 0157 did not enumerate.
--
-- One producer is STRUCTURALLY sweep-exclusive: the `recovery-reissue-unauthorized` hold
-- (`dispatch.ts:391-406`) fires only when `money.reauthorizeRecoveryReissue` is wired, and that dep is set
-- in exactly ONE place — `erpnext-sweep/index.ts:1793`. That hold could therefore NEVER stamp a witness at
-- the moment it occurred, on any code path that exists today.
--
-- ── THE FIX: MAKE THE WITNESS CONTEMPORANEOUS WITH THE FACT ─────────────────────────────────────────
-- The stamp moves INTO `mark_outbox_held`: same statement, same transaction as the hold it witnesses. The
-- previous design stamped in downstream recorders and therefore needed every producer ENUMERATED — which
-- is exactly how this one was missed. Adding a mirror recorder to the sweep would repeat that mistake one
-- level over; putting the stamp at the CREATION point means every producer of a timesheets hold — served,
-- sweep-driven, present or FUTURE — witnesses the unknown without anyone having to remember.
--
-- 0157 §2's trigger already makes this idempotent with both existing writers: the witness is sticky and
-- first-observed-wins, cleared only by learning a real `ts_number` or by the audited
-- `attest_timesheet_no_erp_document`. No other domain is touched.
--
-- ⚑ WHY THE STAMP IS UNCONDITIONAL (not gated on the hold's CAS landing), and what it costs. All three
-- reachable call sites are POST-WINDOW RECOVERY branches — the probe threw non-retryably, or the probe
-- found no document behind a mutable anchor, or the reissue's actor lost authorization — and each of them
-- means this claimant did not establish what ERPNext holds. That is true whether or not its fencing token
-- still wins the outbox CAS, so the fact is recorded either way. The residual over-stamp is a FIRST
-- attempt whose probe fails non-retryably before anything was ever POSTed: it costs one audited Admin
-- attestation ("I checked ERPNext; there is no Timesheet for this week") before that week can be
-- corrected. That is the same trade 0157 §3's S2 branch already makes deliberately, and it is the right
-- direction: a missing witness costs permanently double-counted client hours, a spurious one costs a
-- documented human check. Inferring "nothing was POSTed" from the outbox's own attempt/state history is
-- exactly the ERP-fact-from-PMO-queue-state reasoning 0157 exists to delete.
--
-- ⚑ AND IT MAY NEVER MAKE A HOLD FAIL. `mark_outbox_held` is the money path's own fenced write-back: if it
-- raised, the row would stay `committing` with the hold unrecorded and the operator route out
-- (`release_outbox_hold`, which only accepts a `held` row) unreachable. So a `pmo_record_id` that is not a
-- uuid, or names no timesheet, warns and skips; it never raises. The mirror row is written with the
-- SHEET's org (a mirror row's org is its sheet's org by definition), and a disagreement with the outbox
-- row's org is warned about rather than raised — the witness is never lost to a data bug.
--
-- ⚑ ON S1 (round-10 SHOULD-FIX) — `markTimesheetPushOutcome`'s non-held upsert
-- (`adapter-dispatch/readModelWriters.ts`) is a blind upsert that can rewrite a `held` mirror to `failed`.
-- After this migration that is no longer load-bearing and is not a defect: EVERY writer that can produce a
-- `held` timesheet mirror also stamps the witness in the same statement — this function (at creation),
-- `record_timesheet_command_held` (0157 §3, unconditionally outside its guard), and the sweep's held-park
-- (`parkTimesheetMirrorRow`). So `0157 §4`'s `push_state = 'held'` predicate is hereby ADVISORY: it fences
-- only the PRE-0157 residue (a `held` row written before the witness column existed), and for every row
-- written from here on THE WITNESS IS THE FENCE. `0158_held_predicate_is_advisory.test.sql` pins that a
-- downgrade of `held` → `failed` leaves the re-open refused.
--
-- Reversibility (ADR-0006, unreleased): re-apply the 0096 body of `public.mark_outbox_held`. No table,
-- column, ACL or data change — the ACL grants from 0096 (service_role only) still apply to this same
-- signature and are deliberately NOT restated.

create or replace function public.mark_outbox_held(
  p_id uuid, p_generation int, p_reason text
) returns int
  language plpgsql security definer set search_path = public as $$
  declare
    v_n         int;
    v_domain    text;
    v_record    text;
    v_key       text;
    v_org       uuid;
    v_sheet     uuid;
    v_sheet_org uuid;
  begin
    -- ── The 0096 hold, byte-for-byte. Guarded on claim_generation (F4) so only the current claimant may
    -- hold it; records the reason in last_error for ops visibility. Returns 1 when held, else 0.
    update public.external_command_outbox
       set state = 'held', last_error = p_reason, updated_at = now()
     where id = p_id and claim_generation = p_generation and state = 'committing'
    returning 1 into v_n;

    -- ── ⚑ THE WITNESS, AT THE MOMENT THE HOLD IS BORN (round-10 BLOCK). Re-read the row for its immutable
    -- identity columns; the UPDATE above already holds its row lock, so this cannot be read stale, and
    -- `record_timesheet_command_held` / `release_outbox_hold` (both of which take `for update` on this
    -- same row) serialize behind it.
    select o.domain, o.pmo_record_id, o.org_id, o.idempotency_key
      into v_domain, v_record, v_org, v_key
      from public.external_command_outbox o where o.id = p_id;

    if v_domain = 'timesheets' then
      begin
        v_sheet := v_record::uuid;
      exception when others then
        v_sheet := null;   -- not a timesheet key (legacy/foreign row) ⇒ nothing to witness, never a 22P02
      end;

      if v_sheet is not null then
        select t.org_id into v_sheet_org from public.timesheets t where t.id = v_sheet;
        if v_sheet_org is null then
          -- A timesheets command naming no timesheet is a BUG, not an outcome — but this is the money
          -- write-back, so it is surfaced and skipped rather than raised (an FK violation here would
          -- strand the row `committing`, unreleasable).
          raise warning 'mark_outbox_held: outbox % names timesheet % which does not exist — no unknown-outcome witness recorded', p_id, v_sheet;
        else
          if v_sheet_org is distinct from v_org then
            raise warning 'mark_outbox_held: outbox % carries org % but timesheet % belongs to org % — witnessing under the SHEET''s org', p_id, v_org, v_sheet, v_sheet_org;
          end if;
          -- `held` + the reason for a mirror that does not exist yet: the two rows then AGREE the moment
          -- the hold exists (0152 §A's release CAS has a `held` mirror to release, instead of matching 0
          -- rows as round 10 observed). `approved_at_pushed` is read off THIS COMMAND'S OWN KEY
          -- (`timesheet_push_key_witness`, 0151 §A2 — the generation the claim already validated against
          -- `timesheets.approved_at`), never off the sheet's current state: the created row must carry
          -- the generation whose outcome is unknown, so 0157 §3's generation guard keeps comparing real
          -- generations instead of falling back to "the CAS matched". On an EXISTING row only the witness
          -- is written — this function answers "does PMO know what ERP holds?", never "whose OUTCOME
          -- wins", which stays the business of the guarded writers (0157 §3). The guard skips a row
          -- naming a LIVE document: there is no unknown left to witness (and 0157 §2 rule 1 would clear
          -- it anyway).
          insert into public.timesheet_erp_mirror
            (org_id, timesheet_id, push_state, push_error, approved_at_pushed, post_submit_unknown_at)
          values (v_sheet_org, v_sheet, 'held', p_reason, public.timesheet_push_key_witness(v_key), now())
          on conflict (timesheet_id) do update
             set post_submit_unknown_at = now()
           where timesheet_erp_mirror.ts_number is null
              or timesheet_erp_mirror.erp_cancelled_at is not null;
        end if;
      end if;
    end if;

    return coalesce(v_n, 0);
  end; $$;
