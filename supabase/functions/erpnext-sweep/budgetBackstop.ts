/**
 * erpnext-sweep/budgetBackstop.ts (P3c slice 5, FR-BUD-102/141/142, ADR-0059 §5/§6) — the
 * SECOND originator of the budget push (the sweep) + the budget domain's inbound never-adopt /
 * never-fight-the-operator rules.
 *
 * Pure orchestration over injected deps (Deno- AND Vitest-importable, like `budgetGate.ts`) — no
 * `Deno.*`/`supabase-js` symbol crosses this file. `index.ts` wires the LIVE deps
 * (`reconcileOrgBudgetPushesLive`) the same way it wires every other `*Live` pass.
 *
 * ⚑ THE THREE INVARIANTS THIS FILE ENFORCES (ADR-0059 §5/§6 — see the plan's slice-5 header):
 *  1. `reconcileOrgBudgetPushes` re-asserts the gate from DB truth and NEVER "trusts itself" because
 *     it is the sweep (FR-BUD-102) — a version that is no longer `Active` is never pushed, and nothing
 *     is ever finalized without a resolvable authority for the push.
 *  2. `applyBudgetFeedEvent` NEVER adopts a Desk-created ERP `Budget` (FR-BUD-140) — no
 *     `external_refs` mapping ⇒ ack-and-skip + action-required; NOTHING is minted into
 *     `budget_versions`/`budget_line_items` (PMO is the SoT for the budget figure, OD-BUDGET-1). This
 *     is the deliberate INVERSE of P3a's FR-SAR-085 revenue adopt rule.
 *  3. `applyBudgetFeedEvent` NEVER re-pushes an externally-cancelled `Budget` (FR-BUD-142,
 *     never-fight-the-operator) — a `docstatus: 2` on a mapped budget tombstones the mirror
 *     (`erp_cancelled_at`/`erp_docstatus`), reopens `push_state='failed'`, surfaces action-required,
 *     and leaves the PMO version `Active` (PMO's budget is not ERP's to revoke). The tombstone ALSO
 *     excludes the row from (1)'s candidate list forever — the backstop must not instantly re-create
 *     what a human just cancelled.
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
  for (const row of candidates) {
    const version = await deps.readBudgetVersion(row.budget_version_id);
    // FR-BUD-102: re-assert the gate from DB truth — never trust the mirror row's own state, and
    // never drive a version that is no longer Active (or has no activation stamp at all).
    if (!version || version.status !== 'Active' || !version.activated_at) {
      skipped += 1;
      continue;
    }
    await deps.driveBudgetPush(row, version);
    driven += 1;
  }
  return { driven, skipped };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// (2)+(3) Inbound: lifecycle-only, NEVER adopt, NEVER fight the operator (ADR-0059 §5).
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** The lifecycle fields the inbound feed reads off an ERP `Budget` doc (name/docstatus/modified —
 *  Luna BLOCK 6's per-kind field-list idiom; `bodies/budget.ts` owns the full field list for the
 *  outbound body/canonical, this is the narrow slice the inbound lifecycle-only path needs). */
export interface BudgetFeedDoc {
  name: string;
  docstatus: number;
  modified: string;
}

export interface ApplyBudgetFeedResult {
  acked: boolean;
  actionRequired: boolean;
}

export interface BudgetFeedDeps {
  /** Resolve the `external_refs` mapping (domain `'budget'`) for this ERP `Budget` name → the PMO
   *  `budget_version_id`, or `null` when this Budget was never pushed by PMO (created natively). */
  findMappedVersionId(erpBudgetName: string): Promise<string | null>;
  /** FR-BUD-140 — ack-and-skip a Desk-created Budget: surface action-required, mint NOTHING. */
  ackNeverAdopted(erpBudgetName: string): Promise<void>;
  /** FR-BUD-142 — tombstone the mirror for an externally-CANCELLED, PMO-mapped Budget:
   *  `erp_cancelled_at`/`erp_docstatus` stamped, `push_state` reopened to `'failed'`, action-required
   *  surfaced. Never touches `budget_versions` — PMO's version stays `Active`. */
  tombstoneCancel(versionId: string, doc: BudgetFeedDoc): Promise<void>;
  /** A non-cancel lifecycle event on a mapped Budget (e.g. a Desk edit, or a plain re-fetch) —
   *  stamp the lifecycle columns only. Never a PMO SoT write. */
  updateLifecycle(versionId: string, doc: BudgetFeedDoc): Promise<void>;
}

/**
 * Apply ONE inbound ERP `Budget` feed event (webhook or sweep poll). ADR-0059 §5: lifecycle-only for a
 * PMO-originated budget, and an unmapped (Desk-created) one is NEVER adopted — the deliberate INVERSE
 * of P3a's revenue adopt rule (FR-SAR-085): there ERP is SoT and adoption is correct; here PMO is SoT
 * (OD-BUDGET-1) and adopting an ERP-native Budget would mint a figure that never passed PMO's
 * activation authority.
 */
export async function applyBudgetFeedEvent(
  deps: BudgetFeedDeps,
  _org: { orgId: string },
  doc: BudgetFeedDoc,
): Promise<ApplyBudgetFeedResult> {
  const versionId = await deps.findMappedVersionId(doc.name);
  if (!versionId) {
    // FR-BUD-140: no PMO version ever claimed this ERP Budget — it was created directly in the Desk.
    // Ack-and-skip: NOTHING is minted into budget_versions/budget_line_items.
    await deps.ackNeverAdopted(doc.name);
    return { acked: true, actionRequired: true };
  }
  if (doc.docstatus === 2) {
    // FR-BUD-142: a human cancelled the ERP object PMO pushed. Tombstone + surface — never re-push
    // (that would instantly re-create what the operator just cancelled), and PMO's version is
    // untouched: PMO's budget is not ERP's to revoke.
    await deps.tombstoneCancel(versionId, doc);
    return { acked: true, actionRequired: true };
  }
  await deps.updateLifecycle(versionId, doc);
  return { acked: true, actionRequired: false };
}
