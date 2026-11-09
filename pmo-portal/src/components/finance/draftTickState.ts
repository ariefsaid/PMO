import type { BudgetActivationMode } from '@/src/lib/db/budgets';
import type { BudgetActivationPrecheckResult } from '@/src/lib/budget/budgetGate';
import type { DistributionReadinessStatus } from '@/src/lib/budget/savedDistribution';

export type DraftTickState =
  | 'ready' | 'unchecked' | 'checking' | 'check-failed' | 'unmapped' | 'blocked' | 'not-allowed'
  | 'blocked-editor' | 'needs-admin-finance' | 'eligibility-unavailable'
  | 'distribution-missing' | 'distribution-stale';

/** #1273 — what lets one draft be ticked. Mirrors the Budget tab (`useBudgetReadiness`): the server's activation mode
 *  allows it, `can()` agrees (UX only; `activate_budget_version` decides), the readiness precheck has settled unblocked,
 *  and a whole-project draft's saved distribution is current (`distribution`, the tab's own status). */
export function draftTickState(args: {
  mode: BudgetActivationMode | undefined;
  precheck: BudgetActivationPrecheckResult | undefined;
  canTransition: boolean;
  /** The row's readiness reads have not been requested yet (outside the checked window). */
  unchecked?: boolean;
  /** A readiness or eligibility read failed: never tickable, never left as "Checking…". */
  checkFailed?: boolean;
  /** Whole-project drafts only; anything else is `current`. */
  distribution?: DistributionReadinessStatus;
}): DraftTickState {
  const { mode, precheck, canTransition, unchecked, checkFailed, distribution = 'current' } = args;
  if (unchecked) return 'unchecked';
  if (checkFailed || distribution === 'error') return 'check-failed';
  if (mode === undefined || precheck === undefined || distribution === 'loading') return 'checking';
  if (mode === 'blocked_editor') return 'blocked-editor';
  if (mode === 'blocked_no_drafter') return 'needs-admin-finance';
  if (mode === 'blocked') return 'eligibility-unavailable';
  if (mode !== 'sole_operator' && !canTransition) return 'not-allowed';
  if (precheck.issues.some((i) => i.code === 'budget-category-unmapped')) return 'unmapped';
  if (precheck.status === 'blocked') return 'blocked';
  if (distribution === 'absent') return 'distribution-missing';
  if (distribution !== 'current') return 'distribution-stale';
  return 'ready';
}
