import { beforeEach, describe, expect, it, vi } from 'vitest';

// Chainable PostgREST builder mock (the agentRuns.test.ts reference pattern, extended with the
// write chain, the paged-read terminal and an ordered result queue).
const h = vi.hoisted(() => {
  type Res = { data: unknown; error: unknown };
  const results: Res[] = [];
  const calls: Record<string, unknown[]> = {
    from: [], rpc: [], select: [], insert: [], update: [], delete: [], eq: [], is: [], order: [], limit: [], range: [], single: [], maybeSingle: [],
  };
  const next = (): Res => (results.length ? (results.shift() as Res) : { data: null, error: null });
  const builder: Record<string, unknown> = {};
  const rec = (name: keyof typeof calls) => (...args: unknown[]) => {
    calls[name].push(args.length <= 1 ? args[0] : args);
    return builder;
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'limit', 'range'] as const) builder[m] = rec(m);
  builder.maybeSingle = () => { calls.maybeSingle.push(true); return Promise.resolve(next()); };
  builder.single = () => { calls.single.push(true); return Promise.resolve(next()); };
  builder.then = (res: (v: Res) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  const from = vi.fn((table: string) => { calls.from.push(table); return builder; });
  const rpc = vi.fn((fn: string, args?: unknown) => { calls.rpc.push(args ? [fn, args] : fn); return Promise.resolve(next()); });
  return { from, rpc, calls, results, push: (r: Res) => results.push(r) };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  createSection, deleteSection, getReadinessCounts, listReadinessEvents, listSectionProgress,
  listSectionRollup, setSectionArchived, setSectionReadiness, updateSection,
} from './workOrderSections';
import { AppError } from '@/src/lib/appError';

const rollupRow = (over: Record<string, unknown> = {}) => ({
  section_id: 's1', code: 'A', name: 'Earthworks', location_note: 'north', foreman_id: 'f1', readiness: 'ready', readiness_note: null,
  sort_order: 1, archived_at: null, direct_budget: 1200.456, indirect_budget: null, equipment_hours: '8', crew_hours: '3.5',
  tasks_total: 4, tasks_done: 1, crews_today: 2, ...over,
});

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) h.calls[k].length = 0;
  h.results.length = 0;
});

