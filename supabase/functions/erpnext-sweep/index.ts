export { resolveInvoiceProject, resolveInvoiceProjects } from '../_shared/projectInvoiceAttribution.ts';
/**
 * erpnext-sweep — Deno Edge Function entry point (task 8.6, AC-ENA-045/071, ADR-0055 §3 + ADR-0058 §Consequences).
 *
 * The reconciliation sweep — the convergence authority that catches webhook gaps (ADR-0055 §3:
 * webhooks for latency, sweep for truth) AND runs the outbox recovery pass (ADR-0058 §Consequences:
 * the SAME recovery algorithm as the retry flow, run as an explicit pass BEFORE the doctype sweep so
 * an orphaned commit / stuck committing / committed-but-unfinalized row is reconciled even if the
 * original retry never returned). Dedicated-sweep-secret-guarded (`verify_jwt = false`; the handler
 * verifies the bearer itself — it MUST equal ERPNEXT_SWEEP_SECRET, constant-time), mirroring
 * clickup-sweep's least-privilege pattern: the caller is the pg_cron job (migration 0101), not a
 * browser JWT, and the dedicated sweep secret can at worst trigger a tick — never grant DB access.
 * Registered-but-idle per the 0094 precedent: the cron helper no-ops until an operator creates the
 * Vault secrets, so the job fires as a no-op until then (no employing org ⇒ no-op).
 *
 * Per employing org, ONE cycle runs the native statement segment alongside SEVEN legacy passes:
 *   (1) reconcileOrgOutbox — the ADR-0058 §4 outbox recovery pass (delegates to the REAL
 *       dispatchMoneyWrite per candidate — one algorithm, shared with the retry path);
 *   (2) the modified-poll doctype sweep (runSweep per doctype, the convergence authority — AC-ENA-071;
 *       #916: BOUNDED per tick — each doctype lists at most `SWEEP_LIST_MAX_PAGES` pages and the whole
 *       walk stops once the tick's `SWEEP_TICK_MAX_DOCS` document budget or `SWEEP_TICK_TIME_BUDGET_MS`
 *       elapsed-time budget is spent; the per-doctype watermark is the persisted cursor the next tick
 *       resumes from, so a full-year backfill is resumable instead of one CPU-limit-dying pass);
 *   native statement batch refresh — after the doctype walk and independently of legacy raw readiness;
 *   (3) the ledger-mirror feed (feedLedgerMirrors, 8.6b — populates erp_gl_entry_mirror/
 *       erp_payment_ledger_mirror);
 *   (3b) the read-only ERP purchases list (feedPurchaseMirror, FR-EPR-001 — visibility only, never actuals);
 *   (4) refreshActuals + refreshAging (slice 7 — read the freshly-fed mirror);
 *   (5) P3c — reconcileOrgBudgetPushes, the budget push's sweep backstop (FR-BUD-141,
 *       AC-BUD-023, `budgetBackstop.ts`) — re-drives the mirror's own (org_id, push_state) work queue,
 *       re-asserting the SAME still-Active gate the foreground path enforces (FR-BUD-102);
 *   (6) P3b — reconcileOrgTimesheetPushes, the timesheet push's sweep backstop (FR-TSP-045,
 *       AC-TSP-022, `timesheetBackstop.ts`) — the structural twin of (5): re-drives the mirror's own
 *       (org_id, push_state) work queue, re-asserting the SAME 0138 approval gate the foreground push
 *       enforces, with `p_actor` => the sheet's own `approved_by`. Until this landed, the push had ONE
 *       originator (the Approvals UI) and a push that died with the browser was stranded forever.
 *   (7) #775 phase B — reconcileOrgExpensePostings, the ONLY originator of expense postings (ADR-0081,
 *       `expensePostingBackstop.ts`): drives the intents 0270 writes in the claim's own transaction —
 *       replay an existing outbox row, else re-assert `expense_posting_for_push`, resolve, and post.
 * ⚑ Passes (5), (6) and (7) are the SOLE owners of the `budget`, `timesheets` and `expenses` domains: pass
 *   (1) skips all three, so each domain's gate is re-asserted by exactly one pass and `0131`'s attempt
 *   budget is spent once per tick, not twice.
 * Cadence (owner ruling 2026-10-23): the outbound money passes — (1), (5), (6), (7) — run on EVERY
 *   tick so postings reach ERPNext within a minute; the inbound work — (2), (2b), (3), (3b), (4) — runs
 *   about hourly per org: when the org's last completed full run (0358, stamped under its lock) is 55+
 *   minutes old, plus #1212's five-minute backfill ticks (`sweepCadenceAt`). Each `perOrg` entry and the
 *   top-level body carry `cadence: 'full' | 'money-only'` (top level `mixed` when orgs differ). A caller
 *   holding the sweep secret may post `{"mode":"full"}` to force the full tick (the e2e journeys do).
 * ⚑ 0642: the native statement batch has its OWN per-org freshness marker (`erp_statement_pass_run`),
 *   not the full-run marker: it is due hourly per org, an unfinished/failed pass is retried on the
 *   five-minute backfill cadence, and a `{"mode":"full"}` request bypasses the interval.
 * An org's failure is recorded WITHOUT blocking the others (sweep resilience: one client's bench
 * hiccup must not kill every org's refresh). Interactive priority over bulk (NFR-ENA-PERF-001).
 *
 * Thin wiring ONLY — the sweepCursor list+dedupe, applyFeed lineage, ledgerMirrorFeed, and
 * dispatchMoneyWrite reconcile are unit-proven elsewhere. `reconcileOrgOutbox` + `runErpSweepCycle`
 * are the testable core (outboxRecovery.test.ts); `reconcileOrgBudgetPushes` is `budgetBackstop.ts`'s
 * testable core (budgetBackstop.test.ts) — the budget domain's INBOUND rules (never adopt, never fight
 * the operator) live on the generic feed path, proven in `_shared/erpnextFeedDeps.test.ts`; the
 * `sweepOrgDoctypesLive` wiring itself is proven in companyScopedSweep/sweepWedge.test.ts. The
 * remaining Deno.serve wrapper is
 * INTEGRATION-ONLY — verified by `deno check` + the boot-smoke.
 *
 * Module map (THEME-BACK-40, #1643): this file keeps the handler, the per-org cycle, the outbox recovery
 * pass and the statement / ledger / purchase / accounting feeds, and wires the passes that live beside it —
 * `doctypePoll.ts` (2), `linkRepair.ts` (the receipt and invoice-project repairs), `budgetBackstopLive.ts` (5),
 * `timesheetBackstopLive.ts` (6), `expensePostingBackstopLive.ts` (7), `imprestPostingBackstopLive.ts` (7b), over the
 * shared layers `moneyWriteLive.ts` (every pass's DispatchMoneyWriteDeps), `budgetOutboxFacts.ts`,
 * `sweepShared.ts`, `outboxRows.ts` and `sweepCadence.ts`. The modules never import this file; it
 * re-exports their names so existing importers keep resolving.
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { constantTimeBearerEquals } from '../_shared/constantTimeBearerEquals.ts';
import { ERPNEXT_TIER, surfaceActionRequired } from '../_shared/erpnextFeedDeps.ts';
// Luna BLOCK 6: each body module declares the list-endpoint fields ITS `fromDoc` reads, next to the
// mapper — the poll is built from those so the two cannot drift apart.
import { sweepKindsForOrg } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { sweepFieldsForKind, KINDS_NEEDING_FULL_DOC, PAYMENT_TYPE_BY_KIND, pollFiltersForKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/pollSpec.ts';
import { advanceConnectRuns } from './connectRun.ts';
import { drainConnectSends } from './connectSends.ts';
import { feedLedgerMirrors } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/ledgerMirrorFeed.ts';
import { feedPurchaseMirror, type PurchaseFeedServiceClient } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/purchaseMirrorFeed.ts';
import { fetchStatementAccounts } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/accountFetch.ts';
import {
  refreshStatementReportBatch,
  STATEMENT_READ_REQUEST_TIMEOUT_MS,
  STATEMENT_READ_STAGE_TIMEOUT_MS,
  type StatementReportBatchService,
} from '../../../pmo-portal/src/lib/adapterSeam/erpnext/statementReportRefresh.ts';
export { STATEMENT_READ_REQUEST_TIMEOUT_MS, STATEMENT_READ_STAGE_TIMEOUT_MS };
import {
  planChangeDrivenStatements, settleChangeDrivenRun,
  type ChangeDrivenDecision, type ChangeDrivenRun, type ChangeDrivenService,
} from './statementChangeDriven.ts';
export const STATEMENT_SOURCE_READ_REQUEST_TIMEOUT_MS = 5_000;
export const STATEMENT_SOURCE_READ_STAGE_TIMEOUT_MS = 7_000;
import { feedAccountMirror } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/accountMirrorFeed.ts';
import { refreshAccountingSnapshots, type OrgAccountingScope } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/accountingFanout.ts';
import type { DispatchMoneyWriteDeps, OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { getDoc, withProbeBudget, type ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { createErpAuthPairCache, type ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
// BLOCK 1 / B5: the pull-adopt barrier now lives in `_shared/` so the WEBHOOK adopt path raises the
// IDENTICAL guard (round-9 FIX 1). Re-exported below so this module's existing test imports still resolve.
import { createInFlightAnchorProbe, type InFlightAnchorProbe } from '../_shared/inFlightAnchorProbe.ts';
import {
  type ErpSweepCadence, fullSweepDue, HOURLY_INVOCATION_DEADLINE_MS, SWEEP_BACKFILL_EVERY_MINUTES, SWEEP_FULL_INTERVAL_MS,
  SWEEP_RETRY_DELAY_SECONDS, statementPassDue, STATEMENT_PASS_INTERVAL_MS, STATEMENT_PASS_RETRY_DELAY_SECONDS, sweepCadenceAt,
  sweepRetryDelaySeconds,
} from './sweepCadence.ts';
export {
  type ErpSweepCadence, fullSweepDue, SWEEP_BACKFILL_EVERY_MINUTES, SWEEP_FULL_INTERVAL_MS, SWEEP_RETRY_DELAY_SECONDS,
  statementPassDue, STATEMENT_PASS_INTERVAL_MS, STATEMENT_PASS_RETRY_DELAY_SECONDS, sweepCadenceAt,
};

import { ERPNEXT_BUDGET_DOMAIN, ERPNEXT_EXPENSES_DOMAIN, ERPNEXT_TIMESHEETS_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';
import { withJobRun, type JobSummary } from '../_shared/jobRun.ts';
// The passes extracted beside this file (#1643), and the names this file re-exports from them.
import { type ListOutboxCandidates, DOMAIN_FEATURE_KEY, featureDisabled, type OrgBinding, erpClientForBinding, listCandidatesLive } from './sweepShared.ts';
import { repairInvoiceProjectsLive, repairOrgLinksLive } from './linkRepair.ts';
import { SWEEP_TICK_MAX_DOCS, SWEEP_TICK_TIME_BUDGET_MS, SWEEP_TICK_MAX_DOCS_ENV, SWEEP_TICK_TIME_BUDGET_MS_ENV, sweepOrgDoctypesLive } from './doctypePoll.ts';
import { buildReconcileDepsLive, dispatchMoneyWrite } from './moneyWriteLive.ts';
import { PRE_CUTOVER_CODE } from '../../../pmo-portal/src/lib/adapterSeam/cutoverGate.ts';
import { reconcileOrgBudgetPushesLive } from './budgetBackstopLive.ts';
import { reconcileOrgTimesheetPushesLive } from './timesheetBackstopLive.ts';
import { reconcileOrgExpensePostingsLive } from './expensePostingBackstopLive.ts';
import { reconcileOrgImprestPostingsLive } from './imprestPostingBackstopLive.ts';
export { imprestResolveDepsLive, imprestPostingBackstopDepsLive } from './imprestPostingBackstopLive.ts';
export { expenseResolveDepsLive, expensePostingBackstopDepsLive } from './expensePostingBackstopLive.ts';
export { absentQueueBudget, timesheetBackstopDepsLive } from './timesheetBackstopLive.ts';
export { BUDGET_ARCHIVE_CANCEL_HELD, BUDGET_ARCHIVE_RESUME_ACTOR_UNAUTHORIZED, type BudgetArchiveWaitResumeOutcome, BUDGET_ARCHIVE_CANCEL_SUPERSEDED, budgetArchiveWaitResumeLive, budgetBackstopDepsLive } from './budgetBackstopLive.ts';
export { buildOutboxProbe, buildReconcileDepsLive, moneyWriteReplayOptions, moneyWriteReadModelContext, dispatchMoneyWrite, buildMoneyWriteDepsLive, readErpFiscalYearsLive } from './moneyWriteLive.ts';
export { inFlightAnchorFilter, sweepWatermarkDomain, SWEEP_LIST_MAX_PAGES, SWEEP_TICK_MAX_DOCS, SWEEP_TICK_TIME_BUDGET_MS, orderedSweepKindsForOrg, SWEEP_TICK_MAX_DOCS_ENV, SWEEP_TICK_TIME_BUDGET_MS_ENV, type SweepTickBudgetOpts, sweepOrgDoctypesLive } from './doctypePoll.ts';
export { type RepairUnlinkedReceiptsDeps, repairUnlinkedReceipts, repairInvoiceProjectsLive, listReceiptRepairCandidates, resolveReceiptSalesInvoice, repairOrgLinksLive } from './linkRepair.ts';
export { type ListOutboxCandidates, DOMAIN_FEATURE_KEY, featureDisabled } from './sweepShared.ts';

export { createInFlightAnchorProbe, type InFlightAnchorProbe };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// #656: the domain→doctype poll rule (Luna BLOCK 9) lives in `erpnext/feedKinds.ts` — ONE copy, shared
// with the activation read-permission probe (`external-set-company`). Re-exported for existing importers.
export { sweepKindsForOrg };

// The per-kind poll spec moved to `erpnext/pollSpec.ts` (shared with the adapter's change-feed read); re-exported here.
export { sweepFieldsForKind, KINDS_NEEDING_FULL_DOC, PAYMENT_TYPE_BY_KIND, pollFiltersForKind };


// ────────────────────────────────────────────────────────────────────────────────────────────────
// (1) The outbox recovery pass — ADR-0058 §Consequences. Delegates to the REAL dispatchMoneyWrite per
//     candidate so the sweep path and the retry path share ONE reconciliation algorithm.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Builds the DispatchMoneyWriteDeps for one candidate row (the sweep wires the real outbox deps +
 *  adapter + read-model writers per org; the test injects mocks). Async-capable so the live wiring can
 *  resolve the adapter/binding; a sync mock (`() => deps`) still satisfies it (await on a value is a value). */
