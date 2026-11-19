import { describe, it, expect } from 'vitest';
import { buildCostView, NO_DISCIPLINE } from './workOrderCostView';
import type { WorkOrderCostLine, CostSource } from '@/src/lib/db/workOrderCosts';

const ln = (source: CostSource, id: string, disciplineId: string | null, q: number | null = null): WorkOrderCostLine => ({
  source, recordId: id, projectId: 'p', workOrderId: 'w', disciplineId, occurredOn: '2026-01-01', reference: id, quantity: q, quantityUnit: q == null ? null : 'h',
});

describe('AC-WORP-006 buildCostView', () => {
  const lines = [ln('purchase_order', 'po1', 'd1'), ln('purchase_order', 'po2', null), ln('timesheet_entry', 't1', 'd2', 8), ln('vendor_bill', 'vb1', 'd1')];
  it('groups by source (only sources with records), then discipline, with No discipline for the unlabelled one', () => {
    const v = buildCostView(lines, { purchase_order: { po1: { amount: 100, currency: 'IDR' }, po2: { amount: 50, currency: 'IDR' } } });
    expect(v.map((g) => g.source)).toEqual(['purchase_order', 'vendor_bill', 'timesheet_entry']);
    const po = v[0];
    expect(po.disciplines.map((d) => [d.disciplineId, d.lines.map((l) => l.recordId)])).toEqual([['d1', ['po1']], [NO_DISCIPLINE, ['po2']]]);
  });
  it('money test: group totals equal the sum of the source rows', () => {
    const v = buildCostView(lines, { purchase_order: { po1: { amount: 100, currency: 'IDR' }, po2: { amount: 50.5, currency: 'IDR' } } });
    const po = v[0];
    expect(po.total).toEqual({ amount: 150.5, currency: 'IDR' });
    expect(po.disciplines.reduce((s, d) => s + (d.total?.amount ?? 0), 0)).toBe(po.total!.amount);
  });
  it('AC-WORP-007 omits the total (not zero) for a source whose money cannot be read, and keeps quantities', () => {
    const v = buildCostView(lines, { purchase_order: null });
    expect(v[0].restricted).toBe(true);
    expect(v[0].total).toBeNull();
    expect(v.find((g) => g.source === 'timesheet_entry')!.disciplines[0].lines[0].quantity).toBe(8);
  });
  it('omits the total when a record has no readable amount or mixes currencies', () => {
    expect(buildCostView([ln('purchase_order', 'a', null), ln('purchase_order', 'b', null)], { purchase_order: { a: { amount: 1, currency: 'IDR' } } })[0].total).toBeNull();
    expect(buildCostView([ln('purchase_order', 'a', null), ln('purchase_order', 'b', null)], { purchase_order: { a: { amount: 1, currency: 'IDR' }, b: { amount: 1, currency: 'USD' } } })[0].total).toBeNull();
  });
  it('a source with no money read in this version shows no total and is not flagged restricted', () => {
    const v = buildCostView([ln('timesheet_entry', 't', null, 2)], {});
    expect(v[0]).toMatchObject({ total: null, restricted: false });
  });
});
