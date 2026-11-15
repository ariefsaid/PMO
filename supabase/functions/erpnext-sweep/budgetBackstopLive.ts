// The budget push's sweep backstop, live wiring (THEME-BACK-40, #1643): pass (5)'s deps for `budgetBackstop.ts`, the
// parked-unit resume and the archive-cancellation pass. Moved verbatim from index.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { surfaceActionRequired } from '../_shared/erpnextFeedDeps.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { createErpAuthPairCache, type ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { checkErpnextCommandAuthorization } from '../adapter-dispatch/authGuard.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
// P3c slice 5 (FR-BUD-141, AC-BUD-023) — the budget push's sweep backstop, pure orchestration.
import { reconcileOrgBudgetPushes, type BudgetBackstopDeps, type BudgetMirrorCandidateRow, type BudgetBackstopVersionRow } from './budgetBackstop.ts';
import { reconcileOrgBudgetArchiveCancellations, type BudgetArchiveBackstopDeps, type BudgetArchiveCancelIntent } from './budgetArchiveBackstop.ts';
// ⚑ rm-1472 — the parked-unit resume. `buildBudgetDispatchPlan` is the SAME gate wiring the
// foreground activation uses, so a resumed unit is derived, keyed and authorized exactly as the
// activation would have derived it (no second push path, no second key derivation).
import { BUDGET_ARCHIVE_CANCEL_WAIT, budgetArchiveCancelState, buildBudgetDispatchPlan, recordBudgetPushFailure } from '../adapter-dispatch/budgetDispatch.ts';
import { commandForBudgetUnit } from '../adapter-dispatch/commandUnit.ts';
import { checkCreateTargetUnmapped } from '../adapter-dispatch/transitionTargetGuard.ts';
import { resolveErpBindingRow } from '../adapter-dispatch/dispatchAdapters.ts';
import { budgetPushKey } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetPushKey.ts';
import { encodeFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';
import { budgetAccountArchiveKey, budgetAccountIdentity, budgetAccountPushKey, budgetLegacyArchiveKey, budgetLegacyIdentity, budgetRangeIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { ERPNEXT_BUDGET_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { type OrgBinding, listRetryPendingLive, listCandidatesLive, stampQueueAttempt, byQueueFairness } from './sweepShared.ts';
import { bareBudgetVersionId, fiscalYearOfIdentity, toFiscalYearOfIdentity, accountOfIdentity, budgetDedupKey, findBudgetOutboxRow, readBudgetArchiveLifecycleLive, budgetArchiveTargetStillLiveAndOwnedLive } from './budgetOutboxFacts.ts';
import { buildReconcileDepsLive, dispatchMoneyWrite, buildMoneyWriteDepsLive } from './moneyWriteLive.ts';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// (5) P3c — the budget push's sweep backstop, live wiring (FR-BUD-141, AC-BUD-023, budgetBackstop.ts).
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚑ NEW-4 (audit round 4, 2026-07-22) — park a budget mirror row at `held` as a COMPARE-AND-SET.
 *
 * The row's eligibility was established by `listPendingBudgetPushes` earlier in the SAME tick
 * (`push_state in ('pending','failed')`, not tombstoned), and the FOREGROUND dispatch path runs
 * concurrently on the very same row. Both `held` writes used to be keyed on `(org_id,
 * budget_version_id)` alone, so between the list and the write an operator's Retry could move the row
 * to `committing` — or all the way to `pushed` against a real ERPNext Budget — and the blind update
 * relabelled that live success as `held`. The money screen then reported "ERPNext is still enforcing
 * the previous budget" over a budget ERPNext IS enforcing, and because `held` is excluded from this
 * very work queue, nothing ever re-drove it. A read-then-blind-write across a concurrent writer is a
 * lost update, not a state machine.
 *
 * So the update REPEATS the listing's own predicate: it matches only a row still in the state that
 * justified holding it. A row that has moved on is simply not matched, and the tick moves on with it.
 */
function holdBudgetMirrorRow(
  serviceClient: SupabaseClient,
  orgId: string,
  row: BudgetMirrorCandidateRow,
  reason: string,
): PromiseLike<{ error: { message: string; code?: string } | null }> {
  const { budget_version_id: budgetVersionId, push_state: pushState, fiscal_year: fiscalYear, to_fiscal_year: toFiscalYear } = row;
  const account = typeof row.erp_account === 'string' && row.erp_account !== '' ? row.erp_account : null;
  const mirrorName = account ? 'budget_version_account_erp_mirror' : 'budget_version_erp_mirror';
  // ⚑ MEDIUM-2: an `absent` candidate (an outbox-only orphan — a dispatch that died between the ERP
  // commit and the mirror write) has NO row to compare-and-set against, so an update-only hold wrote
  // zero rows and the refusal was invisible: exactly the stranded-and-unseen outcome this pass exists to
  // end. Its durable state must be CREATED. A 23505 means the foreground (or another tick) created the
  // row first — theirs is the newer truth, leave it exactly as it is. (The `timesheet_erp_mirror` twin,
  // `parkTimesheetMirrorRow`, takes the same shape for the same reason.)
  if (pushState === BUDGET_MIRROR_ABSENT) {
    return (async () => {
      // ⚑ LOW-1 (audit round 6) — `fiscal_year` is `text NOT NULL` with no default (0137 §1) and
      // `stamp_org_id` stamps only `org_id`, so the insert that omitted it raised 23502 — which the
      // 23505 guard does NOT absorb, so this recovery branch threw instead of recording the durable
      // `held` state it exists to write. Dead on arrival.
      //
      // ⚑ And the missing year may NOT be derived to make the insert go through. Since HIGH-1,
      // `budget_version_erp_mirror.fiscal_year` is the authority `get_budget_projection` scopes PMO's
      // budget column by, so a guessed year here would put a wrong-year Budget/Variance/Utilization on
      // the primary money screen — the exact defect HIGH-1 removed, re-entered through a recovery path.
      // With no year on record there is no grain to hold, so nothing is written; the caller's
      // `surfaceActionRequired` is what tells a human, and it runs either way.
      if (!fiscalYear) return { error: null };
      const { error } = await serviceClient
        .from(mirrorName)
        .insert({
          org_id: orgId,
          budget_version_id: budgetVersionId,
          fiscal_year: fiscalYear,
          ...(account ? { to_fiscal_year: toFiscalYear ?? null, erp_account: account, budget_intent: row.budget_intent ?? 'ensure' } : {}),
          push_state: 'held',
          push_error: reason,
        });
      return { error: error && error.code !== '23505' ? error : null };
    })();
  }
  // ⚑ BLOCK 1 (FU-2 round 2) — A HOLD IS ABOUT ONE YEAR, and the mirror's grain is
  // `(budget_version_id × fiscal_year)`. Keyed on the version alone this CAS matched every
  // `pending`/`failed` row of the version, so exhausting FY2027's attempts also stamped FY2026 `held`
  // with FY2027's reason — and `listPendingBudgetPushes` excludes `held`, so a perfectly recoverable
  // year left the backstop queue PERMANENTLY (ERPNext then holds no overspend control for it and
  // nothing will ever install one, while `hold_releasable` is false because its own outbox row is not
  // `held`). With no year on record there is no grain to hold, so nothing is written at all — the same
  // posture the `absent`/INSERT branch above already takes, and for the same reason: a guessed year
  // writes a wrong-year state onto the primary money screen.
  if (!fiscalYear) return Promise.resolve({ error: null });
  let hold = serviceClient
    .from(mirrorName)
    .update({ push_state: 'held', push_error: reason })
    .eq('org_id', orgId)
    .eq('budget_version_id', budgetVersionId)
    .eq('fiscal_year', fiscalYear);
  if (account) {
    hold = hold.eq('erp_account', account) as typeof hold;
    hold = toFiscalYear == null ? hold.is('to_fiscal_year', null) as typeof hold : hold.eq('to_fiscal_year', toFiscalYear) as typeof hold;
  }
  return hold
    // the SAME eligibility `listPendingBudgetPushes` asserted — never a state this pass did not observe
    .in('push_state', ['pending', 'failed'])
    .is('erp_cancelled_at', null);
}

/** The synthetic candidate state for a budget push whose OUTBOX row exists but whose mirror row does
 *  not — the crash-between-the-ERP-write-and-the-finalize window (⚑ MEDIUM-2). */
const BUDGET_MIRROR_ABSENT = 'absent';

/** ⚑ rm-1472 — the named reason a unit is parked when an archive cancellation needs a PERSON (the
 *  intent is `held`, or no recorded actor is left to attribute the replacement push to). It is
 *  distinct from the generic `budget-push-no-outbox-candidate` so the screen says "a person must
 *  resolve the predecessor's cancellation", not "this push lost its command". */
export const BUDGET_ARCHIVE_CANCEL_HELD = 'budget-archive-cancellation-held';

/** ⚑ M-2 (review r8) — the named reason a parked unit is HELD because the recorded activator is no
 *  longer allowed to push a budget. Distinct from `BUDGET_ARCHIVE_CANCEL_HELD`: the cancellation itself
 *  is settled and fine, so telling an operator "the cancellation needs a person" would send them to the
 *  wrong place. */
export const BUDGET_ARCHIVE_RESUME_ACTOR_UNAUTHORIZED = 'budget-archive-resume-actor-unauthorized';

/** What the resume driver did with one version's parked units this tick. */
export type BudgetArchiveWaitResumeOutcome = 'driven' | 'waiting' | 'held';

/** ⚑ rm-1472 — the named reason a parked unit is RETIRED: the re-derived plan no longer contains that
 *  account, because the archive cancellation tombstoned the document it named. Nothing will ever push
 *  it, so it must stop looking queued (and must not re-run the gate on every tick). */
export const BUDGET_ARCHIVE_CANCEL_SUPERSEDED = 'budget-archive-cancellation-superseded';

/** Hold every unit of one version that is still parked on the archive-cancellation wait. Scoped by
 *  org + version and fenced on the wait marker itself, so a unit the foreground just pushed (or that
 *  a person already resolved) can never be relabelled by this pass. */
async function holdWaitingBudgetUnits(
  serviceClient: SupabaseClient,
  orgId: string,
  versionId: string,
  reason: string,
): Promise<void> {
  const { error } = await serviceClient.from('budget_version_account_erp_mirror')
    .update({ push_state: 'held', push_error: reason })
    .eq('org_id', orgId)
    .eq('budget_version_id', versionId)
    .eq('push_error', BUDGET_ARCHIVE_CANCEL_WAIT)
    .is('erp_cancelled_at', null)
    .in('push_state', ['pending', 'failed']);
  if (error) throw new AppError(error.message, error.code);
}

/** Park a version's waiting units because a PERSON must act (a held cancellation, no recorded activator
 *  to attribute the replacement push to, or an activator who may no longer push) — and say so once on
 *  the operator surface, under the reason the units are parked with. */
async function parkWaitingBudgetUnitsForPerson(
  serviceClient: SupabaseClient,
  orgId: string,
  versionId: string,
  projectId: string,
  reason: string = BUDGET_ARCHIVE_CANCEL_HELD,
): Promise<void> {
  await holdWaitingBudgetUnits(serviceClient, orgId, versionId, reason);
  await surfaceActionRequired(serviceClient, orgId, reason, { versionId, projectId });
}

/** Retire every parked unit the re-derived plan no longer contains: the account left the plan because
 *  the archive cancellation tombstoned the very document that unit named, so nothing will ever push
 *  it. Leaving it on the wait marker made the screen say "queued" forever AND re-ran the gate for it on
 *  every tick. Retired with a reason, never silently, and never as a push that happened. */
async function retirePlanAbsentWaitingUnits(
  serviceClient: SupabaseClient,
  orgId: string,
  versionId: string,
  units: ReadonlyArray<{ identity: string }>,
): Promise<void> {
  const planned = new Set(units.map((unit) => unit.identity));
  const { data, error } = await serviceClient.from('budget_version_account_erp_mirror')
    .select('id,fiscal_year,to_fiscal_year,erp_account')
    .eq('org_id', orgId)
    .eq('budget_version_id', versionId)
    .eq('push_error', BUDGET_ARCHIVE_CANCEL_WAIT)
    .is('erp_cancelled_at', null)
    .in('push_state', ['pending', 'failed']);
  if (error) throw new AppError(error.message, error.code);
  for (const row of (data ?? []) as Array<{ id?: string; fiscal_year?: string; to_fiscal_year?: string | null; erp_account?: string | null }>) {
    if (typeof row.id !== 'string' || typeof row.fiscal_year !== 'string') continue;
    let identity: string;
    try {
      identity = row.to_fiscal_year
        ? budgetRangeIdentity(versionId, row.fiscal_year, row.to_fiscal_year, row.erp_account ?? '')
        : budgetAccountIdentity(versionId, row.fiscal_year, row.erp_account ?? '');
    } catch {
      continue;
    }
    if (planned.has(identity)) continue;
    const { error: holdError } = await serviceClient.from('budget_version_account_erp_mirror')
      .update({ push_state: 'held', push_error: BUDGET_ARCHIVE_CANCEL_SUPERSEDED })
      .eq('org_id', orgId)
      .eq('id', row.id)
      .eq('push_error', BUDGET_ARCHIVE_CANCEL_WAIT)
      .in('push_state', ['pending', 'failed']);
    if (holdError) throw new AppError(holdError.message, holdError.code);
  }
}

/** The person who ACTIVATED this version — read from the archive request the activation itself queued.
 *
 *  ⚑ I-1 (review r8) — the activation actor is RECORDED, once, and it is the only honest attribution a
 *  resumed mint can carry. `queue_budget_archive_cancel` (0579) inserts its `budget_archive_requests`
 *  row with `queued_by_activation=true` and `requested_by=auth.uid()` in the SAME transaction that
 *  stamps the successor's `activated_at=now()`, and inside one transaction `now()` is the transaction
 *  timestamp — so `created_at = <this version's activated_at>` names exactly that activation's own
 *  request.
 *
 *  The shipped behaviour read the ACTOR off the latest settled `budget_archive_cancel_intents` row on
 *  the PROJECT instead. That fence is project-wide, so a manual archive (or a later activation of a
 *  different version) superseded this version's row and the replacement Budget was minted as whoever
 *  last touched the project's cancellation queue — someone who may be the version's own drafter (the
 *  SoD breach 0579/FR-BUD-102 forbid) or may since have been deactivated.
 *
 *  Zero matches ⇒ this activation queued no cancellation of its own, so NO activator is recorded: hold
 *  for a person, never guess. More than one ⇒ ambiguous, hold for a person as well.
 */
async function budgetActivationActor(
  serviceClient: SupabaseClient,
  orgId: string,
  projectId: string,
  activatedAt: string,
): Promise<string | null> {
  const { data, error } = await serviceClient.from('budget_archive_requests')
    .select('id,requested_by')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .eq('queued_by_activation', true)
    .eq('created_at', activatedAt)
    .limit(2);
  if (error) throw new AppError(error.message, error.code);
  const rows = (data ?? []) as Array<{ requested_by?: unknown }>;
  if (rows.length !== 1) return null;
  const actor = rows[0]?.requested_by;
  return typeof actor === 'string' && actor !== '' ? actor : null;
}

/**
 * ⚑ rm-1472 — RESUME a version whose units were parked by the budget gate's `202
 * budget-cancellation-pending`.
 *
 * The defect this removes: the gate parks v16 range units as `pending` with
 * `push_error='waiting-for-budget-archive-cancellation'` and writes NO outbox row (the fan-out never
 * begins). Nothing re-ran the gate when the cancellations settled, so ERPNext kept enforcing nothing
 * while PMO said "Version activated" — and the backstop, which only looks for an EXISTING outbox row,
 * parked the units `held` and ended automatic recovery for good.
 *
 * The release is the SAME gate, run again from CURRENT truth (`buildBudgetDispatchPlan`): it re-reads
 * the plan, re-derives each unit's year-qualified identity and server key from `activated_at`, and
 * re-plans against the now-tombstoned predecessor history — so a resumed unit is byte-identical to
 * what the activation would have produced had the cancellation already settled. Each unit then goes
 * through the ordinary `dispatchMoneyWrite`/outbox path (SoD re-authorization, claim fencing,
 * one-in-flight, one-document-per-record), never a second push path.
 *
 * Fail-closed and quiet where that is right:
 *  - fence `pending` → the units stay parked on the wait (a later tick retries);
 *  - fence `held`, no RECORDED activator, or an activator who may no longer push → the units are HELD
 *    with a named reason + one action-required notice (waiting longer would release nothing);
 *  - the gate refusing → its own durable failure row is written by the gate itself, and the units stay
 *    parked so the pass resumes by itself once a person fixes the cause (the FR-BFY-075 posture).
 */
export function budgetArchiveWaitResumeLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  cache?: ErpAuthPairCache,
): (versionId: string, projectId: string | null, activatedAt: string | null) => Promise<BudgetArchiveWaitResumeOutcome> {
  // One gate run per version per tick: several parked units of one version must not each re-run it.
  const perVersion = new Map<string, Promise<BudgetArchiveWaitResumeOutcome>>();
  return (versionId, projectId, activatedAt) => {
    const running = perVersion.get(versionId);
    if (running) return running;
    const started = resumeWaitingBudgetVersion(serviceClient, org, versionId, projectId, activatedAt, cache);
    perVersion.set(versionId, started);
    return started;
  };
}

async function resumeWaitingBudgetVersion(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  versionId: string,
  projectId: string | null,
  activatedAt: string | null,
  cache?: ErpAuthPairCache,
): Promise<BudgetArchiveWaitResumeOutcome> {
  // The fence is project-scoped (that is the grain the gate reasons on) and the attribution is keyed on
  // the activation stamp. Without either there is nothing to prove, so never release: leave the units
  // parked for a later tick (the backstop never calls this without an Active, stamped version).
  if (!projectId || !activatedAt) return 'waiting';
  const state = await budgetArchiveCancelState(serviceClient, org.orgId, projectId);
  if (state === 'pending') return 'waiting';
  if (state === 'held') {
    await parkWaitingBudgetUnitsForPerson(serviceClient, org.orgId, versionId, projectId);
    return 'held';
  }
  // ⚑ I-1 — the ACTIVATOR of this version, never the latest archive intent on the project.
  const actorUserId = await budgetActivationActor(serviceClient, org.orgId, projectId, activatedAt);
  if (!actorUserId) {
    // No activation-queued request names this version's activation (or more than one does): nobody is
    // recorded as having activated it, so there is no honest attribution. Never guess — hold.
    await parkWaitingBudgetUnitsForPerson(serviceClient, org.orgId, versionId, projectId);
    return 'held';
  }
  // Re-authorize the recorded activator NOW (never trust that they were allowed when the activation was
  // requested) — the same rule the synchronous dispatch and the outbox replay apply.
  const authorization = await checkErpnextCommandAuthorization(serviceClient as never, org.orgId, actorUserId, {
    domain: ERPNEXT_BUDGET_DOMAIN,
    record: { erp_doc_kind: 'budget' },
  });
  if (!authorization.ok) {
    // ⚑ M-2 — its own reason: the cancellation settled fine, the PERSON cannot push any more.
    await parkWaitingBudgetUnitsForPerson(serviceClient, org.orgId, versionId, projectId, BUDGET_ARCHIVE_RESUME_ACTOR_UNAUTHORIZED);
    return 'held';
  }

  // The SAME gate the activation ran. Its own reads are org-checked (the gate refuses a version or a
  // project outside `deps.orgId`) and every per-version read is keyed on the version the parked row
  // names, so a service-role client here cannot widen anything.
  const command: AdapterCommand = {
    domain: ERPNEXT_BUDGET_DOMAIN,
    operation: 'create',
    // `commandForBudgetUnit` replaces this with the unit's own server-derived key; it never reaches
    // the outbox (the fan-out mints one per unit, exactly as `dispatchBudgetPush` does).
    idempotencyKey: '',
    record: { id: versionId, erp_doc_kind: 'budget' },
  };
  const plan = await buildBudgetDispatchPlan({
    command,
    // The sweep carries no user JWT; the gate's org assertions are the tenancy boundary here.
    callerClient: serviceClient,
    serviceClient,
    orgId: org.orgId,
    erpAuth: cache ?? createErpAuthPairCache(),
    headers: new Headers(),
    resolveBinding: resolveErpBindingRow,
  });
  // A Response means the gate refused (its 422 writes its own durable failure row) or a cancellation
  // became unsettled again (202). Either way nothing is pushed and the units stay parked: the pass
  // resumes by itself once the cause is fixed. NEVER silent — a resume that keeps refusing is a stuck
  // money push and must be visible in the tick's own logs.
  if (plan instanceof Response) {
    console.warn(`[erpnext-sweep] org ${org.orgId} budget ${versionId}: archive-cancellation resume not released (HTTP ${plan.status}) ${await plan.clone().text()}`);
    return 'waiting';
  }

  // ⚑ M-1 (review r8) — THE ONE REMAINING WINDOW, deliberately fail-closed. The gate above cleared
  // this version's wait marker on its settled path (budgetDispatch.ts: `push_error: null` for every
  // planned unit) BEFORE any unit below reaches `dispatchMoneyWrite`. A crash in between leaves a unit
  // `pending`, `push_error` NULL and no outbox row, so the next tick's backstop no longer recognizes it
  // as parked and holds it `budget-push-no-outbox-candidate` — which re-runs every gate and mints under
  // the retrying person's own authority. Recovery for that window is therefore the HELD path (a person),
  // never a second automatic release; it can never double-mint, because a unit with no outbox row has no
  // ERP document either. Narrowing it further would mean clearing the marker per unit after its outbox
  // row exists, which the gate (shared with the synchronous activation path) does not do.
  for (const unit of plan.units ?? []) {
    const unitCommand = commandForBudgetUnit(command, unit);
    try {
      // BLOCK #4, per unit, on the year-qualified identity — the same pre-outbox guard the served
      // fan-out runs, so a resume can never mint a second ERP document for an already-mapped unit.
      const createTarget = await checkCreateTargetUnmapped(serviceClient as never, org.orgId, unitCommand, unit.idempotencyKey);
      if (!createTarget.ok) {
        await recordBudgetPushFailure({
          serviceClient, orgId: org.orgId, command: unitCommand,
          budgetVersionMajor: plan.versionMajor, failure: new AppError(createTarget.message, 'commit-rejected'),
        });
        continue;
      }
      await dispatchMoneyWrite(await buildMoneyWriteDepsLive(serviceClient, org, {
        command: unitCommand,
        actorUserId,
        outboxRecordId: unit.identity,
        persistPayload: true,
      }, cache));
    } catch (err) {
      // PER-UNIT containment (the served fan-out's rule): one account's refusal must not abandon the
      // rest of the fan-out, and it is recorded durably rather than swallowed.
      const failure = err instanceof AppError ? err : new AppError(err instanceof Error ? err.message : String(err), 'commit-rejected');
      try {
        await recordBudgetPushFailure({
          serviceClient, orgId: org.orgId, command: unitCommand,
          budgetVersionMajor: plan.versionMajor, failure,
        });
      } catch { /* the durable write must never mask the original failure */ }
      console.warn(`[erpnext-sweep] org ${org.orgId} budget ${versionId} resume unit ${unit.identity}: ${failure.message}`);
    }
  }
  await retirePlanAbsentWaitingUnits(serviceClient, org.orgId, versionId, plan.units ?? []);
  return 'driven';
}

/** The live `BudgetBackstopDeps` for one org — the mirror's own work queue (FR-BUD-123, index-served
 *  on `(org_id, push_state)`), the re-asserted version gate (FR-BUD-102), and driving a found
 *  candidate through the EXACT SAME `dispatchMoneyWrite`/`buildReconcileDepsLive` machinery the
 *  outbox-recovery pass (1) already uses — one algorithm, shared. */
export function budgetBackstopDepsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  /** ⚑ MEDIUM-2: the budget-domain rows `outbox_reconcile_candidates` (0131) STILL ADMITS — the id set
   *  the attempts-exhausted gate already used, plus each row's `pmo_record_id` so the queue can also
   *  find an outbox-only ORPHAN (a dispatch that died between the ERP commit and the mirror write). */
  eligibleBudgetCandidates: ReadonlyArray<{ id: string; pmo_record_id: string; fiscal_year?: string | null; to_fiscal_year?: string | null; budget_intent?: 'ensure' | 'remove' | null }>,
  /** 0357: `failed` rows waiting out their retry delay (`outbox_retry_pending`) — not due, not exhausted. */
  retryPendingIds: ReadonlySet<string> = new Set(),
  /** ⚑ rm-1472 — the parked-unit resume. A row whose own `push_error` says it is waiting on an
   *  archive cancellation is NOT an outbox orphan: the fan-out never began, so there is nothing for
   *  this queue to find. The resume runs the gate again (once per version per tick) and releases the
   *  units through it, attributed to the version's ACTIVATION actor (read from the request that
   *  activation queued — I-1). Absent ⇒ such a row is left exactly as it is, never relabelled `held`. */
  resumeArchiveWait?: (versionId: string, projectId: string | null, activatedAt: string | null) => Promise<BudgetArchiveWaitResumeOutcome>,
): BudgetBackstopDeps {
  const eligibleOutboxIds = new Set(eligibleBudgetCandidates.map((c) => c.id));
  return {
    listPendingBudgetPushes: async (orgId, limit) => {
      const [legacyResult, accountResult] = await Promise.all([
        serviceClient.from('budget_version_erp_mirror')
          .select('id,budget_version_id,push_state,erp_cancelled_at,fiscal_year,created_at,last_attempt_at,push_error')
          .eq('org_id', orgId).in('push_state', ['pending', 'failed']).is('erp_cancelled_at', null)
          .order('last_attempt_at', { ascending: true, nullsFirst: true }).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit),
        serviceClient.from('budget_version_account_erp_mirror')
          .select('id,budget_version_id,push_state,erp_cancelled_at,fiscal_year,to_fiscal_year,erp_account,budget_intent,created_at,last_attempt_at,push_error')
          .eq('org_id', orgId).in('push_state', ['pending', 'failed']).is('erp_cancelled_at', null)
          .order('last_attempt_at', { ascending: true, nullsFirst: true }).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit),
      ]);
      if (legacyResult.error) throw new AppError(legacyResult.error.message, legacyResult.error.code);
      if (accountResult.error) throw new AppError(accountResult.error.message, accountResult.error.code);
      const toCandidate = (r: Record<string, unknown>, accountGrained: boolean): BudgetMirrorCandidateRow => ({
        id: typeof r.id === 'string' ? r.id : null,
        budget_version_id: String(r.budget_version_id),
        push_state: String(r.push_state),
        erp_cancelled_at: (r.erp_cancelled_at as string | null) ?? null,
        fiscal_year: (r.fiscal_year as string | null) ?? null,
        to_fiscal_year: accountGrained ? (r.to_fiscal_year as string | null) ?? null : null,
        ...(accountGrained ? {
          erp_account: (r.erp_account as string | null) ?? null,
          budget_intent: (r.budget_intent as 'ensure' | 'remove' | null) ?? null,
        } : { erp_account: null, budget_intent: 'ensure' as const }),
        push_error: (r.push_error as string | null) ?? null,
        created_at: (r.created_at as string | null) ?? null,
        last_attempt_at: (r.last_attempt_at as string | null) ?? null,
      });
      const mirrored = [
        // #1364: the empty-year row is a refusal record for the screen (project dates), not a push to drive.
        ...((legacyResult.data as Array<Record<string, unknown>> | null) ?? [])
          .filter((r) => r.fiscal_year !== '')
          .map((r) => toCandidate(r, false)),
        ...((accountResult.data as Array<Record<string, unknown>> | null) ?? [])
          .filter((r) => typeof r.erp_account === 'string' && r.erp_account !== '')
          .map((r) => toCandidate(r, true)),
      ].sort(byQueueFairness)
        .slice(0, limit);
      // ⚑ MEDIUM-2 — …plus the OUTBOX-ONLY orphans. Nothing writes a `budget_version_erp_mirror` row
      // before the dispatch (every mirror writer lives inside `adapter-dispatch`'s finalize), so a
      // dispatch that died after `adapter.commit` and before `finalize_outbox` left an outbox row
      // `committing`/`quarantined` with NO mirror row and NO `external_refs` row — invisible to pass 1
      // (which skips this domain by design) AND to this queue, while ERPNext held a live, submitted
      // Budget that `get_budget_projection` reported as 'never-pushed' (and, with the FR-BUD-121 upsert,
      // while the PREVIOUS budget was already a tombstone). This is not a second eligibility door: the
      // set IS `outbox_reconcile_candidates`, and `reconcileOrgBudgetPushes` still re-reads the version
      // and refuses anything that is no longer `Active` (FR-BUD-102). A version that already HAS a mirror
      // row is never double-queued — the mirror row carries the recorded failure history and wins.
      // ⚑ BLOCKER 3 (FU-2): dedup by (budget_version_id, fiscal_year), NEVER by version alone. Once the
      // identity is year-qualified the fiscal year travels with it: a crashed FY2027 push must still be
      // reconciled even when FY2026 already has a mirror row for the SAME version. A version-only `known`
      // set silently discarded that orphan (its version had *a* mirror), stranding a live ERP Budget PMO
      // reports as never-pushed. A pre-fan-out bare orphan (no year on record) keeps version-level
      // suppression — pre-fan-out there is exactly one year per version, so the two agree.
      const knownComposite = new Set(mirrored.map((r) => budgetDedupKey(r.budget_version_id, r.fiscal_year, r.erp_account, r.to_fiscal_year)));
      const knownVersions = new Set(mirrored.map((r) => r.budget_version_id));
      const orphans = eligibleBudgetCandidates
        // ⚑ FR-BFY-032: an outbox row's `pmo_record_id` is now the YEAR-QUALIFIED identity, so the
        // bare `budget_version_id` (the mirror's FK, and this queue's own key) is PARSED out of it, and
        // the fiscal year is READ from it (falling back to the outbox canonical for a pre-fan-out row).
        .map((c) => ({
          ...c,
          versionId: bareBudgetVersionId(c.pmo_record_id),
          year: fiscalYearOfIdentity(c.pmo_record_id) ?? c.fiscal_year ?? null,
          toYear: toFiscalYearOfIdentity(c.pmo_record_id) ?? c.to_fiscal_year ?? null,
          account: accountOfIdentity(c.pmo_record_id),
        }))
        // Suppress only an exact version/year/account mirror. Bare legacy rows keep version suppression.
        .filter((c) => c.account !== null
          ? !knownComposite.has(budgetDedupKey(c.versionId, c.year, c.account, c.toYear))
          : c.year ? !knownComposite.has(budgetDedupKey(c.versionId, c.year, null, c.toYear)) : !knownVersions.has(c.versionId))
        .map((c) => ({
          id: c.id,
          budget_version_id: c.versionId,
          push_state: BUDGET_MIRROR_ABSENT,
          erp_cancelled_at: null,
          fiscal_year: c.year,
          to_fiscal_year: c.toYear,
          erp_account: c.account,
          budget_intent: c.budget_intent ?? 'ensure',
          created_at: null,
        }));
      return [...mirrored, ...orphans]
        .sort(byQueueFairness)
        .slice(0, limit);
    },
    markAttempted: async (orgId, rows) => {
      // Only rows with a mirror row of their own can be stamped; an `absent` orphan is an outbox row.
      const real = rows.filter((r) => r.push_state !== BUDGET_MIRROR_ABSENT && typeof r.id === 'string');
      await stampQueueAttempt(serviceClient, 'budget_version_erp_mirror', orgId, 'id', real.filter((r) => !r.erp_account).map((r) => String(r.id)));
      await stampQueueAttempt(serviceClient, 'budget_version_account_erp_mirror', orgId, 'id', real.filter((r) => !!r.erp_account).map((r) => String(r.id)));
    },
    readBudgetVersion: async (versionId) => {
      // FR-BUD-102: re-read under SERVICE ROLE (the sweep carries no user JWT) — scoped to this org
      // explicitly, since service role bypasses RLS. Never trust the mirror row's own push_state.
      const { data, error } = await serviceClient
        .from('budget_versions')
        .select('id, status, activated_at, project_id')
        .eq('id', versionId)
        .eq('org_id', org.orgId)
        .maybeSingle();
      if (error) throw new AppError(error.message, error.code);
      return (data as BudgetBackstopVersionRow | null) ?? null;
    },
    driveBudgetPush: async (row: BudgetMirrorCandidateRow, version: BudgetBackstopVersionRow) => {
      // ⚑ FR-BFY-031/032 — the backstop must derive the SAME per-year identity + key the foreground
      // dispatch derived, or it finds no outbox row at all and parks a perfectly recoverable push as
      // `budget-push-no-outbox-candidate`. A candidate with no fiscal year on record is a PRE-fan-out
      // row (its outbox row was written under the bare id and the single-year key) — never a guess: the
      // legacy shape is used verbatim for it.
      const encodedFiscalYear = row.fiscal_year ? encodeFiscalYear(row.fiscal_year) : null;
      const identity = row.erp_account
        ? row.to_fiscal_year
          ? budgetRangeIdentity(row.budget_version_id, String(row.fiscal_year ?? ''), row.to_fiscal_year, row.erp_account)
          : budgetAccountIdentity(row.budget_version_id, String(row.fiscal_year ?? ''), row.erp_account)
        : encodedFiscalYear ? `${row.budget_version_id}:${encodedFiscalYear}` : row.budget_version_id;
      const idempotencyKey = row.erp_account
        ? budgetAccountPushKey(identity, version.activated_at)
        : encodedFiscalYear
          ? budgetPushKey(row.budget_version_id, encodedFiscalYear, version.activated_at)
          : budgetPushKey(row.budget_version_id, version.activated_at);
      const outboxRow = await findBudgetOutboxRow(serviceClient, org.orgId, identity, idempotencyKey);
      if (!outboxRow) {
        // ⚑ rm-1472 — A PARKED UNIT IS NOT AN ORPHAN. When the gate parked this unit behind an
        // unsettled predecessor cancellation, the fan-out never began, so "no outbox row" is the
        // EXPECTED state, not the crash-between-commit-and-finalize window the hold below is for.
        // Relabelling it `held` (the shipped behaviour) ended automatic recovery for good: ERPNext had
        // cancelled the old Budgets, the new one was never sent, and PMO still said "Version active".
        // Release is the SAME gate, re-run by the resume driver; while the fence still says pending the
        // row stays parked on its own reason and the next tick tries again.
        if (row.push_error === BUDGET_ARCHIVE_CANCEL_WAIT) {
          if (resumeArchiveWait) await resumeArchiveWait(row.budget_version_id, version.project_id ?? null, version.activated_at ?? null);
          return;
        }
        // FR-BUD-102 ("never finalize with a NULL actor"): the foreground dispatch never even reached
        // the outbox for this activation (e.g. the browser tab died mid-request before the fetch) — so
        // there is no RECORDED actor to reconcile against. Never mint a fresh, unattributed outbox row
        // here; hold for an operator instead (never silently dropped — FR-BUD-123).
        const { error } = await holdBudgetMirrorRow(serviceClient, org.orgId, row, 'budget-push-no-outbox-candidate');
        if (error) throw new AppError(error.message, error.code);
        await surfaceActionRequired(serviceClient, org.orgId, 'budget-push-no-outbox-candidate', { versionId: row.budget_version_id });
        return;
      }
      // ⚑ H-1 (audit r3): re-drive ONLY through `0131`'s ONE eligibility door. `findBudgetOutboxRow`
      // matches by key with no state/attempt/age filter, so on its own it would re-POST a
      // terminally-rejected budget EVERY cron tick forever — and re-create the ERP Budget the moment an
      // operator removes the blocker. `outbox_reconcile_candidates` is the single authority for "may this
      // row be reconciled now" (bounded by state + attempt_count + age, 0131); a row absent from it is
      // committed-already, attempt-exhausted, quarantined-not-due, or too old. Not a second door — the
      // SAME door the outbox-recovery pass uses. An absent-but-existing row is held for the operator, not
      // silently re-sent (FR-BUD-123: never dropped, never auto-looped past its budget).
      if (!eligibleOutboxIds.has(outboxRow.id)) {
        // ⚑ HIGH-1 (audit round 5, found by the AC-BUD-032 e2e) — NOT-DUE-YET IS NOT ATTEMPTS-EXHAUSTED.
        // `outbox_reconcile_candidates` answers "may this row be reconciled NOW", and it deliberately
        // omits two states that are simply not due: a `committing` row inside its 60 s lease and a
        // `quarantined` row before its visibility window elapses (0131). Both are ABOUT to become
        // claimable. Parking them `held` — a state this queue excludes — ended the automatic recovery
        // for good, and it is the ordinary shape of a transient ERP failure on the budget push (the
        // dispatch marks NOTHING so the row stays reclaimable, and the next cron tick, seconds later,
        // saw a `failed` mirror plus a not-yet-due outbox row). Leave them for a later tick; the
        // attempt/age bound itself is untouched for every state that really has run out.
        // 0357: a `failed` row waiting out its retry delay is likewise not due — never exhausted.
        if (outboxRow.state === 'committing' || outboxRow.state === 'quarantined' || retryPendingIds.has(outboxRow.id)) return;
        const { error } = await holdBudgetMirrorRow(serviceClient, org.orgId, row, 'budget-push-attempts-exhausted');
        if (error) throw new AppError(error.message, error.code);
        await surfaceActionRequired(serviceClient, org.orgId, 'budget-push-attempts-exhausted', { versionId: row.budget_version_id });
        return;
      }
      // Re-authorizes against the RECORDED actor (`buildReconcileDepsLive`'s `checkOutboxReplayAuthorization`
      // + `reauthorizeRecoveryReissue`) — the SAME discipline every other domain's recovery reissue
      // already enforces; a null-actor row is refused THERE, never silently reissued.
      await dispatchMoneyWrite(await buildReconcileDepsLive(serviceClient, org, outboxRow));
    },
  };
}

