/**
 * #895 FR-MJE-027 — the read-back after a journal post or reversal. Nothing is shown Posted until the ledger's copy has
 * been read and matches what was sent: Odoo silently re-dates a post inside a locked period (spec §4.4).
 */
import { sumSide, type LedgerJournal } from './ledgerJournal.ts';
import { formatCents, nanoToCents, toNano } from './odoo/ledger/cents.ts';

export interface PostedJournalRead {
  date: string;
  state: 'draft' | 'posted' | 'cancel';
  ref: string | null;
  debit: string;
  credit: string;
}

export type ReadBackVerdict =
  | { kind: 'posted' }
  /** FR-MJE-028: a reversal dated after today, still draft in the ledger until its day. */
  | { kind: 'scheduled' }
  | { kind: 'mismatch'; reason: string };

/** A ledger amount normalised to 2 decimals; the raw text when malformed, so it can never equal a sent total. */
function normal(v: string): string {
  const nano = toNano(v);
  return nano === null ? `?${v}` : formatCents(nanoToCents(nano));
}

export function judgeReadBack(sent: LedgerJournal, read: PostedJournalRead, today: string): ReadBackVerdict {
  if (read.state === 'draft' && sent.date > today) return { kind: 'scheduled' };
  if (read.state !== 'posted') return { kind: 'mismatch', reason: `the ledger holds it as ${read.state}, not posted` };
  if (read.date !== sent.date) return { kind: 'mismatch', reason: `posted in the ledger on ${read.date}, not ${sent.date}` };
  const debit = sumSide(sent.lines, 'debit');
  const credit = sumSide(sent.lines, 'credit');
  if (normal(read.debit) !== debit || normal(read.credit) !== credit) {
    return { kind: 'mismatch', reason: `the ledger total is ${normal(read.debit)}, not ${debit}` };
  }
  return { kind: 'posted' };
}
