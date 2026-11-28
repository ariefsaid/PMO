import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  type RpcResponse = { data: unknown; error: unknown };
  const pages: RpcResponse[] = [];
  const ranges: Array<[number, number]> = [];
  const builder: {
    range: ReturnType<typeof vi.fn>;
    then: (resolve: (result: RpcResponse) => unknown) => unknown;
  } = {
    range: vi.fn((from: number, to: number) => {
      ranges.push([from, to]);
      return builder;
    }),
    then: (resolve) => resolve(pages.shift() ?? { data: [], error: null }),
  };
  const rpc = vi.fn(() => builder);
  return { pages, ranges, range: builder.range, rpc };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { listWaitingDecisions } from './waitingDecisions';
import { PAGE_SCAN_SIZE } from '@/src/lib/pagedRead';
import type { Database } from '@/src/lib/supabase/database.types';

type RawWaitingDecision = Database['public']['Functions']['my_waiting_decisions']['Returns'][number];

function rawRow(recordId: string, kind: 'daily_report' | 'delivery_record' = 'daily_report'): RawWaitingDecision {
  return {
    kind,
    record_id: recordId,
    project_id: 'project-1',
    title: `Waiting ${recordId}`,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function pageRows(): RawWaitingDecision[] {
  return Array.from({ length: PAGE_SCAN_SIZE }, (_, index) => rawRow(`record-${String(index).padStart(4, '0')}`));
}

beforeEach(() => {
  h.rpc.mockClear();
  h.range.mockClear();
  h.ranges.length = 0;
  h.pages.length = 0;
});

describe('listWaitingDecisions pagination (#1122)', () => {
  it('reads across a server-sized page and preserves a stable, duplicate-free order', async () => {
    const first = pageRows();
    const last = rawRow('record-1000', 'delivery_record');
    h.pages.push({ data: first, error: null }, { data: [last], error: null });

    const rows = await listWaitingDecisions();

    expect(h.rpc.mock.calls).toEqual([['my_waiting_decisions'], ['my_waiting_decisions']]);
    expect(h.ranges).toEqual([[0, PAGE_SCAN_SIZE - 1], [PAGE_SCAN_SIZE, PAGE_SCAN_SIZE * 2 - 1]]);
    expect(rows).toHaveLength(PAGE_SCAN_SIZE + 1);
    expect(rows.map((row) => row.recordId)).toEqual([...first.map((row) => row.record_id), last.record_id]);
    expect(new Set(rows.map((row) => row.recordId)).size).toBe(rows.length);
    expect(rows.at(-1)).toEqual({
      kind: 'delivery_record', recordId: last.record_id, projectId: last.project_id, title: last.title, createdAt: last.created_at,
    });
  });

  it('runs the database function once when the list fits in one page', async () => {
    h.pages.push({ data: [rawRow('record-0001'), rawRow('record-0002')], error: null });

    const rows = await listWaitingDecisions();

    expect(rows.map((row) => row.recordId)).toEqual(['record-0001', 'record-0002']);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.ranges).toEqual([[0, PAGE_SCAN_SIZE - 1]]);
  });

  it('requests an empty page after an exact-full-page result before treating the list as complete', async () => {
    const first = pageRows();
    h.pages.push({ data: first, error: null }, { data: [], error: null });

    const rows = await listWaitingDecisions();

    expect(rows).toHaveLength(PAGE_SCAN_SIZE);
    expect(h.ranges).toEqual([[0, PAGE_SCAN_SIZE - 1], [PAGE_SCAN_SIZE, PAGE_SCAN_SIZE * 2 - 1]]);
  });

  it('rejects the whole read when a later page fails', async () => {
    h.pages.push(
      { data: pageRows(), error: null },
      { data: null, error: { message: 'later page failed', code: 'PGRST000' } },
    );

    await expect(listWaitingDecisions().then((rows) => rows.length)).rejects.toMatchObject({ message: 'later page failed', code: 'PGRST000' });
    expect(h.ranges).toEqual([[0, PAGE_SCAN_SIZE - 1], [PAGE_SCAN_SIZE, PAGE_SCAN_SIZE * 2 - 1]]);
  });
});
