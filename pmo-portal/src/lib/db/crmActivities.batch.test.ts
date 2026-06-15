/**
 * C3 — listActivitiesForContacts issues ONE query for N contact ids.
 *
 * The N+1 pattern (one listActivities call per contact) is replaced by a single
 * .in('contact_id', ids) query that exploits crm_activities_contact_idx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    in: [] as unknown[],
    order: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select');
  builder.in = chain('in');
  builder.order = chain('order');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listActivitiesForContacts } from './crmActivities';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('C3: listActivitiesForContacts — single batch query', () => {
  it('issues exactly ONE query to crm_activities for N contact ids', async () => {
    const rows = [
      { id: 'a1', contact_id: 'ct1', occurred_at: '2026-06-10T10:00:00Z' },
      { id: 'a2', contact_id: 'ct2', occurred_at: '2026-06-09T10:00:00Z' },
    ];
    h.result.value = { data: rows, error: null };

    const result = await listActivitiesForContacts(['ct1', 'ct2']);

    // ONE supabase.from call, not two
    expect(h.from).toHaveBeenCalledTimes(1);
    expect(h.calls.from).toEqual(['crm_activities']);

    // Uses .in() not .eq()
    expect(h.calls.in).toHaveLength(1);
    expect(h.calls.in[0]).toEqual(['contact_id', ['ct1', 'ct2']]);

    // ordered newest-first
    expect(h.calls.order).toContainEqual(['occurred_at', { ascending: false }]);

    // org_id never sent
    expect(JSON.stringify(h.calls)).not.toContain('org_id');

    expect(result).toEqual(rows);
  });

  it('returns [] without hitting the DB when contactIds is empty', async () => {
    const result = await listActivitiesForContacts([]);

    expect(h.from).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };

    const result = await listActivitiesForContacts(['ct1']);

    expect(result).toEqual([]);
  });

  it('throws AppError preserving code on query error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };

    await expect(listActivitiesForContacts(['ct1'])).rejects.toBeInstanceOf(AppError);
  });
});
