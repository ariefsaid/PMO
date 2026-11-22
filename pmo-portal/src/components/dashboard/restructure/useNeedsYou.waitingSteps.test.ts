import { describe, expect, it } from 'vitest';
import { buildNeedsItems } from './useNeedsYou';

const translate = (key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/gu, (_, variable: string) => String(options?.[variable] ?? ''));

describe('needs-you billing step pointer (AC-CBS-012)', () => {
  const fact = { count: 2, overdue: 1, oldestOverdueDays: 7, href: '/projects/p1/billing' };

  it('shows one pointer with the count, the oldest overdue days and a link to the billing tab', () => {
    const items = buildNeedsItems('Finance', { waitingBillingSteps: fact }, translate, 'IDR');
    expect(items).toEqual([expect.objectContaining({
      id: 'billing-steps-waiting', count: 2, label: 'billing steps waiting on your role', detail: 'oldest 7 days overdue',
      href: '/projects/p1/billing', tone: 'lost',
    })]);
  });

  it('is a warning with no detail while nothing is overdue, and singular for one step', () => {
    const [item] = buildNeedsItems('Project Manager', { waitingBillingSteps: { count: 1, overdue: 0, oldestOverdueDays: null, href: '/projects' } }, translate, 'IDR');
    expect(item).toMatchObject({ id: 'billing-steps-waiting', count: 1, label: 'billing step waiting on your role', tone: 'warn', detail: undefined });
  });

  it('adds no item when there are none, the read is unread or failed, or the viewer is an Engineer', () => {
    expect(buildNeedsItems('Finance', {}, translate, 'IDR').some((i) => i.id === 'billing-steps-waiting')).toBe(false);
    expect(buildNeedsItems('Engineer', { waitingBillingSteps: fact }, translate, 'IDR')).toEqual([]);
  });
});

describe('needs-you work-order billing step pointer (AC-WBS-009)', () => {
  const fact = { count: 2, overdue: 1, href: '/work-orders' };

  it('shows one pointer for every role, with the overdue count, linking to the work order or list', () => {
    for (const role of ['Engineer', 'Finance', 'Project Manager'] as const) {
      const item = buildNeedsItems(role, { waitingWorkOrderSteps: fact }, translate, 'IDR').find((i) => i.id === 'work-order-steps-waiting');
      expect(item).toMatchObject({ count: 2, label: 'work-order billing steps waiting for you', detail: '1 past target', href: '/work-orders', tone: 'lost' });
    }
  });

  it('adds no item when nothing waits', () => {
    expect(buildNeedsItems('Finance', {}, translate, 'IDR').some((i) => i.id === 'work-order-steps-waiting')).toBe(false);
  });
});
