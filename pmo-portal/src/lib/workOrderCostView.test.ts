import { describe, it, expect } from 'vitest';
import { buildCostView, buildDailyCost, NO_DISCIPLINE } from './workOrderCostView';
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
  it('keeps mixed currencies as separate exact totals rather than silently hiding them', () => {
    const group = buildCostView([ln('purchase_order', 'a', null), ln('purchase_order', 'b', null)], { purchase_order: { a: { amount: 2, currency: 'IDR' }, b: { amount: 3, currency: 'USD' } } })[0];
    expect(group.totals).toEqual([{ amount: 2, currency: 'IDR' }, { amount: 3, currency: 'USD' }]);
    expect(group.disciplines[0].totals).toEqual(group.totals);
  });
  it('a source with no money read in this version shows no total and is not flagged restricted', () => {
    const v = buildCostView([ln('timesheet_entry', 't', null, 2)], {});
    expect(v[0]).toMatchObject({ total: null, restricted: false });
  });
});

describe('#1126 buildDailyCost: one source, grouped by each record\'s own day', () => {
  const at = (source: CostSource, id: string, day: string | null): WorkOrderCostLine => ({ ...ln(source, id, null), occurredOn: day });
  const idr = (amount: number) => ({ amount, currency: 'IDR' });
  const lines = [
    at('vendor_bill', 'b1', '2026-11-10'), at('stock_document', 's1', '2026-11-10'), at('stock_document', 's2', '2026-11-12'),
    at('equipment_usage', 'e1', '2026-11-10'), at('expense_claim', 'c1', '2026-11-12'), at('timesheet_entry', 't1', '2026-11-10'),
    at('equipment_usage', 'e2', null), at('purchase_order', 'po1', '2026-11-10'),
  ];
  const money = {
    vendor_bill: { b1: idr(100.25) }, stock_document: { s1: idr(40), s2: idr(10.1) }, equipment_usage: { e1: idr(300), e2: idr(55.55) },
    expense_claim: { c1: idr(7) }, timesheet_entry: { t1: idr(80.2) }, purchase_order: { po1: idr(9999) },
  };
  const groups = buildCostView(lines, money);
  const daily = buildDailyCost(groups, 'IDR');

  it('the days plus the undated line add up to the cost list total of every counted source (a commitment is not counted)', () => {
    const listTotal = groups.filter((g) => g.source !== 'purchase_order').reduce((s, g) => s + g.total!.amount, 0);
    const days = Object.values(daily.days).reduce((s, d) => s + d.total!, 0);
    expect(Math.round((days + daily.undated!.total!) * 100) / 100).toBe(Math.round(listTotal * 100) / 100);
  });
  it('puts each cost on its own day under labour, equipment, material or other; no cost is spread', () => {
    expect(daily.days['2026-11-10']).toMatchObject({ labour: 80.2, equipment: 300, material: 140.25, other: undefined, total: 520.45 });
    expect(daily.days['2026-11-12']).toMatchObject({ labour: undefined, equipment: undefined, material: 10.1, other: 7, total: 17.1 });
    expect(Object.keys(daily.days)).toEqual(['2026-11-10', '2026-11-12']);
  });
  it('a cost with no day sits on the undated line, not on any day', () => {
    expect(daily.undated).toMatchObject({ equipment: 55.55, total: 55.55 });
  });
  it('a day whose cost cannot be read says so (null), never zero, and so is its total', () => {
    const d = buildDailyCost(buildCostView(lines, { ...money, timesheet_entry: undefined }), 'IDR');
    expect(d.days['2026-11-10'].labour).toBeNull();
    expect(d.days['2026-11-10'].total).toBeNull();
    expect(d.days['2026-11-12'].total).toBe(17.1);
  });
  it('a cost in another currency is unknown for this work order, never added', () => {
    const d = buildDailyCost(buildCostView(lines, { ...money, expense_claim: { c1: { amount: 7, currency: 'USD' } } }), 'IDR');
    expect(d.days['2026-11-12'].other).toBeNull();
  });
  it('no counted cost lines at all: nothing to show', () => {
    expect(buildDailyCost([], 'IDR')).toEqual({ days: {}, undated: null });
  });
});
