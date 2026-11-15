import { describe, expect, it } from 'vitest';
import { judgeReadBack } from './ledgerJournalReadBack.ts';
import type { LedgerJournal } from './ledgerJournal.ts';

const sent = (date: string): LedgerJournal => ({
  key: 'journal:89500000-0000-0000-0000-0000000000a1', date, memo: 'Bank fee',
  lines: [
    { account: '6100', debit: '25000.00', credit: '0.00', label: 'fee' },
    { account: '1100', debit: '0.00', credit: '25000.00', label: 'fee' },
  ],
});
const read = (over: Partial<Parameters<typeof judgeReadBack>[1]> = {}) =>
  ({ date: '2026-01-20', state: 'posted' as const, ref: 'Bank fee', debit: '25000.00', credit: '25000.00', ...over });

describe('judgeReadBack (AC-ACD-027, AC-ACD-029 unit half)', () => {
  it('AC-ACD-027 a post the ledger re-dated is a mismatch naming both dates', () => {
    expect(judgeReadBack(sent('2026-01-20'), read({ date: '2026-02-28' }), '2026-11-15'))
      .toEqual({ kind: 'mismatch', reason: 'posted in the ledger on 2026-02-28, not 2026-01-20' });
  });
  it('AC-ACD-027 a different total is a mismatch', () => {
    expect(judgeReadBack(sent('2026-01-20'), read({ debit: '2500.00', credit: '2500.00' }), '2026-11-15'))
      .toEqual({ kind: 'mismatch', reason: 'the ledger total is 2500.00, not 25000.00' });
  });
  it('AC-ACD-027 totals compare as decimals, not text: 25000 equals 25000.00', () => {
    expect(judgeReadBack(sent('2026-01-20'), read({ debit: '25000', credit: '25000.0' }), '2026-11-15')).toEqual({ kind: 'posted' });
  });
  it('AC-ACD-029 a reversal dated after today that the ledger holds as draft is scheduled, never posted', () => {
    expect(judgeReadBack(sent('2026-12-01'), read({ date: '2026-12-01', state: 'draft' }), '2026-11-15')).toEqual({ kind: 'scheduled' });
  });
  it('AC-ACD-027 a draft dated today or earlier is a mismatch', () => {
    expect(judgeReadBack(sent('2026-01-20'), read({ state: 'draft' }), '2026-11-15'))
      .toEqual({ kind: 'mismatch', reason: 'the ledger holds it as draft, not posted' });
  });
  it('AC-ACD-027 same date and totals is posted', () => {
    expect(judgeReadBack(sent('2026-01-20'), read(), '2026-11-15')).toEqual({ kind: 'posted' });
  });
});
