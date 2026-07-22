/**
 * erpnext-sweep/budgetBackstop.ts (P3c slice 5, FR-BUD-102/141, ADR-0059 §6) — the SECOND originator
 * of the budget push (the sweep).
 *
 * Pure orchestration over injected deps (Deno- AND Vitest-importable, like `budgetGate.ts`) — no
 * `Deno.*`/`supabase-js` symbol crosses this file. `index.ts` wires the LIVE deps
 * (`reconcileOrgBudgetPushesLive`) the same way it wires every other `*Live` pass.
 *
 * ⚑ THE INVARIANT THIS FILE ENFORCES (ADR-0059 §6 — see the plan's slice-5 header):
 *  1. `reconcileOrgBudgetPushes` re-asserts the gate from DB truth and NEVER "trusts itself" because
 *     it is the sweep (FR-BUD-102) — a version that is no longer `Active` is never pushed, and nothing
 *     is ever finalized without a resolvable authority for the push.
 *
 * ⛑ MEDIUM-E (Luna re-audit round 2, 2026-07-21) — the inbound half of this module was DELETED.
 * `applyBudgetFeedEvent`/`BudgetFeedDeps` were called by NOTHING in production: both inbound paths
 * (the sweep's `runSweep`, the webhook) route budget through the generic `applyErpFeedEvent` +
 * `createErpFeedDeps('budget')`. AC-BUD-040 (never adopt, FR-BUD-140) and AC-BUD-041 (never fight the
 * operator, FR-BUD-142) are therefore owned by `supabase/functions/_shared/erpnextFeedDeps.test.ts`,
 * against the code that actually runs — keeping both was how HIGH-A's sweep wedge and MEDIUM-G's
 * tombstone clear stayed invisible to two passing "proofs".
 */

// ────────────────────────────────────────────────────────────────────────────────────────────────
// (1) The sweep backstop — originator 2 of the budget push (FR-BUD-141).
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** FR-BUD-123: the mirror's work queue is bounded per tick (index-served on `(org_id, push_state)`)
 *  so one org's backlog cannot starve another's — the shipped resilience contract every other pass
 *  in this file already follows. */
export const BUDGET_BACKSTOP_TICK_LIMIT = 200;

/** The re-asserted state of the version the mirror row is pushing (FR-BUD-102 — read fresh, never
 *  trusted from the mirror row itself or from any payload). */
export interface BudgetBackstopVersionRow {
  id: string;
  status: string;
  /** The ADR-0059 §4 state stamp. `null` ⇒ never activated — never a push candidate. */
  activated_at: string | null;
}

/** One row of the mirror's own work queue (FR-BUD-123). */
export interface BudgetMirrorCandidateRow {
  budget_version_id: string;
  push_state: string;
  erp_cancelled_at?: string | null;
  /**
   * ⚑ LOW-1 (audit round 6) — the grain's fiscal year. Present for a real mirror row (it is the row's
   * own key); for an outbox-only `absent` orphan it is whatever the outbox canonical states, and
   * `null`/absent when even that does not say. It is carried because `budget_version_erp_mirror.
   * fiscal_year` is `NOT NULL` — a hold that omits it raises 23502 rather than recording anything —
   * and it is never DERIVED, because since HIGH-1 that column is the authority the budget projection
   * scopes PMO's budget column by: a guessed year here becomes a wrong-year figure on the money screen.
   */
  fiscal_year?: string | null;
}

export interface BudgetBackstopDeps {
  /** The org's ELIGIBLE mirror rows: `push_state in ('pending','failed')` and NOT tombstoned
   *  (`erp_cancelled_at is null` — FR-BUD-142's exclusion), bounded to `limit`. `pushed`/`held` rows
   *  and any tombstoned row are NEVER returned here — FR-BUD-123's "never re-driven" + FR-BUD-142's
   *  "never fight the operator" both live in what this query excludes, not in extra logic per-row. */
  listPendingBudgetPushes(orgId: string, limit: number): Promise<BudgetMirrorCandidateRow[]>;
  /** Re-read the version's OWN state under service-role (the sweep carries no user JWT — FR-BUD-102).
   *  `null` ⇒ not readable at all. Never trust the mirror row's `push_state` as authorization. */
  readBudgetVersion(versionId: string): Promise<BudgetBackstopVersionRow | null>;
  /** Drive the still-Active version through the SAME dispatch path the foreground activation
   *  consequence uses (FR-BUD-141) — derives the SAME deterministic key (`budgetPushKey`), so a
   *  candidate already queued/committed by the foreground path is RECONCILED (the ADR-0058 fenced
   *  outbox's own 23505 collision), never duplicated. Resolves (or marks `held` + surfaces
   *  action-required, never silently drops) when there is nothing resolvable to finalize with. */
  driveBudgetPush(row: BudgetMirrorCandidateRow, version: BudgetBackstopVersionRow): Promise<void>;
}

export interface ReconcileOrgBudgetPushesResult {
  /** Rows actually driven through the dispatch path this tick. */
  driven: number;
  /** Rows whose re-asserted gate refused the push (the version is no longer `Active`, or unreadable) —
   *  left exactly as they are; an operator (or a later re-activation) resolves them, never this pass. */
  skipped: number;
  /** NEW-3: rows that THREW. Recorded per-row so one failure cannot abandon the queue (a pre-claim
   *  throw never bumps `attempt_count`, and `created_at ASC` would put it first again every tick —
   *  disabling the org's whole automatic budget recovery). Surfaced by the caller, never swallowed. */
  errors: Array<{ budgetVersionId: string; error: string }>;
}

/**
 * The sweep backstop pass (AC-BUD-023). For each of the org's eligible mirror rows, re-assert the
 * SAME precondition the foreground path's gate enforces — the version is STILL `Active` and carries
 * its activation stamp — from DB truth, before driving anything. A row whose version has moved on
 * (archived, superseded by a later activation) is left untouched: it is not this pass's job to decide
 * what should have happened, only to never act on stale authority.
 */
export async function reconcileOrgBudgetPushes(
  deps: BudgetBackstopDeps,
  org: { orgId: string },
): Promise<ReconcileOrgBudgetPushesResult> {
  const candidates = await deps.listPendingBudgetPushes(org.orgId, BUDGET_BACKSTOP_TICK_LIMIT);
  let driven = 0;
  let skipped = 0;
  const errors: Array<{ budgetVersionId: string; error: string }> = [];
  for (const row of candidates) {
    // ⚑ NEW-3 (audit r4) — PER-ROW containment, the same rule `reconcileOrgOutbox` already applies and
    // the same class as HIGH-A (one bad row wedging a whole pass). Without it, a row that throws BEFORE
    // any outbox claim (e.g. its recorded actor was deactivated, so re-authorization refuses) never
    // bumps `attempt_count` — and because the queue is ordered `created_at ASC` it is FIRST again on
    // every tick, so the org's entire automatic budget recovery stays off until a human intervenes.
    // Record and continue: the row is surfaced, the rest of the queue still drains.
    try {
      const version = await deps.readBudgetVersion(row.budget_version_id);
      // FR-BUD-102: re-assert the gate from DB truth — never trust the mirror row's own state, and
      // never drive a version that is no longer Active (or has no activation stamp at all).
      if (!version || version.status !== 'Active' || !version.activated_at) {
        skipped += 1;
        continue;
      }
      await deps.driveBudgetPush(row, version);
      driven += 1;
    } catch (err) {
      errors.push({ budgetVersionId: row.budget_version_id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { driven, skipped, errors };
}
