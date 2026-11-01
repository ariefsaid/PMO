import { describe, expect, it } from 'vitest';
import type { BudgetProjectionCellRow } from '@/src/lib/repositories/budgetProjection';
import { interpretForecast } from './forecastInterpretation';

const row: BudgetProjectionCellRow = { category: 'Labor', pmoBudgetAmount: null, actualsToDate: 10, actualsAsOf: '2026-01-01', pmoEtc: 2, projectedFinalCost: 12, projectedVariance: null, projectedUtilization: null, attributionKnown: true };
const facts = (years: Record<string, string[]>, unphased: Record<string, true> = {}) => ({ years, unphased });
const interpret = (r = row, phasing = facts({})) => interpretForecast([r], '2026', phasing, {}, true);

describe('forecast interpretation', () => {
  it('preserves reason priority for missing figures', () => {
    expect(interpret({ ...row, actualsToDate: null, actualsAsOf: null }, facts({ Labor: ['2025'] })).rows[0].reason).toEqual({ kind: 'no-ledger' });
    expect(interpret({ ...row, actualsToDate: null }, facts({})).rows[0].reason).toEqual({ kind: 'no-account' });
    expect(interpret({ ...row, attributionKnown: false }, facts({ Labor: ['2025'] })).rows[0].reason).toEqual({ kind: 'other-year', years: ['2025'] });
    expect(interpret({ ...row, attributionKnown: false }, facts({ Labor: ['2025'] }, { Labor: true })).rows[0].reason).toEqual({ kind: 'stale-attribution' });
    expect(interpret({ ...row, attributionKnown: false }, facts({})).rows[0].reason).toEqual({ kind: 'partial-attribution' });
    expect(interpret().rows[0].reason).toEqual({ kind: 'no-budget-year' });
    expect(interpret(row, facts({ Materials: ['2026'] })).rows[0].reason).toEqual({ kind: 'no-budget-line' });
  });
  it('keeps missing phasing unknown while recognizing missing amounts', () => {
    const result = interpretForecast([row], '2026', undefined, {}, true);
    expect(result.rows[0]).toMatchObject({ incomplete: true, reason: null, budgetStatus: 'unknown' });
    expect(interpret(row, facts({ Materials: ['2026'] })).rows[0].budgetStatus).toBe('known-absent');
    expect(interpret({ ...row, attributionKnown: false }).rows[0].budgetStatus).toBe('unknown');
    expect(interpret({ ...row, pmoBudgetAmount: 0 }).rows[0]).toMatchObject({ incomplete: false, reason: null });
  });
  it('does not present partial monetary totals or restricted commitments', () => {
    const result = interpretForecast([{ ...row, pmoBudgetAmount: 100, projectedVariance: 88 }, { ...row, category: 'Materials', actualsToDate: null, projectedFinalCost: null }], '2026', facts({}), { Labor: 4, Materials: 6 }, false);
    expect(result.summary).toEqual({ budget: null, actuals: null, etc: 4, final: null, remaining: null, committed: null });
    expect(interpretForecast([{ ...row, pmoBudgetAmount: 100, projectedVariance: 88 }], '2026', facts({}), { Labor: 4 }, true).summary).toEqual({ budget: 100, actuals: 10, etc: 2, final: 12, remaining: 88, committed: 4 });
  });
});
