import { parseMoneyInputAtScale } from '@/src/lib/format';

/**
 * The optional money amount on a procurement record capture (#684, AC-PLC-009). Every record
 * table stores `amount numeric(14,2)`, so an on-screen draft is read in the viewer's number
 * convention and must fit two decimals — a three-decimal amount is refused rather than rounded
 * by the database. Shared by `RecordCaptureForm` and the inline vendor-invoice capture so the two
 * entry points validate and persist the same number.
 */
export type RecordAmountParse = { ok: true; amount: number | null } | { ok: false };

export const RECORD_AMOUNT_ERROR = 'Enter a valid amount with no more than 2 decimal places.';

export function parseRecordAmount(raw: string): RecordAmountParse {
  if (raw.trim() === '') return { ok: true, amount: null };
  const amount = parseMoneyInputAtScale(raw, 2);
  return amount === null ? { ok: false } : { ok: true, amount };
}
