// The timesheet push's sweep backstop, live wiring (THEME-BACK-40, #1643): pass (6)'s deps for `timesheetBackstop.ts`,
// the absent-mirror mint and the per-org pass. Moved verbatim from index.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ERPNEXT_TIER, surfaceActionRequired } from '../_shared/erpnextFeedDeps.ts';
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { canonicalCommandDigest } from '../adapter-dispatch/moneyOutboxDeps.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { findOutboxRowByKey } from './outboxRows.ts';
import { ERPNEXT_TIMESHEETS_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
// P3b task 6.4 (FR-TSP-045, AC-TSP-022) — the timesheet push's sweep backstop, pure orchestration.
import { reconcileOrgTimesheetPushes, type TimesheetBackstopDeps, type TimesheetMirrorCandidateRow, type TimesheetPushSubject } from './timesheetBackstop.ts';
// ⚑ The ONE derivation of the timesheet key, IMPORTED — never re-implemented here. Two originators with
// drifted keys means the outbox 4-tuple does not collide and the client is billed a DUPLICATED WEEK of
// hours. (This is why the key was moved out of `repositories/index.ts`, which no edge fn can load.)
import { timesheetPushKey } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/timesheetPushKey.ts';
import { featureDisabled, type OrgBinding, listRetryPendingLive, listCandidatesLive, stampQueueAttempt, moneyRowsStopped } from './sweepShared.ts';
import { buildReconcileDepsLive, dispatchMoneyWrite } from './moneyWriteLive.ts';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// (6) P3b — the timesheet push's sweep backstop, live wiring (FR-TSP-045, AC-TSP-022,
//     timesheetBackstop.ts). The structural twin of pass (5).
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Read the EXISTING `external_command_outbox` row for this timesheet's deterministic key, if any —
 *  the SAME key the Approvals UI derives (`timesheetPushKey`), so this finds the SAME candidate rather
 *  than minting a second one; the two originators collide safely (ADR-0058). */
// deno-lint-ignore require-await -- preserve async promise/error behavior while forwarding the query result.
async function findTimesheetOutboxRow(
  serviceClient: SupabaseClient,
  orgId: string,
  timesheetId: string,
  idempotencyKey: string,
): Promise<OutboxRow | null> {
  return findOutboxRowByKey(serviceClient, orgId, ERPNEXT_TIMESHEETS_DOMAIN, timesheetId, idempotencyKey);
}

/**
 * Park a timesheet mirror row (`held` or `failed`) as a COMPARE-AND-SET — the NEW-4 lesson from the
 * budget twin, applied here by construction.
 *
 * The row's eligibility was established by `listPendingTimesheetPushes` earlier in the SAME tick, and
 * the FOREGROUND push (the Approvals UI's Retry, or a fresh approval) runs concurrently on the very same
 * row. A blind update keyed on `(org_id, timesheet_id)` alone would relabel a live success — a row that
 * moved to `pushed` against a real ERPNext Timesheet — as `held`, and `held` is excluded from this very
 * work queue, so nothing would ever re-drive it. A read-then-blind-write across a concurrent writer is a
 * lost update, not a state machine. So the update REPEATS the listing's own predicate.
 *
 * ⚑ Luna FU-1a round-8 BLOCK — a HELD park also records that the ERP OUTCOME IS UNKNOWN. This park is
 * the second producer of "PMO does not know what ERPNext holds": a command whose attempts ran out may
 * have run them out AFTER a submit landed (a post-submit unknown is retried as `external-unreachable`,
 * `erpnext/adapter.ts`), so `held` here carries exactly the doubt the dispatch's own `command-held`
 * carries. Recording it only as `push_state='held'` leaves the re-open fence resting on a PMO QUEUE
 * STATE — and that state is precisely what an operator's `release_outbox_hold` clears when they restore
 * the backstop route. The witness is sticky and first-observed-wins in the DB (migration 0157 §2), so
 * re-parking on a later tick is idempotent. A `failed` park is NOT an unknown: those reasons
 * (`timesheet-push-gate-refused`, `timesheet-push-no-outbox-candidate`) all mean nothing was sent.
 */
async function parkTimesheetMirrorRow(
  serviceClient: SupabaseClient,
  orgId: string,
  row: TimesheetMirrorCandidateRow,
  pushState: 'held' | 'failed',
  reason: string,
): Promise<{ error: { message: string; code?: string } | null }> {
  const patch: Record<string, unknown> = { push_state: pushState, push_error: reason };
  if (pushState === 'held') patch.post_submit_unknown_at = new Date().toISOString();
  // AC-TSP-022: an `absent` candidate (an approved sheet with NO mirror row) has nothing to
  // compare-and-set against — its durable state must be CREATED, or the refusal is invisible and the
  // sheet is re-driven from scratch every tick. A 23505 means the foreground (or another tick) created
  // the row first: theirs is the newer truth, so leave it exactly as it is.
  if (row.push_state === MIRROR_ABSENT) {
    const { error } = await serviceClient
      .from('timesheet_erp_mirror')
      .insert({ org_id: orgId, timesheet_id: row.timesheet_id, ...patch });
    return { error: error && error.code !== '23505' ? error : null };
  }
  return await serviceClient
    .from('timesheet_erp_mirror')
    .update(patch)
    .eq('org_id', orgId)
    .eq('timesheet_id', row.timesheet_id)
    // the SAME eligibility `listPendingTimesheetPushes` asserted — never a state this pass did not observe
    .in('push_state', ['pending', 'failed'])
    .is('erp_cancelled_at', null);
}

/** The synthetic candidate state for an APPROVED sheet that has no `timesheet_erp_mirror` row at all. */
const MIRROR_ABSENT = 'absent';

/** How far back the `absent` queue looks for an approved-but-never-attempted sheet (14 days). See
 *  `listApprovedSheetsWithoutMirror` for why the scan must be bounded at all. */
const ABSENT_SHEET_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Mint the timesheet push's outbox row for an approval whose foreground dispatch never reached the
 * server, ATTRIBUTED to the sheet's own `approved_by` (AC-TSP-022 / FR-TSP-045).
 *
 * The row is byte-identical to the one `adapter-dispatch` would have inserted for the same approval:
 * the SAME deterministic key, the SAME `create` operation, and the SAME payload shape built from the
 * SAME server-read gate output (`repositories/index.ts` `pushApproved` + the dispatch's own gate
 * substitution) — so the digest matches and the two originators reconcile as one command instead of
 * rejecting each other with `idempotency-key-payload-mismatch`.
 *
 * ⚑ MINTED THROUGH THE FENCE (Luna code review BLOCK 1, migration 0151 §B). This used to INSERT into
 * `external_command_outbox` directly, which put the sweep OUTSIDE the per-sheet `ts-correct:` advisory
 * lock that the re-open (`transition_timesheet` Approved→Draft) and the sync push both honour. That was
 * live money: the gate read sees the 40-hour sheet `Approved`, the approver re-opens it (the lock is
 * taken, no outbox row exists yet, PMO commits `Draft`), and the sweep then mints and POSTs the
 * ORIGINAL hours anyway — the corrected week is pushed later and ERPNext holds BOTH generations (72
 * hours on the client's project). A second status read here could not close it; the status check and
 * the INSERT must be one transaction under the lock, which is exactly what the guard RPC is.
 *
 * Returns `{ row }` to drive, or `{ row: null, refusal }`:
 *   • a 23505 says a concurrent writer owns this record's in-flight command (a different key under
 *     0116's one-in-flight index) — the re-read below finds their row, or nothing to drive;
 *   • a P0001 says the FENCE refused (`timesheet-no-longer-approved` — the re-open won the lock). The
 *     reason is handed back so the caller records WHY, and nothing is pushed.
 */
async function mintTimesheetOutboxRow(
  serviceClient: SupabaseClient,
  orgId: string,
  timesheetId: string,
  idempotencyKey: string,
  approvedAt: string,
  subject: TimesheetPushSubject,
): Promise<{ row: OutboxRow | null; refusal: string | null }> {
  const payload: Record<string, unknown> = {
    id: timesheetId,
    erp_doc_kind: 'timesheet',
    user_id: subject.userId,
    approved_at: approvedAt,
    entries: subject.entries,
  };
  const payloadDigest = await canonicalCommandDigest({ domain: ERPNEXT_TIMESHEETS_DOMAIN, operation: 'create', record: payload });
  const { error } = await serviceClient.rpc('insert_timesheet_outbox_pending', {
    p_org: orgId,
    p_domain: ERPNEXT_TIMESHEETS_DOMAIN,
    p_record_id: timesheetId,
    p_key: idempotencyKey,
    p_tier: ERPNEXT_TIER,
    p_operation: 'create',
    p_payload: payload,
    p_digest: payloadDigest,
    // 0108 §C: the RECORDED actor every later re-authorization (`checkOutboxReplayAuthorization`) and
    // every mirror attribution keys on. Never null here — the caller only mints with a resolved approver.
    p_actor: subject.approvedBy,
  });
  // P0001 = THE FENCE REFUSED: the sheet is no longer Approved (a re-open committed while this pass was
  // deciding). Nothing was inserted; the week's old hours must never be posted. Recorded, not pushed.
  if (error?.code === 'P0001') return { row: null, refusal: error.message };
  // 23505 = the foreground raced us (same 4-tuple ⇒ the read below finds THEIR row and we reconcile to
  // it) or a different command for this record is already in flight (0116 ⇒ nothing to find, caller
  // records it). Any other error is a real DB fault and is contained per-row by the caller.
  if (error && error.code !== '23505') throw new AppError(error.message, error.code);
  return { row: await findTimesheetOutboxRow(serviceClient, orgId, timesheetId, idempotencyKey), refusal: null };
}

/**
 * ⚑ AC-TSP-022 — the `absent` half of the work queue: APPROVED sheets with NO mirror row.
 *
 * The mirror is written by `adapter-dispatch` itself, so the very failure this backstop exists for —
 * the browser dying BEFORE the fetch reaches the server — leaves no mirror row AND no outbox row, i.e.
 * nothing at all for a mirror-only queue to find. Those weeks were stranded silently: PMO said
 * Approved, the client's ERP never heard about the hours, and no surface said otherwise.
 *
 * ⚑ SCOPED TO THE BINDING'S OWN LIFETIME (`approved_at >= activated_at`). Hours approved BEFORE the org
 * connected ERPNext are deliberately out of scope: back-filling a client's ledger with historical
 * payroll costing is a migration decision a human makes, never a side effect of switching the
 * integration on. An org with no activation stamp is not employing at all (`listEmployingOrgsLive`
 * already filters those out) — a missing stamp here yields NO candidates, which is the fail-safe answer.
 */
async function listApprovedSheetsWithoutMirror(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  limit: number,
  nowMs: number = Date.now(),
): Promise<TimesheetMirrorCandidateRow[]> {
  if (limit <= 0 || !org.activatedAt) return [];
  // ⚑ BOUNDED LOOKBACK, and not a nicety: a sheet keeps its mirror row forever once it has one, so an
  // unbounded `approved_at asc` scan fills its whole page with long-settled sheets as the org's history
  // grows and would never reach a NEW stranded week — the queue would starve itself silently. The
  // window is orders of magnitude wider than the recovery it serves (the cron ticks hourly, so a
  // stranded week is normally recovered within the hour); anything older than it is a human's problem,
  // not something to post to a client's ledger unannounced.
  const lookbackFloor = new Date(nowMs - ABSENT_SHEET_LOOKBACK_MS).toISOString();
  const floor = lookbackFloor > org.activatedAt ? lookbackFloor : org.activatedAt;
  // ⚑ HIGH-3 (audit round 5) — THE ANTI-JOIN IS IN THE QUERY, so `limit` bounds the CANDIDATES FOUND,
  // not the rows SCANNED. It used to page `timesheets` first and subtract the mirrored ones in JS: a
  // 120-person org approves ~240 sheets in the trailing 14 days, so the 200-row page filled with
  // already-mirrored sheets and the `absent` queue came back EMPTY — the backstop silently did nothing
  // at exactly the volume that makes it matter. `is('timesheet_erp_mirror', null)` on the embedded
  // resource is PostgREST's anti-join (the 1:1 FK `timesheet_erp_mirror.timesheet_id → timesheets.id`,
  // 0136 §1): it is part of the WHERE clause, so LIMIT applies to sheets that have no mirror row.
  const { data, error } = await serviceClient
    .from('timesheets')
    .select('id, timesheet_erp_mirror!left(timesheet_id)')
    .eq('org_id', org.orgId)
    .eq('status', 'Approved')
    .gte('approved_at', floor)
    .is('timesheet_erp_mirror', null)
    .order('approved_at', { ascending: true })
    .limit(limit);
  if (error) throw new AppError(error.message, error.code);
  return ((data as Array<{ id: string }> | null) ?? []).map((r) => ({
    timesheet_id: r.id,
    push_state: MIRROR_ABSENT,
    erp_cancelled_at: null,
  }));
}

/**
 * ⚑ HIGH-3 — the `absent` queue's own RESERVED share of a tick, so a saturated mirror queue can never
 * zero it. The absent half used to be handed `limit - mirrored.length`: ONE org-wide misconfiguration
 * (say every push failing `activity-type-unconfigured`) parks ≥`limit` `failed` mirror rows, which are
 * re-listed every tick, so the absent budget was 0 PERMANENTLY and a genuinely stranded week could
 * never be seen again. The header comment reasoned carefully about absent sheets not starving mirror
 * rows; the converse was unguarded. A reserved floor keeps both halves bounded (total ≤ 1.25×limit)
 * and neither can be starved by the other.
 */
export function absentQueueBudget(limit: number, mirroredCount: number): number {
  const reserved = Math.ceil(limit * 0.25);
  return Math.max(limit - mirroredCount, Math.min(reserved, limit));
}

/** The live `TimesheetBackstopDeps` for one org. */
export function timesheetBackstopDepsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  eligibleOutboxIds: ReadonlySet<string>,
  /** 0357: `failed` rows waiting out their retry delay (`outbox_retry_pending`) — not due, not exhausted. */
  retryPendingIds: ReadonlySet<string> = new Set(),
  /** 0534 (held module): when set, the queue is restricted to these timesheet ids — the ones whose outbox
   *  command is already `committed`, i.e. ERP accepted the week and only the local finalize is outstanding.
   *  Omit it while the module is on. */
  recoverableOnlyIds?: ReadonlySet<string>,
): TimesheetBackstopDeps {
  return {
    listPendingTimesheetPushes: async (orgId, limit) => {
      // ⚑ Everything this pass must NEVER re-drive is expressed HERE, as query predicates:
      //   • only `pending`/`failed` — so `pushed` (done), `held` (ADR-0058-terminal until an operator)
      //     and `pushing` (an in-flight claim, owned by the stale-claim path — a naive re-POST would
      //     mint a SECOND ERP Timesheet) are never even fetched;
      //   • `erp_cancelled_at is null` — a Desk-cancelled sheet is never re-created (FR-TSP-084: never
      //     fight the accountant).
      // Index-served on (org_id, push_state) and bounded, ordered oldest-first so the queue is fair.
      const { data, error } = await serviceClient
        .from('timesheet_erp_mirror')
        .select('id, timesheet_id, push_state, erp_cancelled_at, last_attempt_at')
        .eq('org_id', orgId)
        .in('push_state', ['pending', 'failed'])
        .is('erp_cancelled_at', null)
        // Fair order (0427): never attempted first, then the longest-waiting — see `stampQueueAttempt`.
        .order('last_attempt_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (error) throw new AppError(error.message, error.code);
      const mirrored = ((data as Array<{ timesheet_id: string; push_state: string; erp_cancelled_at: string | null; last_attempt_at: string | null }> | null) ?? [])
        .map((r) => ({ timesheet_id: r.timesheet_id, push_state: r.push_state, erp_cancelled_at: r.erp_cancelled_at, last_attempt_at: r.last_attempt_at }));
      // …plus the `absent` half: APPROVED sheets that never got a mirror row at all (see
      // `listApprovedSheetsWithoutMirror` — the browser-died-before-the-fetch case this pass exists
      // for). Mirror rows come FIRST, and each half has a bounded budget NEITHER of which the other can
      // drive to zero (`absentQueueBudget`, HIGH-3): a large backlog of never-attempted sheets cannot
      // starve rows that already have recorded retryable state, and — the converse the original design
      // missed — a saturated `failed` mirror queue cannot blind the stranded-sheet detector.
      const absent = await listApprovedSheetsWithoutMirror(serviceClient, org, absentQueueBudget(limit, mirrored.length));
      const rows = [...mirrored, ...absent];
      // 0534: while the module is held, only rows whose command ERP already accepted are recoverable.
      return recoverableOnlyIds ? rows.filter((r) => recoverableOnlyIds.has(r.timesheet_id)) : rows;
    },

    stopNewRows: () => moneyRowsStopped(org),
    markAttempted: async (orgId, rows) => {
      await stampQueueAttempt(serviceClient, 'timesheet_erp_mirror', orgId, 'timesheet_id',
        rows.filter((r) => r.push_state !== 'absent').map((r) => r.timesheet_id));
    },

    assertApprovedForPush: async (row) => {
      // FR-TSP-045 / R-SWEEP: re-assert 0138's gate under SERVICE ROLE, resolving the actor to the
      // sheet's OWN `approved_by` (the admin-connect `p_actor` precedent). The sweep never "trusts
      // itself" past the status check — this RPC is server truth for status + authorization + entries.
      const { data: sheet, error: sheetErr } = await serviceClient
        .from('timesheets')
        .select('approved_by')
        .eq('id', row.timesheet_id)
        .eq('org_id', org.orgId)   // service role bypasses RLS — scope explicitly
        .maybeSingle();
      if (sheetErr) throw new AppError(sheetErr.message, sheetErr.code);
      const approvedBy = (sheet as { approved_by?: string | null } | null)?.approved_by ?? null;
      if (!approvedBy) {
        // No recorded approver ⇒ nothing resolvable to re-authorize against, and 0138 fails closed on a
        // null actor anyway. A REFUSAL (recorded, visible), never a fabricated actor.
        return { ok: false, reason: 'timesheet-push-no-recorded-approver' };
      }
      const gate = await serviceClient.rpc('approved_timesheet_for_push', {
        p_timesheet_id: row.timesheet_id,
        p_actor: approvedBy,
      });
      if (gate.error) {
        // ⚑ 0138 raises P0001 ('timesheet-not-approved') and 42501 (cross-org, or its (a2) OFFBOARDING
        // gate on the resolved actor — a deactivated approver). Those are INTENDED refusals: recorded
        // per-row, never a wedge. Anything else is a real transport/DB failure and THROWS, so NEW-3's
        // per-row containment surfaces it as an error rather than silently marking the sheet failed.
        const code = gate.error.code;
        if (code === 'P0001' || code === '42501' || code === 'P0002') {
          return { ok: false, reason: gate.error.message };
        }
        throw new AppError(gate.error.message, code);
      }
      const gateRow = (gate.data as Array<{ approved_at?: string | null; user_id?: string | null; entries?: unknown }> | null)?.[0];
      const approvedAt = gateRow?.approved_at ?? null;
      if (!approvedAt) {
        // The key's own input. `ts:<id>:null` would be the SAME key for every future approval of this
        // sheet, so only the first would ever reach ERP — fail closed rather than key on a fiction.
        return { ok: false, reason: 'timesheet-push-no-approved-at-witness' };
      }
      // The gate's OWN server-read subject — whose week it is, which hours may be posted, and the actor
      // (`approved_by`) an outbox row minted below is attributed to. Nothing here comes from a payload.
      return {
        ok: true,
        approvedAt,
        subject: {
          approvedBy,
          userId: String(gateRow?.user_id ?? ''),
          entries: Array.isArray(gateRow?.entries) ? (gateRow.entries as unknown[]) : [],
        },
      };
    },

    recordGateRefusal: async (row, reason) => {
      // Durable + operator-visible. `failed` (not `held`): a refusal caused by an offboarded approver is
      // resolved by re-activating them or by a privileged user re-pushing, both of which SHOULD let this
      // pass pick the row up again — `held` would exclude it from this queue permanently.
      const { error } = await parkTimesheetMirrorRow(serviceClient, org.orgId, row, 'failed', reason);
      if (error) throw new AppError(error.message, error.code);
      await surfaceActionRequired(serviceClient, org.orgId, 'timesheet-push-gate-refused', { timesheetId: row.timesheet_id });
    },

    driveTimesheetPush: async (row: TimesheetMirrorCandidateRow, approvedAt: string, subject?: TimesheetPushSubject) => {
      const idempotencyKey = timesheetPushKey(row.timesheet_id, approvedAt);
      let outboxRow = await findTimesheetOutboxRow(serviceClient, org.orgId, row.timesheet_id, idempotencyKey);
      // ⚑ AC-TSP-022 — the foreground dispatch never reached the outbox for this approval (the browser
      // died before the fetch). MINT the command here, attributed to the sheet's own `approved_by`.
      //
      // This is deliberately NOT the budget twin's rule. Budget holds because a version carries no actor
      // of its own — an outbox row minted for it would be genuinely UNATTRIBUTED (FR-BUD-102's "never
      // finalize with a NULL actor"). A timesheet always has one: its approver, read SERVER-SIDE by
      // `approved_timesheet_for_push` (0138) with `p_actor => approved_by`, which re-asserts that
      // actor's authorization AND offboarding status on every single tick. So the minted row is
      // attributable and auditable — and an approver who has since been deactivated is REFUSED by that
      // gate (recorded as a failure, per-row contained), never quietly pushed.
      //
      // The key is the SAME deterministic `timesheetPushKey` the Approvals UI derives, so a race with
      // the user's own push collides on the outbox 4-tuple (23505) and reconciles to the winner instead
      // of minting a second week of hours.
      let minted = false;
      let mintRefusal: string | null = null;
      if (!outboxRow && subject?.approvedBy) {
        const mint = await mintTimesheetOutboxRow(serviceClient, org.orgId, row.timesheet_id, idempotencyKey, approvedAt, subject);
        outboxRow = mint.row;
        mintRefusal = mint.refusal;
        minted = outboxRow !== null;
      }
      if (!outboxRow) {
        // Nothing to drive and nothing mintable: the FENCE refused (the sheet was re-opened — Luna
        // BLOCK 1, and then the reason says exactly that), or the gate handed back no actor at all
        // (never attribute a money-adjacent command to nobody), or a DIFFERENT command for this record
        // is already in flight and owns the outcome (0116). `failed`, not `held`: all of those clear
        // themselves, and `held` would exclude the row from this queue permanently.
        const reason = mintRefusal ?? 'timesheet-push-no-outbox-candidate';
        const { error } = await parkTimesheetMirrorRow(serviceClient, org.orgId, row, 'failed', reason);
        if (error) throw new AppError(error.message, error.code);
        await surfaceActionRequired(
          serviceClient,
          org.orgId,
          mintRefusal ? 'timesheet-push-gate-refused' : 'timesheet-push-no-outbox-candidate',
          { timesheetId: row.timesheet_id },
        );
        return;
      }
      // ⚑ H-1 (the budget twin's audit finding, applied here by construction): re-drive ONLY through
      // `0131`'s ONE eligibility door. `findTimesheetOutboxRow` matches by key with no state/attempt/age
      // filter, so on its own it would re-POST a terminally-rejected timesheet EVERY cron tick forever.
      // `outbox_reconcile_candidates` is the single authority for "may this row be reconciled now"
      // (bounded by state + attempt_count + age); a row absent from it is committed-already,
      // attempt-exhausted, quarantined-not-due, or too old. Not a second door — the SAME door pass 1 uses.
      // A row minted a moment ago is `pending` with zero attempts — the eligibility set was read at the
      // START of this pass and cannot contain it. Re-reading the whole set per mint would be the same
      // answer at more cost; what must NOT happen is treating a brand-new command as attempt-exhausted.
      if (!minted && !eligibleOutboxIds.has(outboxRow.id)) {
        // ⚑ Luna round-3 BLOCK 2 — NOT-DUE-YET IS NOT ATTEMPTS-EXHAUSTED (the budget twin's ⚑ HIGH-1,
        // applied here). `outbox_reconcile_candidates` deliberately omits two states that are simply not
        // due: a `committing` row inside its 60 s lease and a `quarantined` row before its visibility
        // window elapses (0131). Both are ABOUT to become claimable by the stale-claim/recovery pass.
        // Parking them `held` was terminal in every direction at once: `held` is excluded from THIS
        // queue, the generic outbox pass skips timesheets, and the outbox row keeps the record's one
        // in-flight slot (0116) — so the submitted ERP Timesheet is never adopted, the mirror never
        // converges, and the re-open fence (which refuses on a non-terminal outbox row) refuses the week
        // forever. And this is the ORDINARY shape of a post-submit unknown, whose whole point is that the
        // dispatch marks NOTHING so the row stays reclaimable: the next tick, seconds later, sees a
        // `failed` mirror plus a not-yet-due `committing` row. Leave it; the attempt/age bound is
        // untouched for every state that really has run out.
        // 0357: a `failed` row waiting out its retry delay is likewise not due — never exhausted.
        if (outboxRow.state === 'committing' || outboxRow.state === 'quarantined' || retryPendingIds.has(outboxRow.id)) return;
        const { error } = await parkTimesheetMirrorRow(serviceClient, org.orgId, row, 'held', 'timesheet-push-attempts-exhausted');
        if (error) throw new AppError(error.message, error.code);
        await surfaceActionRequired(serviceClient, org.orgId, 'timesheet-push-attempts-exhausted', { timesheetId: row.timesheet_id });
        return;
      }
      // Re-authorizes against the RECORDED actor (`buildReconcileDepsLive`'s
      // `checkOutboxReplayAuthorization` + `reauthorizeRecoveryReissue`) — the SAME discipline every
      // other domain's recovery reissue enforces.
      await dispatchMoneyWrite(await buildReconcileDepsLive(serviceClient, org, outboxRow));
    },
  };
}

/** ⚑ 0131 is the ONE eligibility door. The id set a backstop pass may re-drive IS
 *  `outbox_reconcile_candidates`' own answer (`listCandidatesLive`) — never a second, hand-rolled
 *  state/attempt predicate, which is exactly the "second door" 0131 exists to prevent. This applies
 *  that single read to the timesheet domain and additionally returns the `committed`-record allow-list
 *  the held-module pass needs: while a module is switched off, only a week ERP already accepted stays
 *  drivable, because its LOCAL finalize is the one thing left outstanding (closure is never held,
 *  FR-PLN-006). The shape is deliberate and pinned: `eligibleOutboxIds` is projected from THAT call in
 *  one hop (`dispatchGateWiring.test.ts` H-1), never re-derived from a hand-rolled predicate. */
function timesheetEligibility(
  candidates: readonly OutboxRow[],
  held: boolean,
): { eligibleOutboxIds: ReadonlySet<string>; recoverable: ReadonlySet<string> | null } {
  const domainCandidates = candidates.filter((c) => c.domain === ERPNEXT_TIMESHEETS_DOMAIN);
  const recoverable = held
    ? new Set(domainCandidates.filter((c) => c.state === 'committed').map((c) => c.pmoRecordId))
    : null;
  return {
    eligibleOutboxIds: new Set(
      domainCandidates.filter((c) => recoverable === null || recoverable.has(c.pmoRecordId)).map((c) => c.id),
    ),
    recoverable,
  };
}

/** The live per-org timesheet backstop pass (P3b task 6.4, AC-TSP-022). Domain-gated (Luna BLOCK 9): an
 *  org that never assigned the `timesheets` domain to this tier has nothing to reconcile. */
export async function reconcileOrgTimesheetPushesLive(serviceClient: SupabaseClient, org: OrgBinding): Promise<{ driven: number; error?: string }> {
  if (!org.ownedDomains.includes(ERPNEXT_TIMESHEETS_DOMAIN)) return { driven: 0 };
  // 0534: a switched-off module is HELD, not driven — reported with the typed reason so ops can see
  // it, and resumed on the next tick after re-enable (nothing is dropped or abandoned).
  //
  // ⚑ CLOSURE IS NEVER HELD (FR-PLN-006): the pass still runs while held, restricted to sheets whose
  // outbox command is `committed` — ERP already accepted that week, so only its LOCAL finalize is
  // outstanding and leaving it would strand payroll-costing hours for the whole off interval.
  const held = featureDisabled(org, 'timesheets');
  try {
    // The SoT eligibility set (0131), fetched ONCE per pass — the backstop may only re-drive a row this
    // RPC still admits. Scoped to the timesheets domain; other domains' candidates are irrelevant here.
    const { eligibleOutboxIds, recoverable } = timesheetEligibility(
      await listCandidatesLive(serviceClient)(org.orgId), held,
    );
    const result = await reconcileOrgTimesheetPushes(
      timesheetBackstopDepsLive(serviceClient, org, eligibleOutboxIds,
        await listRetryPendingLive(serviceClient, org.orgId), recoverable ?? undefined),
      { orgId: org.orgId },
    );
    // NEW-3: per-row throws are contained so the queue drains, but they are NEVER silent — a row that
    // keeps throwing is a stuck payroll-costing push and must be visible in the tick's own result.
    for (const e of result.errors) {
      console.warn(`[erpnext-sweep] org ${org.orgId} timesheet ${e.timesheetId}: backstop row failed — ${e.error}`);
    }
    return {
      driven: result.driven,
      error: held
        ? `feature-off:timesheets${result.errors.length ? `; ${result.errors.length} timesheet row(s) failed` : ''}`
        : (result.errors.length ? `${result.errors.length} timesheet row(s) failed` : undefined),
    };
  } catch (err) {
    return { driven: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
