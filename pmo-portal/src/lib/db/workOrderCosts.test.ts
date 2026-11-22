import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/**
 * AC-WCA-012 / AC-WCA-013 (data half) — the work-order cost attribution DAL (#2517, ADR-0104).
 * The write path sends only the source, the ids and the two attribution values (never org_id); the read seam
 * returns a work order's cost lines grouped by source; a refusal keeps its Postgres code.
 */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown } };
  const calls = { from: [] as string[], rpc: [] as Array<[string, unknown]>, select: [] as unknown[], eq: [] as unknown[], is: [] as unknown[], order: [] as unknown[], gt: [] as unknown[], limit: [] as unknown[], insert: [] as unknown[], update: [] as unknown[], single: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...a: unknown[]) => { (calls[name] as unknown[]).push(a.length === 1 ? a[0] : a); return builder; };
  for (const k of ['select', 'eq', 'is', 'order', 'gt', 'limit', 'insert', 'update', 'single'] as const) builder[k] = chain(k);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(result.value); });
  return { from, rpc, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import * as dal from './workOrderCosts';
import { workOrderCostRepository } from '@/src/lib/repositories/workOrderCosts';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const v of Object.values(h.calls)) (v as unknown[]).length = 0;
  h.result.value = { data: null, error: null };
});

