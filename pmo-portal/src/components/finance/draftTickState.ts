import type { BudgetActivationMode } from '@/src/lib/db/budgets';
import type { BudgetActivationPrecheckResult } from '@/src/lib/budget/budgetGate';

/** #1273 — what lets one draft be ticked. Mirrors the Budget tab (`useBudgetReadiness`): the server's activation mode
 *  allows it, `can()` agrees (UX only; `activate_budget_version` decides), and the readiness precheck has settled unblocked. */
export function draftTickState(args: {
  mode: BudgetActivationMode | undefined;
  precheck: BudgetActivationPrecheckResult | undefined;
  canTransition: boolean;
}): 'ready' | 'checking' | 'unmapped' | 'blocked' | 'not-allowed' {
  const { mode, precheck, canTransition } = args;
  if (mode === undefined || precheck === undefined) return 'checking';
  const modeAllows = mode === 'allowed' || mode === 'sole_operator';
  if (!modeAllows || (mode !== 'sole_operator' && !canTransition)) return 'not-allowed';
  if (precheck.issues.some((i) => i.code === 'budget-category-unmapped')) return 'unmapped';
  if (precheck.status === 'blocked') return 'blocked';
  return 'ready';
}
