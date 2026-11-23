import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/**
 * #2581 — the crew tools DAL. A report uploads its photos under the line's organisation, then makes ONE RPC call that
 * always names every argument (PostgREST cannot resolve an omitted one: the note travels as null); org_id is never sent;
 * a refusal keeps its Postgres code.
 */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown }, queue: [] as Array<{ data: unknown; error: unknown }> };
  const calls: Record<string, unknown[]> = { from: [], rpc: [], insert: [], update: [], upload: [], signed: [], eq: [], is: [], order: [], gt: [], limit: [], select: [] };
  const next = () => (result.queue.length ? result.queue.shift()! : result.value);
  const builder: Record<string, unknown> = {};
  const chain = (name: 'insert' | 'update') => (...a: unknown[]) => { calls[name].push(a[0]); return builder; };
  for (const k of ['select', 'eq', 'is', 'order', 'gt', 'limit']) builder[k] = (...a: unknown[]) => { calls[k].push(a.length <= 1 ? a[0] : a); return builder; };
  builder.insert = chain('insert'); builder.update = chain('update');
  builder.maybeSingle = () => Promise.resolve(next());
  builder.then = (resolve: (v: unknown) => unknown) => resolve(next());
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(next()); });
  const storage = {
    from: vi.fn(() => ({
      upload: (...a: unknown[]) => { calls.upload.push(a); return Promise.resolve({ error: null }); },
      createSignedUrl: (...a: unknown[]) => { calls.signed.push(a); return Promise.resolve(next()); },
    })),
  };
  return { from, rpc, storage, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc, storage: h.storage } }));

import * as tools from './crewTools';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const v of Object.values(h.calls)) (v as unknown[]).length = 0;
  h.result.value = { data: null, error: null };
  h.result.queue = [];
});

describe('#2581 crew tools DAL', () => {
  it('AC-CTR-012 reports through one RPC naming every argument, photos uploaded under the line\'s organisation', async () => {
    h.result.queue = [{ data: { org_id: 'org1' }, error: null }, { data: 'rep1', error: null }];
    const file = new File(['x'], 'my hammer.png', { type: 'image/png' });
    const id = await tools.reportTool({ reportId: 'rep1', lineId: 'l1', kind: 'damaged', qty: 1, note: null, photos: [file] });
    expect(id).toBe('rep1');
    const path = (h.calls.upload[0] as [string])[0];
    expect(path).toMatch(/^org1\/rep1\/[0-9a-f-]{36}\/my_hammer\.png$/);
    const [name, args] = h.calls.rpc[0] as [string, Record<string, unknown>];
    expect(name).toBe('report_crew_tool');
    expect(args).toEqual({ p_id: 'rep1', p_line: 'l1', p_kind: 'damaged', p_qty: 1, p_note: null, p_photos: [{ path, title: 'my hammer.png' }] });
    expect(JSON.stringify(args)).not.toContain('org_id');
  });
  it('AC-CTR-001 a refusal keeps its Postgres code and message', async () => {
    h.result.queue = [{ data: { org_id: 'org1' }, error: null }, { data: null, error: { message: 'CTR_QTY_EXCEEDS_USABLE: only 3 usable', code: '23514' } }];
    await expect(tools.reportTool({ reportId: 'r', lineId: 'l1', kind: 'lost', qty: 4, note: 'n', photos: [] }))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('only 3 usable') });
    await expect(Promise.reject(new AppError('x', '23514'))).rejects.toBeInstanceOf(AppError);
  });
  it('FR-CTR-014 close and correct go through their RPCs', async () => {
    await tools.closeToolReport('r1', 'written_off');
    await tools.correctToolReport('r1', 'lost', 2, 'miscounted');
    await tools.setToolSettings(null, 5);
    expect(h.calls.rpc).toEqual([
      ['close_crew_tool_report', { p_report: 'r1', p_resolution: 'written_off' }],
      ['correct_crew_tool_report', { p_report: 'r1', p_kind: 'lost', p_qty: 2, p_reason: 'miscounted' }],
      ['set_crew_tool_settings', { p_coordinator: null, p_due_days: 5 }],
    ]);
  });
  it('FR-CTR-003 a line is added without org_id', async () => {
    await tools.addToolLine({ crew_id: 'c1', name: 'Saw', code: null, serial: 'S1', held_qty: 1, note: null });
    expect(h.calls.from).toEqual(['crew_tool_lines']);
    expect(h.calls.insert[0]).toEqual({ crew_id: 'c1', name: 'Saw', code: null, serial: 'S1', held_qty: 1, note: null });
  });
});

