import { procurementMoney, supplierUnpaid, type MoneyFigure, type ProcurementMoneyKind } from '../blocks/procurementMoney';
import { stageForStatus, type StageKey } from '../blocks/stage';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

export type ProcurementListRole = 'Engineer' | 'Project Manager' | 'Finance' | 'Executive' | 'Admin' | string | null | undefined;
export type ProcurementGroupKey = 'needs-approval' | 'in-progress' | 'invoiced' | 'done';
export type MoneyBasis = 'most-real' | 'pay' | 'needs-you';

export interface CurrencyTotal {
  currency: string;
  amount: number | null;
  unknown: boolean;
}

export interface ProcurementGroup {
  key: ProcurementGroupKey;
  rows: ProcurementWithRefs[];
}

const REQUEST_ONLY_ROLE = 'Engineer';

/** One source for every calculated list figure, with sensitive invoice/payment data withheld from Engineers. */
export function moneyForListRow(row: ProcurementWithRefs, role: ProcurementListRole) {
  if (role === REQUEST_ONLY_ROLE) return procurementMoney({ total_value: row.total_value });
  return procurementMoney({
    total_value: row.total_value,
    purchase_requests: row.purchase_requests,
    purchase_orders: row.purchase_orders,
    procurement_invoices: row.procurement_invoices,
    payments: row.payments,
  });
}

export function figureForListRow(
  row: ProcurementWithRefs,
  role: ProcurementListRole,
  basis: MoneyBasis = 'most-real',
  needsYouReason?: 'approve' | 'pay' | 'receive',
): MoneyFigure & { kind: ProcurementMoneyKind | null } {
  const money = moneyForListRow(row, role);
  const unpaid = (): MoneyFigure => (role === REQUEST_ONLY_ROLE ? money.unpaid : supplierUnpaid(row));
  if (basis === 'pay' && row.status === 'Vendor Invoiced') {
    return { ...unpaid(), kind: 'unpaid' };
  }
  if (basis === 'pay' && row.status === 'Paid') {
    return { amount: 0, unknown: false, kind: 'unpaid' };
  }
  if (basis === 'needs-you' && needsYouReason === 'pay') {
    return { ...unpaid(), kind: 'unpaid' };
  }
  return money.mostReal
    ? { amount: money.mostReal.amount, unknown: false, kind: money.mostReal.kind }
    : { amount: null, unknown: true, kind: null };
}

/** Aggregate in each record currency; an unknown row keeps that currency's total visibly unknown. */
export function totalsByCurrency(
  rows: readonly ProcurementWithRefs[],
  role: ProcurementListRole,
  basis: MoneyBasis = 'most-real',
  reasons?: ReadonlyMap<string, 'approve' | 'pay' | 'receive'>,
): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const row of rows) {
    const current = totals.get(row.currency) ?? { currency: row.currency, amount: 0, unknown: false };
    const figure = figureForListRow(row, role, basis, reasons?.get(row.id));
    if (figure.unknown || figure.amount === null) {
      current.unknown = true;
      current.amount = null;
    } else if (!current.unknown) {
      current.amount = (current.amount ?? 0) + figure.amount;
    }
    totals.set(row.currency, current);
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export function groupKeyForStatus(status: string): ProcurementGroupKey {
  if (status === 'Requested') return 'needs-approval';
  if (status === 'Vendor Invoiced') return 'invoiced';
  if (status === 'Paid' || status === 'Rejected' || status === 'Cancelled') return 'done';
  return 'in-progress';
}

export function groupProcurements(rows: readonly ProcurementWithRefs[]): ProcurementGroup[] {
  const groups: ProcurementGroup[] = [
    { key: 'needs-approval', rows: [] },
    { key: 'in-progress', rows: [] },
    { key: 'invoiced', rows: [] },
    { key: 'done', rows: [] },
  ];
  const byKey = new Map(groups.map((group) => [group.key, group]));
  for (const row of rows) byKey.get(groupKeyForStatus(row.status))?.rows.push(row);
  return groups;
}

export function matchesStage(row: ProcurementWithRefs, stage: StageKey | null): boolean {
  return !stage || stageForStatus(row.status) === ({ request: 'Request', order: 'Order', receive: 'Receive', pay: 'Pay' } as const)[stage];
}

export function daysSince(date: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}
