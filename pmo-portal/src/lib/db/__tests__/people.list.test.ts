import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * AC-FSF-001/002 — the People register's read shape. The DAL is the seam: these tests pin the
 * PostgREST filter each view sends, so the screen can never show former staff by accident and
 * the Active view stays byte-for-byte the query the register sent before #2703.
 */
const h = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; args: unknown[] }>,
  rows: [{ id: 'p1', code: 'P-0001', name: 'Budi', job_title: null, profile_id: null, archived_at: null }] as unknown[],
}));

const chain: Record<string, unknown> = {};
for (const op of ['select', 'is', 'not', 'order', 'range']) {
  chain[op] = (...args: unknown[]) => { h.calls.push({ op, args }); return chain; };
}
chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: h.rows, error: null }).then(res);
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: () => chain } }));

import { listPeople } from '../people';

describe('people register read shape (#2703)', () => {
  beforeEach(() => { h.calls = []; });

  it('AC-FSF-001 with no view chosen, asks for live people only', async () => {
    await listPeople();
    expect(h.calls.filter((c) => c.op === 'is')).toEqual([{ op: 'is', args: ['archived_at', null] }]);
    expect(h.calls.some((c) => c.op === 'not')).toBe(false);
  });

  it('AC-FSF-002 the Former staff view asks for archived people only', async () => {
    await listPeople('former');
    expect(h.calls.filter((c) => c.op === 'not')).toEqual([{ op: 'not', args: ['archived_at', 'is', null] }]);
    expect(h.calls.some((c) => c.op === 'is')).toBe(false);
  });

  it('AC-FSF-002 the All view asks for both, without an archive filter', async () => {
    await listPeople('all');
    expect(h.calls.some((c) => c.op === 'is')).toBe(false);
    expect(h.calls.some((c) => c.op === 'not')).toBe(false);
  });

  it('reads the archived_at column every view needs to name a row', async () => {
    await listPeople('all');
    expect(h.calls.find((c) => c.op === 'select')?.args[0]).toContain('archived_at');
  });
});
