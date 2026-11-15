import { describe, expect, it } from 'vitest';
import { journalBalance, lineAmountCents, toLinePayload } from './journalBalance';

const line = (debit: string, credit: string, account = '6100') => ({ account, debit, credit, label: '', projectId: '' });

describe('journal balance in exact cents (#895)', () => {
  it('AC-ACD-021 100.00 against 99.99 is off by exactly 0.01 and cannot be submitted', () => {
    const b = journalBalance([line('100.00', ''), line('', '99.99', '1010')]);
    expect(b.differenceCents).toBe(1n);
    expect(b.difference).toBe('0.01');
    expect(b.balanced).toBe(false);
    expect(b.submittable).toBe(false);
  });

  it('sums without float drift: 0.10 + 0.20 balances 0.30', () => {
    const b = journalBalance([line('0.10', ''), line('0.20', ''), line('', '0.30', '1010')]);
    expect(b.differenceCents).toBe(0n);
    expect(b.balanced).toBe(true);
    expect(b.submittable).toBe(true);
    expect(b.totalDebit).toBe('0.30');
  });

  it('a line with both sides, neither side, no account or an unreadable amount blocks submit', () => {
    expect(journalBalance([line('5', '5'), line('', '0', '1010')]).submittable).toBe(false);
    expect(journalBalance([line('', ''), line('', '', '1010')]).submittable).toBe(false);
    expect(journalBalance([line('5', '', ''), line('', '5', '1010')]).submittable).toBe(false);
    expect(journalBalance([line('5x', ''), line('', '5', '1010')]).invalidLines).toEqual([0]);
    expect(journalBalance([line('1.234', ''), line('', '1.23', '1010')]).submittable).toBe(false);
  });

  it('one line alone never submits, even when it is zero-difference', () => {
    expect(journalBalance([line('5', '')]).submittable).toBe(false);
  });

  it('blank reads as zero; a negative amount is unreadable', () => {
    expect(lineAmountCents('')).toBe(0n);
    expect(lineAmountCents('  ')).toBe(0n);
    expect(lineAmountCents('-1')).toBeNull();
    expect(lineAmountCents('1,000.50')).toBe(100050n);
  });

  it('the RPC payload carries exact decimal strings and drops an empty project', () => {
    expect(toLinePayload([{ account: ' 6100 ', debit: '1,000.5', credit: '', label: 'Bank fee', projectId: '' },
      { account: '1010', debit: '', credit: '1000.50', label: '', projectId: 'p1' }])).toEqual([
      { account: '6100', debit: '1000.50', credit: '0.00', label: 'Bank fee' },
      { account: '1010', debit: '0.00', credit: '1000.50', label: '', project_id: 'p1' },
    ]);
  });
});
