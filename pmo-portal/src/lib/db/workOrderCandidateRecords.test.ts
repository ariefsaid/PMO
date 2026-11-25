import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => {
  const result = { value: { data: [] as unknown, error: null as unknown } };
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'order', 'limit'] as const) builder[k] = (...a: unknown[]) => { calls.push([k, a]); return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  return { calls, result, from: vi.fn(() => builder) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listCandidateRecords } from './workOrderCandidateRecords';

beforeEach(() => { h.calls.length = 0; h.result.value = { data: [], error: null }; });

describe('AC-WOC-005 earlier candidate work orders stay readable', () => {
  it('lists a project\'s candidates newest first with their checks in order', async () => {
    h.result.value = { data: [{ id: 'c1', title: 'T', client_reference: 'R', offered_on: '2026-11-20', status: 'rejected', decision_reason: 'Deferred', work_order_id: null,
      items: [{ label: 'B', position: 2, status: 'open', note: null }, { label: 'A', position: 1, status: 'passed', note: 'ok' }] }], error: null };
    const rows = await listCandidateRecords('p1');
    expect(h.calls).toContainEqual(['eq', ['project_id', 'p1']]);
    expect(h.calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(rows[0].items.map((i) => i.label)).toEqual(['A', 'B']);
    expect(rows[0].decision_reason).toBe('Deferred');
  });
  it('refuses a status it does not know rather than showing it', async () => {
    h.result.value = { data: [{ id: 'c1', status: 'weird', items: [] }], error: null };
    await expect(listCandidateRecords('p1')).rejects.toBeInstanceOf(AppError);
  });
});