export type BuildReconcileDeps = (row: OutboxRow) => DispatchMoneyWriteDeps | Promise<DispatchMoneyWriteDeps>;

export interface ReconcileOrgOutboxResult {
  /** Candidates the pass drove through dispatchMoneyWrite this run. */
  reconciled: number;
  /** Per-candidate outcomes (`ok` on a terminal reconcile; `error` when dispatchMoneyWrite threw — the
   *  sweep logs + continues so one bad row does not abort the pass). */
  errors: Array<{ id: string; error: string }>;
}

/**
 * The outbox recovery pass for ONE org (AC-ENA-045, ADR-0058 §Consequences). Lists the candidates
 * (pending/failed/committing-past-lease/committed) via `outbox_reconcile_candidates(org)` and drives
 * each through the REAL `dispatchMoneyWrite` — one algorithm, shared with the retry path. A candidate
 * whose reconcile throws is recorded + skipped (sweep resilience); the next schedule retries it.
 *
 * Luna re-audit (ownership): the pass is DOMAIN-GATED, like `sweepOrgDoctypesLive` (sweepKindsForOrg)
 * and `repairOrgLinksLive`. It previously gated on nothing, so revoking a domain — the Operator's
 * kill-switch — refused NEW dispatches and stopped inbound adoption while queued/committing/committed
 * rows of that domain kept reconciling on the next tick and POSTED REAL money documents into an org
 * that no longer owns the domain. Fail-CLOSED: an org with no recorded ownership reconciles nothing.
 *
 * The skip is NOT silent (never drop a money row): `mark_outbox_held` cannot express it — 0096
 * transitions only `state='committing'`, while candidates are pending/failed/committing-past-lease/
 * committed — so the row is left EXACTLY as it is (no state change, no ERP call) and reported as a
 * per-candidate error, which `runErpSweepCycle` surfaces as `reconcile:<id>:<error>`. Re-granting the
 * domain resumes it on the next tick.
 */
