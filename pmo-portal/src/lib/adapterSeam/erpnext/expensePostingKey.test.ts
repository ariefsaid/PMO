import { describe, expect, it } from 'vitest';
import { AdapterError } from '../contract';
import { EXPENSE_JOURNAL_KEY_RE, expenseOutboxIdentity, expensePostingIdentity, expensePostingKey } from './expensePostingKey';

const CLAIM_UPPER = '0B7A8C2E-1111-4222-8333-444455556666';
const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';
// 2026-10-07T10:00:00.123Z
const EPOCH = '1791367200123';

describe('expensePostingKey (AC-EXP-110)', () => {
  it('AC-EXP-110 gives each posting its prefix and lowercases the subject', () => {
    const stamp = '2026-10-07T10:00:00.123+00:00';
    expect(expensePostingKey('approval', CLAIM_UPPER, stamp)).toBe(`expj:${CLAIM}:${EPOCH}`);
    expect(expensePostingKey('settlement', CLAIM, stamp)).toBe(`exps:${CLAIM}:${EPOCH}`);
    expect(expensePostingKey('approval-cancel', CLAIM, stamp)).toBe(`expx:${CLAIM}:${EPOCH}`);
    expect(expensePostingKey('claim-payment', CLAIM, stamp)).toBe(`expp:${CLAIM}:${EPOCH}`);
    expect(expensePostingKey('advance-payment', CLAIM, stamp)).toBe(`expa:${CLAIM}:${EPOCH}`);
    expect(expensePostingKey('advance-return', CLAIM, stamp)).toBe(`expr:${CLAIM}:${EPOCH}`);
  });

  it('AC-EXP-110 one instant in every transport spelling is one key', () => {
    const a = expensePostingKey('approval', CLAIM, '2026-10-07T10:00:00.123+00:00');
    expect(expensePostingKey('approval', CLAIM, '2026-10-07 10:00:00.123+00')).toBe(a);
    expect(expensePostingKey('approval', CLAIM, '2026-10-07T17:00:00.123+07:00')).toBe(a);
  });

  it('AC-EXP-110 refuses to derive a key from a missing or unparseable stamp', () => {
    expect(() => expensePostingKey('approval', CLAIM, null)).toThrow(AdapterError);
    expect(() => expensePostingKey('approval', CLAIM, 'yesterday')).toThrow(/unparseable state stamp/);
  });

  it('AC-EXP-110 identities: the cancel acts on the approval identity', () => {
    expect(expensePostingIdentity('claim-payment', CLAIM_UPPER)).toBe(`${CLAIM}:claim-payment`);
    expect(expenseOutboxIdentity('claim-payment', CLAIM)).toBe(`${CLAIM}:claim-payment`);
    expect(expenseOutboxIdentity('approval-cancel', CLAIM)).toBe(`${CLAIM}:approval`);
  });

  it('AC-EXP-110 the Journal Entry key pattern admits only PMO expense journal keys', () => {
    expect(EXPENSE_JOURNAL_KEY_RE.test(`expj:${CLAIM}:${EPOCH}`)).toBe(true);
    expect(EXPENSE_JOURNAL_KEY_RE.test(`exps:${CLAIM}:${EPOCH}`)).toBe(true);
    expect(EXPENSE_JOURNAL_KEY_RE.test(`expp:${CLAIM}:${EPOCH}`)).toBe(false);
    expect(EXPENSE_JOURNAL_KEY_RE.test('expense reclass for March')).toBe(false);
  });
});
