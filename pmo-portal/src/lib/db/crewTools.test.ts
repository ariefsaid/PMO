import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/**
 * #2581 — the crew tools DAL. A report uploads its photos under the line's organisation, then makes ONE RPC call that
 * always names every argument (PostgREST cannot resolve an omitted one: the note travels as null); org_id is never sent;
 * a refusal keeps its Postgres code.
 */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown }, queue: [] as Array<{ data: unknown; error: unknown }> };
  const calls = { from: [] as string[], rpc: [] as Array<[string, unknown]>, insert: [] as unknown[], update: [] as unknown[], upload: [] as unknown[] };
  const next = () => (result.queue.length ? result.queue.shift()! : result.value);
  const builder: Record<string, unknown> = {};
  const chain = (name: 'insert' | 'update') => (...a: unknown[]) => { calls[name].push(a[0]); return builder; };
  for (const k of ['select', 'eq', 'is', 'order', 'gt', 'limit']) builder[k] = () => builder;
  builder.insert = chain('insert'); builder.update = chain('update');
  builder.maybeSingle = () => Promise.resolve(next());
  builder.then = (resolve: (v: unknown) => unknown) => resolve(next());
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(next()); });
  const storage = { from: vi.fn(() => ({ upload: (...a: unknown[]) => { calls.upload.push(a); return Promise.resolve({ error: null }); } })) };
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
