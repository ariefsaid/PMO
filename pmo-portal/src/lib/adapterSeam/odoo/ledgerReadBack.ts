/**
 * What PMO sent against what the posted Odoo record says (#2290), pure. Odoo moves the accounting `date` of a post dated inside a
 * locked period instead of refusing it; the ledger is the oracle (ADR-0048), so its date is returned to be mirrored and the
 * difference is named for a person. Nothing is overwritten in Odoo or reversed. References are compared trimmed: surrounding
 * whitespace is not a different reference.
 */
import type { OdooCall } from './client.ts';

export type LedgerCode = 'ledger-date-differs' | 'ledger-date-unreadable' | 'ledger-reference-differs';
export interface LedgerSent { date: string | null; ref?: string | null }
export interface LedgerRead { date: unknown; ref?: unknown }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): string | null => (typeof v === 'string' && ISO.test(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function compareLedger(sent: LedgerSent, read: LedgerRead): { codes: LedgerCode[]; postingDate: string | null } {
  const postingDate = day(read.date);
  const codes: LedgerCode[] = [];
  if (sent.date !== null) {
    if (postingDate === null) codes.push('ledger-date-unreadable');
    else if (postingDate !== sent.date) codes.push('ledger-date-differs');
  }
  const sentRef = text(sent.ref ?? null);
  if (sentRef !== null && text(read.ref) !== sentRef) codes.push('ledger-reference-differs');
  return { codes, postingDate };
}

/**
 * The ledger date of a payment or receipt: the `date` of the journal entry it names (`move_id`). Odoo leaves `account.payment.date` as
 * sent when a lock moves the post; only the entry moves (bed, #2290). `false` when the payment names no entry or the entry carries no
 * date, so `compareLedger` flags it unreadable; the payment's own date is never the answer.
 */
export async function readEntryDate(call: OdooCall, moveRef: unknown): Promise<unknown> {
  const id = Number(Array.isArray(moveRef) ? moveRef[0] : moveRef);
  if (!Number.isInteger(id) || id <= 0) return false;
  const [entry] = await call<Array<{ date?: unknown }>>('account.move', 'read', { ids: [id], fields: ['date'] });
  return entry?.date ?? false;
}