describe('#2581 crew tools reads and settings', () => {
  it('FR-CTR-004 lists the crew live lines keyset-paged and ordered by name, id', async () => {
    const line = (id: string, name: string, usable: number) => ({
      id, crew_id: 'c1', name, code: null, serial: null, held_qty: usable, note: null, archived_at: null,
      damaged_qty: 0, lost_qty: 0, usable_qty: usable,
    });
    h.result.queue = [{ data: [line('l2', 'Wrench', 1), line('l1', 'Hammer', 2)], error: null }];
    await expect(tools.listToolLines('c1')).resolves.toEqual([line('l1', 'Hammer', 2), line('l2', 'Wrench', 1)]);
    expect(h.calls.from).toEqual(['crew_tool_line_summary']);
    expect(h.calls.eq).toContainEqual(['crew_id', 'c1']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
  });

  it('a page failure refuses the whole line list', async () => {
    h.result.queue = [{ data: null, error: { message: 'denied', code: '42501' } }];
    await expect(tools.listToolLines('c1')).rejects.toMatchObject({ code: '42501' });
  });

  it('FR-CTR-011 the open reports carry the line name, crew and task assignee (null when no task), oldest due first', async () => {
    h.result.queue = [{
      data: [
        { id: 'r2', line_id: 'l1', kind: 'lost', qty: 1, note: null, status: 'open', resolution: null, task_id: 't1', reported_by: 'u1', reported_on: '2026-03-02', due_on: '2026-03-09', line: { name: 'Hammer', crew_id: 'c9' }, task: { assignee_id: 'u2' } },
        { id: 'r1', line_id: 'l2', kind: 'damaged', qty: 2, note: 'n', status: 'open', resolution: null, task_id: null, reported_by: null, reported_on: '2026-03-01', due_on: '2026-03-08', line: { name: 'Wrench', crew_id: 'c9' }, task: null },
      ],
      error: null,
    }];
    await expect(tools.listOpenToolReports('c9')).resolves.toEqual([
      { id: 'r1', line_id: 'l2', line_name: 'Wrench', crew_id: 'c9', kind: 'damaged', qty: 2, note: 'n', status: 'open', resolution: null, task_id: null, assignee_id: null, reported_by: null, reported_on: '2026-03-01', due_on: '2026-03-08' },
      { id: 'r2', line_id: 'l1', line_name: 'Hammer', crew_id: 'c9', kind: 'lost', qty: 1, note: null, status: 'open', resolution: null, task_id: 't1', assignee_id: 'u2', reported_by: 'u1', reported_on: '2026-03-02', due_on: '2026-03-09' },
    ]);
    expect(h.calls.eq).toContainEqual(['status', 'open']);
    expect(h.calls.eq).toContainEqual(['line.crew_id', 'c9']);
  });

  it('report photos list only the live ones of the report', async () => {
    h.result.queue = [{ data: [{ id: 'p1', report_id: 'r1', title: 'a.png', file_path: 'p' }], error: null }];
    await expect(tools.listReportPhotos('r1')).resolves.toEqual([{ id: 'p1', report_id: 'r1', title: 'a.png', file_path: 'p' }]);
    expect(h.calls.from).toEqual(['crew_tool_report_files']);
    expect(h.calls.eq).toContainEqual(['report_id', 'r1']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
  });

  it('a photo opens only through a short-lived signed link from the private bucket', async () => {
    h.result.queue = [{ data: { signedUrl: 'https://signed/tool' }, error: null }];
    await expect(tools.toolPhotoUrl('o/r/f/a.png')).resolves.toBe('https://signed/tool');
    expect(h.calls.signed).toContainEqual(['o/r/f/a.png', 300]);
    h.result.queue = [{ data: null, error: { message: 'gone' } }];
    await expect(tools.toolPhotoUrl('x')).rejects.toBeInstanceOf(AppError);
  });

  it('FR-CTR-002 settings read with maybeSingle (an unset org is null) and written through their RPC', async () => {
    h.result.queue = [{ data: { coordinator_id: 'u1', task_due_days: 3 }, error: null }];
    await expect(tools.getToolSettings()).resolves.toEqual({ coordinator_id: 'u1', task_due_days: 3 });
    expect(h.calls.from).toEqual(['org_crew_tool_settings']);
    h.result.queue = [{ data: null, error: null }];
    await expect(tools.getToolSettings()).resolves.toBeNull();
    h.result.queue = [{ data: null, error: null }];
    await tools.setToolSettings('u1', 5);
    expect(h.calls.rpc).toEqual([['set_crew_tool_settings', { p_coordinator: 'u1', p_due_days: 5 }]]);
  });

  it('FR-CTR-003 a line is edited by id (archive included) and a refusal keeps its code', async () => {
    h.result.queue = [{ data: null, error: null }];
    await tools.updateToolLine('l1', { held_qty: 4, archived_at: '2026-03-02T00:00:00Z' });
    expect(h.calls.update).toEqual([{ held_qty: 4, archived_at: '2026-03-02T00:00:00Z' }]);
    expect(h.calls.eq).toContainEqual(['id', 'l1']);
    h.result.queue = [{ data: null, error: { message: 'rule', code: '23514' } }];
    await expect(tools.updateToolLine('l1', {})).rejects.toMatchObject({ code: '23514' });
  });
});
