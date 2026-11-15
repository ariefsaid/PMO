import { describe, expect, it } from 'vitest';
import { compareStockCost, compareTotals, findDoubleCounts, findOtherAccountTags, type PmoLine, type StockCostLine } from './ledgerReconcile.ts';

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

describe('#2282 stock-cost comparison and the no-double-count check (AC-IMC-005)', () => {
  const sl = (analyticAccount: string, debit: string, credit = '0.00', over: Partial<StockCostLine> = {}): StockCostLine =>
    ({ analyticAccount, debit, credit, writeDate: '2026-11-14 08:00:00', isCancelled: false, ...over });
  const cutoff = '2026-11-14 09:00:00';

  it('matches when each analytic account\'s net cost equals Odoo\'s negated amount', () => {
    expect(compareStockCost({ lines: [sl('600', '240.00'), sl('600', '0.00', '120.00'), sl('601', '50.00')], odoo: { ok: true, totals: { 600: '-120.00', 601: '-50.00' } }, cutoff }))
      .toEqual({ state: 'matches', accounts: 2 });
  });

  it('differs, naming the account, when an amount is missing or extra; cancelled and later lines are left out', () => {
    const r = compareStockCost({ lines: [sl('600', '240.00'), sl('600', '9.00', '0.00', { isCancelled: true }), sl('600', '9.00', '0.00', { writeDate: '2026-11-14 10:00:00' })],
      odoo: { ok: true, totals: { 600: '-200.00' } }, cutoff });
    expect(r).toEqual({ state: 'differs', accounts: 1, differing: [{ account: '600', pmo: { debit: '240.00', credit: '0.00' }, odoo: { debit: '200.00', credit: '0.00' } }] });
  });

  it('a failed read is "not checked", never a match', () => {
    expect(compareStockCost({ lines: [], odoo: { ok: false, reason: 'validation' }, cutoff })).toEqual({ state: 'not-checked', reason: 'validation' });
  });

  it('flags a tied line whose picking has a journal item tagged to the same project account, and only that one', () => {
    expect(findDoubleCounts(
      [{ stockMoveId: 11, analyticAccounts: ['600'] }, { stockMoveId: 12, analyticAccounts: ['999'] }],
      [{ analyticLineId: '501', analyticAccount: '600', stockMoveIds: [11] }, { analyticLineId: '502', analyticAccount: '600', stockMoveIds: [12] },
        { analyticLineId: '503', analyticAccount: '601', stockMoveIds: [13] }],
    )).toEqual(['501']);
  });

  it('findOtherAccountTags returns the lines whose picking is tagged to a different account (or the line has none), never one findDoubleCounts returns', () => {
    const journal = [{ stockMoveId: 11, analyticAccounts: ['600'] }, { stockMoveId: 12, analyticAccounts: ['999'] }, { stockMoveId: 14, analyticAccounts: ['600', '999'] }];
    const tied = [{ analyticLineId: '501', analyticAccount: '600', stockMoveIds: [11] }, { analyticLineId: '502', analyticAccount: '600', stockMoveIds: [12] },
      { analyticLineId: '503', analyticAccount: '601', stockMoveIds: [13] }, { analyticLineId: '504', analyticAccount: null, stockMoveIds: [12] },
      { analyticLineId: '505', analyticAccount: '600', stockMoveIds: [14] }];
    expect(findOtherAccountTags(journal, tied)).toEqual(['502', '504']);
    expect(findDoubleCounts(journal, tied)).toEqual(['501', '505']);
  });
});
