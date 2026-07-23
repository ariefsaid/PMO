-- 0153_fence_timesheet_command_held_mirror.sql — close the release-before-mirror ordering race that
-- the round-4 fix (0152) left open (Luna FU-1a round-5 BLOCK).
--
-- ⚑ THE DEFECT (a late, un-fenced mirror write recreates the dead end 0152 closed). The deterministic
-- recovery marks the OUTBOX `held` FIRST (`adapterSeam/dispatch.ts` → `mark_outbox_held`), then the
-- dispatch catch records the `command-held` MIRROR later, through an UNGUARDED upsert
-- (`markTimesheetPushOutcome`'s `command-held` arm). The two writes are not atomic, so an Admin release
-- can interleave BETWEEN them:
--   1. outbox = `held`; the mirror row is NOT present yet.
--   2. `release_outbox_hold` (0152 §A) locks only the outbox, sets it `failed`, updates ZERO mirror rows
--      (none exists), and commits.
--   3. the delayed handler upserts the mirror as `held`.
-- Final state: outbox `failed` + mirror `held`. The backstop excludes `held` (`erpnext-sweep`), the
-- re-open fence refuses it (0152 §B), and a SECOND release is refused because the outbox is no longer
-- `held`. The ERP Timesheet is live but can never be adopted/re-probed — the correction path is dead-ended.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────────────────────────────
-- A released outbox generation must be UNABLE to write `held` to the mirror afterward. This RPC replaces
-- the `command-held` arm's blind upsert: it reads the outbox and writes the mirror in ONE statement, and
-- writes `push_state='held'` ONLY while a `held` timesheet outbox for this record is STILL live. Because
-- the one-inflight-per-record index (0116) admits at most one non-terminal command per record, that live
-- `held` row IS the exact command (at its exact generation) whose recovery-probe failure produced this
-- outcome — a release moves it to `failed` (and bumps `claim_generation`), after which no `held` row
-- exists, so the fence fails. On a failed fence the writer records the RELEASED outcome (`failed`,
-- matching the outbox) so the backstop re-queues the record, and NEVER resurrects the hold.
--
-- Scope: ONLY the timesheet `command-held` path. `release_outbox_hold` (0152) and every non-timesheet
-- mirror-outcome write are untouched.
--
-- Reversibility (ADR-0006): `drop function public.record_timesheet_command_held(uuid, uuid, timestamptz,
-- text);` and restore `markTimesheetPushOutcome`'s held arm to the direct upsert. No table/column change.

create or replace function public.record_timesheet_command_held(
  p_org          uuid,
  p_timesheet_id uuid,
  p_approved_at  timestamptz,
  p_reason       text
) returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_state text;
  v_error text;
begin
  -- THE FENCE — read the outbox and decide in the SAME statement. A `held` timesheet outbox for this
  -- record still live ⇒ the hold is real and current, record `held`. Otherwise (released → `failed`,
  -- generation bumped; or never landed) ⇒ record the released outcome, `failed`. One command per record
  -- (0116) makes this `held` row THE command at its exact generation, so this is a generation-exact CAS.
  if exists (
    select 1 from public.external_command_outbox o
      where o.org_id        = p_org
        and o.domain        = 'timesheets'
        and o.pmo_record_id  = p_timesheet_id::text
        and o.state          = 'held'
  ) then
    v_state := 'held';
    v_error := p_reason;
  else
    v_state := 'failed';
    v_error := coalesce(p_reason, 'command-held')
             || ' — hold released before it could be recorded; recorded as failed to keep the recovery route open';
  end if;

  -- Write the mirror. `where push_state <> 'pushed'` is defensive money-safety: this outcome writer never
  -- runs on a sheet whose mirror is a real ERP document (the `command-held` outcome means the successful
  -- mirror write never happened), but it must NEVER clobber a `pushed` row to `failed` and un-block a
  -- live document from re-open. `ts_number`/`pushed_at`/`erp_cancelled_at` are deliberately NOT named —
  -- the no-document outcome never learns a document number (NEW-7).
  insert into public.timesheet_erp_mirror (org_id, timesheet_id, push_state, push_error, approved_at_pushed)
  values (p_org, p_timesheet_id, v_state, v_error, p_approved_at)
  on conflict (timesheet_id) do update
    set push_state        = excluded.push_state,
        push_error        = excluded.push_error,
        approved_at_pushed = excluded.approved_at_pushed
    where timesheet_erp_mirror.push_state <> 'pushed';

  return v_state;
end $$;

-- ── ACL discipline (0096 pattern): SECURITY DEFINER over a policy-scoped table; MACHINE-ONLY. The only
-- caller is the service-role dispatch edge fn (`markTimesheetPushOutcome`). An authenticated principal
-- could otherwise forge a mirror hold/release outcome for any org's sheet. ─────────────────────────────
revoke all     on function public.record_timesheet_command_held(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant  execute on function public.record_timesheet_command_held(uuid, uuid, timestamptz, text) to   service_role;
