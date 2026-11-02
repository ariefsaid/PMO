import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const inCalls: Array<[string, string[]]> = [];
  const state = { rows: [] as unknown[], error: null as unknown, tables: [] as string[] };
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.in = (col: string, ids: string[]) => {
    inCalls.push([col, ids]);
    return builder;
  };
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: state.rows, error: state.error });
  const from = vi.fn((t: string) => {
    state.tables.push(t);
    return builder;
  });
  return { from, inCalls, state };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { getOpportunitiesByIds } from './opportunity';
import { getCompaniesByIds } from './companies';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

beforeEach(() => {
  h.inCalls.length = 0;
  h.state.rows = [];
  h.state.error = null;
  h.state.tables.length = 0;
});

describe.each([
  ['getOpportunitiesByIds', getOpportunitiesByIds, 'projects'],
  ['getCompaniesByIds', getCompaniesByIds, 'companies'],
] as const)('%s', (_name, fn, table) => {
  it('reads nothing for an empty id list', async () => {
    expect(await fn([])).toEqual([]);
    expect(h.from).not.toHaveBeenCalled();
  });

  it('reads every id in bounded .in(id) chunks, deduplicated, and returns the rows found', async () => {
    h.state.rows = [{ id: 'id-0' }];
    const out = await fn([...ids(250), 'id-0']);
    expect(h.inCalls.map(([col]) => col)).toEqual(['id', 'id', 'id']);
    expect(h.inCalls.map(([, c]) => c.length)).toEqual([100, 100, 50]);
    expect(new Set(h.state.tables)).toEqual(new Set([table]));
    expect(out).toHaveLength(3); // one row returned per chunk; inaccessible ids are simply absent
  });

  it('throws when a chunk read fails instead of returning a partial set', async () => {
    h.state.error = { message: 'boom', code: '500' };
    await expect(fn(ids(3))).rejects.toThrow('boom');
  });
});
