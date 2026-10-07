/**
 * erpnext-sweep/expensePostingBackstop.ts (#775 phase B, ADR-0081) — the ONLY originator of expense postings.
 * Pure orchestration over injected deps (Deno- and Vitest-importable; no Deno/supabase-js symbol here), wired
 * live by index.ts (`expensePostingBackstopDepsLive`), the timesheetBackstop.ts shape.
 *
 * Per intent, oldest first:
 *  1. an outbox row already exists for its key → REPLAY it from the frozen payload (the outbox owns recovery;
 *     re-deciding could change a body whose digest is already bound — idempotency-key-payload-mismatch);
 *  2. else re-assert the DB gate (status, stamp, recorded actor's CURRENT standing) — refusal = failed;
 *  3. resolve references — refuse = failed; wait = untouched; already-done = pushed;
 *  4. drive a fresh command through dispatchMoneyWrite.
 * NEW-3 per-row containment: a throw is recorded and the rest of the queue still drains.
 * What is never re-driven (pushed, held, ERP-cancelled) is excluded by the live listPending QUERY.
 */
import type { ExpenseGateTruth, ExpenseResolvedRefs } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingCommand.ts';
import type { ExpenseResolution } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingResolve.ts';

/** NFR-EXP-013 — bounded per org per tick (index-served), equal to the timesheet/budget twins. */
export const EXPENSE_BACKSTOP_TICK_LIMIT = 200;

export interface ExpenseIntentRow {
  id: string;
  posting: string;
  posting_identity: string;
  claim_id: string;
  return_id: string | null;
  state_stamp: string;
  push_state: string;
  push_error: string | null;
}

export interface ExpenseOutboxRef {
  id: string;
  state: string;
}

export type ExpenseGateOutcome = { ok: true; truth: ExpenseGateTruth } | { ok: false; reason: string };

export interface ExpenseOutcome {
  state: 'failed' | 'held' | 'pushed';
  reason: string | null;
  erpName?: string | null;
}

export interface ExpenseBackstopDeps {
  listPending(orgId: string, limit: number): Promise<ExpenseIntentRow[]>;
  findOutbox(row: ExpenseIntentRow): Promise<ExpenseOutboxRef | null>;
  replay(row: ExpenseIntentRow, outbox: ExpenseOutboxRef): Promise<void>;
  assertGate(row: ExpenseIntentRow): Promise<ExpenseGateOutcome>;
  resolve(truth: ExpenseGateTruth): Promise<ExpenseResolution>;
  recordOutcome(row: ExpenseIntentRow, outcome: ExpenseOutcome): Promise<void>;
  driveFresh(row: ExpenseIntentRow, truth: ExpenseGateTruth, refs: ExpenseResolvedRefs): Promise<void>;
}

export interface ReconcileOrgExpensePostingsResult {
  driven: number;
  replayed: number;
  waiting: number;
  refused: number;
  errors: Array<{ intentId: string; error: string }>;
}

export async function reconcileOrgExpensePostings(
  deps: ExpenseBackstopDeps,
  org: { orgId: string },
): Promise<ReconcileOrgExpensePostingsResult> {
  const result: ReconcileOrgExpensePostingsResult = { driven: 0, replayed: 0, waiting: 0, refused: 0, errors: [] };
  for (const row of await deps.listPending(org.orgId, EXPENSE_BACKSTOP_TICK_LIMIT)) {
    try {
      const outbox = await deps.findOutbox(row);
      if (outbox) {
        await deps.replay(row, outbox);
        result.replayed += 1;
        continue;
      }
      const gate = await deps.assertGate(row);
      if (!gate.ok) {
        await deps.recordOutcome(row, { state: 'failed', reason: gate.reason });
        result.refused += 1;
        continue;
      }
      const resolution = await deps.resolve(gate.truth);
      if (resolution.outcome === 'wait') {
        result.waiting += 1;
        continue;
      }
      if (resolution.outcome === 'refuse') {
        await deps.recordOutcome(row, { state: 'failed', reason: `${resolution.code}: ${resolution.message}` });
        result.refused += 1;
        continue;
      }
      if (resolution.outcome === 'already-done') {
        await deps.recordOutcome(row, { state: 'pushed', reason: null, erpName: resolution.erpName });
        continue;
      }
      await deps.driveFresh(row, gate.truth, resolution.refs);
      result.driven += 1;
    } catch (err) {
      result.errors.push({ intentId: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
