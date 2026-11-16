import { describe, expect, it } from 'vitest';
import {
  JOURNAL_KEY_RE, JOURNAL_REVERSAL_KEY_RE, assertLedgerJournal, journalKey, sumSide, journalReversalKey, type LedgerJournal,
} from './ledgerJournal.ts';

const ID = '89500000-0000-0000-0000-0000000000a1';
const line = (account: string, debit: string, credit: string) => ({ account, debit, credit, label: 'bank fee' });
const journal = (lines: LedgerJournal['lines']): LedgerJournal => ({ key: journalKey(ID), date: '2026-11-15', memo: 'Bank fee', lines });

describe('journal keys (AC-MJE-003, AC-MJE-004)', () => {
  it('AC-MJE-003 journalKey lower-cases the journal id', () => {
    expect(journalKey(ID.toUpperCase())).toBe(`journal:${ID}`);
    expect(journalReversalKey(ID.toUpperCase())).toBe(`journal-rev:${ID}`);
  });
  it('AC-MJE-003 JOURNAL_KEY_RE accepts journal:<uuid> only', () => {
    expect(JOURNAL_KEY_RE.test(`journal:${ID}`)).toBe(true);
    expect(JOURNAL_KEY_RE.test(`journal:${ID}:1`)).toBe(false);
    expect(JOURNAL_KEY_RE.test(`po:${ID}`)).toBe(false);
    expect(JOURNAL_KEY_RE.test(`journal:${ID.slice(1)}`)).toBe(false);
    expect(JOURNAL_KEY_RE.test(`journal-rev:${ID}`)).toBe(false);
  });
  it('AC-MJE-004 JOURNAL_REVERSAL_KEY_RE accepts journal-rev:<uuid> only', () => {
    expect(JOURNAL_REVERSAL_KEY_RE.test(`journal-rev:${ID}`)).toBe(true);
    expect(JOURNAL_REVERSAL_KEY_RE.test(`journal:${ID}`)).toBe(false);
    expect(JOURNAL_REVERSAL_KEY_RE.test(`journal-rev:${ID}:2`)).toBe(false);
  });
});

describe('assertLedgerJournal balances to the unit (AC-MJE-001)', () => {
  it('AC-MJE-001 refuses 100.00 Dr against 99.99 Cr: does not balance by 0.01', () => {
    expect(() => assertLedgerJournal(journal([line('6100', '100.00', '0.00'), line('1100', '0.00', '99.99')])))
      .toThrow('does not balance by 0.01');
  });
  it('AC-MJE-001 refuses a single line', () => {
    expect(() => assertLedgerJournal(journal([line('6100', '100.00', '0.00')]))).toThrow('needs two or more lines');
  });
  it('AC-MJE-001 refuses a line with both a debit and a credit', () => {
    expect(() => assertLedgerJournal(journal([line('6100', '100.00', '100.00'), line('1100', '0.00', '0.00')])))
      .toThrow('either a debit or a credit');
  });
  it('AC-MJE-001 refuses a malformed amount', () => {
    expect(() => assertLedgerJournal(journal([line('6100', '1e2', '0.00'), line('1100', '0.00', '100.00')])))
      .toThrow('bad amount');
  });
  it('AC-MJE-001 refuses a bad key or date', () => {
    expect(() => assertLedgerJournal({ ...journal([line('6100', '1.00', '0.00'), line('1100', '0.00', '1.00')]), key: `po:${ID}` }))
      .toThrow('bad key');
    expect(() => assertLedgerJournal({ ...journal([line('6100', '1.00', '0.00'), line('1100', '0.00', '1.00')]), date: '15/11/2026' }))
      .toThrow('bad date');
  });
  it('AC-MJE-001 accepts 100.00 against 100.00', () => {
    const j = journal([line('6100', '100.00', '0.00'), line('1100', '0.00', '100.00')]);
    expect(assertLedgerJournal(j)).toBe(j);
  });
  it('AC-MJE-001 sums exactly: 0.10 + 0.20 balances 0.30 (no float drift)', () => {
    const j = journal([line('6100', '0.10', '0.00'), line('6100', '0.20', '0.00'), line('1100', '0.00', '0.30')]);
    expect(assertLedgerJournal(j)).toBe(j);
  });
  it('totals the sides as exact decimal strings', () => {
    expect(sumSide([line('a', '0.10', '0.00'), line('b', '0.20', '0.00')], 'debit')).toBe('0.30');
  });
});
