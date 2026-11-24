import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable, thenable query-builder mock (the stockAllowances.test.ts harness) with rpc.
const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown; count?: number }> = [];
  const calls: Record<string, unknown[]> = { from: [], select: [], eq: [], is: [], ilike: [], range: [], insert: [], update: [], rpc: [] };
  const builder: Record<string, unknown> = {};
  for (const n of ['select', 'eq', 'is', 'ilike', 'range', 'insert', 'update']) builder[n] = (...a: unknown[]) => { calls[n].push(a.length === 1 ? a[0] : a); return builder; };
  for (const n of ['order', 'limit']) builder[n] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve(queue.shift() ?? { data: [], error: null });
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((name: string, args?: unknown) => { calls.rpc.push([name, args]); return Promise.resolve(queue.shift() ?? { data: null, error: null }); });
  return { from, rpc, calls, queue };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  listUsageStandards, getStandardMatchCounts, createUsageStandard, updateUsageStandard, setUsageStandardArchived,
  getConsumablePlan, generateConsumablePlan, adjustConsumablePlanLine, approveConsumablePlan, getPlanInputs, consumablePlanRefusal, parseConsumablePlan, USAGE_STANDARDS_PAGE_SIZE,
} from './usageStandards';

beforeEach(() => { h.queue.length = 0; h.from.mockClear(); h.rpc.mockClear(); for (const k of Object.keys(h.calls)) h.calls[k].length = 0; });

describe('usage standards DAL (#2577)', () => {
  it('FR-CUS-004 lists one bounded page, hides archived rows, and returns quantities as decimal strings', async () => {
    h.queue.push({ data: [{ id: 's1', item_id: 'i1', work_unit: 'dia-inch', boq_code_prefix: 'WLD', qty_per_unit: '0.050000', margin_pct: '10.00', archived_at: null }], error: null, count: 61 });
    const r = await listUsageStandards({ includeArchived: false, page: 2 });
    expect(h.calls.from).toEqual(['consumable_usage_standards']);
    expect(String(h.calls.select[0])).toContain('qty_per_unit::text');
    expect(h.calls.range).toEqual([[2 * USAGE_STANDARDS_PAGE_SIZE, 3 * USAGE_STANDARDS_PAGE_SIZE - 1]]);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(r).toEqual({ rows: [{ id: 's1', itemId: 'i1', workUnit: 'dia-inch', boqCodePrefix: 'WLD', qtyPerUnit: '0.050000', marginPct: '10.00', archivedAt: null }], total: 61 });
  });

  it('FR-CUS-004 filters by item and work unit, escaping LIKE wildcards, and can include archived rows', async () => {
    h.queue.push({ data: [], error: null, count: 0 });
    await listUsageStandards({ includeArchived: true, itemId: 'i1', workUnit: ' 50%_x ', page: 0 });
    expect(h.calls.eq).toContainEqual(['item_id', 'i1']);
    expect(h.calls.ilike).toContainEqual(['work_unit', '%50\\%\\_x%']);
    expect(h.calls.is).toHaveLength(0);
  });

  it('FR-CUS-004 match counts come from the server, keyed by standard', async () => {
    h.queue.push({ data: [{ standard_id: 's1', match_lines: 3 }, { standard_id: 's2', match_lines: 0 }], error: null });
    await expect(getStandardMatchCounts()).resolves.toEqual({ s1: 3, s2: 0 });
    expect(h.calls.rpc[0]).toEqual(['cus_standard_match_counts', undefined]);
  });

  it('FR-CUS-001 a standard is created with the typed decimals and a trimmed unit; an empty prefix is null, an empty margin 0', async () => {
    h.queue.push({ data: null, error: null });
    await createUsageStandard({ itemId: 'i1', workUnit: ' dia-inch ', boqCodePrefix: '  ', qtyPerUnit: '0.05', marginPct: '' });
    expect(h.calls.insert[0]).toEqual({ item_id: 'i1', work_unit: 'dia-inch', boq_code_prefix: null, qty_per_unit: '0.05', margin_pct: '0' });
  });

  it('FR-CUS-001 an edit never sends the item, and a write RLS hid is a refusal not a silent success', async () => {
    h.queue.push({ data: [{ id: 's1' }], error: null });
    await updateUsageStandard('s1', { itemId: 'i1', workUnit: 'm', boqCodePrefix: 'A', qtyPerUnit: '1', marginPct: '5' });
    expect(h.calls.update[0]).toEqual({ work_unit: 'm', boq_code_prefix: 'A', qty_per_unit: '1', margin_pct: '5' });
    h.queue.push({ data: [], error: null });
    await expect(updateUsageStandard('s1', { itemId: 'i1', workUnit: 'm', boqCodePrefix: null, qtyPerUnit: '1', marginPct: '0' })).rejects.toMatchObject({ code: '42501' });
    h.queue.push({ data: [], error: null });
    await expect(setUsageStandardArchived('s1', true)).rejects.toMatchObject({ code: '42501' });
  });

  it('AC-CUS-003 a duplicate keeps its Postgres code so the form can say so', async () => {
    h.queue.push({ data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } });
    await expect(createUsageStandard({ itemId: 'i1', workUnit: 'm', boqCodePrefix: null, qtyPerUnit: '1', marginPct: '0' })).rejects.toMatchObject({ code: '23505' });
  });

  it('FR-CUS-001 archive and restore set and clear archived_at', async () => {
    h.queue.push({ data: [{ id: 's1' }], error: null });
    await setUsageStandardArchived('s1', true);
    expect((h.calls.update[0] as { archived_at: string | null }).archived_at).toEqual(expect.any(String));
    h.queue.push({ data: [{ id: 's1' }], error: null });
    await setUsageStandardArchived('s1', false);
    expect(h.calls.update[1]).toEqual({ archived_at: null });
  });
});

