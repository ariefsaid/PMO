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

describe('needs-you ahead-of-progress pointer (AC-MVP-012)', () => {
  it('shows one pointer with the count and a link to the project\'s work orders', () => {
    const items = buildNeedsItems('Project Manager', { waitingMaterialAlerts: { count: 2, href: '/projects/p1/work-orders' } }, translate, 'IDR');
    expect(items).toEqual([expect.objectContaining({
      id: 'material-ahead-of-progress', count: 2, label: 'work orders with material ahead of progress', href: '/projects/p1/work-orders', tone: 'warn',
    })]);
  });

  it('is singular for one work order, and any role listed as a recipient sees it (an Engineer too)', () => {
    const [item] = buildNeedsItems('Engineer', { waitingMaterialAlerts: { count: 1, href: '/projects' } }, translate, 'IDR');
    expect(item).toMatchObject({ id: 'material-ahead-of-progress', count: 1, label: 'work order with material ahead of progress' });
  });

  it('adds nothing when there are none, or the read is unread or failed', () => {
    expect(buildNeedsItems('Project Manager', {}, translate, 'IDR').some((i) => i.id === 'material-ahead-of-progress')).toBe(false);
  });
});
