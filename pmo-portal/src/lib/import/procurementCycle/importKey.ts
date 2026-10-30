/** Versioned record identity, its legacy compatibility candidate, and app creation facts. */
import type { CaseGroup, CycleRow } from './types';
import { parseMoneyInputAtScale } from '@/src/lib/format';

export function computeCaseImportKey(group: CaseGroup): string {
  return group.caseRef;
}

export function computeRecordImportKey(row: CycleRow, facts: (string | null)[]): string {
  return `pcy2:${JSON.stringify(row.externalRef?.trim() ? ['r', row.externalRef.trim()] : ['f', facts])}`;
}

export function computeLegacyRecordImportKey(row: CycleRow): string {
  if (row.externalRef?.trim()) return row.externalRef.trim();
  const parts = [row.type, row.date ?? '', row.amount ?? '', row.vendor ?? ''];
  return `fp:${parts.join('|')}`;
}

export function projectRecordFacts(row: CycleRow, vendorId: string | null, invoiceId: string | null): (string | null)[] {
  const text = (value: string | undefined) => value?.trim() || null;
  const money = (value: string | undefined) => {
    if (!value?.trim()) return null;
    const amount = parseMoneyInputAtScale(value, 2, 'en-US');
    if (amount === null || amount < 0 || amount >= 1e12) throw new Error('Invalid amount');
    return amount.toFixed(2);
  };
  const ref = text(row.externalRef), status = text(row.status), date = text(row.date);
  switch (row.type) {
    case 'PR': case 'RFQ': case 'PO': return [ref, status ?? 'Draft', date, money(row.amount)];
    case 'Quotation': return [null, vendorId?.toLowerCase() ?? null, money(row.amount) ?? '0.00', date];
    case 'GR': return [ref, status, date];
    case 'VI': return [ref, status, date, money(row.amount), text(row.taxTreatment), money(row.taxAmount)];
    case 'Payment': return [ref, invoiceId?.toLowerCase() ?? null, status ?? 'Scheduled', date, money(row.amount)];
    default: throw new Error(`Unsupported identity projection: ${row.type}`);
  }
}
