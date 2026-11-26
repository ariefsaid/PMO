import { afterEach, expect, it, vi } from 'vitest';

const { single } = vi.hoisted(() => ({ single: vi.fn() }));
vi.mock('../e2e/support/jobFixtures', () => ({
  ORG_ID: 'test-org',
  serviceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  need: (_step: string, result: { data: unknown }) => result.data,
}));

import { orgDay } from '../e2e/support/orgDay';

afterEach(() => vi.useRealTimers());

it('reads the organisation timezone once and uses calendar offsets across UTC midnight', async () => {
  single.mockResolvedValue({ data: { default_timezone: 'Australia/Perth' }, error: null });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-31T16:30:00Z'));
  expect(await orgDay()).toBe('2026-02-01');
  vi.setSystemTime(new Date('2026-01-31T18:00:00Z'));
  expect(await orgDay()).toBe('2026-02-01');
  expect(await orgDay(-1)).toBe('2026-01-31');
  vi.setSystemTime(new Date('2026-01-31T23:30:00Z'));
  expect(await orgDay(1)).toBe('2026-02-02');
  expect(single).toHaveBeenCalledTimes(1);
});
