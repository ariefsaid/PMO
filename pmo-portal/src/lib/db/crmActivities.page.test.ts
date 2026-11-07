/**
 * #1990 — the activity timelines read ONE page of the newest activity (keyset on
 * occurred_at desc, id desc), not every activity ever logged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    in: [] as unknown[],
    or: [] as unknown[],
    order: [] as unknown[],
    limit: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    return builder;
  };
  for (const k of ['select', 'eq', 'in', 'or', 'order', 'limit'] as const) builder[k] = chain(k);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import {
  ACTIVITY_PAGE_SIZE,
  listActivitiesPage,
  listActivitiesForContactsPage,
} from './crmActivities';
import { AppError } from '@/src/lib/appError';

const row = (i: number) => ({
  id: `a${String(i).padStart(3, '0')}`,
  contact_id: 'ct1',
  occurred_at: `2026-06-${String(30 - Math.floor(i / 10)).padStart(2, '0')}T10:0${i % 10}:00+00:00`,
});

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) (h.calls[k] as unknown[]).length = 0;
  h.result.value = { data: null, error: null };
});

describe('#1990 listActivitiesPage', () => {
  it('reads one page newest-first, asks for page+1 to prove more exist, and never sends org_id', async () => {
    h.result.value = { data: Array.from({ length: ACTIVITY_PAGE_SIZE + 1 }, (_, i) => row(i)), error: null };
    const page = await listActivitiesPage('ct1', null);
    expect(h.calls.eq).toContainEqual(['contact_id', 'ct1']);
    expect(h.calls.order).toEqual([
      ['occurred_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(h.calls.limit).toEqual([ACTIVITY_PAGE_SIZE + 1]);
    expect(h.calls.or).toHaveLength(0);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(page.rows).toHaveLength(ACTIVITY_PAGE_SIZE);
    const last = page.rows[ACTIVITY_PAGE_SIZE - 1];
    expect(page.nextCursor).toEqual({ occurred_at: last.occurred_at, id: last.id });
  });

  it('a short page has no next cursor (nothing older exists)', async () => {
    h.result.value = { data: [row(0), row(1)], error: null };
    const page = await listActivitiesPage('ct1', null);
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('a full page of exactly PAGE_SIZE rows has no next cursor (no phantom load-more)', async () => {
    h.result.value = { data: Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, i) => row(i)), error: null };
    expect((await listActivitiesPage('ct1', null)).nextCursor).toBeNull();
  });

  it('continues strictly after the cursor on (occurred_at, id) so same-instant rows are neither skipped nor repeated', async () => {
    h.result.value = { data: [], error: null };
    await listActivitiesPage('ct1', { occurred_at: '2026-06-10T10:00:00+00:00', id: 'a050' });
    expect(h.calls.or).toEqual([
      'occurred_at.lt.2026-06-10T10:00:00+00:00,and(occurred_at.eq.2026-06-10T10:00:00+00:00,id.lt.a050)',
    ]);
  });

  it('throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listActivitiesPage('ct1', null)).rejects.toMatchObject({ code: '42501' });
    await expect(listActivitiesPage('ct1', null)).rejects.toBeInstanceOf(AppError);
  });
});

describe('#1990 listActivitiesForContactsPage', () => {
  it('reads one page for N contacts in ONE query', async () => {
    h.result.value = { data: [row(0)], error: null };
    const page = await listActivitiesForContactsPage(['ct1', 'ct2'], null);
    expect(h.from).toHaveBeenCalledTimes(1);
    expect(h.calls.in).toEqual([['contact_id', ['ct1', 'ct2']]]);
    expect(h.calls.limit).toEqual([ACTIVITY_PAGE_SIZE + 1]);
    expect(page.rows).toHaveLength(1);
  });

  it('returns an empty page without hitting the DB when contactIds is empty', async () => {
    const page = await listActivitiesForContactsPage([], null);
    expect(h.from).not.toHaveBeenCalled();
    expect(page).toEqual({ rows: [], nextCursor: null });
  });
});
