import { normalizeLocalizedDecimal } from '@/src/lib/format';
import { formatExactCents, parseExactCents } from '@/src/lib/exactDecimal';

/** One line of a journal being drafted, as typed (amounts in the viewer's number locale). */
export interface JournalLineDraft {
  account: string;
  debit: string;
  credit: string;
  label: string;
  projectId: string;
}

/** A typed amount in integer cents: blank is zero, anything unreadable, negative or past two decimals is null. Never a float. */
export function lineAmountCents(raw: string): bigint | null {
  if (raw.trim() === '') return 0n;
  const normalized = normalizeLocalizedDecimal(raw.trim(), 2);
  if (normalized === null || normalized.startsWith('-')) return null;
  return parseExactCents(normalized);
}

export interface JournalBalance {
  totalDebitCents: bigint;
  totalCreditCents: bigint;
  /** |debits − credits| in cents. */
  differenceCents: bigint;
  totalDebit: string;
  difference: string;
  balanced: boolean;
  /** Indexes of lines that are not one account with exactly one side above zero. */
  invalidLines: number[];
  /** Two or more valid lines, a non-zero total and no difference: what `submit_journal` accepts. */
  submittable: boolean;
}

/** The running difference of a draft, summed in exact cents (the submit gate mirrors `submit_journal`). */
export function journalBalance(lines: JournalLineDraft[]): JournalBalance {
  let debit = 0n;
  let credit = 0n;
  const invalidLines: number[] = [];
  lines.forEach((l, i) => {
    const d = lineAmountCents(l.debit);
    const c = lineAmountCents(l.credit);
    if (d === null || c === null || (d === 0n) === (c === 0n) || l.account.trim() === '') invalidLines.push(i);
    debit += d ?? 0n;
    credit += c ?? 0n;
  });
  const differenceCents = debit > credit ? debit - credit : credit - debit;
  const balanced = differenceCents === 0n;
  return {
    totalDebitCents: debit,
    totalCreditCents: credit,
    differenceCents,
    totalDebit: formatExactCents(debit),
    difference: formatExactCents(differenceCents),
    balanced,
    invalidLines,
    submittable: lines.length >= 2 && invalidLines.length === 0 && balanced && debit > 0n,
  };
}

export interface JournalLinePayload {
  account: string;
  debit: string;
  credit: string;
  label: string;
  project_id?: string;
}

/** The `save_journal_draft` line list: exact two-decimal strings (never a JS number) and no empty project. */
export function toLinePayload(lines: JournalLineDraft[]): JournalLinePayload[] {
  return lines.map((l) => ({
    account: l.account.trim(),
    debit: formatExactCents(lineAmountCents(l.debit) ?? 0n),
    credit: formatExactCents(lineAmountCents(l.credit) ?? 0n),
    label: l.label.trim(),
    ...(l.projectId ? { project_id: l.projectId } : {}),
  }));
}
