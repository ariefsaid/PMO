import { describe, expect, it } from 'vitest';
import type { BudgetComparisonRow, BudgetProjectionCellRow } from '@/src/lib/repositories/budgetProjection';
import { buildBudgetProjectionCsv } from './budgetProjectionExport';

const options = { budgetCurrency: 'USD', projectCurrency: 'USD', categoryLabel: (category: string) => category };

describe('buildBudgetProjectionCsv (AC-013/015)', () => {
  it('exports the all-years comparison without yearly forecast columns and keeps unknown values blank', () => {
    const rows: BudgetComparisonRow[] = [
      { category: 'Labor', budgetTotal: 100, recorded: 0, recordedAsOf: '2026-01-01T00:00:00Z', mapped: true, hasLedger: true, remaining: 100, percentUsed: 0 },
      { category: 'Equipment', budgetTotal: 20, recorded: null, recordedAsOf: null, mapped: false, hasLedger: false, remaining: null, percentUsed: null },
    ];

    expect(buildBudgetProjectionCsv({ scope: { kind: 'all' }, rows }, options)).toBe([
      '"Category","Approved total (USD)","Recorded to date (USD)","Remaining (USD)","% recorded"',
      '"Labor","100","0","100","0"',
      '"Equipment","20","","",""',
    ].join('\r\n'));
  });

  it('retains the fiscal-year ETC and EAC export columns, including overrun and zero ETC', () => {
    const rows: BudgetProjectionCellRow[] = [
      { category: 'Labor', pmoBudgetAmount: 100, actualsToDate: 120, actualsAsOf: null, pmoEtc: 0, projectedFinalCost: 120, projectedVariance: -20, projectedUtilization: 1.2, attributionKnown: true },
    ];

    expect(buildBudgetProjectionCsv({ scope: { kind: 'year', year: 'FY-client' }, rows }, options)).toBe([
      '"Category","Budget (USD)","Spent (USD)","Cost to finish (USD)","Forecast final (USD)","Forecast remaining (USD)"',
      '"Labor","100","120","0","120","-20"',
    ].join('\r\n'));
  });

  it('quotes commas, line breaks, and embedded quotes in category labels', () => {
    const rows: BudgetComparisonRow[] = [
      { category: 'Labor', budgetTotal: 1, recorded: 1, recordedAsOf: null, mapped: true, hasLedger: true, remaining: 0, percentUsed: 1 },
    ];

    expect(buildBudgetProjectionCsv({ scope: { kind: 'all' }, rows }, {
      ...options,
      categoryLabel: () => 'Labor, "regional"\nteam',
    })).toContain('"Labor, ""regional""\nteam","1","1","0","100"');
  });
});
