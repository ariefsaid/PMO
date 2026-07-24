-- 0157_timesheet_post_submit_unknown_witness.sql — separate the two questions `release_outbox_hold`
-- conflated (Luna FU-1a round-8 BLOCK, reproduced end-to-end against the migrated DB).
--
-- ⚑ THE DEFECT, AND IT IS THE ROUND-4 FIX'S OWN PREMISE. A `held` outbox row + a `held` mirror mean ONE
-- thing: the ERP submit SUCCEEDED and the read-back did not, so PMO DOES NOT KNOW whether ERPNext holds
-- a Timesheet for this week. 0152 §A made an operator release clear BOTH of those states in one
-- transaction — correctly, so the backstop can re-drive — but the release LEARNS NOTHING ABOUT ERP: it
-- re-queues a command, it does not go and look. After it the re-open arm saw `failed` / `failed` / no
-- `ts_number` and ADMITTED. Re-open → re-approve → a NEW approval generation → a new idempotency key →
-- a SECOND ERPNext Timesheet for the same week. The client's project costing carries both weeks of
-- hours, permanently, and PMO shows nothing wrong.
--
-- It does not self-heal. The hold class is by construction DETERMINISTIC (the probe re-runs, re-maps,
-- re-fails), and once the re-open wins, `claim_outbox_for_commit` refuses the original row forever
-- (`timesheet-approval-superseded`, 0151 §C) — so the live ERP document is never adopted and never
-- learns a `ts_number`, the one fact that would have fenced the second push.
--
-- ⚑ THE SENTENCE THAT WAS FALSE. 0152:239-245 states, of the re-open arm's admission of terminal
-- `failed`: "For a timesheet command written by THIS release, `failed` means the failure happened
-- BEFORE or AT the ERP submit — a rejection, which leaves no document." `release_outbox_hold` — in the
-- SAME migration — manufactures a counterexample: a post-submit unknown written to `failed` by an
-- operator action. (`commitCreate`'s create-then-submit-rejected window is a second, smaller one: ERP
-- keeps a DRAFT Timesheet nobody has a pointer to. A draft carries no costing, so it is clutter rather
-- than a double-count — but the sentence was stated absolutely and is not.) The corrected statement
-- lives in §4's arm below.
--
-- ── THE FIX: STOP INFERRING AN ERP FACT FROM A PMO QUEUE STATE ──────────────────────────────────────
-- `push_state` answers "can the backstop retry this?". Nothing in it answers "does ERPNext hold a
-- document?" — so this migration gives that second question its own durable answer:
--   §1 `timesheet_erp_mirror.post_submit_unknown_at` — a WITNESS, stamped the moment PMO loses track of
--      a submit's outcome, INDEPENDENT of push_state.
--   §2 a trigger makes it STICKY: it is cleared by exactly two things — learning a real `ts_number`
--      (the question is answered by fact) or the audited attestation in §5. Every other writer,
--      including a release, leaves it alone whether it names it or not.
--   §3 `record_timesheet_command_held` stamps it (and fails closed properly — S2/S3 below).
--   §4 the re-open arm refuses while it is set, independent of `push_state`.
--   §5 `attest_timesheet_no_erp_document` — the Admin-only, audited, reason-required route out.
-- A release therefore restores the RECOVERY route (mirror `failed` is the backstop's queue) without
-- opening the CORRECTION route. That is what round 4 actually asked for.
--
-- ⚑ ALSO CLOSED HERE (round-8 SHOULD-FIX, same function):
--   • S2 — "fails closed to `failed`" was fail-OPEN. On the MIRROR fence `failed` is the permissive
--     state and `held` the restrictive one, so a LOST marker (no `p_outbox_id`) downgraded the fence.
--     A miss on a row that EXISTS is a real audited event (release/reclaim) and `failed` is honest; a
--     row that cannot be located at all is a BUG in the threading, and the outcome being recorded is
--     still a post-submit unknown — so it records `held` + the witness and names the loss.
--     (⚑ Deliberate deviation from the review's literal "raise instead": the served catch swallows the
--     throw, so raising would leave NO mirror row at all — and with §4 the mirror is now the fence, so
--     "record nothing" is the one outcome that re-opens the money hole this migration closes.)
--   • S3 — the generation guard's NULL-witness escape admitted a PROVEN-STALE writer. The sweep's park
--     creates rows with no `approved_at_pushed` (`parkTimesheetMirrorRow`'s absent branch), so on
--     exactly those rows "a stale writer's `failed` is a no-op" was false. With an UNKNOWN existing
--     generation, only a writer whose CAS actually matched may overwrite.
--
-- Round 7's generation-exact CAS under the row lock is UNCHANGED and is not re-litigated here.
--
-- Reversibility (ADR-0006, unreleased): `drop trigger timesheet_erp_mirror_unknown_witness_guard on
-- public.timesheet_erp_mirror; drop function public.timesheet_mirror_unknown_witness_guard();
-- drop function public.attest_timesheet_no_erp_document(uuid, text);
-- alter table public.timesheet_erp_mirror drop column post_submit_unknown_at;` then re-apply the 0155
-- body of `record_timesheet_command_held` and the 0152 body of `transition_timesheet`.

-- ⚑ WHY NO BACKFILL (the question this migration must answer, not assume). The population at risk is
-- "a week whose hold was RELEASED before this migration existed": its witness would be missing, and the
-- re-open would still admit. That population is provably EMPTY rather than merely assumed empty —
-- `release_outbox_hold`'s timesheet-mirror arm IS 0152, which has never left this unmerged branch (`dev`
-- carries migrations only through 0150), so no environment has ever executed the transition that creates
-- it. If that ever stops being true (this branch reaching an environment WITHOUT 0157), the backfill is
-- not derivable either: the release OVERWRITES `push_error` with its own note, erasing the
-- `command-held:` prefix that would identify the row. So the two ship together, or the gap is real.
-- The separate PRE-0151 residue is unchanged and still named + left alone by 0152's own disposition
-- (`docs/plans/2026-07-23-timesheet-reopen-unpushed.md` §9); this migration does not guess at it either.
--
-- ============================================================================================
-- §1 — THE WITNESS COLUMN. Additive + nullable ⇒ every existing row reads "no unknown outcome on
-- record", which is the honest pre-0157 state (see the backfill note above).
-- ============================================================================================
alter table public.timesheet_erp_mirror
  add column if not exists post_submit_unknown_at timestamptz;

comment on column public.timesheet_erp_mirror.post_submit_unknown_at is
  'When PMO FIRST lost track of what ERPNext holds for this week: the submit reached ERP and its '
  'outcome could not be read back. NOT a status — it is independent of push_state, survives a hold '
  'release (which re-queues a command and learns nothing about ERP), and is cleared ONLY by learning a '
  'real ts_number or by attest_timesheet_no_erp_document(). The re-open refuses while it is set.';

-- ============================================================================================
-- §2 — THE STICKINESS TRIGGER. Enforced in the database, not by writer discipline, because writer
-- discipline is precisely what failed: the BLOCK was one writer clearing a fence as a side effect of
-- answering a different question. Four writers touch this mirror today (the dispatch success path, the
-- failure/held recorder, the sweep's park, the ERP feed) and 0152's release is a fifth by symmetry.
--
-- Rules, in order:
--   (1) a REAL, live document number answers the question — clear the witness. This is the ONLY fact
--       that dissolves an unknown without a human, and it is exactly the fact the recovery probe /
--       backstop exist to obtain.
--   (2) otherwise the witness is STICKY: an UPDATE may not null it (the write is silently preserved,
--       not raised — the writers that would trip this are best-effort recorders whose real job must
--       still commit), and a LATER unknown may not restamp it (it records when PMO FIRST lost track).
--   (3) the one escape is the §5 attestation, which names this timesheet in a txn-local GUC. That is
--       not a privilege hole: `authenticated` has NO write policy on this table at all (0136), so the
--       only principals who can reach an UPDATE here are the service role and postgres-owned definers.
-- ============================================================================================
create or replace function public.timesheet_mirror_unknown_witness_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- (1) a live ERP document number is the answer, so there is no longer an unknown to witness. A
  -- CANCELLED document (erp_cancelled_at set) is a tombstone, not an answer — it leaves the question
  -- of a later generation open, so it does not clear.
  if new.ts_number is not null and new.erp_cancelled_at is null then
    new.post_submit_unknown_at := null;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.post_submit_unknown_at is not null then
    if new.post_submit_unknown_at is null then
      -- (2)+(3) refuse the silent clear unless THIS row's attestation is in progress.
      if coalesce(current_setting('pmo.attested_no_erp_timesheet', true), '')
         is distinct from old.timesheet_id::text then
        new.post_submit_unknown_at := old.post_submit_unknown_at;
      end if;
    else
      -- (2) first-observed wins: a second unknown does not move the clock forward.
      new.post_submit_unknown_at := old.post_submit_unknown_at;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists timesheet_erp_mirror_unknown_witness_guard on public.timesheet_erp_mirror;
create trigger timesheet_erp_mirror_unknown_witness_guard
  before insert or update on public.timesheet_erp_mirror
  for each row execute function public.timesheet_mirror_unknown_witness_guard();

-- ============================================================================================
-- §3 — record_timesheet_command_held: stamp the witness, and fail closed for real (S2 + S3).
-- Byte-for-byte with 0155 except the three marked blocks. The round-7 generation-exact CAS under the
-- row lock is untouched.
-- ============================================================================================
create or replace function public.record_timesheet_command_held(
  p_org              uuid,
  p_timesheet_id     uuid,
  p_approved_at      timestamptz,
  p_reason           text,
  p_outbox_id        uuid,
  p_claim_generation int
) returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_state       text;
  v_error       text;
  v_out_state   text;
  v_out_gen     int;
  v_sheet_org   uuid;
  v_cas_matched boolean := false;
begin
  -- ── Defense-in-depth (round-6 NOTE): derive the org FROM THE SHEET and assert the caller's p_org
  -- agrees. Service role bypasses RLS and could otherwise record a mirror carrying an org the sheet does
  -- not belong to (the no-outbox branch inserts a fresh row). The FK only checks the sheet UUID exists.
  select org_id into v_sheet_org from public.timesheets where id = p_timesheet_id;
  if v_sheet_org is null then
    raise exception 'timesheet % not found', p_timesheet_id using errcode = 'P0002';
  end if;
  if v_sheet_org is distinct from p_org then
    raise exception 'org mismatch: timesheet % does not belong to org %', p_timesheet_id, p_org using errcode = '42501';
  end if;

  -- ── THE GENERATION-EXACT FENCE UNDER A ROW LOCK (round-6 BLOCK 1 + BLOCK 2, UNCHANGED). Lock the
  -- EXACT outbox row this held outcome was produced against and re-read its COMMITTED state.
  -- `release_outbox_hold` (0152 §A) takes the SAME `FOR UPDATE` lock on this row, so a concurrent
  -- release and this writer serialize: whichever commits first, the loser re-reads the committed result.
  -- Record `held` ONLY while that exact row is STILL `held` at the SAME `claim_generation` the hold was
  -- produced under. A successor command (0134 admits one once the old row is terminal) has a DIFFERENT
  -- id; a reclaim or a release BUMPS the generation.
  select state, claim_generation
    into v_out_state, v_out_gen
    from public.external_command_outbox
   where id = p_outbox_id
   for update;

  if v_out_state = 'held' and v_out_gen = p_claim_generation then
    v_state       := 'held';
    v_error       := p_reason;
    v_cas_matched := true;
  elsif v_out_state is null then
    -- ⚑ S2 (round 8) — AN UNLOCATABLE ROW IS A BUG, NOT AN OUTCOME, AND MUST NOT RELAX THE FENCE.
    -- 0155 recorded `failed` here and called it "fails closed" — but on the MIRROR side `failed` is the
    -- PERMISSIVE state (it is the backstop's queue AND the re-open's admit), so a lost marker
    -- DOWNGRADED the fence. This branch means the id was never threaded, or names a row that no longer
    -- exists; either way nothing was learned about ERPNext and a `command-held` is being recorded, so
    -- the honest record is the RESTRICTIVE state plus the durable witness below, and a reason that says
    -- the identity was lost so an operator can see it is a defect rather than a normal hold.
    v_state := 'held';
    v_error := coalesce(p_reason, 'command-held')
             || ' — ⚑ the held command''s outbox row could not be located (identity lost); recorded as held + unknown because nothing here established what ERPNext holds';
  else
    -- A miss on a row that EXISTS is a REAL, audited event: a release or a reclaim superseded this
    -- writer's generation. `failed` matches the released outbox, so the backstop re-queues the record.
    -- (It does NOT re-open the correction path: the witness stamped below outlives this state.)
    v_state := 'failed';
    v_error := coalesce(p_reason, 'command-held')
             || ' — hold released or superseded before it could be recorded; recorded as failed to keep the recovery route open';
  end if;

  -- ── Write the mirror (BLOCK 3 + ⚑ S3). The conflict guard admits the update when it does NOT clobber
  -- a LIVE ERP document (a `ts_number` set and not cancelled) AND its generation witness
  -- (`approved_at_pushed`) does not lose to what is already recorded:
  --   • never overwrite a live document — this is by definition the no-document outcome (NEW-7).
  --   • DO overwrite a stale no-document `pushed`/null row from a PRIOR generation (the empty-approved-
  --     sheet success must not permanently mask a later real held push).
  --   • ⚑ S3 (round 8): when the existing row's generation is UNKNOWN (`approved_at_pushed is null` —
  --     the shape `parkTimesheetMirrorRow`'s absent-branch insert creates, i.e. every row the SWEEP
  --     writes), 0155 let ANY writer overwrite it. So on exactly those rows the guard's stated property
  --     ("a STALE writer's `failed` is a no-op against a newer generation") was FALSE, and a released
  --     writer could downgrade the sweep's `held` park to `failed`. Unknown generation now admits only
  --     a writer whose CAS actually MATCHED — a proven-current one.
  -- `ts_number`/`pushed_at`/`erp_cancelled_at` are deliberately NOT named — the no-document outcome never
  -- learns a document number (NEW-7), and must not erase/forge one.
  insert into public.timesheet_erp_mirror (org_id, timesheet_id, push_state, push_error, approved_at_pushed)
  values (p_org, p_timesheet_id, v_state, v_error, p_approved_at)
  on conflict (timesheet_id) do update
    set push_state         = excluded.push_state,
        push_error         = excluded.push_error,
        approved_at_pushed = excluded.approved_at_pushed
    where (timesheet_erp_mirror.ts_number is null or timesheet_erp_mirror.erp_cancelled_at is not null)
      and (case
             when timesheet_erp_mirror.approved_at_pushed is null then v_cas_matched
             else excluded.approved_at_pushed is not null
                  and excluded.approved_at_pushed >= timesheet_erp_mirror.approved_at_pushed
           end);

  -- ⚑ THE WITNESS (round-8 BLOCK) — STAMPED UNCONDITIONALLY, OUTSIDE THE GUARD ABOVE. The guard decides
  -- whose OUTCOME wins; this is not an outcome. Every branch of this function is recording a
  -- `command-held`, which means the submit reached ERPNext and its result was never read back — a fact
  -- about the EXTERNAL system that is true whether or not this writer's generation is current, and that
  -- no release, re-queue or supersession can make false. The trigger in §2 keeps the FIRST such
  -- timestamp and refuses every silent clear. Skipped only when the row already names a live document:
  -- there is no unknown left to witness (and §2 would clear it anyway).
  update public.timesheet_erp_mirror
     set post_submit_unknown_at = now()
   where timesheet_id = p_timesheet_id
     and (ts_number is null or erp_cancelled_at is not null);

  return v_state;
end $$;

-- ── ACL discipline (0096 pattern): SECURITY DEFINER over a policy-scoped table; MACHINE-ONLY. The only
-- caller is the service-role dispatch edge fn (`markTimesheetPushOutcome`). An authenticated principal
-- could otherwise forge a mirror hold/release outcome for any org's sheet. ─────────────────────────────
revoke all     on function public.record_timesheet_command_held(uuid, uuid, timestamptz, text, uuid, int) from public, anon, authenticated;
grant  execute on function public.record_timesheet_command_held(uuid, uuid, timestamptz, text, uuid, int) to   service_role;

-- ============================================================================================
-- §4 — transition_timesheet: the re-open refuses while the ERP OUTCOME IS UNKNOWN.
-- Byte-for-byte with 0152 §B except the one added precondition (marked inline) and the corrected
-- narrative on what `failed` does and does not prove. Every other arm, the SoD ordering, the advisory
-- lock, and the stamps are unchanged.
-- ============================================================================================
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
    -- side wins the lock the other sees its effect.
    perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || p_timesheet_id::text, 0));
    -- Refuse if ERP may hold a LIVE document — a mirror row with ts_number set and not cancelled
    -- (Luna f1, mirror side). A pushed sheet is refused here; Slice B will fill the cancel-confirmed
    -- admit branch for it. Fail closed on any doubt.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.ts_number is not null and m.erp_cancelled_at is null) then
      raise exception 'reopen-erp-document-held' using errcode = 'P0001';
    end if;
    -- ⚑ THE UNKNOWN ERP OUTCOME (Luna FU-1a round-8 BLOCK — THE money predicate). `post_submit_unknown_at`
    -- is set the moment PMO loses track of a submit's result and is cleared ONLY by learning a real
    -- `ts_number` or by an audited operator attestation (0157 §2/§5). It is deliberately INDEPENDENT of
    -- `push_state` and of the outbox: those answer "can the backstop retry this?", and a re-queue —
    -- including `release_outbox_hold`, which clears BOTH hold states in one transaction — establishes
    -- NOTHING about what ERPNext holds. Before this predicate, a release therefore opened the correction
    -- path over a live ERP document: re-open + re-approve minted a SECOND Timesheet for the week and the
    -- client's hours double-counted permanently (the original command can never be adopted afterwards,
    -- so it never learns the `ts_number` that would have fenced the second push).
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.post_submit_unknown_at is not null) then
      raise exception 'reopen-push-outcome-unknown' using errcode = 'P0001';
    end if;
    -- The mirror's own `held` state, kept as an INDEPENDENT predicate (0152 §B). It fences the pre-0157
    -- residue — a `held` row written before the witness column existed — and any future writer that
    -- parks `held` without stamping one. Same refusal, so the caller sees one story.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id and m.push_state = 'held') then
      raise exception 'reopen-push-outcome-unknown' using errcode = 'P0001';
    end if;
    -- Refuse if ANY non-terminal outbox row exists for this sheet — the after-commit-before-mirror
    -- seam (a `committed` row whose mirror finalize has not run — Luna f1) AND a bare `pending` (a
    -- queued push still claimable/POSTable while this re-open commits — Luna f2).
    --
    -- ⚑ WHAT TERMINAL `failed` DOES AND DOES NOT PROVE (CORRECTED IN ROUND 8; the 0152 text this
    -- replaces was false). `failed` on the OUTBOX means only "no retry is queued". It does NOT mean
    -- "ERP holds no document":
    --   • an operator `release_outbox_hold` writes `failed` over a POST-SUBMIT UNKNOWN (0152 §A) —
    --     that is the round-8 BLOCK, and it is why the predicate above no longer reads push state at all;
    --   • `commitCreate` creates then submits (`erpnext/adapter.ts`), so a create that succeeded and a
    --     submit ERP rejected is terminal `failed` while ERPNext holds a DRAFT Timesheet PMO has no
    --     pointer to (no costing, so clutter rather than a double-count — but not "no document");
    --   • a row written by the PRE-0151 code carries no guarantee at all: a succeeded submit whose
    --     read-back failed was marked terminal `failed` with a `ts_number`-less mirror.
    -- So this arm no longer LEANS on `failed`; it admits `failed` only once the independent
    -- unknown-outcome witness above says the ERP question has actually been answered. THE PRE-0151
    -- DISPOSITION IS UNCHANGED AND STILL EXPLICIT: those rows carry no witness (the column did not
    -- exist), this arm will ADMIT them, and an OPERATOR must establish what ERP holds before trusting
    -- that admit. The census + the operator's action are named in
    -- `docs/plans/2026-07-23-timesheet-reopen-unpushed.md` §9 ("Pre-0151 residue"); an environment that
    -- never ran the P3b push before 0151 has an empty census and nothing to do.
    if exists (select 1 from public.external_command_outbox o
                 where o.org_id = v_org and o.domain = 'timesheets'
                   and o.pmo_record_id = p_timesheet_id::text
                   and o.state in ('pending','committing','committed','quarantined','held')) then
      raise exception 'reopen-push-in-flight' using errcode = 'P0001';
    end if;
    -- ⛔ SLICE B SEAM: the cancel-confirmed ADMIT branch (FR-TSC-008 full) lands HERE — when a
    -- generation-specific correction intent is consumed + its cancel outbox confirmed + mirror
    -- tombstoned, a PUSHED sheet may flip. Slice A admits ONLY the un-pushed case (no live doc, no
    -- unknown outcome, no non-terminal outbox row); a pushed sheet is refused above (Slice B's entry
    -- point). Do NOT widen without the intent table + cancel machinery.
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

