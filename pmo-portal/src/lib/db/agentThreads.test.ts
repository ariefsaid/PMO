import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible chainable mock of the supabase query builder (mirrors userViews.test.ts's
// pattern — the reference DAL slice this file follows).
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    is: [] as unknown[],
    order: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select');
  builder.is = chain('is');
  builder.order = chain('order');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listAgentThreads } from './agentThreads';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-AGP-019 listAgentThreads', () => {
  it('listAgentThreads orders pinned above unpinned then by recency, never sends org_id/owner_id', async () => {
    h.result.value = {
      data: [
        { id: 't1', title: 'Pinned thread', pinned_at: '2026-07-01T00:00:00Z', archived_at: null },
        { id: 't2', title: 'Recent unpinned', pinned_at: null, archived_at: null },
      ],
      error: null,
    };
    const rows = await listAgentThreads();

    expect(h.calls.from).toEqual(['agent_threads']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    // pinned-first (nulls last), then recency
    expect(h.calls.order).toContainEqual(['pinned_at', { ascending: false, nullsFirst: false }]);
    expect(h.calls.order).toContainEqual(['updated_at', { ascending: false }]);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(JSON.stringify(h.calls)).not.toContain('owner_id');
    expect(rows[0].id).toBe('t1');
  });

  it('returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(listAgentThreads()).resolves.toEqual([]);
  });

  it('throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listAgentThreads()).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(listAgentThreads()).rejects.toBeInstanceOf(AppError);
  });
});
