import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AC-CUA-002 (supports) — Slice C, C5/C5b. A ClickUp-native delete tombstones the mirrored `tasks`
 * row (`tombstoned_at`, C3) rather than removing it — every task READ path must exclude tombstoned
 * rows so a deleted-upstream task disappears from the active project view (list/board — and
 * transitively Gantt/S-curve, both of which consume `listTasks`) and cannot be opened by id.
 */

const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    is: [] as unknown[],
    order: [] as unknown[],
    maybeSingle: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'maybeSingle') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.is = chain('is');
  builder.order = chain('order');
  builder.maybeSingle = chain('maybeSingle');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listTasks, getTask } from './tasks';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-CUA-002 listTasks excludes tombstoned rows (C5)', () => {
  it('filters .is(tombstoned_at, null) and a tombstoned row never appears in the project list', async () => {
    h.result.value = {
      data: [
        { id: 't1', project_id: 'p1', name: 'Live task', status: 'To Do', assignee: null, dependencies: [] },
      ],
      error: null,
    };
    const rows = await listTasks('p1');
    expect(h.calls.is).toContainEqual(['tombstoned_at', null]);
    // Gantt/S-curve consume listTasks directly — no separate query to also filter.
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('t1');
  });
});

describe('AC-CUA-002 getTask excludes a tombstoned row (C5b)', () => {
  it('filters .is(tombstoned_at, null) — a live row still resolves', async () => {
    h.result.value = { data: { id: 't1', name: 'Live', status: 'To Do' }, error: null };
    const row = await getTask('t1');
    expect(h.calls.is).toContainEqual(['tombstoned_at', null]);
    expect(row?.id).toBe('t1');
  });

  it('a tombstoned row resolves as null (the query itself excludes it → no data)', async () => {
    h.result.value = { data: null, error: null };
    await expect(getTask('tombstoned-1')).resolves.toBeNull();
  });
});