/** The live per-org budget backstop pass (P3c slice 5, AC-BUD-023). Gated on the ACTIVE ERPNext BINDING,
 *  not a `domain_externally_owned('budget')` row: budget is Posture B (FR-BUD-006(a)/FR-BUD-010 — it NEVER
 *  gets an ownership row; employment IS the binding). ⚑ FIX 2026-07-24: this gate previously read
 *  `ownedDomains.includes('budget')`, which is now ALWAYS false once the forbidden ownership row is gone —
 *  so the backstop stopped running and a stale `committing` budget row was never quarantined (AC-BUD-032
 *  regression). Gate on `activatedAt` (the same signal `orgEmploysErpnext` uses); the empty-candidate
 *  filter below still makes this a no-op for an org with no budget outbox rows. */
export async function reconcileOrgBudgetPushesLive(serviceClient: SupabaseClient, org: OrgBinding, cache?: ErpAuthPairCache): Promise<{ driven: number; error?: string }> {
  if (!org.activatedAt) return { driven: 0 };
  try {
    // The SoT eligibility set (0131), fetched ONCE per pass — the backstop may only re-drive a row this
    // RPC still admits. Scoped to the budget domain; any other domain's candidates are irrelevant here.
    const eligibleBudgetCandidates = (await listCandidatesLive(serviceClient)(org.orgId))
      .filter((c) => c.domain === ERPNEXT_BUDGET_DOMAIN)
      // LOW-1: the canonical the dispatch recorded is the ONLY in-DB statement of an outbox-only
      // orphan's fiscal year. It is carried, never derived (a derived year would mis-scope the budget
      // projection — HIGH-1).
      .map((c) => ({
        id: c.id,
        pmo_record_id: c.pmoRecordId,
        fiscal_year: typeof (c.canonical as Record<string, unknown> | null)?.fiscal_year === 'string'
          ? ((c.canonical as Record<string, string>).fiscal_year)
          : null,
        to_fiscal_year: typeof (c.canonical as Record<string, unknown> | null)?.to_fiscal_year === 'string'
          ? ((c.canonical as Record<string, string>).to_fiscal_year)
          : toFiscalYearOfIdentity(c.pmoRecordId),
        budget_intent: (c.canonical as Record<string, unknown> | null)?.budget_intent === 'remove' ? 'remove' as const : 'ensure' as const,
      }));
    const retryPendingIds = await listRetryPendingLive(serviceClient, org.orgId);
    const result = await reconcileOrgBudgetPushes(
      budgetBackstopDepsLive(
        serviceClient, org, eligibleBudgetCandidates, retryPendingIds,
        // ⚑ rm-1472 — units the gate parked behind an unsettled archive cancellation are resumed here,
        // through the SAME gate, once that fence settles.
        budgetArchiveWaitResumeLive(serviceClient, org, cache),
      ),
      { orgId: org.orgId },
    );
    // NEW-3: per-row throws are contained so the queue drains, but they are NEVER silent — a row that
    // keeps throwing is a stuck money push and must be visible in the tick's own result.
    for (const e of result.errors) {
      console.warn(`[erpnext-sweep] org ${org.orgId} budget ${e.budgetVersionId}: backstop row failed — ${e.error}`);
    }
    const archiveResult = await reconcileOrgBudgetArchiveCancellationsLive(
      serviceClient, org, new Set(eligibleBudgetCandidates.map((candidate) => candidate.id)), retryPendingIds, cache,
    );
    for (const e of archiveResult.errors) {
      console.warn(`[erpnext-sweep] org ${org.orgId} budget archive intent ${e.id}: ${e.error}`);
    }
    const errorCount = result.errors.length + archiveResult.errors.length;
    return { driven: result.driven + archiveResult.driven, error: errorCount ? `${errorCount} budget row(s) failed` : undefined };
  } catch (err) {
    return { driven: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function reconcileOrgBudgetArchiveCancellationsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  eligibleOutboxIds: ReadonlySet<string>,
  retryPendingIds: ReadonlySet<string>,
  cache?: ErpAuthPairCache,
): Promise<{ driven: number; errors: Array<{ id: string; error: string }> }> {
  const deps: BudgetArchiveBackstopDeps = {
    listPending: async (orgId, limit) => {
      const { data, error } = await serviceClient.from('budget_archive_cancel_intents')
        .select('id,org_id,request_id,project_id,budget_version_id,source_mirror_id,source_kind,actor_user_id,fiscal_year,to_fiscal_year,erp_modified,erp_account,erp_budget_name,activated_at_witness,pushed_project_start_date,pushed_project_end_date')
        .eq('org_id', orgId).eq('state', 'pending')
        .order('last_attempt_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit);
      if (error) throw new AppError(error.message, error.code);
      return (data ?? []) as unknown as BudgetArchiveCancelIntent[];
    },
    markAttempted: (orgId, jobs) => stampQueueAttempt(serviceClient, 'budget_archive_cancel_intents', orgId, 'id', jobs.map((j) => j.id)),
    readLifecycle: (job) => readBudgetArchiveLifecycleLive(serviceClient, job),
    targetIsStillLiveAndOwned: (job) => budgetArchiveTargetStillLiveAndOwnedLive(serviceClient, job),
    driveCancellation: async (job) => {
      // #1462 — the SOURCE KIND selects the identity, the archive key and the grain. A legacy job names an
      // old year-grained document and must never borrow the account plan's identity.
      const legacy = (job.source_kind ?? 'account') === 'legacy';
      const identity = legacy
        ? budgetLegacyIdentity(job.budget_version_id, job.fiscal_year)
        : job.to_fiscal_year
          ? budgetRangeIdentity(job.budget_version_id, job.fiscal_year, job.to_fiscal_year, job.erp_account!)
          : budgetAccountIdentity(job.budget_version_id, job.fiscal_year, job.erp_account!);
      const idempotencyKey = legacy
        ? budgetLegacyArchiveKey(identity, job.activated_at_witness)
        : budgetAccountArchiveKey(identity, job.activated_at_witness);
      const outbox = await findBudgetOutboxRow(serviceClient, job.org_id, identity, idempotencyKey);
      if (outbox?.state === 'confirmed') return true;
      if (outbox && !eligibleOutboxIds.has(outbox.id)) {
        if (outbox.state === 'committing' || outbox.state === 'quarantined' || retryPendingIds.has(outbox.id)) return false;
        throw new AppError('budget archive cancellation outbox is no longer eligible for automatic retry', 'commit-rejected');
      }
      if (outbox) {
        await dispatchMoneyWrite(await buildReconcileDepsLive(serviceClient, org, outbox, cache));
        return true;
      }

      const authorization = await checkErpnextCommandAuthorization(serviceClient as never, job.org_id, job.actor_user_id, {
        domain: ERPNEXT_BUDGET_DOMAIN,
        record: { erp_doc_kind: 'budget' },
      });
      if (!authorization.ok) throw new AppError(authorization.message, 'commit-rejected');

      const command: AdapterCommand = {
        domain: ERPNEXT_BUDGET_DOMAIN,
        operation: 'create',
        idempotencyKey,
        record: {
          id: job.budget_version_id,
          erp_doc_kind: 'budget',
          projectId: job.project_id,
          fiscal_year: job.fiscal_year,
          ...(job.to_fiscal_year ? { to_fiscal_year: job.to_fiscal_year, budget_mode: 'whole_project' } : {}),
          ...(job.to_fiscal_year ? { budget_predecessor_modified: job.erp_modified } : {}),
          ...(legacy
            ? { source_kind: 'legacy' }
            : { erp_account: job.erp_account }),
          budget_intent: 'remove',
          budget_predecessor: job.erp_budget_name,
          outbox_identity: identity,
          project_start_date: job.pushed_project_start_date,
          project_end_date: job.pushed_project_end_date,
          activated_at: job.activated_at_witness,
          budget_archive_cancel_job_id: job.id,
          budget_archive_source_mirror_id: job.source_mirror_id,
          line_items: [],
        },
      };
      await dispatchMoneyWrite(await buildMoneyWriteDepsLive(serviceClient, org, {
        command,
        actorUserId: job.actor_user_id,
        outboxRecordId: identity,
        persistPayload: true,
      }, cache));
      return true;
    },
    markComplete: async (job) => {
      const { data, error } = await serviceClient.from('budget_archive_cancel_intents')
        .update({ state: 'complete', last_error: null, updated_at: new Date().toISOString() })
        .eq('id', job.id).eq('org_id', job.org_id).eq('state', 'pending').select('id');
      if (error) throw new AppError(error.message, error.code);
      if (!Array.isArray(data) || data.length !== 1) {
        throw new AppError('budget archive cancellation intent changed before completion', 'commit-rejected');
      }
    },
    markSuperseded: async (job) => {
      const { data, error } = await serviceClient.rpc('transition_budget_archive_cancel_intent', {
        p_org_id: job.org_id, p_intent_id: job.id, p_action: 'superseded', p_reason: null,
      });
      if (error) throw new AppError(error.message, error.code);
      if (data === 'stale') throw new AppError('archive cancellation witness changed', 'archive-witness-stale');
    },
    markHeld: async (job, reason) => {
      const { data, error } = await serviceClient.rpc('transition_budget_archive_cancel_intent', {
        p_org_id: job.org_id, p_intent_id: job.id, p_action: 'held', p_reason: reason,
      });
      if (error) throw new AppError(error.message, error.code);
      if (data === 'stale') throw new AppError('archive cancellation witness changed', 'archive-witness-stale');
      await surfaceActionRequired(serviceClient, job.org_id, 'budget-archive-cancel-held', {
        projectId: job.project_id, versionId: job.budget_version_id,
        fiscalYear: job.fiscal_year, account: job.erp_account,
        sourceKind: job.source_kind ?? 'account',
      });
    },
    noteRetry: async (job, reason) => {
      const { data, error } = await serviceClient.rpc('transition_budget_archive_cancel_intent', {
        p_org_id: job.org_id, p_intent_id: job.id, p_action: 'retry', p_reason: reason,
      });
      if (error) throw new AppError(error.message, error.code);
      if (data === 'stale') throw new AppError('archive cancellation witness changed', 'archive-witness-stale');
      await surfaceActionRequired(serviceClient, job.org_id, 'budget-archive-cancel-retry', {
        projectId: job.project_id, versionId: job.budget_version_id,
        fiscalYear: job.fiscal_year, account: job.erp_account,
        sourceKind: job.source_kind ?? 'account',
      });
    },
  };
  const result = await reconcileOrgBudgetArchiveCancellations(deps, org.orgId);
  return { driven: result.driven, errors: result.errors };
}
