import { describe, expect, it } from 'vitest';
import { compareLedger } from './ledgerReadBack.ts';

describe('AC-ODR-001 a ledger date that differs from the sent date is named', () => {
  it('a moved date returns ledger-date-differs and the ledger date', () => {
    expect(compareLedger({ date: '2025-01-20', ref: 'INV-1' }, { date: '2025-02-01', ref: 'INV-1' }))
      .toEqual({ codes: ['ledger-date-differs'], postingDate: '2025-02-01' });
  });
  it('an equal date and reference return nothing', () => {
    expect(compareLedger({ date: '2025-01-20', ref: 'INV-1' }, { date: '2025-01-20', ref: 'INV-1' })).toEqual({ codes: [], postingDate: '2025-01-20' });
  });
  it('an unreadable ledger date is ledger-date-unreadable, never a match', () => {
    expect(compareLedger({ date: '2025-01-20' }, { date: false })).toEqual({ codes: ['ledger-date-unreadable'], postingDate: null });
  });
  it('no sent date (a legacy outbox row) compares no date', () => {
    expect(compareLedger({ date: null }, { date: '2025-02-01' })).toEqual({ codes: [], postingDate: '2025-02-01' });
  });
});

describe('AC-ODR-002 a reference Odoo changed is named', () => {
  it('a different ref returns ledger-reference-differs', () => {
    expect(compareLedger({ date: '2025-01-20', ref: 'INV-1' }, { date: '2025-01-20', ref: 'INV-2' }).codes).toEqual(['ledger-reference-differs']);
  });
  it('a ref PMO did not send is not compared', () => {
    expect(compareLedger({ date: '2025-01-20' }, { date: '2025-01-20', ref: 'anything' }).codes).toEqual([]);
  });
  it('surrounding whitespace Odoo trims is not a difference', () => {
    expect(compareLedger({ date: '2025-01-20', ref: ' INV-1 ' }, { date: '2025-01-20', ref: 'INV-1' }).codes).toEqual([]);
  });
});

describe('AC-ODR-009 a journal entry or reversal posted on another date is named', () => {
  it('a reversal asked for 2025-01-15 that Odoo posts on 2025-02-01 is ledger-date-differs', () => {
    expect(compareLedger({ date: '2025-01-15', ref: 'Reversal of: MISC/2025/0001' }, { date: '2025-02-01', ref: 'Reversal of: MISC/2025/0001' }).codes).toEqual(['ledger-date-differs']);
  });
});
