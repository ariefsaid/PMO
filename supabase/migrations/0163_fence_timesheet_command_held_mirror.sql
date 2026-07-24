-- 0155_fence_timesheet_command_held_mirror.sql — record the timesheet `command-held` mirror outcome as
-- a GENERATION-EXACT CAS under a row lock (Luna FU-1a round-6, THREE BLOCKs from ONE root cause).
--
-- ⚑ THE DEFECT (round-5's fix approximated the fence with an `EXISTS` heuristic — "does ANY held
-- timesheet outbox for (org, timesheet_id) currently exist?" — and that heuristic fails three ways):
--   • BLOCK 1 — the `EXISTS` read is not atomic with the mirror INSERT and takes NO row lock, so a
--     release interleaving between the read and the write still lands outbox=`failed` + mirror=`held`:
--     the race round-4/round-5 tried to close is NOT closed.
--   • BLOCK 2 — `EXISTS` matches a NEWER approval generation. Once the original held row is released
--     (terminal `failed`, generation bumped), 0134's partial-unique index admits a SUCCESSOR command
--     (a new id, a new generation). A delayed writer for the OLD generation then attributes the
--     successor's unknown ERP outcome to itself — a wrong-generation witness on a money mirror.
--   • BLOCK 3 — the empty-approved-sheet path legitimately records `pushed` with `ts_number = NULL`
--     (FR-TSP-056). The old conflict guard `WHERE push_state <> 'pushed'` then updates ZERO rows against
--     that prior `pushed` row, so a genuinely-held later generation stays recorded `pushed`: the backstop
--     skips it, and re-open admits another approval while ERP may hold a live document — a DOUBLE-COUNT.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────────────────────────────
-- The served mirror writer now threads the EXACT outbox id + claim generation the hold was produced
-- under (stamped on the `command-held` AppError deep in `dispatch.ts`'s recovery, carried through the
-- served catch into `markTimesheetPushOutcome`). This RPC:
--   1. LOCKS that EXACT outbox row (`SELECT … FOR UPDATE`) and re-reads its committed state. A release
--      takes the SAME lock, so the two serialize — one waits, and the loser re-reads committed state.
--      (BLOCK 1: the interleave is closed by the lock, not by a hope about scheduling.)
--   2. records `held` ONLY if that exact row is STILL `state = 'held'` AND its `claim_generation` equals
--      the token the hold was produced under. A successor command has a different id; a reclaimed row
--      has a bumped generation — neither matches, so a stale writer records the RELEASED outcome
--      (`failed`), NEVER `held`. (BLOCK 2: a generation-exact compare-and-set, not an `EXISTS`.)
--   3. writes the mirror with a conflict guard that distinguishes a LIVE ERP document (`ts_number` set
--      and not cancelled — never clobbered) from the documented no-document `pushed` (`ts_number` NULL).
--      A current-generation outcome MAY overwrite a stale `pushed`/null row from a PRIOR generation, keyed
--      on the generation witness (`approved_at_pushed`): only a strictly-newer witness may. That also
--      stops a stale (older-witness) writer from overwriting a newer generation's row. (BLOCK 3.)
-- Plus defense-in-depth: the RPC derives + asserts the sheet's org, so a service-role caller cannot
-- record a mirror carrying the wrong org (round-6 NOTE).
--
-- Scope: ONLY the timesheet `command-held` path. `release_outbox_hold` (0152) and every non-timesheet
-- mirror-outcome write are untouched.
--
-- Reversibility (ADR-0006, unreleased): `drop function public.record_timesheet_command_held(uuid, uuid,
-- timestamptz, text, uuid, int);` and restore `markTimesheetPushOutcome`'s held arm to the direct
-- upsert. No table/column change.

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
  v_state     text;
  v_error     text;
  v_out_state text;
  v_out_gen   int;
  v_sheet_org uuid;
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

  -- ── THE GENERATION-EXACT FENCE UNDER A ROW LOCK (BLOCK 1 + BLOCK 2). Lock the EXACT outbox row this
  -- held outcome was produced against and re-read its COMMITTED state. `release_outbox_hold` (0152 §A)
  -- takes the SAME `FOR UPDATE` lock on this row, so a concurrent release and this writer serialize:
  -- whichever commits first, the loser re-reads the committed result. Record `held` ONLY while that exact
  -- row is STILL `held` at the SAME `claim_generation` the hold was produced under. A successor command
  -- (0134 admits one once the old row is terminal) has a DIFFERENT id and cannot be this row; a reclaim
  -- (`claim_outbox_for_commit`) or a release BUMPS the generation, so the token no longer matches. In
  -- every mismatch the writer records the RELEASED outcome (`failed`) — matching the released outbox, so
  -- the backstop re-queues the record — and NEVER resurrects the hold.
  --
  -- ⛔ THE NEXT SENTENCE WAS FALSE AND IS SUPERSEDED BY 0157 §3 (Luna round-8, S2). It read: "A
  -- missing/absent p_outbox_id (no id threaded) finds no row ⇒ fails closed to `failed`, never a blind
  -- `held`." On the MIRROR fence `failed` is the PERMISSIVE state (it is both the backstop's queue and
  -- the re-open's admit) and `held` is the restrictive one — so a LOST marker RELAXED the fence rather
  -- than tightening it. 0157 distinguishes a miss on a row that EXISTS (a real release/reclaim ⇒
  -- `failed`) from a row that cannot be located at all (a threading bug ⇒ `held` + the unknown witness).
  select state, claim_generation
    into v_out_state, v_out_gen
    from public.external_command_outbox
   where id = p_outbox_id
   for update;

  if v_out_state = 'held' and v_out_gen = p_claim_generation then
    v_state := 'held';
    v_error := p_reason;
  else
    v_state := 'failed';
    v_error := coalesce(p_reason, 'command-held')
             || ' — hold released or superseded before it could be recorded; recorded as failed to keep the recovery route open';
  end if;

  -- ── Write the mirror (BLOCK 3). The conflict guard admits the update when it does NOT clobber a LIVE
  -- ERP document (a `ts_number` set and not cancelled) AND its generation witness (`approved_at_pushed`)
  -- is not OLDER than what is already recorded:
  --   • never overwrite a live document — this is by definition the no-document outcome (NEW-7).
  --   • DO overwrite a stale no-document `pushed`/null row from a PRIOR generation (the empty-approved-
  --     sheet success must not permanently mask a later real held push).
  --   • a strictly-newer witness requirement also makes a STALE (older-generation) writer's `failed`
  --     a no-op against a newer generation's row (BLOCK 2's mirror side).
  -- `ts_number`/`pushed_at`/`erp_cancelled_at` are deliberately NOT named — the no-document outcome never
  -- learns a document number (NEW-7), and must not erase/forge one.
  insert into public.timesheet_erp_mirror (org_id, timesheet_id, push_state, push_error, approved_at_pushed)
  values (p_org, p_timesheet_id, v_state, v_error, p_approved_at)
  on conflict (timesheet_id) do update
    set push_state         = excluded.push_state,
        push_error         = excluded.push_error,
        approved_at_pushed = excluded.approved_at_pushed
    where (timesheet_erp_mirror.ts_number is null or timesheet_erp_mirror.erp_cancelled_at is not null)
      and (timesheet_erp_mirror.approved_at_pushed is null
           or (excluded.approved_at_pushed is not null
               and excluded.approved_at_pushed >= timesheet_erp_mirror.approved_at_pushed));

  return v_state;
end $$;

-- ── ACL discipline (0096 pattern): SECURITY DEFINER over a policy-scoped table; MACHINE-ONLY. The only
-- caller is the service-role dispatch edge fn (`markTimesheetPushOutcome`). An authenticated principal
-- could otherwise forge a mirror hold/release outcome for any org's sheet. ─────────────────────────────
revoke all     on function public.record_timesheet_command_held(uuid, uuid, timestamptz, text, uuid, int) from public, anon, authenticated;
grant  execute on function public.record_timesheet_command_held(uuid, uuid, timestamptz, text, uuid, int) to   service_role;
