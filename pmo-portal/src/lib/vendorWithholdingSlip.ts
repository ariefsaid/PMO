import type { PphType } from './vendorWithholding';

export type DecimalMoney = string;
export type SlipCoverage = 'not-required' | 'return-review' | 'not-recorded' | 'slipped' | 'needs-review' | 'unavailable';
export type RecordSlipInput = {
  slipId: string; vendorId: string; slipNumber: string; slipDate: string; taxPeriod: string; pphType: PphType;
  taxBase: DecimalMoney; withheldAmount: DecimalMoney; invoiceIds: string[]; declaredInvoiceIds: string[];
};
export type CorrectSlipInput = { slipId: string; expectedRevision: number; slipNumber: string; slipDate: string; taxPeriod: string; reason: string };
export type VoidSlipInput = { slipId: string; expectedRevision: number; reason: string };
export type SlipWriteResult = { slipId: string; revision: number };

const MAX_CENTS = 99_999_999_999_999n;
const DECIMAL = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
export function parseDecimalCents(value: string): bigint | null {
  const match = DECIMAL.exec(value.trim());
  if (!match) return null;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? '').padEnd(2, '0'));
  const cents = whole * 100n + fraction;
  return match[1] ? -cents : cents;
}
export function parsePositiveSlipMoney(value: string): DecimalMoney | null {
  const trimmed = value.trim();
  const cents = parseDecimalCents(trimmed);
  if (cents === null || cents <= 0n || cents > MAX_CENTS || [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  })) return null;
  return formatSlipCents(cents);
}
export function formatSlipCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
export function sumSlipMoney(values: readonly string[]): bigint | null {
  let total = 0n;
  for (const value of values) {
    const cents = parseDecimalCents(value);
    if (cents === null) return null;
    total += cents;
  }
  return total;
}
export type BupotRemedy = 'reload' | 'inspect' | 'edit' | 'retry';
export function bupotRefusal(error: unknown): { key: string; remedy: BupotRemedy } {
  const source = error && typeof error === 'object' ? error as { code?: unknown; details?: unknown; detail?: unknown } : {};
  const detail = String(source.details ?? source.detail ?? '');
  const refusals: Record<string, { key: string; remedy: BupotRemedy }> = {
    'bupot-not-permitted': { key: 'notPermitted', remedy: 'inspect' },
    'bupot-not-found': { key: 'notFound', remedy: 'reload' },
    'bupot-invalid-facts': { key: 'invalidFacts', remedy: 'edit' },
    'bupot-ineligible-bill': { key: 'ineligibleBill', remedy: 'edit' },
    'bupot-amount-mismatch': { key: 'amountMismatch', remedy: 'edit' },
    'bupot-type-confirmation': { key: 'typeConfirmation', remedy: 'edit' },
    'bupot-bill-limit': { key: 'billLimit', remedy: 'edit' },
    'bupot-number-conflict': { key: 'conflict', remedy: 'inspect' },
    'bupot-bill-covered': { key: 'conflict', remedy: 'inspect' },
    'bupot-intent-conflict': { key: 'conflict', remedy: 'inspect' },
    'bupot-stale': { key: 'stale', remedy: 'reload' },
    'bupot-voided': { key: 'voided', remedy: 'reload' },
  };
  if (refusals[detail]) return refusals[detail];
  if (source.code === '40001') return refusals['bupot-stale'];
  if (source.code === '23505') return refusals['bupot-bill-covered'];
  return { key: 'retrySameIntent', remedy: 'retry' };
}
