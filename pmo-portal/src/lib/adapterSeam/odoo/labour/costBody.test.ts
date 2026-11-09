import { describe, expect, it } from 'vitest';
import { buildCostEntry, type CostEntryInput } from './costBody.ts';

const input = (over: Partial<CostEntryInput> = {}): CostEntryInput => ({
  batch: { periodEnd: '2026-10-31', currency: 'IDR' },
  lines: [
    { projectId: 'p2', projectCode: 'P-2', analyticAccountId: 78, deltaCents: 50_000_000 },
    { projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 100_000_000 },
  ],
  maps: { journalId: 9, expenseAccountId: 41, payableAccountId: 42 },
  companyCurrency: 'IDR',
  ...over,
});

type Line = [0, 0, Record<string, unknown>];
const lines = (body: Record<string, unknown>) => body.line_ids as Line[];
const side = (body: Record<string, unknown>, which: 'debit' | 'credit') =>
  lines(body).reduce((sum, [, , line]) => sum + Math.round(Number(line[which]) * 100), 0);
const names = (body: Record<string, unknown>) => lines(body).map(([, , line]) => line.name);

describe('odoo/labour/costBody — AC-OLH-030 the payroll journal body', () => {
  it('AC-OLH-030 one expense line per project on its analytic account at 100 %, one payable line for the total', () => {
    const built = buildCostEntry(input());
    expect(built.outcome).toBe('ready');
    if (built.outcome !== 'ready') return;
    expect(built.body).toEqual({
      move_type: 'entry',
      journal_id: 9,
      date: '2026-10-31',
      ref: 'PMO labour 2026-10',
      line_ids: [
        [0, 0, { account_id: 41, name: 'Labour · P-1', debit: '1000000.00', credit: '0.00', analytic_distribution: { '77': 100 } }],
        [0, 0, { account_id: 41, name: 'Labour · P-2', debit: '500000.00', credit: '0.00', analytic_distribution: { '78': 100 } }],
        [0, 0, { account_id: 42, name: 'Payroll payable', debit: '0.00', credit: '1500000.00' }],
      ],
    });
  });

  it('AC-OLH-030 lines are ordered by project code, whatever order the allocations arrive in', () => {
    const built = buildCostEntry(input({
      lines: [
        { projectId: 'p3', projectCode: 'P-30', analyticAccountId: 80, deltaCents: 300 },
        { projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 100 },
        { projectId: 'p2', projectCode: 'P-2', analyticAccountId: 78, deltaCents: 200 },
      ],
    }));
    if (built.outcome !== 'ready') throw new Error(built.outcome);
    expect(names(built.body)).toEqual(['Labour · P-1', 'Labour · P-2', 'Labour · P-30', 'Payroll payable']);
  });

  it('AC-OLH-030 a revision that lowers one project posts the negative delta on the credit side (plan L5-T4)', () => {
    const built = buildCostEntry(input({
      lines: [
        { projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 200_000 },
        { projectId: 'p2', projectCode: 'P-2', analyticAccountId: 78, deltaCents: -100_000 },
      ],
    }));
    if (built.outcome !== 'ready') throw new Error(built.outcome);
    expect(built.body.line_ids).toEqual([
      [0, 0, { account_id: 41, name: 'Labour · P-1', debit: '2000.00', credit: '0.00', analytic_distribution: { '77': 100 } }],
      [0, 0, { account_id: 41, name: 'Labour · P-2', debit: '0.00', credit: '1000.00', analytic_distribution: { '78': 100 } }],
      [0, 0, { account_id: 42, name: 'Payroll payable', debit: '0.00', credit: '1000.00' }],
    ]);
    expect(side(built.body, 'debit')).toBe(200_000);
    expect(side(built.body, 'credit')).toBe(200_000);
  });

  it('AC-OLH-030 an all-negative revision reverses: the expense line credits and the payable line debits', () => {
    const built = buildCostEntry(input({
      lines: [{ projectId: 'p2', projectCode: 'P-2', analyticAccountId: 78, deltaCents: -100_000 }],
    }));
    expect(built).not.toEqual({ outcome: 'settled' });
    if (built.outcome !== 'ready') throw new Error(built.outcome);
    expect(built.body.line_ids).toEqual([
      [0, 0, { account_id: 41, name: 'Labour · P-2', debit: '0.00', credit: '1000.00', analytic_distribution: { '78': 100 } }],
      [0, 0, { account_id: 42, name: 'Payroll payable', debit: '1000.00', credit: '0.00' }],
    ]);
    expect(side(built.body, 'debit')).toBe(side(built.body, 'credit'));
  });

  it('AC-OLH-030 a net-zero revision still posts its two lines, and needs no payable leg to balance', () => {
    const built = buildCostEntry(input({
      lines: [
        { projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 100_000 },
        { projectId: 'p2', projectCode: 'P-2', analyticAccountId: 78, deltaCents: -100_000 },
      ],
    }));
    if (built.outcome !== 'ready') throw new Error(built.outcome);
    expect(names(built.body)).toEqual(['Labour · P-1', 'Labour · P-2']);
    expect(side(built.body, 'debit')).toBe(100_000);
    expect(side(built.body, 'credit')).toBe(100_000);
  });

  it('AC-OLH-030 the credit side is derived from the debit side, so a signed body always balances', () => {
    const built = buildCostEntry(input({
      lines: [
        { projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 123_457 },
        { projectId: 'p2', projectCode: 'P-2', analyticAccountId: 78, deltaCents: 999_999_999 },
        { projectId: 'p3', projectCode: 'P-3', analyticAccountId: 80, deltaCents: -42_222 },
      ],
    }));
    if (built.outcome !== 'ready') throw new Error(built.outcome);
    expect(side(built.body, 'debit')).toBe(side(built.body, 'credit'));
    expect(side(built.body, 'debit')).toBe(123_457 + 999_999_999);
    expect(lines(built.body).at(-1)![2].credit).toBe('10000812.34');
  });

  it('AC-OLH-030 a project with no analytic account refuses the build, naming the project code', () => {
    expect(buildCostEntry(input({
      lines: [
        { projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 100 },
        { projectId: 'p2', projectCode: 'P-2', analyticAccountId: null, deltaCents: 200 },
      ],
    }))).toEqual({ outcome: 'refused', code: 'project-unmapped', projectCode: 'P-2' });
  });

  it('AC-OLH-030 a credit-side delta needs its analytic account too, so an unmapped decrease refuses by name', () => {
    expect(buildCostEntry(input({
      lines: [{ projectId: 'p2', projectCode: 'P-2', analyticAccountId: null, deltaCents: -100_000 }],
    }))).toEqual({ outcome: 'refused', code: 'project-unmapped', projectCode: 'P-2' });
  });

  it('AC-OLH-030 an amount finer than a cent, a currency that is not the company currency, are refused by name', () => {
    expect(buildCostEntry(input({ lines: [{ projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 100.5 }] }))).toEqual({ outcome: 'refused', code: 'labour-cost-precision' });
    expect(buildCostEntry(input({ batch: { periodEnd: '2026-10-31', currency: 'USD' } }))).toEqual({ outcome: 'refused', code: 'labour-cost-currency' });
  });

  it('AC-OLH-030 settled means every delta is exactly zero, and nothing else', () => {
    expect(buildCostEntry(input({ lines: [] }))).toEqual({ outcome: 'settled' });
    expect(buildCostEntry(input({ lines: [{ projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 0 }] }))).toEqual({ outcome: 'settled' });
    expect(buildCostEntry(input({
      lines: [
        { projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 0 },
        { projectId: 'p2', projectCode: 'P-2', analyticAccountId: 78, deltaCents: 0 },
      ],
    }))).toEqual({ outcome: 'settled' });
  });

  it('AC-OLH-030 a zero delta line is left out of an entry that has other lines', () => {
    const built = buildCostEntry(input({
      lines: [
        { projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 0 },
        { projectId: 'p2', projectCode: 'P-2', analyticAccountId: 78, deltaCents: 200 },
      ],
    }));
    if (built.outcome !== 'ready') throw new Error(built.outcome);
    expect(names(built.body)).toEqual(['Labour · P-2', 'Payroll payable']);
  });

  it('AC-OLH-030 a period end that is not a day refuses to be the entry date', () => {
    expect(() => buildCostEntry(input({ batch: { periodEnd: '2026-10', currency: 'IDR' } }))).toThrow();
    expect(() => buildCostEntry(input({ batch: { periodEnd: '2026-02-30', currency: 'IDR' } }))).toThrow();
  });
});
