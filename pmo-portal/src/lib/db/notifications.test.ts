import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible chainable mock of the supabase query builder (mirrors agentThreads.test.ts's
// pattern — the reference DAL slice this file follows, REC-2).
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown, count: null as number | null } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    is: [] as unknown[],
    order: [] as unknown[],
    update: [] as unknown[],
    eq: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select');
  builder.is = chain('is');
  builder.order = chain('order');
  builder.update = chain('update');
  builder.eq = chain('eq');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listNotifications, listUnreadCount, markNotificationRead } from './notifications';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null, count: null };
});

describe('FR-AAN-035 listNotifications', () => {
  it('listNotifications orders created_at desc, never sends org_id/owner_id', async () => {
    h.result.value = {
      data: [
        { id: 'n1', title: 'First', created_at: '2026-07-01T00:00:00Z' },
        { id: 'n2', title: 'Second', created_at: '2026-07-02T00:00:00Z' },
      ],
      error: null,
      count: null,
    };
    const rows = await listNotifications();

    expect(h.calls.from).toEqual(['notifications']);
    expect(h.calls.order).toContainEqual(['created_at', { ascending: false }]);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(JSON.stringify(h.calls)).not.toContain('owner_id');
    expect(rows).toHaveLength(2);
  });

  it('returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null, count: null };
    await expect(listNotifications()).resolves.toEqual([]);
  });

  it('throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' }, count: null };
    await expect(listNotifications()).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(listNotifications()).rejects.toBeInstanceOf(AppError);
  });
});

describe('FR-AAN-034 listUnreadCount', () => {
  it('listUnreadCount uses the count:exact head:true fast path filtered on read_at is null', async () => {
    h.result.value = { data: null, error: null, count: 3 };
    const count = await listUnreadCount();

    expect(h.calls.from).toEqual(['notifications']);
    expect(h.calls.select).toContainEqual(['*', { count: 'exact', head: true }]);
    expect(h.calls.is).toContainEqual(['read_at', null]);
    expect(count).toBe(3);
  });

  it('returns 0 when count is null', async () => {
    h.result.value = { data: null, error: null, count: null };
    await expect(listUnreadCount()).resolves.toBe(0);
  });

  it('throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' }, count: null };
    await expect(listUnreadCount()).rejects.toMatchObject({ code: '42501' });
  });
});

describe('FR-AAN-036 markNotificationRead', () => {
  it('markNotificationRead sends only read_at, scoped by id', async () => {
    h.result.value = { data: null, error: null, count: null };
    await markNotificationRead('n1');

    expect(h.calls.from).toEqual(['notifications']);
    expect(h.calls.eq).toContainEqual(['id', 'n1']);
    expect(h.calls.update).toHaveLength(1);
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(['read_at']);
    expect(typeof patch.read_at).toBe('string');
  });

  it('throws AppError preserving the PG code on a denied/non-owner update', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' }, count: null };
    await expect(markNotificationRead('n1')).rejects.toMatchObject({ code: '42501' });
  });
});
