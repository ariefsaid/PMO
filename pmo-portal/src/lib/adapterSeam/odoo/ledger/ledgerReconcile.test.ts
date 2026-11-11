import { describe, expect, it } from 'vitest';
import { compareTotals, type PmoLine } from './ledgerReconcile.ts';

const CUTOFF = '2026-03-01 10:00:00';
const pmo = (account: string, debit: string, credit: string, writeDate = '2026-02-01 00:00:00', cancelled = false): PmoLine =>
  ({ account, debit, credit, writeDate, isCancelled: cancelled });
const odoo = (totals: Record<string, { debit: string; credit: string }>) => ({ ok: true as const, totals });

describe('AC-ODA-008 compareTotals', () => {
  it('equal totals match', () => {
    const r = compareTotals({
      lines: [pmo('5100', '600.01', '0'), pmo('5100', '400.00', '0'), pmo('2100', '0', '1000.01')],
      odoo: odoo({ '5100': { debit: '1000.01', credit: '0' }, '2100': { debit: '0', credit: '1000.01' } }), cutoff: CUTOFF,
    });
    expect(r).toEqual({ state: 'matches', accounts: 2 });
  });

  it('one account differing reports both figures', () => {
    const r = compareTotals({
      lines: [pmo('5100', '1000.00', '0'), pmo('2100', '0', '1000.00')],
      odoo: odoo({ '5100': { debit: '1000.00', credit: '0' }, '2100': { debit: '0', credit: '1000.50' } }), cutoff: CUTOFF,
    });
    expect(r).toEqual({
      state: 'differs', accounts: 2,
      differing: [{ account: '2100', pmo: { debit: '0.00', credit: '1000.00' }, odoo: { debit: '0.00', credit: '1000.50' } }],
    });
  });

  it('a credit-only difference is a difference', () => {
    const r = compareTotals({ lines: [pmo('5100', '10', '5')], odoo: odoo({ '5100': { debit: '10', credit: '4' } }), cutoff: CUTOFF });
    expect(r.state).toBe('differs');
  });

  it('an account on one side only differs against zero', () => {
    const r = compareTotals({ lines: [pmo('5100', '10', '0')], odoo: odoo({ '5200': { debit: '3', credit: '0' } }), cutoff: CUTOFF });
    expect(r).toMatchObject({ state: 'differs', accounts: 2 });
    expect((r as { differing: unknown[] }).differing).toHaveLength(2);
  });

  it('grouped read failed or unsupported is not checked, with the reason', () => {
    const r = compareTotals({ lines: [pmo('5100', '10', '0')], odoo: { ok: false, reason: 'grouped read unsupported' }, cutoff: CUTOFF });
    expect(r).toEqual({ state: 'not-checked', reason: 'grouped read unsupported' });
  });

  it('lines changed after the cut-off and cancelled lines are excluded (FR-ODA-042)', () => {
    const r = compareTotals({
      lines: [pmo('5100', '100', '0'), pmo('5100', '999', '0', '2026-03-01 10:00:01'), pmo('5100', '555', '0', '2026-02-01 00:00:00', true)],
      odoo: odoo({ '5100': { debit: '100', credit: '0' } }), cutoff: CUTOFF,
    });
    expect(r).toEqual({ state: 'matches', accounts: 1 });
  });
});
