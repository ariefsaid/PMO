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

const debits = (body: Record<string, unknown>) =>
  (body.line_ids as Array<[0, 0, Record<string, unknown>]>).reduce((sum, [, , line]) => sum + Math.round(Number(line.debit) * 100), 0);

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
    expect((built.body.line_ids as Array<[0, 0, { name: string }]>).map(([, , l]) => l.name)).toEqual(['Labour · P-1', 'Labour · P-2', 'Labour · P-30', 'Payroll payable']);
  });

  it('AC-OLH-030 the credit is derived from the debits, so it always equals their sum', () => {
    const built = buildCostEntry(input({
      lines: [
        { projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 123_457 },
        { projectId: 'p2', projectCode: 'P-2', analyticAccountId: 78, deltaCents: 999_999_999 },
      ],
    }));
    if (built.outcome !== 'ready') throw new Error(built.outcome);
    const lines = built.body.line_ids as Array<[0, 0, Record<string, unknown>]>;
    const credit = Math.round(Number(lines.at(-1)![2].credit) * 100);
    expect(credit).toBe(debits(built.body));
    expect(credit).toBe(123_457 + 999_999_999);
  });

  it('AC-OLH-030 a project with no analytic account refuses the build, naming the project code', () => {
    expect(buildCostEntry(input({
      lines: [
        { projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 100 },
        { projectId: 'p2', projectCode: 'P-2', analyticAccountId: null, deltaCents: 200 },
      ],
    }))).toEqual({ outcome: 'refused', code: 'project-unmapped', projectCode: 'P-2' });
  });

  it('AC-OLH-030 an amount finer than a cent, a currency that is not the company currency, are refused by name', () => {
    expect(buildCostEntry(input({ lines: [{ projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 100.5 }] }))).toEqual({ outcome: 'refused', code: 'labour-cost-precision' });
    expect(buildCostEntry(input({ batch: { periodEnd: '2026-10-31', currency: 'USD' } }))).toEqual({ outcome: 'refused', code: 'labour-cost-currency' });
  });

  it('AC-OLH-030 nothing to post is settled, not an empty journal entry', () => {
    expect(buildCostEntry(input({ lines: [] }))).toEqual({ outcome: 'settled' });
    expect(buildCostEntry(input({ lines: [{ projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 0 }] }))).toEqual({ outcome: 'settled' });
  });

  it('AC-OLH-030 a zero delta line is left out of an entry that has other lines, and negative deltas post nothing', () => {
    const built = buildCostEntry(input({
      lines: [
        { projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: 0 },
        { projectId: 'p2', projectCode: 'P-2', analyticAccountId: 78, deltaCents: 200 },
      ],
    }));
    if (built.outcome !== 'ready') throw new Error(built.outcome);
    expect((built.body.line_ids as Array<[0, 0, { name: string }]>).map(([, , l]) => l.name)).toEqual(['Labour · P-2', 'Payroll payable']);
    expect(buildCostEntry(input({ lines: [{ projectId: 'p1', projectCode: 'P-1', analyticAccountId: 77, deltaCents: -500 }] }))).toEqual({ outcome: 'settled' });
  });

  it('AC-OLH-030 a period end that is not a day refuses to be the entry date', () => {
    expect(() => buildCostEntry(input({ batch: { periodEnd: '2026-10', currency: 'IDR' } }))).toThrow();
    expect(() => buildCostEntry(input({ batch: { periodEnd: '2026-02-30', currency: 'IDR' } }))).toThrow();
  });
});
