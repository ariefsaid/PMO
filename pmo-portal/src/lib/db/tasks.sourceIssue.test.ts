import { describe, it, expect, vi, beforeEach } from 'vitest';

// The tasks.recordLink.test.ts idiom: a chainable builder that records every call.
const h = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  const result = { value: { data: [] as unknown, error: null as unknown } };
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'single', 'limit', 'maybeSingle']) {
    builder[m] = (...args: unknown[]) => { calls.push([m, args]); return builder; };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  return { calls, result, from: vi.fn(() => builder), rpc: vi.fn() };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { sourceIssuesOfTasks } from './tasks';

const has = (m: string, ...args: unknown[]) =>
  h.calls.some(([name, a]) => name === m && JSON.stringify(a) === JSON.stringify(args));

beforeEach(() => { h.calls.length = 0; h.result.value = { data: [], error: null }; });

describe('JOB-F17 the issue a task was made from', () => {
  it('reads the incident_tasks join for the page ids in ONE call and maps task → issue', async () => {
    h.result.value = { data: [{ task_id: 't1', incident_id: 'i1' }, { task_id: 't2', incident_id: 'i2' }], error: null };
    const map = await sourceIssuesOfTasks(['t1', 't2', 't1']);
    expect(h.from).toHaveBeenCalledWith('incident_tasks');
    expect(has('select', 'task_id, incident_id')).toBe(true);
    expect(has('in', 'task_id', ['t1', 't2'])).toBe(true);
    expect(map.get('t1')).toBe('i1');
    expect(map.get('t2')).toBe('i2');
  });

  it('makes no request for an empty page', async () => {
    expect((await sourceIssuesOfTasks([])).size).toBe(0);
    expect(h.from).not.toHaveBeenCalled();
  });

  it('splits a very large page into chunks', async () => {
    h.result.value = { data: [], error: null };
    await sourceIssuesOfTasks(Array.from({ length: 250 }, (_, i) => `t${i}`));
    expect(h.from).toHaveBeenCalledTimes(3);
  });

  it('throws when the read fails', async () => {
    h.result.value = { data: null, error: { message: 'read refused', code: '42501' } };
    await expect(sourceIssuesOfTasks(['t1'])).rejects.toThrow('read refused');
  });
});
