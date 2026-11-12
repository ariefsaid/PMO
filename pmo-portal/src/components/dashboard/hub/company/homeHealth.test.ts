import { describe, expect, it } from 'vitest';
import type { AttentionProject } from '@/src/lib/db/dashboard';
import { bulletFor, healthOrder } from './homeHealth';

const row = (id: string, over: Partial<AttentionProject> = {}): AttentionProject => ({
  id, name: id, client_name: null, contract_value: 1000, currency: 'USD', budget: 100, spent: 10, actual_complete: true, actual_currency: 'USD', budget_currency: 'USD', status: 'Ongoing Project',
  attention_signals: 0, overdue_items: 0, overdue_tasks: 0, overdue_milestones: 0, overdue_invoices: 0, waiting_approvals: 0, over_budget: false, budget_used_ratio: 0.1, ...over,
});

describe('project health order (worst first)', () => {
  it('puts off-track projects first, then more kinds of trouble, then more overdue items, then budget used', () => {
    const rows = [
      row('fine-high-budget', { budget_used_ratio: 0.9 }),
      row('one-signal', { attention_signals: 1, overdue_tasks: 9, overdue_items: 9 }),
      row('two-signals', { attention_signals: 2, overdue_tasks: 1, overdue_items: 1, over_budget: true }),
      row('fine-low-budget', { budget_used_ratio: 0.2 }),
      row('one-signal-more', { attention_signals: 1, overdue_milestones: 12 }),
    ];
    expect(healthOrder(rows).map((r) => r.id)).toEqual(['two-signals', 'one-signal-more', 'one-signal', 'fine-high-budget', 'fine-low-budget']);
  });

  it('caps at six rows', () => {
    expect(healthOrder(Array.from({ length: 9 }, (_, i) => row(`p${i}`)))).toHaveLength(6);
  });

  it('an unknown overdue-task count is not counted as zero trouble or as trouble', () => {
    const unknown = row('unknown', { overdue_tasks: null as unknown as number });
    expect(() => healthOrder([unknown, row('x')])).not.toThrow();
  });
});

describe('budget-vs-actual bullet', () => {
  it('fill = spent / budget, tick = share delivered; within plan uses the data hue', () => {
    expect(bulletFor(row('a', { budget: 6_900_000, spent: 2_100_000 }), 51)).toEqual({ spent: 2_100_000 / 6_900_000, delivered: 0.51, tone: 'data' });
  });
  it('spending ahead of delivery is the warning tone', () => {
    expect(bulletFor(row('a', { budget: 100, spent: 60 }), 40)?.tone).toBe('ahead');
  });
  it('spending past the budget is over, even with no delivery figure', () => {
    expect(bulletFor(row('a', { budget: 100, spent: 120 }), null)).toEqual({ spent: 1.2, delivered: null, tone: 'over' });
  });
  it('incomplete or other-currency spending is unknown, never zero', () => {
    expect(bulletFor(row('a', { actual_complete: false }), 50)?.spent).toBeNull();
    expect(bulletFor(row('a', { actual_currency: 'IDR' }), 50)?.spent).toBeNull();
    expect(bulletFor(row('a', { spent: null }), 50)?.spent).toBeNull();
  });
  it('a recorded zero is a zero', () => {
    expect(bulletFor(row('a', { spent: 0 }), 10)?.spent).toBe(0);
  });
  it('no active budget draws no bullet', () => {
    expect(bulletFor(row('a', { budget: null }), 10)).toBeNull();
  });
  it('clamps the delivered tick to the track', () => {
    expect(bulletFor(row('a'), 140)?.delivered).toBe(1);
  });
});
