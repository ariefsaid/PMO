import { describe, expect, it, vi } from 'vitest';
import { runQueryEntity } from '../../../../supabase/functions/agent-chat/actions';
import { AGENT_AGGREGATE_ROW_CAP } from '../../../../supabase/functions/agent-chat/readEntities';
import { QUERY_ENTITY_SCHEMA } from '../../../../supabase/functions/agent-chat/schema';
import { fakeSupabase } from './testing/fakeSupabase';
import type { DeputyContext } from './runtime/port';

const ctxFor = (client: unknown): DeputyContext => ({ jwt: 'caller-jwt', userId: 'user-1', orgId: 'org-1', supabase: client as DeputyContext['supabase'] });

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: String(i), project_id: `p${i % 4}`, status: 'To Do' }));

describe('query_entity review regressions', () => {
  it('AC-ACC-006 caps aggregates at AGENT_AGGREGATE_ROW_CAP and marks totals partial', async () => {
    const source = rows(AGENT_AGGREGATE_ROW_CAP + 1);
    const { client } = fakeSupabase((call) => {
      const range = call.ops.find(([op]) => op === 'range');
      const offset = Number(range?.[1] ?? 0);
      const end = Number(range?.[2] ?? offset);
      return { data: source.slice(offset, end + 1), error: null };
    });
    const result = await runQueryEntity({ entity: 'tasks', group_by: 'project_id', filter: { column: 'project_id', op: 'in', value: ['p0', 'p1', 'p2', 'p3'] } }, ctxFor(client));
    expect(result).toMatchObject({ rowCount: 5000, truncated: true, note: expect.stringContaining('partial') });
    if ('groups' in result) expect(result.groups.reduce((n, g) => n + g.count, 0)).toBe(5000);
  });

  it('AC-ACC-007 refuses non-groupable columns before a read', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [], error: null }));
    const result = await runQueryEntity({ entity: 'tasks', group_by: 'name', filter: { column: 'project_id', op: 'eq', value: 'p1' } }, ctxFor(client));
    expect(result).toEqual({ error: 'column is not groupable: name' });
    expect(calls).toHaveLength(0);
  });

  it('AC-ACC-004 pages 1,200 rows and reports complete aggregate totals', async () => {
    const source = rows(1200);
    const { client, calls } = fakeSupabase((call) => {
      const range = call.ops.find(([op]) => op === 'range');
      const start = Number(range?.[1] ?? 0);
      const end = Number(range?.[2] ?? start);
      return { data: source.slice(start, Math.min(end + 1, start + 250)), error: null };
    });
    const result = await runQueryEntity({ entity: 'tasks', group_by: 'project_id', filter: { column: 'project_id', op: 'in', value: ['p0', 'p1', 'p2', 'p3'] } }, ctxFor(client));
    expect(result).toMatchObject({ rowCount: 1200, truncated: false });
    expect(calls.length).toBeGreaterThan(2);
    if ('groups' in result) expect(result.groups.reduce((n, g) => n + g.count, 0)).toBe(1200);
  });

  it('AC-ACC-004 fails closed when a later page returns a database error', async () => {
    const source = rows(1200);
    const { client } = fakeSupabase((call) => {
      const range = call.ops.find(([op]) => op === 'range');
      const start = Number(range?.[1] ?? 0);
      if (start > 0) return { data: null, error: { code: 'XX001', message: 'page failed' } };
      return { data: source.slice(0, 1000), error: null };
    });
    const result = await runQueryEntity({ entity: 'tasks', group_by: 'project_id', filter: { column: 'project_id', op: 'in', value: ['p0', 'p1', 'p2', 'p3'] } }, ctxFor(client));
    expect(result).toEqual({ error: 'query_entity db error', code: 'XX001', detail: 'page failed' });
  });

  it('AC-ACC-006 enforces one overall aggregate timeout across pages', async () => {
    vi.useFakeTimers();
    const source = rows(1000);
    const { client } = fakeSupabase((call) => {
      const range = call.ops.find(([op]) => op === 'range');
      const start = Number(range?.[1] ?? 0);
      if (start === 0) return { data: source, error: null };
      return new Promise(() => {}) as unknown as { data: unknown; error: unknown };
    });
    const pending = runQueryEntity({ entity: 'tasks', group_by: 'project_id', filter: { column: 'project_id', op: 'in', value: ['p0', 'p1', 'p2', 'p3'] } }, ctxFor(client));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ error: 'query_entity read timeout' });
    vi.useRealTimers();
  });

  it('AC-ACC-007 rejects invalid ordering and sum columns without a read', async () => {
    for (const input of [
      { entity: 'purchase_orders', order_by: { column: 'org_id', direction: 'asc' } },
      { entity: 'purchase_orders', group_by: 'procurement_id', sum: 'org_id' },
    ]) {
      const { client, calls } = fakeSupabase(() => ({ data: [], error: null }));
      expect(await runQueryEntity(input, ctxFor(client))).toMatchObject({ error: expect.any(String) });
      expect(calls).toHaveLength(0);
    }
  });

  it('AC-ACC-007 rejects a non-whitelisted order_by column before a read', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [], error: null }));
    expect(await runQueryEntity({ entity: 'purchase_orders', order_by: { column: 'org_id', direction: 'asc' } }, ctxFor(client)))
      .toEqual({ error: 'invalid order_by column or direction' });
    expect(calls).toHaveLength(0);
  });

  it('AC-ACC-007 rejects a non-whitelisted sum column before a read', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [], error: null }));
    expect(await runQueryEntity({ entity: 'purchase_orders', group_by: 'procurement_id', sum: 'org_id' }, ctxFor(client)))
      .toEqual({ error: 'unknown sum column: org_id' });
    expect(calls).toHaveLength(0);
  });

  it('AC-ACC-007 applies the archived tasks tombstone filter on reads', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [], error: null }));
    await runQueryEntity({ entity: 'tasks', filter: { column: 'project_id', op: 'eq', value: 'p1' } }, ctxFor(client));
    expect(calls[0].ops).toContainEqual(['is', 'archived_at', null]);
  });

  it('AC-ACC-007 schema is portable without references or anyOf', () => {
    const schemaText = JSON.stringify(QUERY_ENTITY_SCHEMA);
    expect(schemaText).not.toMatch(/"\$(?:ref|defs)"|"anyOf"/);
  });

  it('AC-ACC-007 returns the 200 largest groups and reports truncation', async () => {
    const source = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `popular-${i}`, code: 'popular' })),
      ...Array.from({ length: 201 }, (_, i) => ({ id: `id-${i}`, code: `small-${i}` })),
    ];
    const { client } = fakeSupabase((call) => {
      const range = call.ops.find(([op]) => op === 'range');
      const start = Number(range?.[1] ?? 0);
      const end = Number(range?.[2] ?? start);
      return { data: source.slice(start, end + 1), error: null };
    });
    const result = await runQueryEntity({ entity: 'procurements', group_by: 'code' }, ctxFor(client));
    expect(result).toMatchObject({ groupsTruncated: true, note: expect.stringContaining('200 largest groups') });
    if ('groups' in result) {
      expect(result.groups).toHaveLength(200);
      expect(result.groups.find((group) => group.key === 'popular')?.count).toBe(5);
      expect(result.groups.some((group) => group.key === 'small-200')).toBe(false);
    }
  });

  it('AC-ACC-007 ranks capped groups by sum when sum is requested', async () => {
    const source = [
      { id: 'high', code: 'high', total_value: 100 },
      ...Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}`, code: `small-${i}`, total_value: 1 })),
    ];
    const { client } = fakeSupabase((call) => {
      const range = call.ops.find(([op]) => op === 'range');
      const start = Number(range?.[1] ?? 0);
      const end = Number(range?.[2] ?? start);
      return { data: source.slice(start, end + 1), error: null };
    });
    const result = await runQueryEntity({ entity: 'procurements', group_by: 'code', sum: 'total_value' }, ctxFor(client));
    expect(result).toMatchObject({ groupsTruncated: true });
    if ('groups' in result) {
      expect(result.groups).toHaveLength(200);
      expect(result.groups[0]).toMatchObject({ key: 'high', sum: 100 });
      expect(result.groups.some((group) => group.key === 'small-199')).toBe(false);
    }
  });

  it('AC-ACC-003 dispatches lt/lte/gt/gte/neq, AND filters, and ordering', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [{ id: 't1', project_id: 'p1', end_date: '2026-10-01', status: 'To Do' }], error: null }));
    const result = await runQueryEntity({ entity: 'tasks', columns: ['id', 'end_date'], filter: [
      { column: 'project_id', op: 'eq', value: 'p1' },
      { column: 'end_date', op: 'lt', value: '2026-10-22' },
      { column: 'status', op: 'neq', value: 'Done' },
    ], order_by: { column: 'end_date', direction: 'asc' } }, ctxFor(client));
    expect(result).toMatchObject({ rowCount: 1, rows: [{ id: 't1' }] });
    expect(calls[0].ops).toContainEqual(['lt', 'end_date', '2026-10-22']);
    expect(calls[0].ops).toContainEqual(['neq', 'status', 'Done']);
    expect(calls[0].ops).toContainEqual(['order', 'end_date', { ascending: true }]);

    for (const op of ['lte', 'gt', 'gte'] as const) {
      const { client: operatorClient, calls: operatorCalls } = fakeSupabase(() => ({ data: [], error: null }));
      await runQueryEntity({ entity: 'tasks', columns: ['id'], filter: [
        { column: 'project_id', op: 'eq', value: 'p1' },
        { column: 'end_date', op, value: '2026-10-22' },
      ] }, ctxFor(operatorClient));
      expect(operatorCalls[0].ops).toContainEqual([op, 'end_date', '2026-10-22']);
    }
  });
});