describe('consumable plan DAL (#2577)', () => {
  const raw = {
    work_order_id: 'wo1', work_order_status: 'Issued', generated_at: '2026-11-20T01:00:00Z', out_of_date: true,
    lines: [{
      item_id: 'rod', item_code: 'ROD', item_name: 'Welding rod', unit_code: 'KG', generated_qty: '8.800', adjusted_qty: '12.000', adjust_reason: 'spools',
      adjusted_by: 'u1', adjusted_at: '2026-11-20T02:00:00Z', planned_qty: '12.000', prior_qty: '3.000', source: 'adjusted',
      basis: [{ boq_item_id: 'b1', boq_code: 'WLD-01', unit: 'dia-inch', work_qty: '120.000', standard_id: 's1', qty_per_unit: '0.050000', margin_pct: '10.00', result: '6.6' }],
    }],
    no_standard: [{ boq_item_id: 'b3', item_code: 'CIV-01', description: 'Concrete', unit: 'm3', quantity: '10.000' }],
    unplanned: [{ item_id: 'gas', item_code: 'GAS', item_name: 'Gas', unit_code: 'KG', planned_qty: '0.000', prior_qty: '1.000', source: 'none' }],
  };

  it('FR-CUS-008/010/014 the plan is read whole: lines with source and basis, the out-of-date flag, "no standard" lines, unplanned requested items', async () => {
    h.queue.push({ data: raw, error: null });
    h.queue.push({ data: { author_id: 'u2', author_is_pcm: false, approved: true, approved_by: 'pcm', approved_at: '2026-11-20T03:00:00Z' }, error: null });
    const p = await getConsumablePlan('wo1');
    expect(h.calls.rpc).toEqual([
      ['cus_get_plan', { p_work_order_id: 'wo1' }],
      ['cus_plan_approval_status', { p_work_order_id: 'wo1' }],
    ]);
    expect(p.outOfDate).toBe(true);
    expect(p.approval).toEqual({ authorId: 'u2', authorIsPcm: false, approved: true, approvedBy: 'pcm', approvedAt: '2026-11-20T03:00:00Z' });
    expect(p.lines[0]).toMatchObject({ itemCode: 'ROD', generatedQty: '8.800', adjustedQty: '12.000', plannedQty: '12.000', priorQty: '3.000', source: 'adjusted', adjustReason: 'spools' });
    expect(p.lines[0].basis[0]).toMatchObject({ code: 'WLD-01', workQty: '120.000', standardId: 's1' });
    expect(p.noStandard).toEqual([{ boqItemId: 'b3', itemCode: 'CIV-01', description: 'Concrete', unit: 'm3', quantity: '10.000' }]);
    expect(p.unplanned[0]).toMatchObject({ itemCode: 'GAS', source: 'none' });
  });

  it('an empty or missing payload reads as an empty plan, not a crash', () => {
    expect(parseConsumablePlan(null)).toMatchObject({ lines: [], noStandard: [], unplanned: [], outOfDate: false, generatedAt: null,
      approval: { authorId: null, authorIsPcm: false, approved: false, approvedBy: null, approvedAt: null } });
  });

  it('FR-CUS-005 generation calls the server function and returns the number of lines', async () => {
    h.queue.push({ data: 2, error: null });
    await expect(generateConsumablePlan('wo1')).resolves.toBe(2);
    expect(h.calls.rpc[0]).toEqual(['cus_generate_plan', { p_work_order_id: 'wo1' }]);
  });

  it('FR-CUS-009 an adjustment sends the quantity as typed with its reason; null reverts', async () => {
    h.queue.push({ data: null, error: null });
    await adjustConsumablePlanLine({ workOrderId: 'wo1', itemId: 'rod', adjustedQty: '12', reason: 'spools' });
    h.queue.push({ data: null, error: null });
    await adjustConsumablePlanLine({ workOrderId: 'wo1', itemId: 'rod', adjustedQty: null, reason: null });
    expect(h.calls.rpc).toEqual([
      ['cus_adjust_plan_line', { p_work_order_id: 'wo1', p_item_id: 'rod', p_adjusted_qty: '12', p_reason: 'spools' }],
      ['cus_adjust_plan_line', { p_work_order_id: 'wo1', p_item_id: 'rod', p_adjusted_qty: null, p_reason: null }],
    ]);
  });

  it('AC-PEO-003 approval calls the distinct server decision RPC', async () => {
    h.queue.push({ data: null, error: null });
    await approveConsumablePlan('wo1');
    expect(h.calls.rpc).toEqual([['cus_approve_plan', { p_work_order_id: 'wo1' }]]);
  });

  it('AC-CUS-007 a refused adjustment keeps its code and its stable CUS_ key', async () => {
    h.queue.push({ data: null, error: { message: 'CUS_REASON: an adjustment needs a reason (1 to 500 characters)', code: '23514' } });
    const err = await adjustConsumablePlanLine({ workOrderId: 'wo1', itemId: 'rod', adjustedQty: '1', reason: '' }).catch((e) => e);
    expect(err).toMatchObject({ code: '23514' });
    expect(consumablePlanRefusal(err)).toBe('CUS_REASON');
    expect(consumablePlanRefusal(new Error('CUS_WORK_ORDER: closed'))).toBe('CUS_WORK_ORDER');
    expect(consumablePlanRefusal(new Error('CUS_SOD: author'))).toBe('CUS_SOD');
    expect(consumablePlanRefusal(new Error('CUS_APPROVER: pcm'))).toBe('CUS_APPROVER');
    expect(consumablePlanRefusal(new Error('boom'))).toBeNull();
    expect(consumablePlanRefusal('x')).toBeNull();
  });

  it('FR-CUS-007 the preview inputs are the work order lines with code and unit, and the active standards', async () => {
    h.queue.push({ data: [{ boq_item_id: 'b1', quantity: '120.000', boq_items: { item_code: 'WLD-01', unit: 'dia-inch' } }], error: null });
    h.queue.push({ data: [{ id: 's1', item_id: 'rod', work_unit: 'dia-inch', boq_code_prefix: 'WLD', qty_per_unit: '0.050000', margin_pct: '10.00', archived_at: null }], error: null });
    const r = await getPlanInputs('wo1');
    expect(h.calls.eq).toContainEqual(['work_order_id', 'wo1']);
    expect(r.lines).toEqual([{ boqItemId: 'b1', code: 'WLD-01', unit: 'dia-inch', quantity: '120.000' }]);
    expect(r.standards).toEqual([{ id: 's1', itemId: 'rod', workUnit: 'dia-inch', boqCodePrefix: 'WLD', qtyPerUnit: '0.050000', marginPct: '10.00' }]);
  });
});
