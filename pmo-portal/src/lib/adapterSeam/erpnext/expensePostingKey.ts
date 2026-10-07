/**
 * #775 phase B (DD-EXP-14, ADR-0059 §4, ADR-0081) — the deterministic idempotency key and identities of an expense
 * posting. `<prefix>:<subject uuid>:<state stamp epoch ms>`: the sweep re-derives the same key on every tick, so a
 * re-run lands on the same outbox row and the same ERP anchor. The stamp is normalized to epoch ms exactly like the
 * budget key (`timestamptzEpochMs`). Shape passes the served opaque-key guard's `<prefix>:<uuid>:<stamp>` form.
 */
import { AdapterError } from '../contract.ts';
import { timestamptzEpochMs } from './budgetPushKey.ts';

export type ExpensePosting =
  | 'approval'
  | 'claim-payment'
  | 'settlement'
  | 'advance-payment'
  | 'advance-return'
  | 'approval-cancel';

export const EXPENSE_POSTING_KEY_PREFIX: Readonly<Record<ExpensePosting, string>> = {
  approval: 'expj',
  settlement: 'exps',
  'approval-cancel': 'expx',
  'claim-payment': 'expp',
  'advance-payment': 'expa',
  'advance-return': 'expr',
};

/** The keys a PMO-posted Journal Entry carries in `user_remark` (the sweep's poll admits only these). */
export const EXPENSE_JOURNAL_KEY_RE = /^exp[js]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4,20}$/;

export function expensePostingKey(posting: ExpensePosting, subjectId: string, stateStamp: string | null | undefined): string {
  if (!stateStamp) {
    throw new AdapterError('commit-rejected', `expense posting ${posting}: no state stamp — the key cannot be derived`);
  }
  const epochMs = timestamptzEpochMs(stateStamp);
  if (!Number.isFinite(epochMs)) {
    throw new AdapterError('commit-rejected', `expense posting ${posting}: unparseable state stamp "${stateStamp}"`);
  }
  return `${EXPENSE_POSTING_KEY_PREFIX[posting]}:${subjectId.toLowerCase()}:${epochMs}`;
}

/** The side mirror's identity for a posting (`expense_posting_erp_mirror.posting_identity`, 0270 §3 CHECK). */
export function expensePostingIdentity(posting: ExpensePosting, subjectId: string): string {
  return `${subjectId.toLowerCase()}:${posting}`;
}

/** The outbox / external_refs identity: a cancel acts on the approval Journal Entry's own identity. */
export function expenseOutboxIdentity(posting: ExpensePosting, subjectId: string): string {
  return expensePostingIdentity(posting === 'approval-cancel' ? 'approval' : posting, subjectId);
}
