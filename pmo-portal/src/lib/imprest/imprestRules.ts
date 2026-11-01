import type { Role } from '@/src/auth/AuthContext';

/** #1515 — the FE projection of the imprest RPCs (0422-0424). UX ONLY (ADR-0016): the RPCs decide. Money in cents. */
export type ImprestAction =
  | 'requestReplenishment' | 'requestFunding' | 'recordCount'
  | 'approveReplenishment' | 'rejectReplenishment' | 'payReplenishment' | 'cancelReplenishment'
  | 'submitPlan' | 'reopenPlan' | 'cancelPlan' | 'approvePlan' | 'rejectPlan';

const APPROVAL_RANK: readonly Role[] = ['Admin', 'Executive', 'Finance', 'Project Manager'];
const FINANCE_OR_ADMIN: readonly Role[] = ['Admin', 'Finance'];

/** A money string from an RPC (`'1234.50'`) or number to integer cents; never float arithmetic on money. */
export function toCents(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const [whole, frac = ''] = String(v).split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number((frac + '00').slice(0, 2)));
}
export const sumCents = (vs: Array<string | number | null | undefined>): number => vs.reduce<number>((a, v) => a + toCents(v), 0);
export function gapCents(p: { float_amount: string | number; cash_book: string | number; advances_out: string | number;
                              receipts_waiting: string | number }): number {
  return toCents(p.float_amount) - sumCents([p.cash_book, p.advances_out, p.receipts_waiting]);
}
/** FR-IMP-024 hint: no approved plan line (remaining null) means everything is out of plan. */
export function isPlanException(amount: number | string, remaining: number | string | null | undefined): boolean {
  return remaining == null || toCents(amount) > toCents(remaining);
}

export interface FloatCtx {
  userId: string | null | undefined;
  realRole: Role | null | undefined;
  custodianId: string;
  receiptsWaiting: string | number;
  gap: string | number;
  openFunding: boolean;
}
export function availableFloatActions(c: FloatCtx): ImprestAction[] {
  if (!c.userId || !c.realRole) return [];
  const out: ImprestAction[] = [];
  const custodian = c.userId === c.custodianId;
  if (custodian && toCents(c.receiptsWaiting) > 0) out.push('requestReplenishment');
  if (custodian && toCents(c.gap) > 0 && !c.openFunding) out.push('requestFunding');
  if (custodian || FINANCE_OR_ADMIN.includes(c.realRole)) out.push('recordCount');
  return out;
}

export interface ReplenishmentCtx {
  userId: string | null | undefined;
  realRole: Role | null | undefined;
  custodianId: string;
  rep: { status: string; requested_by: string; approved_by: string | null };
}
export function availableReplenishmentActions(c: ReplenishmentCtx): ImprestAction[] {
  if (!c.userId || !c.realRole) return [];
  const fin = FINANCE_OR_ADMIN.includes(c.realRole);
  const party = c.userId === c.custodianId || c.userId === c.rep.requested_by;
  const out: ImprestAction[] = [];
  if (c.rep.status === 'Requested' && fin && !party) out.push('approveReplenishment', 'rejectReplenishment');
  if (c.rep.status === 'Approved' && fin && !party && c.userId !== c.rep.approved_by) out.push('payReplenishment');
  if ((c.rep.status === 'Requested' && (fin || c.userId === c.rep.requested_by)) || (c.rep.status === 'Approved' && fin)) {
    out.push('cancelReplenishment');
  }
  return out;
}

export interface PlanCtx {
  userId: string | null | undefined;
  realRole: Role | null | undefined;
  custodianId: string;
  plan: { status: string; author_id: string };
}
export function availablePlanActions(c: PlanCtx): ImprestAction[] {
  if (!c.userId || !c.realRole) return [];
  const author = c.userId === c.plan.author_id;
  const out: ImprestAction[] = [];
  if (c.plan.status === 'Draft' && author) out.push('submitPlan');
  if (c.plan.status === 'Rejected' && author) out.push('reopenPlan');
  if (['Draft', 'Submitted', 'Rejected'].includes(c.plan.status) && (author || FINANCE_OR_ADMIN.includes(c.realRole))) out.push('cancelPlan');
  if (c.plan.status === 'Submitted' && !author && c.userId !== c.custodianId && APPROVAL_RANK.includes(c.realRole)) {
    out.push('approvePlan', 'rejectPlan');
  }
  return out;
}
