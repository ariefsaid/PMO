import { describe, expect, it } from 'vitest';
import { buildNeedsItems } from './useNeedsYou';

const translate = (key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/gu, (_, variable: string) => String(options?.[variable] ?? ''));

describe('needs-you close-out item pointer (#2907)', () => {
  const fact = { count: 2, overdue: 1, href: '/work-orders' };

  it('shows one pointer for every role, with the overdue count, linking to the work order or list', () => {
    for (const role of ['Engineer', 'Finance', 'Project Manager'] as const) {
      const item = buildNeedsItems(role, { waitingCloseoutItems: fact }, translate, 'IDR').find((i) => i.id === 'closeout-items-waiting');
      expect(item).toMatchObject({ count: 2, label: 'close-out items waiting on your role', detail: '1 past target', href: '/work-orders', tone: 'lost' });
    }
  });

  it('is a warning, singular, with no detail while nothing is overdue', () => {
    const [item] = buildNeedsItems('Project Manager', { waitingCloseoutItems: { count: 1, overdue: 0, href: '/work-orders/w1' } }, translate, 'IDR');
    expect(item).toMatchObject({ id: 'closeout-items-waiting', count: 1, label: 'close-out item waiting on your role', tone: 'warn', detail: undefined });
  });

  it('adds no item when none waits, the read is unread or it failed', () => {
    expect(buildNeedsItems('Project Manager', {}, translate, 'IDR').some((i) => i.id === 'closeout-items-waiting')).toBe(false);
  });
});
