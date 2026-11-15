/**
 * #895 — the canonical manual journal (`journal.post` / `journal.reverse`), accountant's desk piece 1. PMO terms only;
 * each ledger adapter maps it to its own document (Odoo: `account.move` of type `entry`; ERPNext: Journal Entry).
 * Relative imports only, so the seam stays Deno-importable.
 */
import { formatCents, nanoToCents, toNano } from './odoo/ledger/cents.ts';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const JOURNAL_KEY_RE = new RegExp(`^journal:${UUID}$`, 'i');
export const JOURNAL_REVERSAL_KEY_RE = new RegExp(`^journal-rev:${UUID}$`, 'i');
export const journalKey = (journalId: string): string => `journal:${journalId.toLowerCase()}`;
/** The reversal is its own journal row (FR-ACD-025); its key is ITS id, and the original's id rides in the body. */
export const journalReversalKey = (reversalJournalId: string): string => `journal-rev:${reversalJournalId.toLowerCase()}`;

export interface LedgerJournalLine {
  /** Ledger account code from the mirrored chart (external_master_records kind 'account'). */
  account: string;
  /** Exact decimal string, ledger-currency precision; '0.00' on a credit line. */
  debit: string;
  credit: string;
  /** Ledger partner ref, resolved server-side. */
  partner?: string;
  /** Ledger analytic ref of the project (FR-ACD-026), resolved server-side. */
  analytic?: string;
  label: string;
}

export interface LedgerJournal {
  /** journalKey | journalReversalKey — the ADR-0058 idempotency key and the ledger anchor. */
  key: string;
  /** YYYY-MM-DD, org day (Asia/Jakarta), always sent (FR-ACD-113, -028). */
  date: string;
  memo: string;
  /** Two or more; Σdebit = Σcredit exactly (FR-ACD-110). */
  lines: LedgerJournalLine[];
  reverses?: { externalRecordId: string; reason: string };
}

const MONEY = /^\d{1,16}(?:\.\d{1,2})?$/;

function cents(v: string): bigint {
  const nano = MONEY.test(v) ? toNano(v) : null;
  if (nano === null) throw new Error(`journal: bad amount ${v}`);
  return nanoToCents(nano);
}

/** The exact total of one side, as a 2-decimal string (never a Number sum). */
export function sumSide(lines: readonly Pick<LedgerJournalLine, 'debit' | 'credit'>[], side: 'debit' | 'credit'): string {
  return formatCents(lines.reduce((acc, l) => acc + cents(l[side]), 0n));
}

export function assertLedgerJournal(j: LedgerJournal): LedgerJournal {
  if (!JOURNAL_KEY_RE.test(j.key) && !JOURNAL_REVERSAL_KEY_RE.test(j.key)) throw new Error(`journal: bad key ${j.key}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(j.date)) throw new Error(`journal: bad date ${j.date}`);
  if (j.lines.length < 2) throw new Error('journal: needs two or more lines');
  let debit = 0n;
  let credit = 0n;
  for (const l of j.lines) {
    const d = cents(l.debit);
    const c = cents(l.credit);
    if ((d === 0n) === (c === 0n)) throw new Error('journal: each line takes either a debit or a credit');
    if (!l.account) throw new Error('journal: each line needs an account');
    debit += d;
    credit += c;
  }
  const diff = debit - credit;
  if (diff !== 0n) throw new Error(`journal: does not balance by ${formatCents(diff < 0n ? -diff : diff)}`);
  return j;
}