-- ============================================================================================
-- §5 — attest_timesheet_no_erp_document: the ONLY human route out of an unknown.
--
-- An unknown ERP outcome is a question about the EXTERNAL system, so the only things that may answer it
-- are (a) the external system itself, via a learned `ts_number` (§2 rule 1 — the probe/backstop path),
-- or (b) a human who went and looked. This RPC is (b), and it is shaped like every other
-- money-adjacent operator action in this codebase: Admin-only, org-re-asserted (DEFINER bypasses RLS),
-- reason-required, audited, and refusing when there is nothing to attest — an attestation that can be
-- clicked on any row teaches an operator that it is a formality.
--
-- It deliberately does NOT touch push_state, ts_number, or the outbox: it answers ONE question. The
-- backstop route is `release_outbox_hold`'s job, and keeping the two separate is the whole point of
-- this migration.
-- ============================================================================================
create or replace function public.attest_timesheet_no_erp_document(p_timesheet_id uuid, p_reason text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_org     uuid;
  v_actor   uuid := auth.uid();
  v_witness timestamptz;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'an attestation must state what was checked in ERPNext' using errcode = 'P0001';
  end if;

  select t.org_id into v_org from public.timesheets t where t.id = p_timesheet_id;
  if v_org is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;
  -- Org + Admin + active-membership re-assertion — MUST STAY (DEFINER bypasses RLS and this is
  -- directly reachable by any authenticated caller). Same gate as `release_outbox_hold` (0152 §A).
  if v_org is distinct from public.auth_org_id()
     or public.auth_role() is distinct from 'Admin'
     or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock + re-read the row: an attestation races the dispatch's own recorder, and the loser must see
  -- the committed truth rather than clear a witness that was stamped after it looked.
  select m.post_submit_unknown_at into v_witness
    from public.timesheet_erp_mirror m
   where m.timesheet_id = p_timesheet_id and m.org_id = v_org
   for update;
  if v_witness is null then
    raise exception 'timesheet has no unknown ERP outcome to attest' using errcode = 'P0001';
  end if;

  -- The §2 trigger's one escape, scoped to THIS timesheet and THIS transaction (`is_local => true`).
  perform set_config('pmo.attested_no_erp_timesheet', p_timesheet_id::text, true);
  update public.timesheet_erp_mirror m
     set post_submit_unknown_at = null,
         push_error = 'operator attested (' || v_actor::text || '): ERPNext holds no Timesheet for this week — ' || p_reason
   where m.timesheet_id = p_timesheet_id and m.org_id = v_org;
  perform set_config('pmo.attested_no_erp_timesheet', '', true);

  perform public.log_audit(
    'attest_timesheet_no_erp_document',
    v_org,
    v_actor,
    p_timesheet_id,
    jsonb_build_object('reason', p_reason, 'unknown_since', v_witness)
  );
end $$;

revoke all     on function public.attest_timesheet_no_erp_document(uuid, text) from public;
grant  execute on function public.attest_timesheet_no_erp_document(uuid, text) to   authenticated;
revoke execute on function public.attest_timesheet_no_erp_document(uuid, text) from anon;
