import { formatExactCents, parseExactCents } from '@/src/lib/exactDecimal';
import { formatExactDecimal } from '@/src/lib/format';

/** Ledger decimals are strings; shown exactly with the viewer's separators. Missing is "—", never a made-up zero. */
export function formatLedgerAmount(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : formatExactDecimal(value);
}

/** Debit minus credit as a decimal string, exact. Null when either side is not a plain decimal. */
export function netDebit(debit: string, credit: string): string | null {
  const d = parseExactCents(debit);
  const c = parseExactCents(credit);
  return d === null || c === null ? null : formatExactCents(d - c);
}