describe('AC-WCA-013 set_cost_attribution', () => {
  it('AC-WCA-013 sends the source, ids and both attribution values — no org_id', async () => {
    h.result.value = { data: 2, error: null };
    await expect(dal.setCostAttribution('timesheet_entry', ['e1', 'e2'], { workOrderId: 'wo1', disciplineId: 'd1' })).resolves.toBe(2);
    expect(h.calls.rpc).toEqual([['set_cost_attribution', { p_source: 'timesheet_entry', p_ids: ['e1', 'e2'], p_work_order_id: 'wo1', p_discipline_id: 'd1' }]]);
  });

  it('AC-WCA-013 a database refusal keeps its code so the form can explain it', async () => {
    h.result.value = { data: null, error: { message: 'COST_WO_PROJECT: the work order belongs to another project', code: '23514' } };
    const err = await dal.setCostAttribution('vendor_bill', ['b1'], { workOrderId: 'wo2', disciplineId: null }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('23514');
  });

  it('AC-WPL-011 attributeLines writes one call per picked work order (lines grouped), skips "same as the request", never sends a discipline', async () => {
    h.result.value = { data: 2, error: null };
    await workOrderCostRepository.attributeLines('case1', { l1: 'w1', l2: 'w1', l3: 'w2', l4: null });
    expect(h.calls.rpc).toEqual([
      ['set_cost_attribution', { p_source: 'procurement_item', p_ids: ['l1', 'l2'], p_work_order_id: 'w1', p_discipline_id: null }],
      ['set_cost_attribution', { p_source: 'procurement_item', p_ids: ['l3'], p_work_order_id: 'w2', p_discipline_id: null }],
    ]);
  });

  it('AC-WPL-011 a refused line attribution becomes AttributionRefusedError carrying the saved purchase id', async () => {
    h.result.value = { data: null, error: { message: 'COST_WO_PROJECT: the work order belongs to another project', code: '23514' } };
    const err = await workOrderCostRepository.attributeLines('case1', { l1: 'w1' }).catch((e) => e);
    expect(err.name).toBe('AttributionRefusedError');
    expect(err.recordId).toBe('case1');
  });

  it('AC-WCA-013 attributeCreated makes no call when nothing was picked, and one call when something was', async () => {
    await workOrderCostRepository.attributeCreated('purchase_order', 'po1', { workOrderId: null, disciplineId: null });
    await workOrderCostRepository.attributeCreated('purchase_order', null, { workOrderId: 'wo1', disciplineId: null });
    expect(h.calls.rpc).toEqual([]);
    h.result.value = { data: 1, error: null };
    await workOrderCostRepository.attributeCreated('purchase_order', 'po1', { workOrderId: null, disciplineId: 'd1' });
    expect(h.calls.rpc).toEqual([['set_cost_attribution', { p_source: 'purchase_order', p_ids: ['po1'], p_work_order_id: null, p_discipline_id: 'd1' }]]);
  });
});

describe('AC-WCA-012 the read seam', () => {
  it('AC-WCA-012 reads the work order\'s lines and groups them by source, every source present', async () => {
    h.result.value = {
      data: [
        { id: 'r2', source: 'timesheet_entry', project_id: 'p1', work_order_id: 'wo1', discipline_id: null, occurred_on: '2026-11-17', reference: null, quantity: 8, quantity_unit: 'hours' },
        { id: 'r1', source: 'vendor_bill', project_id: 'p1', work_order_id: 'wo1', discipline_id: 'd1', occurred_on: '2026-11-16', reference: 'VI-1', quantity: null, quantity_unit: null },
      ],
      error: null,
    };
    const grouped = await workOrderCostRepository.costLinesBySource('wo1');
    expect(h.calls.from).toEqual(['work_order_cost_lines']);
    expect(h.calls.eq).toEqual([['work_order_id', 'wo1']]);
    expect(Object.keys(grouped).sort()).toEqual([...dal.COST_SOURCES].sort());
    expect(grouped.vendor_bill.map((l) => l.reference)).toEqual(['VI-1']);
    expect(grouped.timesheet_entry[0]).toMatchObject({ recordId: 'r2', quantity: 8, quantityUnit: 'hours' });
    expect(grouped.stock_document).toEqual([]);
  });

  it('AC-WCA-012 lines come back oldest first', async () => {
    h.result.value = {
      data: [
        { id: 'b', source: 'purchase_order', project_id: 'p1', work_order_id: 'wo1', discipline_id: null, occurred_on: '2026-11-18', reference: 'PO-2', quantity: null, quantity_unit: null },
        { id: 'a', source: 'purchase_order', project_id: 'p1', work_order_id: 'wo1', discipline_id: null, occurred_on: '2026-11-02', reference: 'PO-1', quantity: null, quantity_unit: null },
      ],
      error: null,
    };
    expect((await dal.listWorkOrderCostLines('wo1')).map((l) => l.reference)).toEqual(['PO-1', 'PO-2']);
  });

  it('AC-WCA-012 a failed read throws rather than returning an empty list', async () => {
    h.result.value = { data: null, error: { message: 'permission denied', code: '42501' } };
    await expect(dal.listWorkOrderCostLines('wo1')).rejects.toBeInstanceOf(AppError);
  });
});

describe('disciplines', () => {
  it('lists only live disciplines, by name', async () => {
    h.result.value = { data: [{ id: '2', code: 'MEC', name: 'Mechanical' }, { id: '1', code: 'CIV', name: 'Civil' }], error: null };
    expect((await dal.listCostDisciplines()).map((d) => d.code)).toEqual(['CIV', 'MEC']);
    expect(h.calls.from).toEqual(['cost_disciplines']);
    expect(h.calls.is).toEqual([['archived_at', null]]);
  });
});

describe('AC-WCA-017 the discipline list is kept through the DAL (#2623)', () => {
  it('adds a discipline with only its code and name — org_id and author are stamped by the database', async () => {
    h.result.value = { data: { id: 'd9' }, error: null };
    await expect(dal.createCostDiscipline({ code: 'ELE', name: 'Electrical' })).resolves.toBe('d9');
    expect(h.calls.from).toEqual(['cost_disciplines']);
    expect(h.calls.insert).toEqual([{ code: 'ELE', name: 'Electrical' }]);
  });
  it('renames a live discipline by id', async () => {
    h.result.value = { data: [{ id: 'd1' }], error: null };
    await dal.updateCostDiscipline('d1', { code: 'CIV', name: 'Civil works' });
    expect(h.calls.update).toEqual([{ code: 'CIV', name: 'Civil works' }]);
    expect(h.calls.eq).toContainEqual(['id', 'd1']);
  });
  it('archives (never deletes) a discipline, and an update RLS hid is an error, never a silent success', async () => {
    h.result.value = { data: [{ id: 'd1' }], error: null };
    await dal.archiveCostDiscipline('d1');
    expect(Object.keys(h.calls.update[0] as object)).toEqual(['archived_at']);
    h.result.value = { data: [], error: null };
    await expect(dal.archiveCostDiscipline('d1')).rejects.toMatchObject({ code: '42501' });
  });
  it('a duplicate live code keeps its code (23505) for the form to explain', async () => {
    h.result.value = { data: null, error: { message: 'duplicate key', code: '23505' } };
    await expect(dal.createCostDiscipline({ code: 'CIV', name: 'Civil' })).rejects.toMatchObject({ code: '23505' });
  });
});
