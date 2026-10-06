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
    range: [] as unknown[],
    or: [] as unknown[],
    limit: [] as unknown[],
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
  builder.range = chain('range');
  builder.or = chain('or');
  builder.limit = chain('limit');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listNotifications, listNotificationsPage, listUnreadCount, markNotificationRead } from './notifications';
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

  it('data-layer perf hardening #4: does NOT range-bound the query when called with no params (opt-in pagination)', async () => {
    h.result.value = { data: [], error: null, count: null };
    await listNotifications();
    expect(h.calls.range).toEqual([]);
  });

  it('data-layer perf hardening #4: applies an explicit page/pageSize range', async () => {
    h.result.value = { data: [], error: null, count: null };
    await listNotifications({ page: 1, pageSize: 30 });
    expect(h.calls.range).toContainEqual([30, 59]);
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
    h.result.value = { data: [{ id: 'n1' }], error: null, count: null };
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

  it('#534: a using-denied update (0 rows matched, no error) throws 42501 instead of resolving as success', async () => {
    h.result.value = { data: [], error: null, count: null };
    await expect(markNotificationRead('n1')).rejects.toBeInstanceOf(AppError);
    await expect(markNotificationRead('n1')).rejects.toMatchObject({ code: '42501' });
    expect(h.calls.update.length).toBeGreaterThan(0);
  });
});

describe('#843 listNotificationsPage (keyset paging)', () => {
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `n${i}`,
      created_at: `2026-07-01T00:00:${String(59 - i).padStart(2, '0')}+00:00`,
    }));

  it('AC-843-001 orders created_at desc then id desc, with an explicit column list and no org/owner', async () => {
    h.result.value = { data: [], error: null, count: null };
    await listNotificationsPage();
    expect(h.calls.from).toEqual(['notifications']);
    expect(h.calls.order).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]]);
    const cols = String(h.calls.select[0]);
    expect(cols).not.toBe('*');
    expect(cols).not.toContain('*');
    expect(cols).not.toContain('org_id');
    expect(cols).not.toContain('owner_id');
    for (const c of ['id', 'title', 'body', 'severity', 'metadata', 'read_at', 'created_at']) {
      expect(cols.split(',')).toContain(c);
    }
  });

  it('AC-843-002 fetches pageSize+1 and returns a nextCursor only when more rows exist', async () => {
    h.result.value = { data: mk(4), error: null, count: null };
    const page = await listNotificationsPage({ pageSize: 3 });
    expect(h.calls.limit).toContainEqual(4);
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).toEqual({ createdAt: mk(3)[2].created_at, id: 'n2' });

    h.result.value = { data: mk(3), error: null, count: null };
    const last = await listNotificationsPage({ pageSize: 3 });
    expect(last.rows).toHaveLength(3);
    expect(last.nextCursor).toBeNull();
  });

  it('AC-843-003 a cursor adds the keyset filter on (created_at, id)', async () => {
    h.result.value = { data: [], error: null, count: null };
    await listNotificationsPage({ cursor: { createdAt: '2026-07-01T00:00:10+00:00', id: 'abc' } });
    expect(h.calls.or).toContainEqual(
      'created_at.lt.2026-07-01T00:00:10+00:00,and(created_at.eq.2026-07-01T00:00:10+00:00,id.lt.abc)',
    );
  });

  it('AC-843-004 unreadOnly filters read_at is null server-side', async () => {
    h.result.value = { data: [], error: null, count: null };
    await listNotificationsPage({ unreadOnly: true });
    expect(h.calls.is).toContainEqual(['read_at', null]);
    h.calls.is.length = 0;
    await listNotificationsPage();
    expect(h.calls.is).toEqual([]);
  });

  it('throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' }, count: null };
    await expect(listNotificationsPage()).rejects.toMatchObject({ code: '42501' });
  });
});