describe('listSectionRollup', () => {
  it('reads the roll-up RPC and maps figures to exact scale-two text, nulls pass through', async () => {
    h.push({ data: [rollupRow()], error: null });
    await expect(listSectionRollup('wo1')).resolves.toEqual([
      {
        sectionId: 's1', code: 'A', name: 'Earthworks', locationNote: 'north', foremanId: 'f1', readiness: 'ready', readinessNote: null,
        sortOrder: 1, archivedAt: null, directBudget: '1200.46', indirectBudget: null, equipmentHours: '8.00', crewHours: '3.50',
        tasksTotal: 4, tasksDone: 1, crewsToday: 2,
      },
    ]);
    expect(h.calls.rpc).toEqual([['work_order_section_rollup', { p_work_order_id: 'wo1' }]]);
  });

  it('an unknown readiness value is a malformed row, never a guessed badge', async () => {
    h.push({ data: [rollupRow({ readiness: 'fine' })], error: null });
    await expect(listSectionRollup('wo1')).rejects.toMatchObject({ code: 'PMO_MALFORMED' });
  });

  it('an unreadable budget figure throws instead of rendering a wrong number', async () => {
    h.push({ data: [rollupRow({ crew_hours: 'many' })], error: null });
    await expect(listSectionRollup('wo1')).rejects.toMatchObject({ code: 'PMO_MALFORMED' });
  });

  it('a database refusal keeps its code', async () => {
    h.push({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(listSectionRollup('wo1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('listSectionProgress', () => {
  it('validates each quantity to scale-three text', async () => {
    h.push({ data: [{ section_id: 's1', work_order_line_id: 'l1', unit: 'm3', quantity: '1.2346' }], error: null });
    await expect(listSectionProgress('wo1')).resolves.toEqual([
      { sectionId: 's1', workOrderLineId: 'l1', unit: 'm3', quantity: '1.235' },
    ]);
    h.push({ data: [{ section_id: null, work_order_line_id: 'l1', unit: 'm3', quantity: 'x' }], error: null });
    await expect(listSectionProgress('wo1')).rejects.toMatchObject({ code: 'PMO_MALFORMED' });
  });
});

describe('getReadinessCounts', () => {
  it('maps the readiness view row and treats an absent row as "no section tracked"', async () => {
    h.push({ data: { live_sections: 3, not_ready: 1, ready: null, blocked: 1, all_ready: false }, error: null });
    await expect(getReadinessCounts('wo1')).resolves.toEqual({ live_sections: 3, not_ready: 1, ready: 0, blocked: 1, all_ready: false });
    expect(h.calls.from).toEqual(['work_order_section_readiness']);
    expect(h.calls.eq).toContainEqual(['work_order_id', 'wo1']);

    h.push({ data: null, error: null });
    await expect(getReadinessCounts('wo1')).resolves.toBeNull();
  });
});

describe('listReadinessEvents', () => {
  it('pages the section events newest first and renames set_by/set_at', async () => {
    h.push({ data: [{ id: 'e1', readiness: 'blocked', note: 'waiting permit', set_by: 'u1', set_at: '2026-03-02T00:00:00Z' }], error: null });
    await expect(listReadinessEvents('s1')).resolves.toEqual([
      { id: 'e1', readiness: 'blocked', note: 'waiting permit', setBy: 'u1', setAt: '2026-03-02T00:00:00Z' },
    ]);
    expect(h.calls.from).toEqual(['work_order_section_readiness_events']);
    expect(h.calls.eq).toContainEqual(['section_id', 's1']);
    expect(h.calls.order).toContainEqual(['set_at', { ascending: false }]);
  });
});

describe('section writes', () => {
  it('create sends the trimmed fields and never org_id/project_id; returns the new id', async () => {
    h.push({ data: { id: 's9' }, error: null });
    await expect(createSection('wo1', { code: ' B ', name: ' Piping ', locationNote: '  ', foremanId: 'f1', sortOrder: 2 }))
      .resolves.toBe('s9');
    expect(h.calls.insert).toEqual([{
      work_order_id: 'wo1', code: 'B', name: 'Piping', location_note: null, foreman_id: 'f1', sort_order: 2,
    }]);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(JSON.stringify(h.calls)).not.toContain('project_id');
  });

  it('update keys the row by id with the same trimming', async () => {
    h.push({ data: null, error: null });
    await updateSection('s1', { code: 'A', name: 'Earth', locationNote: 'x', foremanId: null, sortOrder: 3 });
    expect(h.calls.update).toEqual([{ code: 'A', name: 'Earth', location_note: 'x', foreman_id: null, sort_order: 3 }]);
    expect(h.calls.eq).toContainEqual(['id', 's1']);
  });

  it('setSectionReadiness refuses a row the caller cannot see (0 rows back) with the RLS code', async () => {
    h.push({ data: [{ id: 's1' }], error: null });
    await setSectionReadiness('s1', 'blocked', '  note  ');
    expect(h.calls.update).toEqual([{ readiness: 'blocked', readiness_note: 'note' }]);

    h.push({ data: [], error: null });
    await expect(setSectionReadiness('s2', 'ready', null)).rejects.toMatchObject({ code: '42501' });
  });

  it('archive writes a timestamp or clears it; delete proves it landed or refuses', async () => {
    h.push({ data: [{ id: 's1' }], error: null });
    await setSectionArchived('s1', true);
    expect((h.calls.update.at(-1) as Record<string, unknown>).archived_at).toBeTruthy();
    h.push({ data: [{ id: 's1' }], error: null });
    await setSectionArchived('s1', false);
    expect((h.calls.update.at(-1) as Record<string, unknown>).archived_at).toBeNull();

    h.push({ data: [{ id: 's1' }], error: null });
    await deleteSection('s1');
    h.push({ data: [], error: null });
    await expect(deleteSection('s1')).rejects.toMatchObject({ code: '42501' });
    await expect(deleteSection('s1')).rejects.toBeInstanceOf(AppError);
  });
});

it("refuses a section archive that did not land", async () => {
 h.push({ data: [], error: null });
 await expect(setSectionArchived("s", true)).rejects.toMatchObject({ code: "42501" });
});
