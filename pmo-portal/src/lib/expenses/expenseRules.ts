import type { Role } from '@/src/auth/AuthContext';
import { mayDecideRoutedApproval, type ApprovalRoute } from '@/src/lib/procurement/approvalRoute';
import type { AgingBucket, ExpenseAdvanceAgingRow, ExpenseClaimRow } from '@/src/lib/db/expenseClaims';

/**
 * #775 — the FE projection of `transition_expense_claim` / `record_expense_advance_return` (0247 §7/§9).
 * UX ONLY (ADR-0016): the RPCs decide. Pure — no I/O, no React. Money is computed in integer cents.
 */
export type ExpenseAction = 'submit' | 'reopen' | 'approve' | 'reject' | 'pay' | 'cancel' | 'recordReturn';

/** `holds_spend_approval_authority`: rank ≥ Project Manager (ADR-0070). */
const APPROVAL_RANK: readonly Role[] = ['Admin', 'Executive', 'Finance', 'Project Manager'];
/** Pay, cancel an approved record, record a return. */
const FINANCE_OR_ADMIN: readonly Role[] = ['Admin', 'Finance'];

type RouteShape = Pick<ApprovalRoute, 'route' | 'approvers'>;

export interface ExpenseActionContext {
  claim: Pick<ExpenseClaimRow, 'kind' | 'status' | 'claimant_id' | 'approved_by_id'>;
  userId: string | null | undefined;
  realRole: Role | null | undefined;
  route?: RouteShape | null;
  /** The advance's own outstanding (only read for a paid advance). */
  advanceOutstanding?: number | null;
}

export function availableExpenseActions(ctx: ExpenseActionContext): ExpenseAction[] {
  const { claim, userId, realRole } = ctx;
  if (!userId || !realRole) return [];
  const out: ExpenseAction[] = [];
  const isClaimant = claim.claimant_id === userId;
  const isAdmin = realRole === 'Admin';
  const financeOrAdmin = FINANCE_OR_ADMIN.includes(realRole);
  const s = claim.status;
  if (s === 'Draft' && isClaimant) out.push('submit');
  if (s === 'Rejected' && isClaimant) out.push('reopen');
  if (s === 'Submitted' && !isClaimant && APPROVAL_RANK.includes(realRole) && mayDecideRoutedApproval(ctx.route, userId, isAdmin)) {
    out.push('approve', 'reject');
  }
  if (s === 'Approved' && financeOrAdmin && !isClaimant && claim.approved_by_id !== userId) out.push('pay');
  if (((s === 'Draft' || s === 'Submitted') && (isClaimant || financeOrAdmin)) || (s === 'Approved' && financeOrAdmin)) {
    out.push('cancel');
  }
  if (claim.kind === 'advance' && s === 'Paid' && financeOrAdmin && !isClaimant && (ctx.advanceOutstanding ?? 0) > 0) {
    out.push('recordReturn');
  }
  return out;
}

const toCents = (v: number): number => Math.round(v * 100);

/** DD-EXP-6 at payment: the advance pays first, the rest is cash. */
export function settlementPreview(amount: number, advanceOutstanding: number | null | undefined): { applied: number; cash: number } {
  const amountC = toCents(amount);
  const outC = advanceOutstanding == null ? 0 : Math.max(toCents(advanceOutstanding), 0);
  const appliedC = Math.min(amountC, outC);
  return { applied: appliedC / 100, cash: (amountC - appliedC) / 100 };
}

interface AwaitingRow {
  claim: Pick<ExpenseClaimRow, 'status' | 'claimant_id'>;
  route: RouteShape | null;
}

/** The approvals inbox: an un-named Admin is not shown routed claims (the DD-APR-5 inbox rule), only `admin` ones. */
export function isAwaitingViewer(row: AwaitingRow, userId: string | null | undefined, realRole: Role | null | undefined): boolean {
  if (!userId || !realRole) return false;
  if (row.claim.status !== 'Submitted' || row.claim.claimant_id === userId) return false;
  if (!APPROVAL_RANK.includes(realRole)) return false;
  const route = row.route;
  if (!route || route.route === 'flat') return true;
  if (route.route === 'admin') return realRole === 'Admin';
  return route.approvers.some((a) => a.id === userId);
}

export function claimsAwaitingViewer<T extends AwaitingRow>(rows: T[], userId: string | null | undefined, realRole: Role | null | undefined): T[] {
  return rows.filter((r) => isAwaitingViewer(r, userId, realRole));
}

export const AGING_BUCKETS: readonly AgingBucket[] = ['0-30', '31-60', '61-90', '90+'];

export function agingTotals(
  rows: Pick<ExpenseAdvanceAgingRow, 'currency' | 'bucket' | 'outstanding'>[],
): Record<string, Record<AgingBucket, number>> {
  const cents: Record<string, Record<AgingBucket, number>> = {};
  for (const r of rows) {
    if (!cents[r.currency]) cents[r.currency] = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    cents[r.currency][r.bucket] += toCents(r.outstanding);
  }
  const out: Record<string, Record<AgingBucket, number>> = {};
  for (const [currency, b] of Object.entries(cents)) {
    out[currency] = { '0-30': b['0-30'] / 100, '31-60': b['31-60'] / 100, '61-90': b['61-90'] / 100, '90+': b['90+'] / 100 };
  }
  return out;
}
