import type { OdooLedgerHealth, OdooLedgerState, OdooStatementProvenance } from '@/src/lib/db/odooLedger';

const STALE_AFTER_MS = 30 * 60 * 1000;

/** The ledger's state as the statement can know it: not caught up, older than 30 minutes, or fine. */
export function statementLedgerState(p: OdooStatementProvenance, now = Date.now()): OdooLedgerState {
  if (p.caughtUp === false) return 'catching-up';
  const at = p.ledgerAsOf ? Date.parse(p.ledgerAsOf) : NaN;
  return Number.isNaN(at) || now - at > STALE_AFTER_MS ? 'stale' : 'fresh';
}

export type SwitchBlocker = 'catching-up' | 'not-checked' | 'check-stale' | null;

/** Why a switch would be refused right now, in the order the database checks. `differs` is not a blocker: an Admin may explain it. */
export function switchBlocker(h: OdooLedgerHealth): SwitchBlocker {
  if (!h.caughtUp) return 'catching-up';
  if (!h.check || h.check.status === 'not-checked') return 'not-checked';
  if (h.check.stale) return 'check-stale';
  return null;
}

