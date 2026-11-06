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
      '"Scope","Fiscal year","Category","Approved total (USD)","Budget source","Recorded to date (USD)","Recorded source","Recorded as of","Remaining (USD)","% recorded"',
      '"All years (project to date)","","Labor","100","Active budget version","0","ERP ledger","2026-01-01T00:00:00Z","100","0.00"',
      '"All years (project to date)","","Equipment","20","Active budget version","","No ledger account mapped","","",""',
    ].join('\r\n'));
  });

  it('exports the percent with exact decimal math: 0.57 is 57.00, never 56.99999999999999', () => {
    const row = (percentUsed: number): BudgetComparisonRow => ({ category: 'Labor', budgetTotal: 100, recorded: 1, recordedAsOf: null, mapped: true, hasLedger: true, remaining: 99, percentUsed });
    const percentCell = (fraction: number) => buildBudgetProjectionCsv({ scope: { kind: 'all' }, rows: [row(fraction)] }, options).split('\r\n')[1].split(',').pop();
    expect(0.57 * 100).not.toBe(57); // the float trap this guards
    expect(percentCell(0.57)).toBe('"57.00"');
    expect(percentCell(0.29)).toBe('"29.00"');
    expect(percentCell(1.2345)).toBe('"123.45"');
    expect(percentCell(0.005)).toBe('"0.50"');
  });

  it('AC-015 suppresses cross-currency comparisons in the actual all-years CSV while retaining both amounts and bases', () => {
    const rows: BudgetComparisonRow[] = [
      { category: 'Labor', budgetTotal: 100, recorded: 40, recordedAsOf: '2026-01-01T00:00:00Z', mapped: true, hasLedger: true, remaining: 60, percentUsed: 0.4 },
    ];

    const csv = buildBudgetProjectionCsv({ scope: { kind: 'all' }, rows }, {
      ...options, budgetCurrency: 'GBP', projectCurrency: 'USD',
    });

    expect(csv).toContain('"Approved total (GBP)"');
    expect(csv).toContain('"Recorded to date (USD)"');
    expect(csv).toContain('"Remaining (Unavailable across currencies)"');
    expect(csv).toContain('"% recorded (Unavailable across currencies)"');
    expect(csv).toContain('"All years (project to date)","","Labor","100","Active budget version","40","ERP ledger","2026-01-01T00:00:00Z","",""');
    expect(csv).not.toContain('"60"');
  });

  it('retains the fiscal-year ETC and EAC export columns, including overrun and zero ETC', () => {
    const rows: BudgetProjectionCellRow[] = [
      { category: 'Labor', pmoBudgetAmount: 100, actualsToDate: 120, actualsAsOf: null, pmoEtc: 0, projectedFinalCost: 120, projectedVariance: -20, projectedUtilization: 1.2, attributionKnown: true },
    ];

    expect(buildBudgetProjectionCsv({ scope: { kind: 'year', year: 'FY-client' }, rows }, options)).toBe([
      '"Scope","Fiscal year","Category","Budget (USD)","Budget source","Spent (USD)","Recorded source","Recorded as of","Cost to finish (USD)","Forecast final (USD)","Forecast remaining (USD)"',
      '"Fiscal year","FY-client","Labor","100","Active budget version","120","ERP ledger","","0","120","-20"',
    ].join('\r\n'));
  });

  it('includes the All scope and recorded provenance in the exported rows', () => {
    const rows: BudgetComparisonRow[] = [
      { category: 'Labor', budgetTotal: 0, recorded: 0, recordedAsOf: '2026-04-05T12:30:00Z', mapped: true, hasLedger: true, remaining: 0, percentUsed: null },
    ];
    const csv = buildBudgetProjectionCsv({ scope: { kind: 'all' }, rows }, options);

    expect(csv).toContain('"All years (project to date)","","Labor"');
    expect(csv).toContain('"ERP ledger","2026-04-05T12:30:00Z"');
  });

  it('keeps scope metadata and provenance when the selected fiscal year is exported', () => {
    const rows: BudgetProjectionCellRow[] = [
      { category: 'Labor', pmoBudgetAmount: 100, actualsToDate: 120, actualsAsOf: '2026-02-03T00:00:00Z', pmoEtc: 0, projectedFinalCost: 120, projectedVariance: -20, projectedUtilization: 1.2, attributionKnown: true },
    ];
    const csv = buildBudgetProjectionCsv({ scope: { kind: 'year', year: 'FY-client' }, rows }, options);

    expect(csv).toContain('"Fiscal year","FY-client","Labor"');
    expect(csv).toContain('"ERP ledger","2026-02-03T00:00:00Z"');
  });

  it('quotes commas, line breaks, and embedded quotes in category labels', () => {
    const rows: BudgetComparisonRow[] = [
      { category: 'Labor', budgetTotal: 1, recorded: 1, recordedAsOf: null, mapped: true, hasLedger: true, remaining: 0, percentUsed: 1 },
    ];

    expect(buildBudgetProjectionCsv({ scope: { kind: 'all' }, rows }, {
      ...options,
      categoryLabel: () => 'Labor, "regional"\nteam',
    })).toContain('"All years (project to date)","","Labor, ""regional""\nteam","1"');
  });
});
