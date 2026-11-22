/** AC-WCI-060 — a phone check-in waiting for this person's decision appears in the list the app already shows for things needing them. */
import { describe, expect, it } from 'vitest';
import { buildNeedsItems } from './useNeedsYou';

const translate = (key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/gu, (_, variable: string) => String(options?.[variable] ?? ''));

describe('needs-you check-ins waiting', () => {
  it('names the count and links to the Crews page, where each request has Approve and Reject', () => {
    const items = buildNeedsItems('Engineer', { checkInsWaiting: 2 }, translate, 'IDR');
    expect(items).toEqual([expect.objectContaining({ id: 'check-ins-waiting', count: 2, label: 'check-ins waiting for your decision', href: '/crews', tone: 'warn' })]);
  });
  it('is singular for one, and shown to every role that can decide (the database lists only what the person may decide)', () => {
    for (const role of ['Engineer', 'Project Manager', 'Executive', 'Admin', 'Finance'] as const) {
      expect(buildNeedsItems(role, { checkInsWaiting: 1 }, translate, 'IDR').find((i) => i.id === 'check-ins-waiting')?.label).toBe('check-in waiting for your decision');
    }
  });
  it('adds nothing for none, or while unread or failed', () => {
    expect(buildNeedsItems('Engineer', { checkInsWaiting: 0 }, translate, 'IDR')).toEqual([]);
    expect(buildNeedsItems('Engineer', {}, translate, 'IDR')).toEqual([]);
  });
});
