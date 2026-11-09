import { describe, expect, it } from 'vitest';
import { yearsInSpan } from './budgetDistribution';
import { categoryTotals, planFor, savedPlanMatchesDraft } from './savedDistribution';

const lines = [{ category: 'Labor' as const, budgeted_amount: 1000 }];
const calendar = [{ name: 'FY2026', start: '2026-01-01', end: '2026-12-31' }];
const plan = planFor(categoryTotals(lines), yearsInSpan('2026-02-01', '2026-06-30', calendar), '2026-02-01', '2026-06-30', 'by_days', {}, {});

describe('savedPlanMatchesDraft (#1273: the Budget tab gate, shared)', () => {
  it('AC-BAD-012 matches when lines, dates and the live ERPNext fiscal years are what the plan was saved on', () => {
    expect(savedPlanMatchesDraft(plan, lines, '2026-02-01', '2026-06-30', calendar)).toBe(true);
  });
  it('AC-BAD-012 does not match after an ERPNext fiscal-year change, a changed date, a changed line, or an unknown calendar', () => {
    expect(savedPlanMatchesDraft(plan, lines, '2026-02-01', '2026-06-30', [{ name: 'FY26', start: '2026-01-01', end: '2026-12-31' }])).toBe(false);
    expect(savedPlanMatchesDraft(plan, lines, '2026-02-01', '2026-07-31', calendar)).toBe(false);
    expect(savedPlanMatchesDraft(plan, [{ category: 'Labor', budgeted_amount: 1200 }], '2026-02-01', '2026-06-30', calendar)).toBe(false);
    expect(savedPlanMatchesDraft(plan, lines, '2026-02-01', '2026-06-30', null)).toBe(false);
    expect(savedPlanMatchesDraft(plan, lines, null, null, calendar)).toBe(false);
  });
});