export async function reconcileOrgOutbox(
  listCandidates: ListOutboxCandidates,
  org: {
    orgId: string;
    ownedDomains: readonly string[];
    disabledFeatureKeys?: readonly string[];
    /** This org's entitlement read failed: every gated domain is held (fail-closed). */
    featuresUnreadable?: boolean;
  },
  buildDeps: BuildReconcileDeps,
  dispatch: typeof dispatchMoneyWrite = dispatchMoneyWrite,
): Promise<ReconcileOrgOutboxResult> {
  const candidates = await listCandidates(org.orgId);
  const owned = new Set(org.ownedDomains);
  let reconciled = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for (const candidate of candidates) {
    // ECA-3 (#1606): a master send (`seed:<kind>:<id>`) is driven by the connect drain ALONE, which rebuilds its master from the PMO row;
    // replaying one here as an ordinary command of its domain would post the wrong body. The row is not dropped: when it has a proposal
    // (an accepted send) that proposal stays `sending` and the drain finishes it; a project sent from its own page has none, and its
    // retry finds the project by lookup (a held one leaves a decision row with a way out).
    if (candidate.idempotencyKey.startsWith('seed:')) continue;
    // ⚑ NEW-2/NEW-5 (audit r4): the `budget` domain is owned by pass 5 (`reconcileOrgBudgetPushes`)
    // ALONE. Two originators must never both drive one budget row:
    //   • CORRECTNESS — pass 5 re-asserts the version is STILL `Active` with its stamp, from DB truth
    //     (FR-BUD-102, `budgetBackstop.ts`). This pass re-checks only the actor's role, so replaying a
    //     budget row here bypasses that gate ENTIRELY. Scenario: v2's push fails while ERP is down, a PM
    //     activates v3, ERP returns — `outbox_reconcile_candidates` has no ORDER BY, so v2 can replay
    //     FIRST and leave ERPNext enforcing the figures of an ARCHIVED version while v3 is rejected by
    //     ERP's own duplicate guard. That is a wrong number in the client's GL controls.
    //   • BUDGET — driving the same row from both passes burns `0131`'s 5-attempt auto-recovery budget
    //     at 2× per tick, so a genuinely recoverable push is abandoned in half the intended attempts.
    // Skipping is safe precisely BECAUSE pass 5 owns it: the row is not dropped, it is reconciled by the
    // one pass that re-reads the version first.
    //
    // ⚑ AC-BUD-003 / FR-BUD-006(a) / FR-BUD-010 — this skip is BEFORE the ownership gate below because
    // budget is Posture B: it NEVER has a `domain_externally_owned('budget')` row (`owned` never contains
    // it), and its employment is the ACTIVE binding, asserted where the org is enumerated
    // (`employingOrgs` filters on `external_org_bindings.activated_at`) and re-asserted by pass 5's own
    // re-drive through the dispatch's binding-gated authGuard. Running the ownership gate on it would
    // report a false `domain-not-owned` "held for an operator" alarm on a budget row that is, in fact,
    // being recovered normally.
    if (candidate.domain === ERPNEXT_BUDGET_DOMAIN) continue;
    // (0534) ENTITLEMENT gate: a module switched off for this org mints no NEW commands, and its
    // outstanding ones are HELD — same treatment as a revoked domain (row untouched, reported, resumes on
    // re-enable), never a silent drop. This runs BEFORE buildDeps so an off module never resolves ERP
    // credentials. Budget/timesheets/expenses candidates were skipped above (their own passes own them).
    //
    // ⚑ CLOSURE IS NEVER HELD (FR-PLN-006): a `committed` candidate is one ERP ALREADY ACCEPTED — the
    // money document exists upstream — so only its LOCAL finalize is outstanding. Holding it would leave
    // PMO and ERP disagreeing for the whole off interval, so it is always driven to its terminal state.
    const featureKey = DOMAIN_FEATURE_KEY[candidate.domain];
    if (featureKey && featureDisabled(org, featureKey) && candidate.state !== 'committed') {
      errors.push({ id: candidate.id, error: `feature-off:${featureKey} is switched off for this organisation — held for an operator, NOT reconciled` });
      continue;
    }
    // The gate runs BEFORE buildDeps so a revoked domain never even resolves ERP credentials/adapter.
    // `candidate.domain` is the outbox row's own PMO domain, which the dispatch's authGuard already
    // proved equal to `KIND_DOMAIN[payload.erp_doc_kind]` at insert time — one value, checked here
    // without a second read of the payload.
    if (!owned.has(candidate.domain)) {
      errors.push({ id: candidate.id, error: `domain-not-owned: '${candidate.domain}' is no longer assigned to this tier — held for an operator, NOT reconciled` });
      continue;
    }
    // ⚑ P3b task 6.4 — the `timesheets` domain is likewise owned by pass 6
    // (`reconcileOrgTimesheetPushes`) ALONE. Two arguments, of different strengths — worth separating,
    // because only one of them is unconditional:
    //   • BUDGET (unconditional). Pass 6 drives exactly the rows `outbox_reconcile_candidates` admits —
    //     the SAME set this pass drives. Leaving `timesheets` here means every candidate is driven TWICE
    //     per tick, burning `0131`'s 5-attempt auto-recovery budget at 2x, so a push ERP would have
    //     accepted on attempt 4 is abandoned after two ticks instead of five.
    //   • GATE (latent today, live tomorrow). This pass re-asserts only the actor's authorization; it
    //     never calls `approved_timesheet_for_push`, so NONE of 0138's preconditions are re-checked.
    //     ⚑ THE ANTICIPATED DAY ARRIVED (2026-07-23, mig 0151 — the Slice-A `Approved -> Draft` re-open).
    //     This comment used to rest on `Approved` being TERMINAL (`'Approved' -> []`, mig 0007), and
    //     warned: "the day `Approved -> Rejected` lands, a row left here silently posts payroll-costing
    //     hours a human un-approved." It landed. **That premise is now FALSE and must not be relied on
    //     again.** The prediction was right, and a Luna money review found the hole it named.
    //     The safety is now STRUCTURAL rather than conventional: `claim_outbox_for_commit` (re-created in
    //     0151 §C) takes the canonical `ts-correct:<uuid>` advisory lock and re-reads `timesheets.status`
    //     INSIDE the claiming UPDATE's transaction for any `domain='timesheets'` row — so no claim path
    //     (this pass, pass 6, a foreground Retry, a recovery reissue) can post a week that was re-opened,
    //     whichever queue reaches it. The skip below is now a routing choice, NOT a safety argument.
    // Skipping is safe precisely BECAUSE pass 6 owns it: the row is not dropped, it is reconciled by the
    // one pass that re-asserts the gate first.
    if (candidate.domain === ERPNEXT_TIMESHEETS_DOMAIN) continue;
    // #775 phase B (ADR-0081): `expenses` is owned by pass (7) ALONE — it replays its own outbox rows (the same
    // dispatchMoneyWrite) after checking the intent, so driving them here too would burn 0131's attempt budget 2×.
    if (candidate.domain === ERPNEXT_EXPENSES_DOMAIN) continue;
    try {
      await dispatch(await buildDeps(candidate));
      reconciled += 1;
    } catch (err) {
      // A retryable reconcile (e.g. a quarantined row still in its window → "reconciling") is expected
      // mid-recovery; record + continue so one candidate does not abort the pass.
      const message = err instanceof Error ? err.message : String(err);
      // A failed payment whose bill a newer payment now holds retries on the next tick once that one settles
      // (0682); it is a deferral, not a fault to report on every tick. The retry path CLASSIFIES the raw 23505
      // before this catch sees it (dispatch.ts `toDispatchError` → the named `payment-in-flight-for-bill`
      // refusal, #1912), so match that code first; the constraint-name match below stays for a bypassed
      // classification (e.g. an op raised straight off a PostgREST error object).
      if ((err as { code?: unknown } | null)?.code === 'payment-in-flight-for-bill') continue;
      if (message.includes('external_command_outbox_one_inflight_erpnext_payment_per_bill')) continue;
      // #1680: a step held at cut-over is reported once (its refusal is then recorded in `last_error`); while the same
      // refusal repeats it stays quiet. The check still ran above, so once the purchase is released the row is driven.
      if ((err as { code?: unknown } | null)?.code === PRE_CUTOVER_CODE && candidate.lastError === message) continue;
      errors.push({ id: candidate.id, error: message });
    }
  }
  return { reconciled, errors };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// (2)+(3)+(4) The per-org sweep cycle: doctype modified-poll → ledger feed → accounting refresh.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 0642 — one native statement pass outcome, as the shipped `refreshStatementReportBatch` reports it.
 * `published` = a batch committed a generation; `progress` = a bounded segment ended with work left
 * (resumable); `failed` = the segment could not complete. An absent status means the pass did nothing
 * this tick (the module is switched off, or the binding is not statement-eligible).
 */
export interface NativeStatementPassResult {
  errorCode?: string;
  status?: 'published' | 'progress' | 'failed';
  /** The generation a `published` pass committed (settles a change-driven run). */
  snapshotId?: string;
}

/** How the statement pass was treated on this org's tick (reported in `perOrg[].statement`):
 *  `published`/`progress`/`failed` = the segment ran; `skipped` = due but not run on this tick (a
 *  money-only tick, or the hourly block ran out of invocation time); `not-due` = inside its interval. */
export type NativeStatementPassOutcome = 'published' | 'progress' | 'failed' | 'skipped' | 'not-due';

export interface ErpSweepCycleDeps {
  listEmployingOrgs: () => Promise<OrgBinding[]>;
  /** Atomic per-org statement-source lock. Live wiring always supplies both callbacks. */
  claimStatementLock?: (orgId: string, holder: string) => Promise<boolean>;
  releaseStatementLock?: (orgId: string, holder: string) => Promise<void>;
  /** Native statement collection is independent of raw-ledger catch-up and legacy readiness. */
  refreshNativeStatements?: (org: OrgBinding, opts?: { bypassMarker?: boolean }) => Promise<NativeStatementPassResult>;
  /** Change-driven statements: decide whether this tick runs a refresh (`legacy` keeps the hourly cadence). Optional so
   *  every existing cycle fixture stays byte-for-byte; absent ⇒ legacy. */
  planChangeDrivenStatements?: (org: OrgBinding) => Promise<ChangeDrivenDecision>;
  settleChangeDrivenStatements?: (org: OrgBinding, run: ChangeDrivenRun, result: NativeStatementPassResult) => Promise<void>;
  reconcileOrgOutbox: (org: OrgBinding) => Promise<ReconcileOrgOutboxResult>;
  /** `complete: false` = the bounded walk stopped early (budget/page quantum); it resumes next tick. */
  sweepOrgDoctypes: (org: OrgBinding) => Promise<{ applied: number; error?: string; complete?: boolean }>;
  /** Luna BLOCK 6: the late-link self-heal (receipts adopted before their invoice). Optional so the
   *  existing cycle tests stay byte-for-byte; the live wiring always supplies it. */
  repairOrgLinks?: (org: OrgBinding) => Promise<{ repaired: number; error?: string }>;
  feedOrgLedgers: (org: OrgBinding) => Promise<OrgLedgerFeedResult>;
  /** (3b) FR-EPR-001: the read-only ERP purchases list (purchaseMirrorFeed.ts). Never feeds actuals. */
  feedOrgPurchases?: (org: OrgBinding) => Promise<{ fed: number; error?: string }>;
  refreshOrgAccounting: (org: OrgBinding) => Promise<{ error?: string }>;
  /** P3c slice 5 (FR-BUD-141, AC-BUD-023) — the budget push's SECOND originator: re-drive the mirror's
   *  own work queue (`budget_version_erp_mirror`), re-asserting the SAME still-Active gate the
   *  foreground path enforces (FR-BUD-102). Optional so the existing cycle tests stay byte-for-byte;
   *  the live wiring always supplies it. */
  reconcileOrgBudgetPushes?: (org: OrgBinding) => Promise<{ driven: number; error?: string }>;
  /** P3b task 6.4 (FR-TSP-045, AC-TSP-022) — the timesheet push's SECOND originator: re-drive the
   *  mirror's own work queue (`timesheet_erp_mirror`), re-asserting the SAME 0138 approval gate the
   *  foreground push enforces. Optional so the existing cycle tests stay byte-for-byte; the live wiring
   *  always supplies it. */
  reconcileOrgTimesheetPushes?: (org: OrgBinding) => Promise<{ driven: number; error?: string }>;
  /** #775 phase B (ADR-0081) — pass (7), the only originator of expense postings. Optional so the existing cycle
   *  tests stay byte-for-byte; the live wiring always supplies it. */
  reconcileOrgExpensePostings?: (org: OrgBinding) => Promise<{ driven: number; error?: string }>;
  /** #1515 S6 — pass (7b), the originator of site float transfers (same ownership as pass (7)). Optional like its siblings. */
  reconcileOrgImprestPostings?: (org: OrgBinding) => Promise<{ driven: number; error?: string }>;
  /** ECA2-T13 (#1605) — pass (8): advance the org's open connect run by one bounded step. Optional like its siblings; the live wiring always supplies it. */
  advanceConnectRun?: (org: OrgBinding) => Promise<{ state?: string; error?: string }>;
  /** ECA3-T7 (#1606) — pass (8b): send the masters an Admin accepted as "send", a few per tick. Optional like its siblings. */
  drainConnectSends?: (org: OrgBinding) => Promise<{ error?: string }>;
  /** 0358: on a money-only tick, whether this org's hourly work is due (its last full run is stale). */
  isFullSweepDue?: (org: OrgBinding) => boolean;
  /** 0642: whether this org's native statement pass is due (its own hourly marker). Absent ⇒ always due,
   *  which keeps every existing cycle fixture byte-for-byte. */
  isStatementPassDue?: (org: OrgBinding) => boolean;
  /** 0642: stamp a PUBLISHED statement pass (lock-holder fenced in the RPC, like the full-run stamp). */
  markStatementPassDone?: (org: OrgBinding) => Promise<void>;
  /** 0642: an unfinished or failed statement pass is due again in `dueInSeconds` (never on the next tick). */
  deferStatementPass?: (org: OrgBinding, dueInSeconds: number) => Promise<void>;
  /** 0642: an explicit full-mode request (the documented operator refresh) runs the pass inside its interval. */
  forceStatementPass?: boolean;
  /** 0358: stamp a completed full run — only after the hourly passes ran, and only by the lock holder. */
  markFullSweepDone?: (org: OrgBinding) => Promise<void>;
  /** THEME-BACK-07: an unfinished or failed full run is deferred, not stamped: due again in `dueInSeconds`. */
  deferFullSweep?: (org: OrgBinding, dueInSeconds: number) => Promise<void>;
  /** Invocation-wide clock and the moment past which no further hourly pass starts (money passes still run). */
  nowMs?: () => number;
  hourlyDeadlineAtMs?: number;
}



/**
 * Supabase Edge Functions document a 150-second wall-clock limit:
 * https://supabase.com/docs/guides/functions/limits
 * ponytail: TTL outlives the function's wall-clock cap, so writers can't overlap; per-write fencing only if ticks ever exceed the cap.
 */
export const STATEMENT_SWEEP_WALL_CLOCK_CAP_MS = 150_000;
export const STATEMENT_SWEEP_LOCK_TTL_MS = 15 * 60_000;

export interface OrgLedgerFeedResult {
  gl: number;
  ple: number;
  /** Raw-source completeness only; statement readiness never changes these flags. */
  glCaughtUp?: boolean;
  pleCaughtUp?: boolean;
  error?: string;
  statementReady?: boolean;
  statementError?: string;
}

export interface ErpSweepCycleResult {
  orgs: number;
  perOrg: Array<{ orgId: string; cadence?: ErpSweepCadence; statement?: NativeStatementPassOutcome; reconcile: ReconcileOrgOutboxResult | null; sweep?: { applied: number }; ledger?: { gl: number; ple: number; glCaughtUp?: boolean; pleCaughtUp?: boolean; statementReady?: boolean }; errors: string[] }>;
}

/**
 * Run ONE sweep cycle across every employing org. Per org, in order: (1) outbox recovery, (2) doctype
 * modified-poll sweep, native statement capture, (3) ledger-mirror feed, (4) accounting refresh. An org's failure is recorded
 * WITHOUT aborting the loop (sweep resilience). The reconcile pass runs FIRST so the doctype sweep
 * sees a consistent outbox (ADR-0058 §Consequences).
 *
 * `cache`: the optional per-tick credential cache (ADR-0072 decision 5). When supplied, each org's entry
 * is DELETED at the end of its own iteration, so a multi-org tick holds at most ONE org's plaintext pair
 * resident at a time while still resolving each org once (AC-ENA-085). This is the #651-review per-org
 * cache SCOPING (the tick-level cache shared by the passes would otherwise accumulate every org's pair
 * for the whole cycle).
 */
export async function runErpSweepCycle(
  deps: ErpSweepCycleDeps,
  cache?: ErpAuthPairCache,
  cadence: ErpSweepCadence = 'full',
): Promise<ErpSweepCycleResult> {
  // The org whose hourly work waited longest (never-run first) goes first, so a slow org cannot starve the rest.
  const orgs = [...(await deps.listEmployingOrgs())].sort((a, b) =>
    (a.lastFullSweepAt ? Date.parse(a.lastFullSweepAt) || 0 : 0) - (b.lastFullSweepAt ? Date.parse(b.lastFullSweepAt) || 0 : 0));
  const pastDeadline = () => deps.hourlyDeadlineAtMs !== undefined && (deps.nowMs ?? Date.now)() >= deps.hourlyDeadlineAtMs;
  const perOrg: ErpSweepCycleResult['perOrg'] = [];
  for (const org of orgs) {
    const errors: string[] = [];
    const lockHolder = crypto.randomUUID();
    if (deps.claimStatementLock) {
      let acquired = false;
      try {
        acquired = await deps.claimStatementLock(org.orgId, lockHolder);
      } catch (err) {
        errors.push(`statement-lock:${err instanceof Error ? err.message : String(err)}`);
      }
      if (!acquired) {
        if (errors.length === 0) errors.push('statement-lock-held');
        perOrg.push({ orgId: org.orgId, reconcile: null, errors });
        cache?.delete(org.orgId);
        continue;
      }
      org.statementLockHolder = lockHolder;
    }
    // The tick forces the full sweep (an explicit request, or a backfilling binding); otherwise each org
    // runs its hourly work when its last completed full run is stale (0358).
    const hourly = cadence === 'full' || (deps.isFullSweepDue?.(org) ?? false);
    // 0642 — the native statement pass keeps its OWN freshness marker, so its cadence does not follow
    // how often the full run happens: 0358 leaves a deferred full run due again on the next tick, which
    // suits the inbound passes but not a resumable report batch. An explicit full-mode request (the
    // documented operator refresh) still bypasses the interval.
    const statementDue = deps.refreshNativeStatements !== undefined &&
      (deps.forceStatementPass === true || (deps.isStatementPassDue?.(org) ?? true));
    let statement: NativeStatementPassOutcome | undefined = deps.refreshNativeStatements === undefined
      ? undefined
      : statementDue ? 'skipped' : 'not-due';
    const runStatementPass = async (opts?: { bypassMarker?: boolean }): Promise<NativeStatementPassResult> => {
      if (!deps.refreshNativeStatements) return {};
      let result: NativeStatementPassResult;
      try {
        result = await deps.refreshNativeStatements(org, opts);
      } catch {
        errors.push('native-statement:native-refresh-failed');
        result = { status: 'failed' };
      }
      if (result.errorCode) errors.push(`native-statement:${result.errorCode}`);
      statement = result.status ?? 'skipped';
      // Only the lock holder can settle the marker (both RPCs re-check the lease), so a tick whose lease
      // lapsed leaves the org due. Published ⇒ hourly. Anything that ran but did not publish ⇒ the
      // next UTC five-minute window; already-published bindings still wait for an eligible full run.
      const settle = result.status === 'published'
        ? deps.markStatementPassDone?.bind(null, org)
        : result.status === undefined
          ? undefined
          : deps.deferStatementPass?.bind(null, org, STATEMENT_PASS_RETRY_DELAY_SECONDS);
      if (settle) {
        try {
          await settle();
        } catch (err) {
          errors.push(`statement-pass-mark:${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return result;
    };
    try {
    // (1) outbox recovery FIRST.
    let reconcile: ReconcileOrgOutboxResult | null = null;
    try {
      reconcile = await deps.reconcileOrgOutbox(org);
      for (const e of reconcile.errors) errors.push(`reconcile:${e.id}:${e.error}`);
    } catch (err) {
      errors.push(`reconcile:${err instanceof Error ? err.message : String(err)}`);
    }
    // (5) P3c — the budget push's sweep backstop (FR-BUD-141). The money passes (5)–(7) run right after (1) and BEFORE
    // the hourly block: if the hourly block dies (isolate CPU kill) the org stays due, and money must not starve behind
    // it. Same try/catch shape as its siblings so one org's failure never aborts the loop.
    if (deps.reconcileOrgBudgetPushes) {
      try {
        const r = await deps.reconcileOrgBudgetPushes(org);
        if (r.error) errors.push(`budget:${r.error}`);
      } catch (err) {
        errors.push(`budget:${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // (6) P3b — the timesheet push's sweep backstop (FR-TSP-045). Same try/catch shape as its siblings
    // so one org's failure never aborts the loop.
    if (deps.reconcileOrgTimesheetPushes) {
      try {
        const r = await deps.reconcileOrgTimesheetPushes(org);
        if (r.error) errors.push(`timesheet:${r.error}`);
      } catch (err) {
        errors.push(`timesheet:${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // (7) #775 phase B — expense postings: an approval posted by this pass reaches the GL mirror on a later
    // full tick's ledger feed (3). Same try/catch shape as its siblings.
    if (deps.reconcileOrgExpensePostings) {
      try {
        const r = await deps.reconcileOrgExpensePostings(org);
        if (r.error) errors.push(`expenses:${r.error}`);
      } catch (err) {
        errors.push(`expenses:${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // (7b) #1515 S6 — site float transfers (replenishments paid into a float with an ERP cash account), same domain and
    // ownership as (7). Same try/catch shape as its siblings.
    if (deps.reconcileOrgImprestPostings) {
      try {
        const r = await deps.reconcileOrgImprestPostings(org);
        if (r.error) errors.push(`imprest:${r.error}`);
      } catch (err) {
        errors.push(`imprest:${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // (8) ECA2-T13 — a person is waiting on the connect screen, so this runs on every tick, money-only included.
    if (deps.advanceConnectRun) {
      try {
        const r = await deps.advanceConnectRun(org);
        if (r.error) errors.push(`connect:${r.error}`);
      } catch (err) {
        errors.push(`connect:${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (deps.drainConnectSends) {
      try {
        const r = await deps.drainConnectSends(org);
        if (r.error) errors.push(`sends:${r.error}`);
      } catch (err) {
        errors.push(`sends:${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // (2) doctype modified-poll sweep. (2)–(4) are the hourly inbound/statement work: a money-only
    // tick skips them (the money passes (5)–(7) above have already run).
    // Change-driven statements run on EVERY tick (money-only included) so "Refresh now" and a confirmed posting are
    // not held up to an hourly window. `legacy` (feature off, checker error, any error here) keeps today's hourly pass.
    let changeDriven = false;
    if (deps.planChangeDrivenStatements && deps.refreshNativeStatements && deps.forceStatementPass !== true) {
      let decision: ChangeDrivenDecision = { kind: 'legacy' };
      try {
        decision = await deps.planChangeDrivenStatements(org);
      } catch {
        errors.push('statement-plan:failed');
      }
      changeDriven = decision.kind !== 'legacy';
      if (decision.kind === 'run' && !pastDeadline()) {
        const result = await runStatementPass({ bypassMarker: true });
        try {
          await deps.settleChangeDrivenStatements?.(org, decision, result);
        } catch (err) {
          errors.push(`statement-settle:${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    let sweep: { applied: number } | undefined;
    let ledger: ErpSweepCycleResult['perOrg'][number]['ledger'];
    if (hourly) {
      // `truncated`: work was left for the next tick (not an error). `failed`: a pass errored (retry after a delay).
      let truncated = false; // out of invocation time: later passes wait
      let walkIncomplete = false; // doctype walk hit its page quantum: later passes still run, the run is deferred
      let hourlyStarted = false;
      const hourlyFrom = errors.length; // money-pass errors above never hold the hourly marker back
      try {
        if (pastDeadline()) {
          truncated = true;
        } else {
          hourlyStarted = true;
          const r = await deps.sweepOrgDoctypes(org);
          sweep = { applied: r.applied };
          if (r.complete === false) walkIncomplete = true;
          if (r.error) errors.push(`sweep:${r.error}`);
        }
      } catch (err) {
        errors.push(`sweep:${err instanceof Error ? err.message : String(err)}`);
      }
      // Past the invocation's hourly deadline the remaining passes wait for the next tick.
      const stillTime = () => !truncated && !(truncated = pastDeadline());
      // (2b) late-link self-heal — AFTER the doctype sweep, so an invoice adopted THIS tick is already
      //      mapped when the receipts that cite it are re-checked (Luna BLOCK 6).
      if (deps.repairOrgLinks && stillTime()) {
        try {
          const r = await deps.repairOrgLinks(org);
          if (r.error) errors.push(`repair:${r.error}`);
        } catch (err) {
          errors.push(`repair:${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Native report capture is independently resumable; raw ledger readiness never gates it. 0642: it
      // also has its own hourly marker — a due full run no longer implies a statement pass.
      if (deps.refreshNativeStatements && statementDue && !changeDriven && stillTime()) {
        await runStatementPass();
      }
      // (3) ledger-mirror feed.
      let ledgerBehind = false;
      if (stillTime()) try {
        const r = await deps.feedOrgLedgers(org);
        ledger = {
          gl: r.gl, ple: r.ple, glCaughtUp: r.glCaughtUp, pleCaughtUp: r.pleCaughtUp,
          ...(r.statementReady === undefined ? {} : { statementReady: r.statementReady }),
        };
        ledgerBehind = r.glCaughtUp === false || r.pleCaughtUp === false;
        if (r.error) errors.push(`ledger:${r.error}`);
        if (r.statementError) errors.push(`statement:${r.statementError}`);
      } catch (err) {
        errors.push(`ledger:${err instanceof Error ? err.message : String(err)}`);
      }
      // (3b) the read-only ERP purchases list — AFTER the ledger feed, so a PI attributes through fresh GL rows.
      if (deps.feedOrgPurchases && stillTime()) {
        try {
          const r = await deps.feedOrgPurchases(org);
          if (r.error) errors.push(`purchases:${r.error}`);
        } catch (err) {
          errors.push(`purchases:${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // (4) refresh only from a complete mirror. A bounded backfill is not a current accounting view.
      if (truncated) {
        // out of invocation time: the whole remainder resumes next tick
      } else if (!ledger || ledger.glCaughtUp === false || ledger.pleCaughtUp === false) {
        console.warn(`[erpnext-sweep] org ${org.orgId}: accounting refresh deferred until both ledger feeds catch up`);
      } else {
        try {
          const r = await deps.refreshOrgAccounting(org);
          if (r.error) errors.push(`accounting:${r.error}`);
        } catch (err) {
          errors.push(`accounting:${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Stamp the completed full run (0358) only when every hourly pass finished and none failed; otherwise defer
      // (continue next tick when work was left, retry after a delay when a pass failed). Statement-side errors
      // retry on their own cadence and do not hold the marker back. A tick that dies before here leaves the org due.
      const failed = errors.slice(hourlyFrom).some((e) => !e.startsWith('native-statement:') && !e.startsWith('statement:') && !e.startsWith('statement-pass-mark:'));
      const unfinished = truncated || walkIncomplete || ledgerBehind;
      // An org whose hourly work never started keeps its marker: a defer would reset how long it has waited
      // and let a slow earlier org go first again on every tick.
      const settle = !hourlyStarted ? undefined : unfinished || failed ? deps.deferFullSweep?.bind(null, org, failed ? sweepRetryDelaySeconds(org.fullSweepFailures ?? 0) : 0) : deps.markFullSweepDone?.bind(null, org);
      if (settle) {
        try {
          await settle();
        } catch (err) {
          errors.push(`full-run-mark:${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    perOrg.push({ orgId: org.orgId, cadence: hourly ? 'full' : 'money-only', ...(statement ? { statement } : {}), reconcile, sweep, ledger, errors });
    // #651 review (per-org cache scope): clear this org's entry so only the CURRENT org's pair is ever
    // resident. One org's refusal already never aborts the loop; deleting here also guarantees a
    // resolution failure can't leave a stale org resident for a later org's passes.
    cache?.delete(org.orgId);
    } finally {
      if (deps.releaseStatementLock && org.statementLockHolder) {
        try {
          await deps.releaseStatementLock(org.orgId, org.statementLockHolder);
        } catch (err) {
          errors.push(`statement-lock-release:${err instanceof Error ? err.message : String(err)}`);
        }
        delete org.statementLockHolder;
      }
    }
  }
  return { orgs: orgs.length, perOrg };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// The real wiring the Deno.serve wrapper uses (DB + env + createErpFeedDeps + the slice-7 fanout).
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Loads the employing orgs (activated erpnext bindings) + resolves each org's ERP client deps.
 *  Exported for unit testing (task FIX-5, Quality IMPORTANT 2 — the DB-error path must be observable,
 *  not silently swallowed). */
export async function listEmployingOrgsLive(serviceClient: SupabaseClient): Promise<OrgBinding[]> {
  const { data, error } = await serviceClient.from('external_org_bindings')
    .select('id, org_id, site_url, secret_ref, config, activated_at, version_major, statement_full_ledger_replay_needed')
    .eq('external_tier', ERPNEXT_TIER);
  // task FIX-5: a real DB error must not be silently folded into "no employing orgs this cycle" — log
  // it so an outage is observable in the function logs. The sweep cycle still returns [] (fail-safe:
  // one bad DB round-trip skips this sweep tick rather than crashing the whole cron invocation).
  if (error) {
    console.error(`[erpnext-sweep] external_org_bindings load failed: code=${error.code ?? 'none'} message=${error.message}`);
    return [];
  }
  const rows = (data as Array<{ id?: string; org_id: string; site_url: string; secret_ref: string; config: Record<string, unknown> | null; activated_at: string | null; version_major: number | null; statement_full_ledger_replay_needed?: boolean }> | null) ?? [];
  const activated = rows.filter((r) => r.activated_at);
  if (activated.length === 0) return [];

  // Luna BLOCK 9: an activated binding says the org talks to ERPNext, NOT which PMO domains it handed
  // over. Load the real per-domain ownership so the sweep polls only what the org opted into. A load
  // error fail-safes this tick to [] (logged, like the binding read above) rather than sweeping blind.
  const { data: owned, error: ownedError } = await serviceClient.from('external_domain_ownership')
    .select('org_id, domain')
    .eq('external_tier', ERPNEXT_TIER)
    .in('org_id', activated.map((r) => r.org_id));
  if (ownedError) {
    console.error(`[erpnext-sweep] external_domain_ownership load failed: code=${ownedError.code ?? 'none'} message=${ownedError.message}`);
    return [];
  }
  const ownedByOrg = new Map<string, string[]>();
  for (const row of (owned as Array<{ org_id: string; domain: string }> | null) ?? []) {
    ownedByOrg.set(row.org_id, [...(ownedByOrg.get(row.org_id) ?? []), row.domain]);
  }

  // #916 fix round (starvation): the whole invocation shares ONE elapsed-time budget, so a FIXED org
  // order lets always-busy head orgs spend it every tick and starve the tail orgs' doctype walks
  // forever. Order the orgs LEAST-RECENTLY-SWEPT first: an org's sweep recency is the NEWEST
  // `updated_at` on its own poll watermark rows (`external_sync_watermarks`, the rows this sweep's
  // cursor advance stamps — no new table), and the stalest org walks first; an org with no rows
  // (never swept) first of all. Ties keep the loaded order (stable sort), so a fresh install sweeps
  // exactly as before. The `ledger::` rows share the table but NOT the walk — they are the ledger
  // feed's own cursors and never count as sweep completions.
  {
    const { data: wm, error: wmError } = await serviceClient.from('external_sync_watermarks')
      .select('org_id, domain, updated_at')
      .eq('external_tier', ERPNEXT_TIER)
      .in('org_id', activated.map((r) => r.org_id));
    if (wmError) {
      // Ordering is a fairness optimization, not a correctness control: a failed read degrades this
      // tick to the loaded order (logged) rather than skipping the sweep.
      console.error(`[erpnext-sweep] external_sync_watermarks recency load failed: code=${wmError.code ?? 'none'} message=${wmError.message}`);
    } else {
      const lastSweptMs = new Map<string, number>();
      for (const row of (wm as Array<{ org_id: string; domain: string; updated_at: string | null }> | null) ?? []) {
        if (typeof row.domain === 'string' && row.domain.startsWith('ledger::')) continue;
        const t = Date.parse(row.updated_at ?? '');
        const prev = lastSweptMs.get(row.org_id);
        lastSweptMs.set(row.org_id, Math.max(prev ?? 0, Number.isFinite(t) ? t : 0));
      }
      activated.sort((a, b) => (lastSweptMs.get(a.org_id) ?? 0) - (lastSweptMs.get(b.org_id) ?? 0));
    }
  }

  // 0358: each org's last completed full run. A failed read leaves every org unknown, i.e. due — the
  // hourly work then runs rather than silently stopping (logged).
  const lastFullByOrg = new Map<string, string>();
  const fullFailuresByOrg = new Map<string, number>();
  {
    const { data: runs, error: runsError } = await serviceClient.from('erp_sweep_full_run')
      .select('org_id, completed_at, consecutive_failures')
      .in('org_id', activated.map((r) => r.org_id));
    if (runsError) {
      console.error(`[erpnext-sweep] erp_sweep_full_run load failed: code=${runsError.code ?? 'none'} message=${runsError.message}`);
    } else {
      for (const row of (runs as Array<{ org_id: string; completed_at: string; consecutive_failures?: number }> | null) ?? []) {
        lastFullByOrg.set(row.org_id, row.completed_at);
        fullFailuresByOrg.set(row.org_id, row.consecutive_failures ?? 0);
      }
    }
  }

  // 0642: each org's last COMPLETED statement pass. The native batch has its own freshness marker so its
  // cadence cannot follow how often the full run happens (a deferred full run is due on every tick).
  // A failed read leaves every org unknown, i.e. due — the pass then runs rather than silently stopping.
  const lastStatementByOrg = new Map<string, string>();
  {
    const { data: passes, error: passesError } = await serviceClient.from('erp_statement_pass_run')
      .select('org_id, completed_at')
      .in('org_id', activated.map((r) => r.org_id));
    if (passesError) {
      console.error(`[erpnext-sweep] erp_statement_pass_run load failed: code=${passesError.code ?? 'none'} message=${passesError.message}`);
    } else {
      for (const row of (passes as Array<{ org_id: string; completed_at: string }> | null) ?? []) {
        lastStatementByOrg.set(row.org_id, row.completed_at);
      }
    }
  }

  const bindings: OrgBinding[] = activated.map((r) => ({
    orgId: r.org_id,
    bindingId: r.id ?? null,
    lastFullSweepAt: lastFullByOrg.get(r.org_id) ?? null,
    fullSweepFailures: fullFailuresByOrg.get(r.org_id) ?? 0,
    lastStatementPassAt: lastStatementByOrg.get(r.org_id) ?? null,
    siteUrl: r.site_url,
    secretRef: r.secret_ref,
    company: (r.config?.company as string | undefined) ?? '',
    config: r.config ?? {},
    // task FIX-6 (Quality MINOR 4): version_major is a top-level column, not a `config` key.
    versionMajor: r.version_major ?? null,
    activatedAt: r.activated_at,
    ownedDomains: ownedByOrg.get(r.org_id) ?? [],
    statementReplayNeeded: r.statement_full_ledger_replay_needed === true,
  }));

  // 0534 — each org's resolved switches, the SAME service-only projection the rest of the platform
  // reads (0533 `service_resolved_org_features`). The sweep holds a domain whose module resolves off
  // instead of driving it. A failed entitlement read holds THAT ORG ONLY, and holds EVERY gated key
  // (fail-closed: an unreadable switch is not evidence the module is on) — while terminal recovery is
  // preserved, because a candidate ERP already accepted still finalizes (reconcileOrgOutbox). The failure
  // is per org: one org's bad read never removes another org's hold.
  await Promise.all(bindings.map(async (b) => {
    try {
      const { data, error } = await serviceClient.rpc('service_resolved_org_features', { p_org_id: b.orgId });
      if (error) throw new Error(error.message);
      const rows = (data as Array<{ feature_key: string; enabled: boolean }> | null) ?? [];
      b.disabledFeatureKeys = rows.filter((row) => row.enabled === false).map((row) => row.feature_key);
    } catch (err) {
      b.featuresUnreadable = true;
      console.error(`[erpnext-sweep] service_resolved_org_features failed for org ${b.orgId}: `
        + `${err instanceof Error ? err.message : String(err)} — holding every gated module for THIS org`);
    }
  }));
  return bindings;
}

type StatementCadenceBindingRow = {
  id?: string | null;
  org_id?: string | null;
  config?: Record<string, unknown> | null;
  activated_at?: string | null;
  version_major?: number | null;
};

type NativeStatementBindingContext = {
  orgId: string;
  bindingId: string;
  activatedAt: string;
  versionMajor: 16;
  company: string;
  projectMap: Record<string, unknown>;
};

// Mirrors refreshStatementReportBatch's UUID_PATTERN: any canonical 8-4-4-4-12 hex UUID. Seeded
// sample ids (e.g. 00000000-0000-0000-0000-000000000001) carry no version/variant nibbles — the
// database already validates identity, so shape is the only thing this guard checks.
const STATEMENT_BINDING_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Binding-side criteria are kept aligned with refreshStatementReportBatch's shipped input guard. */
function nativeStatementBindingContext(input: {
  orgId: unknown;
  bindingId: unknown;
  activatedAt: unknown;
  versionMajor: unknown;
  company: unknown;
  projectMap: unknown;
}): NativeStatementBindingContext | null {
  if (typeof input.orgId !== 'string' || !STATEMENT_BINDING_UUID_PATTERN.test(input.orgId) ||
    typeof input.bindingId !== 'string' || !STATEMENT_BINDING_UUID_PATTERN.test(input.bindingId) ||
    typeof input.activatedAt !== 'string' || !input.activatedAt || !Number.isFinite(Date.parse(input.activatedAt)) ||
    input.versionMajor !== 16 || typeof input.company !== 'string' || input.company.trim() === '' ||
    !isJsonRecord(input.projectMap)) return null;
  return {
    orgId: input.orgId,
    bindingId: input.bindingId,
    activatedAt: input.activatedAt,
    versionMajor: 16,
    company: input.company,
    projectMap: input.projectMap,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isJsonRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function sameTimestampInstant(left: unknown, right: string): boolean {
  if (typeof left !== 'string') return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

const STATEMENT_FIRST_PUBLICATION_BACKFILL_MS = 6 * 60 * 60 * 1000;

type StatementReportBatchReadinessRow = { org_id?: unknown; started_at?: unknown; context?: unknown };
type StatementReportProgressRow = { org_id?: unknown; acquired_at?: unknown };

function statementReportBatchMatchesBinding(
  batchContext: unknown,
  context: NativeStatementBindingContext,
): boolean {
  if (!isJsonRecord(batchContext)) return false;
  const batchBinding = batchContext.binding;
  return batchContext.company === context.company && sameJson(batchContext.projectMap, context.projectMap) &&
    isJsonRecord(batchBinding) && batchBinding.id === context.bindingId &&
    batchBinding.versionMajor === context.versionMajor &&
    sameTimestampInstant(batchBinding.activatedAt, context.activatedAt);
}

/**
 * The tick-wide decision. Every tick runs the outbound money passes (owner ruling 2026-10-23). The tick
 * forces the full sweep for every org only while some binding lacks its first statement publication,
 * on the five-minute ticks (#1212's backfill cadence); otherwise each org runs its hourly work when its
 * own marker says it is due (`fullSweepDue`). The readiness read is made only on five-minute ticks.
 */
/** The body's top-level `cadence`: `full` / `money-only` when every ticked org ran the same work, else
 *  `mixed` (each `perOrg` entry carries its own). With no org ticked it is the tick-wide decision. */
export function tickCadenceSummary(cadence: ErpSweepCadence, cycle: ErpSweepCycleResult): ErpSweepCadence | 'mixed' {
  const ran = new Set(cycle.perOrg.flatMap((p) => (p.cadence ? [p.cadence] : [])));
  if (ran.size === 0) return cadence;
  return ran.size === 1 ? [...ran][0] : 'mixed';
}


/**
 * Between an org's hourly runs, the full sweep is forced only while some active binding accepted by
 * the native collector's binding guard lacks a publication for that same company, binding
 * activation, version, and project map. A binding without its first publication keeps the
 * five-minute full cadence while its matching native report batch started within six hours or
 * recorded a report acquisition within the last six hours. Other bindings stay on the hourly
 * cadence. The publication context is written only by the native snapshot trigger for a committed
 * generation; attempts and legacy status fields do not establish publication.
 */
async function allActiveBindingsHavePublishedStatementGeneration(serviceClient: SupabaseClient): Promise<boolean> {
  const { data, error } = await serviceClient.from('external_org_bindings')
    .select('id, org_id, config, activated_at, version_major')
    .eq('external_tier', ERPNEXT_TIER)
    .not('activated_at', 'is', null);
  if (error || !Array.isArray(data)) {
    console.error(`[erpnext-sweep] publication readiness binding read failed: code=${error?.code ?? 'unknown'} message=${error?.message ?? 'invalid response'}`);
    return false;
  }

  const eligibleBindings = (data as StatementCadenceBindingRow[]).flatMap((binding) => {
    const projectMap = binding.config?.project_map === undefined ? {} : binding.config.project_map;
    const context = nativeStatementBindingContext({
      orgId: binding.org_id,
      bindingId: binding.id,
      activatedAt: binding.activated_at,
      versionMajor: binding.version_major,
      company: binding.config?.company,
      projectMap,
    });
    return context ? [{ binding, context }] : [];
  });

  const readinessNowMs = Date.now();
  const eligibleOrgIds = [...new Set(eligibleBindings.map(({ context }) => context.orgId))];
  const recentBatches: StatementReportBatchReadinessRow[] = [];
  const recentProgressOrgIds = new Set<string>();
  const batchWindowStart = new Date(readinessNowMs - STATEMENT_FIRST_PUBLICATION_BACKFILL_MS).toISOString();
  const batchWindowEnd = new Date(readinessNowMs).toISOString();
  // The report-batch table has one row per org. Read eligible orgs in bounded primary-key chunks;
  // cadence qualification below is based on exact batch identity and acquisition recency, not age since activation.
  for (let offset = 0; offset < eligibleOrgIds.length; offset += 100) {
    const orgIds = eligibleOrgIds.slice(offset, offset + 100);
    const { data: batches, error: batchError } = await serviceClient.from('erp_financial_statement_report_batch')
      .select('org_id, started_at, context')
      .in('org_id', orgIds);
    if (batchError || !Array.isArray(batches)) {
      console.error(`[erpnext-sweep] statement batch readiness read failed: code=${batchError?.code ?? 'unknown'} message=${batchError?.message ?? 'invalid response'}`);
      continue;
    }
    recentBatches.push(...batches as StatementReportBatchReadinessRow[]);
    const pageSize = 250;
    for (let from = 0; ; from += pageSize) {
      const { data: progress, error: progressError } = await serviceClient.from('erp_financial_statement_report_pending')
        .select('org_id, acquired_at')
        .in('org_id', orgIds)
        .gte('acquired_at', batchWindowStart)
        .lte('acquired_at', batchWindowEnd)
        .range(from, from + pageSize - 1);
      if (progressError || !Array.isArray(progress)) {
        console.error(`[erpnext-sweep] statement progress readiness read failed: code=${progressError?.code ?? 'unknown'} message=${progressError?.message ?? 'invalid response'}`);
        break;
      }
      for (const row of progress as StatementReportProgressRow[]) {
        if (typeof row.org_id !== 'string' || typeof row.acquired_at !== 'string') continue;
        const acquiredAtMs = Date.parse(row.acquired_at);
        if (acquiredAtMs < readinessNowMs - STATEMENT_FIRST_PUBLICATION_BACKFILL_MS || acquiredAtMs > readinessNowMs) continue;
        const eligible = eligibleBindings.find(({ context }) => context.orgId === row.org_id);
        if (eligible && recentBatches.some((batch) => batch.org_id === row.org_id &&
          statementReportBatchMatchesBinding(batch.context, eligible.context))) recentProgressOrgIds.add(row.org_id);
      }
      if (progress.length < pageSize) break;
    }
  }

  for (const { binding, context } of eligibleBindings) {
    const activationAgeMs = readinessNowMs - Date.parse(context.activatedAt);
    if (activationAgeMs < 0) continue;

    const { company, projectMap } = context;
    let foundCurrentPublication: boolean | undefined;

    // `activatedAt` is jsonb text, so compare instants in JavaScript: the same PostgreSQL timestamp
    // can be serialized as either a `Z` suffix or an explicit UTC offset across runtime versions.
    const pageSize = 250;
    for (let from = 0; ; from += pageSize) {
      const { data: contexts, error: contextError } = await serviceClient.from('erp_financial_statement_published_context')
        .select('context')
        .eq('org_id', context.orgId)
        .eq('company', company)
        .eq('context->binding->>id', context.bindingId)
        .eq('context->binding->>versionMajor', String(context.versionMajor))
        .contains('context', { company, projectMap })
        .range(from, from + pageSize - 1);
      if (contextError || !Array.isArray(contexts)) {
        console.error(`[erpnext-sweep] publication readiness context read failed: code=${contextError?.code ?? 'unknown'} message=${contextError?.message ?? 'invalid response'}`);
        return false;
      }

      foundCurrentPublication = contexts.some((row: { context?: unknown }) => {
        if (!isJsonRecord(row.context)) return false;
        const publishedContext = row.context;
        const contextBinding = publishedContext.binding;
        return publishedContext.company === company && sameJson(publishedContext.projectMap, projectMap) &&
          isJsonRecord(contextBinding) && contextBinding.id === binding.id &&
          contextBinding.versionMajor === context.versionMajor &&
          sameTimestampInstant(contextBinding.activatedAt, context.activatedAt);
      });
      if (foundCurrentPublication || contexts.length < pageSize) break;
    }
    if (foundCurrentPublication === true) continue;

    const recentAcquisitionActive = recentProgressOrgIds.has(context.orgId);
    const recentBatchActive = recentBatches.some((batch) => {
      if (batch.org_id !== context.orgId || typeof batch.started_at !== 'string') return false;
      const batchAgeMs = readinessNowMs - Date.parse(batch.started_at);
      return batchAgeMs >= 0 && batchAgeMs < STATEMENT_FIRST_PUBLICATION_BACKFILL_MS &&
        statementReportBatchMatchesBinding(batch.context, context);
    });
    if (recentAcquisitionActive || recentBatchActive) return false;
  }
  return true;
}

/** The statement-source read budget is intentionally separate from the ordinary ledger client. */
type StatementReadOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
type StatementSourceReadResults = {
  accounts?: StatementReadOutcome<Awaited<ReturnType<typeof fetchStatementAccounts>>>;
  timedOut: boolean;
};

/** One bounded statement-only stage; the ordinary ledger client and its retry budget are untouched. */
async function readStatementSourcesBounded(client: ErpClientDeps, company: string): Promise<StatementSourceReadResults> {
  const controller = new AbortController();
  const boundedClient: ErpClientDeps = {
    ...client,
    timeoutMs: STATEMENT_SOURCE_READ_REQUEST_TIMEOUT_MS,
    maxRetries: 0,
    fetchImpl: (input, init) => {
      const requestInit = init as RequestInit | undefined;
      const signal = requestInit?.signal ? AbortSignal.any([controller.signal, requestInit.signal]) : controller.signal;
      return client.fetchImpl(input, { ...requestInit, signal });
    },
  };
  let acceptingResults = true;
  let accounts: StatementSourceReadResults['accounts'];
  const accountRead = fetchStatementAccounts(boundedClient, { company }).then(
    (value) => { if (acceptingResults) accounts = { ok: true, value }; },
    (error: unknown) => { if (acceptingResults) accounts = { ok: false, error }; },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`Statement source reads exceeded ${STATEMENT_SOURCE_READ_STAGE_TIMEOUT_MS}ms`));
      resolve(false);
    }, STATEMENT_SOURCE_READ_STAGE_TIMEOUT_MS);
  });
  try {
    await Promise.race([accountRead.then(() => true), deadline]);
    return { accounts, timedOut };
  } finally {
    acceptingResults = false;
    if (timer !== undefined) clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The ledger-mirror feed for one org (8.6b). */
export async function feedOrgLedgersLive(serviceClient: SupabaseClient, org: OrgBinding, cache?: ErpAuthPairCache): Promise<OrgLedgerFeedResult> {
  let client: ErpClientDeps;
  try {
    client = await erpClientForBinding(serviceClient, org, cache);
  } catch (err) {
    return { gl: 0, ple: 0, glCaughtUp: false, pleCaughtUp: false, error: errorMessage(err) };
  }

  const statementErrors: string[] = [];
  const attemptAt = new Date().toISOString();
  const captureRunId = crypto.randomUUID();
  if (org.bindingId) {
    try {
      const { error } = await serviceClient.rpc('record_capture_feed_start', {
        p_org_id: org.orgId, p_binding_id: org.bindingId, p_kind: 'ledger', p_started_at: attemptAt, p_run_id: captureRunId,
      });
      if (error) throw new Error('Could not record ledger feed start');
    } catch (err) {
      return { gl: 0, ple: 0, glCaughtUp: false, pleCaughtUp: false, error: errorMessage(err) };
    }
  }
  try {
    const { error } = await serviceClient.from('external_org_bindings').update({
      statement_last_attempt_at: attemptAt,
    }).eq('org_id', org.orgId).eq('external_tier', ERPNEXT_TIER);
    if (error) statementErrors.push(`could not record statement source attempt: ${error.message}`);
  } catch (err) {
    statementErrors.push(`could not record statement source attempt: ${errorMessage(err)}`);
  }

  let reads: StatementSourceReadResults = { timedOut: false };
  try {
    reads = await readStatementSourcesBounded(client, org.company);
  } catch (err) {
    statementErrors.push(`statement source reads unavailable: ${errorMessage(err)}`);
  }
  if (reads.timedOut) statementErrors.push(`statement source read stage exceeded ${STATEMENT_SOURCE_READ_STAGE_TIMEOUT_MS}ms`);
  let chartReady = false;
  if (reads.accounts?.ok) {
    try {
      await feedAccountMirror(serviceClient as unknown as Parameters<typeof feedAccountMirror>[0], {
        orgId: org.orgId, company: org.company, refreshId: crypto.randomUUID(), asOf: attemptAt, accounts: reads.accounts.value,
      });
      chartReady = true;
    } catch (err) {
      statementErrors.push(`chart unavailable: ${errorMessage(err)}`);
    }
  } else {
    statementErrors.push(`chart unavailable: ${reads.accounts ? errorMessage(reads.accounts.error) : 'statement source read deadline expired'}`);
  }
  let referencesCheckedBefore = false;
  let referencesBefore: boolean | undefined;
  if (chartReady) {
    try {
      const { data, error } = await serviceClient.rpc('mark_erp_statement_replay_for_missing_accounts', {
        p_org_id: org.orgId, p_company: org.company,
      });
      if (error) statementErrors.push(`chart references unavailable before ledger feed: ${error.message}`);
      else if (typeof data !== 'boolean') statementErrors.push('chart references unavailable before ledger feed: unknown result');
      else { referencesCheckedBefore = true; referencesBefore = data; }
    } catch (err) {
      statementErrors.push(`chart references unavailable before ledger feed: ${errorMessage(err)}`);
    }
  }

  let gl = 0;
  let ple = 0;
  let glCaughtUp = false;
  let pleCaughtUp = false;
  let rawError: string | undefined;
  try {
    const result = await feedLedgerMirrors(serviceClient as unknown as Parameters<typeof feedLedgerMirrors>[0], {
      client, orgId: org.orgId, company: org.company,
      // Preserve the binding's original replay intent. Statement readiness is not a raw-history fence.
      fullReplay: org.statementReplayNeeded === true,
    });
    gl = result.glFed;
    ple = result.pleFed;
    glCaughtUp = result.glCaughtUp;
    pleCaughtUp = result.pleCaughtUp;
    const problems = [!glCaughtUp ? 'GL feed is incomplete' : '', !pleCaughtUp ? 'Payment Ledger feed is incomplete' : '',
      // A voucher too big to read in full was not reconciled against ERPNext; the feed moved on (0382).
      ...result.skippedVouchers.map((v) => `${v} too large to reconcile; its mirrored rows were not checked against ERPNext`)].filter(Boolean);
    if (problems.length) rawError = problems.join('; ');
  } catch (err) {
    rawError = errorMessage(err);
  }

  let referencesResolved = false;
  if (chartReady && !rawError && glCaughtUp && pleCaughtUp) {
    try {
      const { data, error } = await serviceClient.rpc('mark_erp_statement_replay_for_missing_accounts', {
        p_org_id: org.orgId, p_company: org.company,
      });
      if (error) statementErrors.push(`chart references unavailable after ledger feed: ${error.message}`);
      else if (typeof data !== 'boolean') statementErrors.push('chart references unavailable after ledger feed: unknown result');
      else referencesResolved = data === false;
    } catch (err) {
      statementErrors.push(`chart references unavailable after ledger feed: ${errorMessage(err)}`);
    }
  }
  if (chartReady && referencesCheckedBefore && referencesBefore === true && !referencesResolved && !statementErrors.some((error) => error.includes('chart references unavailable'))) {
    statementErrors.push('GL accounts remain unresolved in the complete chart');
  }

  // Legacy readiness is diagnostic only; native pending/publication status belongs to the batch RPCs.
  const statementReady = Boolean(
    chartReady && referencesCheckedBefore && referencesResolved &&
    statementErrors.length === 0 && glCaughtUp && pleCaughtUp && !rawError,
  );
  if (statementReady && org.bindingId) {
    // The ledger amounts are in the ERP company's currency. A failed or blank read records an unknown
    // currency (capture then refuses it by name); it never stops the completion from being recorded.
    let ledgerCurrency: string | null = null;
    try {
      const company = await getDoc(withProbeBudget(client), 'Company', org.company) as { default_currency?: unknown } | null;
      ledgerCurrency = typeof company?.default_currency === 'string' && company.default_currency.trim() ? company.default_currency.trim() : null;
    } catch { /* unknown currency */ }
    try {
      const { error } = await serviceClient.rpc('record_capture_feed_completion', {
        p_org_id: org.orgId, p_binding_id: org.bindingId, p_kind: 'ledger', p_started_at: attemptAt, p_run_id: captureRunId, p_currency: ledgerCurrency,
      });
      if (error) statementErrors.push('Could not record ledger feed completion');
    } catch { statementErrors.push('Could not record ledger feed completion'); }
  }

  return {
    gl, ple, glCaughtUp, pleCaughtUp,
    ...(rawError ? { error: rawError } : {}),
    statementReady,
    ...(statementErrors.length ? { statementError: statementErrors.join('; ') } : {}),
  };
}

/**
 * The aging-snapshot provenance version string for an org (task FIX-6, Quality MINOR 4). Sourced
 * from `org.versionMajor` (the `external_org_bindings.version_major` COLUMN, handshake-stamped) —
 * `org.config.version` was never a real key (§4.1's `config` shape has no `version`: it carries
 * `report_filter_shape`/`aging_report_names`/the account defaults), so every aging snapshot's
 * `report_version` provenance was silently the empty string. Exported for direct unit testing.
 */
export function reportVersionFromOrg(org: Pick<OrgBinding, 'versionMajor'>): string {
  return org.versionMajor != null ? String(org.versionMajor) : '';
}

/**
 * The accounting refresh for one org (slice 7 fanout — actuals + AP/AR aging from the mirror).
 * Exported for unit testing (task FIX-6, Quality MINOR 4).
 *
 * ⚑ NEW-1 (audit round 4, 2026-07-22) — `actualsScope` carries the org's REAL `config.project_map`.
 * It used to be a literal `{}`, and `refreshActuals` stamped `project_id` from a caller-supplied scope
 * that was therefore always empty: every `erp_actuals_snapshot` row landed with `project_id = NULL`,
 * while `0141_get_budget_projection.sql` joins `s.project_id = p_project_id`. "Actuals to date" was
 * structurally 0.00 for every project with real posted GL spend — variance = the entire budget, on the
 * primary money screen, with no error anywhere. Attribution now comes from the project dimension ERP
 * itself states on the GL row, resolved through the SAME `project_map` seam the dispatch factory
 * uses for the budget push and every timesheet entry (`resolveErpProjectName`, erpnext/dispatchRefs.ts) —
 * one mapping, consumed inverted, never a second one invented here.
 */
export async function feedOrgPurchasesLive(serviceClient: SupabaseClient, org: OrgBinding, cache?: ErpAuthPairCache): Promise<{ fed: number; error?: string }> {
  try {
    const client = await erpClientForBinding(serviceClient, org, cache);
    const startedAt = new Date().toISOString();
    const runId = crypto.randomUUID();
    if (org.bindingId) {
      const { error } = await serviceClient.rpc('record_capture_feed_start', {
        p_org_id: org.orgId, p_binding_id: org.bindingId, p_kind: 'purchases', p_started_at: startedAt, p_run_id: runId,
      });
      if (error) throw new Error('Could not record purchase feed start');
    }
    const r = await feedPurchaseMirror(serviceClient as unknown as PurchaseFeedServiceClient, { client, orgId: org.orgId, company: org.company });
    if (r.caughtUp && org.bindingId) {
      const { error } = await serviceClient.rpc('record_capture_feed_completion', {
        p_org_id: org.orgId, p_binding_id: org.bindingId, p_kind: 'purchases', p_started_at: startedAt, p_run_id: runId,
      });
      if (error) throw new Error('Could not record purchase feed completion');
    }
    // A bounded backfill is progress, not a failure — warn like the ledger feed does.
    if (!r.caughtUp) console.warn(`[erpnext-sweep] org ${org.orgId}: purchase feed backfill continues next tick`);
    return { fed: r.fed };
  } catch (err) {
    return { fed: 0, error: errorMessage(err) };
  }
}

export async function refreshOrgAccountingLive(serviceClient: SupabaseClient, org: OrgBinding, cache?: ErpAuthPairCache): Promise<{ error?: string }> {
  try {
    const client = await erpClientForBinding(serviceClient, org, cache);
    const reportVersion = reportVersionFromOrg(org);
    const scope: OrgAccountingScope = {
      orgId: org.orgId,
      client,
      actualsScope: { projectMap: (org.config.project_map as Record<string, unknown> | undefined) ?? {} },
      apAgingScope: { reportName: 'Accounts Payable', snapshotTable: 'erp_ap_aging_snapshot', filters: org.config.report_filter_shape as Record<string, unknown> ?? {}, reportVersion },
      arAgingScope: { reportName: 'Accounts Receivable', snapshotTable: 'erp_ar_aging_snapshot', filters: org.config.report_filter_shape as Record<string, unknown> ?? {}, reportVersion },
    };
    const results = await refreshAccountingSnapshots(serviceClient as unknown as Parameters<typeof refreshAccountingSnapshots>[0], [scope]);
    // ⚑ The undated-fiscal-year gap. `erp_actuals_snapshot.fiscal_year` is nullable (0101) and BOTH
    // readers match it by EQUALITY, so a GL row whose fiscal year ERPNext never stated is money that is
    // invisible under every year the UI can offer. PMO does not own the client's fiscal calendar and
    // must never invent a year for it — so the row keeps its honest NULL and a human is told, rather
    // than the refresh reporting a clean success over money nobody can see. `surfaceActionRequired`
    // dedupes against an UNREAD notification for the same reason, so a persisting condition does not
    // re-notify every cron tick.
    const undatedRows = results[0]?.actuals?.undatedRows ?? 0;
    if (undatedRows > 0) {
      await surfaceActionRequired(serviceClient, org.orgId, 'erp-actuals-undated-fiscal-year', {});
    }
    const err = results.find((r) => r.error)?.error;
    return err ? { error: err } : {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * job_run summary for the tick response (#1532 S3). `null` = not a tick (a maintenance request has no
 * `perOrg`). Zero bound orgs is `skipped`: a standalone deployment legitimately has none (ADR-0094).
 * Every org erroring is `failed` ORG_SWEEP_FAILED (FR-PHO-022).
 * Held / quarantined counts come from the erp_push_outcome stream (S4), not from here.
 */
export function summarizeErpSweep(body: unknown): JobSummary | null {
  const b = body as { orgs?: unknown; perOrg?: unknown } | null;
  if (!b || !Array.isArray(b.perOrg)) return null;
  const perOrg = b.perOrg as ErpSweepCycleResult['perOrg'];
  let recovered = 0;
  let applied = 0;
  let reconcileErrors = 0;
  let orgErrors = 0;
  for (const o of perOrg) {
    recovered += o.reconcile?.reconciled ?? 0;
    reconcileErrors += o.reconcile?.errors.length ?? 0;
    applied += o.sweep?.applied ?? 0;
    // `statement-lock-held` is the routine "another tick holds the lock" marker, not a failure.
    if (o.errors.some((e) => e !== 'statement-lock-held')) orgErrors += 1;
  }
  const orgs = typeof b.orgs === 'number' ? b.orgs : perOrg.length;
  return {
    items: recovered + applied,
    orgCount: orgs,
    // Every bound org erroring = the tick did nothing useful (ERP down, credentials expired): failed, not ok.
    // A partial failure stays ok; `org_error_count` carries it (sustained-count alert, docs/posthog-dashboards.md).
    ...(orgs === 0 ? { skipped: true } : perOrg.length > 0 && orgErrors === perOrg.length ? { failedCode: 'ORG_SWEEP_FAILED' } : {}),
    extra: { recovered, reconcile_errors: reconcileErrors, org_error_count: orgErrors },
  };
}

serveWithErrorReporting('erpnext-sweep', withJobRun('erpnext-sweep', async (req: Request): Promise<Response> => {
  const handlerEntryMs = Date.now();
  // ── 1. Authorization: the caller (the pg_cron job) must present the DEDICATED sweep secret (NOT the
  //    master service_role key — least-privilege, mirroring clickup-sweep). The cron presents this same
  //    secret from the Vault `erpnext_sweep_secret`; the master key never crosses into the DB. ──
  const sweepSecret = Deno.env.get('ERPNEXT_SWEEP_SECRET') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!sweepSecret || !(await constantTimeBearerEquals(authHeader, `Bearer ${sweepSecret}`))) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  let maintenanceRequest: { org_id: string; after_id: string | null } | null = null;
  // `{"mode":"full"}` (behind the same sweep secret) forces the hourly work on this tick — for an
  // operator or a test that cannot wait for the hour. The cron keeps posting `{}`.
  let forceFull = false;
  const requestBody = await req.text();
  if (requestBody.trim()) {
    let payload: unknown;
    try { payload = JSON.parse(requestBody); } catch { return json({ error: 'INVALID_REQUEST' }, 400); }
    const object = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown> : null;
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    // The pg_cron tick (erpnext_sweep_tick) posts `{}` — an empty object is the normal sweep, not a maintenance request.
    if (object && Object.keys(object).length === 1 && object.mode === 'full') {
      forceFull = true;
    } else if (!(object && Object.keys(object).length === 0)) {
      if (!object || object.mode !== 'repair-invoice-projects' || typeof object.org_id !== 'string'
          || !uuid.test(object.org_id) || !(object.after_id === null || (typeof object.after_id === 'string' && uuid.test(object.after_id)))) {
        return json({ error: 'INVALID_REQUEST' }, 400);
      }
      maintenanceRequest = { org_id: object.org_id, after_id: object.after_id as string | null };
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }, 500);
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as SupabaseClient;

  // #916: the whole invocation shares ONE elapsed-time budget for the doctype walk, stamped HERE (the
  // env-int reader is the sanctioned "clock/env read" DI — a missing/invalid value falls back).
  const tickStartMs = Date.now();
  const envPositiveInt = (name: string, fallback: number): number => {
    const raw = Deno.env.get(name);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const tickBudget = {
    tickStartMs,
    tickMaxDocs: envPositiveInt(SWEEP_TICK_MAX_DOCS_ENV, SWEEP_TICK_MAX_DOCS),
    tickTimeBudgetMs: envPositiveInt(SWEEP_TICK_TIME_BUDGET_MS_ENV, SWEEP_TICK_TIME_BUDGET_MS),
  };

  // #651 / FR-ENA-019: ONE credential resolution per ORG per TICK. The cache is created HERE, inside the
  // request/tick scope, and shared by every pass that resolves a pair — never module-level, so a shared
  // isolate never holds one tenant's credential across ticks and a rotated credential never outlives the
  // tick (ADR-0072 decision 5).
  const erpAuth = createErpAuthPairCache();

  if (maintenanceRequest) {
    const orgs = await listEmployingOrgsLive(serviceClient);
    const org = orgs.find((candidate) => candidate.orgId === maintenanceRequest!.org_id);
    if (!org || !org.ownedDomains.includes('revenue')) return json({ error: 'ORG_NOT_ELIGIBLE' }, 404);
    const result = await repairInvoiceProjectsLive(serviceClient, org, maintenanceRequest.after_id, erpAuth);
    return json({ ok: result.failedIds.length === 0, ...result });
  }

  // #1212 keeps the expensive inbound/statement work hourly; the owner ruling of 2026-10-23 keeps the
  // outbound money passes on every tick. A tick between the hourly windows is `money-only`, never a skip.
  if (forceFull) console.info('[erpnext-sweep] full run requested explicitly ({"mode":"full"})');
  const cadence: ErpSweepCadence = forceFull
    ? 'full'
    : await sweepCadenceAt(handlerEntryMs, () => allActiveBindingsHavePublishedStatementGeneration(serviceClient));

  const listCandidates = listCandidatesLive(serviceClient);
  const cycle = await runErpSweepCycle({
    listEmployingOrgs: () => listEmployingOrgsLive(serviceClient),
    claimStatementLock: async (orgId, holder) => {
      const { data, error } = await serviceClient.rpc('claim_erp_sweep_lock', {
        p_org_id: orgId, p_holder: holder, p_ttl: `${STATEMENT_SWEEP_LOCK_TTL_MS} milliseconds`,
      });
      if (error) throw new Error(`statement lock claim failed: ${error.code ?? 'unknown'}`);
      return data === true;
    },
    releaseStatementLock: async (orgId, holder) => {
      const { error } = await serviceClient.rpc('release_erp_sweep_lock', { p_org_id: orgId, p_holder: holder });
      if (error) throw new Error(`statement lock release failed: ${error.code ?? 'unknown'}`);
    },
    planChangeDrivenStatements: async (org) => {
      // Feature off ⇒ today's path (which returns {} for a switched-off module).
      if (featureDisabled(org, 'financial_statements')) return { kind: 'legacy' };
      return await planChangeDrivenStatements(
        serviceClient as unknown as ChangeDrivenService, org, () => erpClientForBinding(serviceClient, org, erpAuth), Date.now(),
      );
    },
    settleChangeDrivenStatements: (org, run, result) =>
      settleChangeDrivenRun(serviceClient as unknown as ChangeDrivenService, org, run, result),
    refreshNativeStatements: async (org, opts) => {
      // Recheck after the org lease: another invocation may have completed since the candidate read.
      // A change-driven run was admitted by the DB (nightly/intent/first publication), so it bypasses the hourly marker.
      if (!forceFull && !opts?.bypassMarker) {
        const { data, error } = await serviceClient.from('erp_statement_pass_run')
          .select('completed_at').eq('org_id', org.orgId).maybeSingle();
        if (error) throw new Error('statement marker read failed');
        if (!statementPassDue(data?.completed_at, Date.now())) return {};
      }
      // 0534: financial statements switched off ⇒ the statement pass does not run. The read RPC stays
      // open (FR-PLN-006 gates writes/jobs; published statements remain readable).
      if (featureDisabled(org, 'financial_statements')) return {};
      const rawProjectMap = org.config.project_map;
      const context = nativeStatementBindingContext({
        orgId: org.orgId,
        bindingId: org.bindingId,
        activatedAt: org.activatedAt,
        versionMajor: org.versionMajor,
        company: org.company,
        projectMap: rawProjectMap === undefined ? {} : rawProjectMap,
      });
      if (!context || !org.statementLockHolder) {
        return { errorCode: 'native-context-unavailable' };
      }
      try {
        const client = await erpClientForBinding(serviceClient, org, erpAuth);
        const remainingTickBudgetMs = Math.max(0, tickBudget.tickTimeBudgetMs - (Date.now() - tickBudget.tickStartMs));
        const result = await refreshStatementReportBatch({
          orgId: org.orgId,
          holder: org.statementLockHolder,
          binding: {
            id: context.bindingId,
            activatedAt: context.activatedAt,
            versionMajor: context.versionMajor,
            company: context.company,
            projectMap: context.projectMap,
          },
          client,
          service: serviceClient as unknown as StatementReportBatchService,
          remainingTickBudgetMs,
        });
        return { errorCode: result.errorCode, status: result.status, snapshotId: result.snapshotId };
      } catch {
        return { errorCode: 'native-refresh-failed', status: 'failed' as const };
      }
    },
    reconcileOrgOutbox: (org) => reconcileOrgOutbox(listCandidates, org, (row) => buildReconcileDepsLive(serviceClient, org, row, erpAuth)),
    sweepOrgDoctypes: (org) => sweepOrgDoctypesLive(serviceClient, org, erpAuth, tickBudget),
    repairOrgLinks: (org) => repairOrgLinksLive(serviceClient, org, erpAuth),
    feedOrgLedgers: (org) => feedOrgLedgersLive(serviceClient, org, erpAuth),
    feedOrgPurchases: (org) =>
      // 0534: the read-only ERP purchases feed is the erp_purchases module's job.
      featureDisabled(org, 'erp_purchases') ? Promise.resolve({ fed: 0 }) : feedOrgPurchasesLive(serviceClient, org, erpAuth),
    refreshOrgAccounting: (org) => refreshOrgAccountingLive(serviceClient, org, erpAuth),
    reconcileOrgBudgetPushes: (org) => reconcileOrgBudgetPushesLive(serviceClient, org, erpAuth),
    reconcileOrgTimesheetPushes: (org) => reconcileOrgTimesheetPushesLive(serviceClient, org),
    reconcileOrgExpensePostings: (org) => reconcileOrgExpensePostingsLive(serviceClient, org, erpAuth),
    nowMs: Date.now,
    hourlyDeadlineAtMs: handlerEntryMs + HOURLY_INVOCATION_DEADLINE_MS,
    deferFullSweep: async (org, dueInSeconds) => {
      if (!org.statementLockHolder) throw new Error('no sweep lock held');
      const { data, error } = await serviceClient.rpc('defer_erp_full_sweep', { p_org_id: org.orgId, p_holder: org.statementLockHolder, p_due_in_seconds: dueInSeconds });
      if (error) throw new Error(`full-run defer failed: ${error.code ?? 'unknown'}`);
      if (data !== true) throw new Error('the sweep lock lapsed before the full run was deferred');
    },
    reconcileOrgImprestPostings: (org) => reconcileOrgImprestPostingsLive(serviceClient, org, erpAuth),
    advanceConnectRun: (org) => advanceConnectRuns(serviceClient, org),
    drainConnectSends: (org) => drainConnectSends(serviceClient, org),
    isFullSweepDue: (org) => fullSweepDue(org.lastFullSweepAt, handlerEntryMs),
    // 0642: the statement pass has its own hourly marker; an explicit full-mode request bypasses it.
    isStatementPassDue: (org) => statementPassDue(org.lastStatementPassAt, handlerEntryMs),
    forceStatementPass: forceFull,
    markStatementPassDone: async (org) => {
      if (!org.statementLockHolder) throw new Error('no sweep lock held');
      const { data, error } = await serviceClient.rpc('mark_erp_statement_pass_done', { p_org_id: org.orgId, p_holder: org.statementLockHolder });
      if (error) throw new Error(`statement-pass stamp failed: ${error.code ?? 'unknown'}`);
      if (data !== true) throw new Error('the sweep lock lapsed before the statement pass was stamped');
    },
    deferStatementPass: async (org, dueInSeconds) => {
      if (!org.statementLockHolder) throw new Error('no sweep lock held');
      const { data, error } = await serviceClient.rpc('defer_erp_statement_pass', {
        p_org_id: org.orgId, p_holder: org.statementLockHolder, p_due_in_seconds: dueInSeconds,
      });
      if (error) throw new Error(`statement-pass defer failed: ${error.code ?? 'unknown'}`);
      if (data !== true) throw new Error('the sweep lock lapsed before the statement pass was deferred');
    },
    markFullSweepDone: async (org) => {
      if (!org.statementLockHolder) throw new Error('no sweep lock held');
      const { data, error } = await serviceClient.rpc('mark_erp_full_sweep_done', { p_org_id: org.orgId, p_holder: org.statementLockHolder });
      if (error) throw new Error(`full-run stamp failed: ${error.code ?? 'unknown'}`);
      if (data !== true) throw new Error('the sweep lock lapsed before the full run was stamped');
    },
  }, erpAuth, cadence);
  return json({ ok: true, cadence: tickCadenceSummary(cadence, cycle), ...cycle });
}, { summarize: summarizeErpSweep }));
