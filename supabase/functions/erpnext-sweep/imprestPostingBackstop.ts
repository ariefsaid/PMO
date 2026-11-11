/**
 * erpnext-sweep/imprestPostingBackstop.ts (#1515 S6) — the originator of site-float transfers, the SAME orchestration as
 * the expense pass (replay an existing outbox row by key; else gate, resolve, drive; per-row containment; round robin)
 * over `imprest_posting_erp_mirror`. Reuses `reconcileOrgExpensePostings` rather than copying it: only the row, the gate
 * truth and the refs differ. Pure; wired live by index.ts (`imprestPostingBackstopDepsLive`).
 */
import type { ImprestGateTruth, ImprestResolvedRefs } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/imprestPostingCommand.ts';
import { reconcileOrgExpensePostings, type ExpenseBackstopDeps, type ReconcileOrgExpensePostingsResult } from './expensePostingBackstop.ts';

export { EXPENSE_BACKSTOP_TICK_LIMIT as IMPREST_BACKSTOP_TICK_LIMIT } from './expensePostingBackstop.ts';
export type { ImprestGateTruth, ImprestResolvedRefs };

export interface ImprestIntentRow {
  id: string;
  posting_identity: string;
  replenishment_id: string;
  state_stamp: string;
  push_state: string;
  push_error: string | null;
  attempt_count?: number;
}

export type ImprestBackstopDeps = ExpenseBackstopDeps<ImprestIntentRow, ImprestGateTruth, ImprestResolvedRefs>;

export const reconcileOrgImprestPostings = (deps: ImprestBackstopDeps, org: { orgId: string }): Promise<ReconcileOrgExpensePostingsResult> =>
  reconcileOrgExpensePostings(deps, org);
