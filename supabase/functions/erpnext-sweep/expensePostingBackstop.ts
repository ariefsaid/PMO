/**
 * erpnext-sweep/expensePostingBackstop.ts (#775 phase B, ADR-0081) — the ONLY originator of expense postings.
 * Pure orchestration over injected deps (Deno- and Vitest-importable; no Deno/supabase-js symbol here), wired
 * live by index.ts (`expensePostingBackstopDepsLive`), the timesheetBackstop.ts shape.
 *
 * First, finish every posting stranded between its mirror write and its outbox confirm (intent `pushed`, outbox
 * `committed`): pass (1) skips the expenses domain and the intent queue below never lists a pushed intent, so nothing
 * else would — and while it stays unfinished, 0134 refuses the next command for the same record (the cancel).
 *
 * Then per intent, least recently attempted first (round robin — the whole batch is stamped before any is processed,
 * so stuck intents cannot starve new ones behind the per-tick bound):
 *  1. an outbox row already exists for its key → REPLAY it from the frozen payload (the outbox owns recovery;
 *     re-deciding could change a body whose digest is already bound — idempotency-key-payload-mismatch);
 *  2. else re-assert the DB gate (status, stamp, recorded actor's CURRENT standing) — refusal = failed (an approval
 *     whose claim was cancelled first = held: it never posts, so it is not retried);
 *  3. resolve references — refuse = failed; wait = untouched; already-done = pushed;
 *  4. drive a fresh command through dispatchMoneyWrite.
 * NEW-3 per-row containment: a throw is recorded on the intent as failed (still retried) and the queue still drains.
 * What is never re-driven (pushed, held, ERP-cancelled) is excluded by the live listPending QUERY.
 */
import type { ExpenseGateTruth, ExpenseResolvedRefs } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingCommand.ts';
import type { ExpenseResolution } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/expensePostingResolve.ts';

/** NFR-EXP-013 — bounded per org per tick (index-served), equal to the timesheet/budget twins. */
export const EXPENSE_BACKSTOP_TICK_LIMIT = 200;

/** The gate's refusal for an approval whose claim was cancelled before it posted (0270 §5) — terminal. */
export const EXPENSE_CLAIM_CANCELLED_REFUSAL = 'expense-posting-claim-cancelled';

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
  /** Stamp the listed intents' last attempt (the round-robin order of `listPending`). */
  markAttempted(orgId: string, intentIds: string[]): Promise<void>;
  /** Outbox commands left `committed` whose intent is already `pushed` — finished by a finalize-only replay. */
  listStranded(orgId: string): Promise<Array<{ row: ExpenseIntentRow; outbox: ExpenseOutboxRef }>>;
}

export interface ReconcileOrgExpensePostingsResult {
  /** Stranded postings finished (their outbox confirmed). */
  finished: number;
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
  const result: ReconcileOrgExpensePostingsResult = { finished: 0, driven: 0, replayed: 0, waiting: 0, refused: 0, errors: [] };
  for (const { row, outbox } of await deps.listStranded(org.orgId)) {
    try {
      await deps.replay(row, outbox);
      result.finished += 1;
    } catch (err) {
      // The intent is already pushed: nothing to record on it; the next tick retries the finalize.
      result.errors.push({ intentId: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const rows = await deps.listPending(org.orgId, EXPENSE_BACKSTOP_TICK_LIMIT);
  if (rows.length > 0) await deps.markAttempted(org.orgId, rows.map((r) => r.id));
  for (const row of rows) {
    try {
      const outbox = await deps.findOutbox(row);
      if (outbox) {
        await deps.replay(row, outbox);
        result.replayed += 1;
        continue;
      }
      const gate = await deps.assertGate(row);
      if (!gate.ok) {
        await deps.recordOutcome(row, { state: gate.reason === EXPENSE_CLAIM_CANCELLED_REFUSAL ? 'held' : 'failed', reason: gate.reason });
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
      const reason = err instanceof Error ? err.message : String(err);
      result.errors.push({ intentId: row.id, error: reason });
      try {
        await deps.recordOutcome(row, { state: 'failed', reason });
      } catch {
        // Recording is best-effort here: the error is already counted and the intent stays in the queue.
      }
    }
  }
  return result;
}
