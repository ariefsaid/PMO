import { describe, expect, it } from 'vitest';
import { summariseManpowerToFill } from './waitingManpower';
import { buildNeedsItems } from '@/src/components/dashboard/restructure/useNeedsYou';

/** AC-MPN-011: the pointer is derived from the rows; nothing is stored, so no rows means no pointer. */
const translate = (key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/gu, (_, v: string) => String(options?.[v] ?? ''));

describe('manpower to-fill pointer', () => {
  const rows = [
    { need_id: 'a', project_id: 'p1', needed_by: '2999-03-10', open_count: 2 },
    { need_id: 'b', project_id: 'p1', needed_by: '2999-02-01', open_count: 3 },
  ];

  it('sums the open places and takes the earliest date', () => {
    expect(summariseManpowerToFill(rows)).toEqual({ count: 2, openPlaces: 5, earliestNeededBy: '2999-02-01', href: '/crews?view=manpower' });
  });

  it('is absent with no rows (a met or cancelled need is simply not read)', () => {
    expect(summariseManpowerToFill([])).toBeNull();
  });

  it('shows in the needs-you list for any role, including an Engineer who holds the HR capability', () => {
    const fact = summariseManpowerToFill(rows)!;
    for (const role of ['Engineer', 'Project Manager', 'Admin'] as const) {
      const item = buildNeedsItems(role, { waitingManpower: fact }, translate, 'IDR').find((i) => i.id === 'manpower-to-fill');
      expect(item).toMatchObject({ count: 2, label: 'manpower needs with places to fill', href: '/crews?view=manpower', tone: 'warn' });
      expect(item?.detail).toContain('5 places open');
    }
  });

  it('adds nothing without the fact, and says place in the singular', () => {
    expect(buildNeedsItems('Admin', {}, translate, 'IDR').some((i) => i.id === 'manpower-to-fill')).toBe(false);
    const one = summariseManpowerToFill([{ need_id: 'a', project_id: 'p', needed_by: '2999-01-01', open_count: 1 }])!;
    const item = buildNeedsItems('Admin', { waitingManpower: one }, translate, 'IDR').find((i) => i.id === 'manpower-to-fill');
    expect(item).toMatchObject({ label: 'manpower need with places to fill' });
    expect(item?.detail).toContain('1 place open');
  });
});
