import { describe, expect, it } from 'vitest';
import { rollupProject, type CostAmountLine, type PvaWorkOrder } from './workOrderPlanVsActual';

/** Layer-1 gate-tests for labour cost by class in plan versus actual (#2670, spec docs/specs/labour-cost-money.spec.md). */

const wo = (id: string, extra: Partial<PvaWorkOrder> = {}): PvaWorkOrder => ({
  id, woNumber: id, title: id, status: 'Issued', currency: 'IDR', revenue: '0.00', revenueComplete: true, ...extra,
});
let seq = 0;
const line = (extra: Partial<CostAmountLine>): CostAmountLine => ({
  source: 'vendor_bill', recordId: `r${++seq}`, projectId: 'p1', workOrderId: null, disciplineId: null, occurredOn: '2026-11-03',
  reference: null, currency: 'IDR', amount: '0.00', reason: 'counted', quantity: null, quantityUnit: null, personId: null, ...extra,
});
const labour = (workOrderId: string | null, classId: string, amount: string, hours: number, extra: Partial<CostAmountLine> = {}) =>
  line({ source: 'timesheet_entry', workOrderId, labourClassId: classId, amount, quantity: hours, quantityUnit: 'hours', personId: 'u1', ...extra });
const run = (workOrders: PvaWorkOrder[], lines: CostAmountLine[]) =>
  rollupProject({ workOrders, lines, plans: [], split: null, restricted: false, projectRevenue: null });

describe('rollupProject — labour cost by class (#2670)', () => {
  it('AC-LCM-017 shows labour per class with hours, and the direct cost includes it exactly once', () => {
    const r = run([wo('A')], [
      labour('A', 'direct', '400000.00', 8), labour('A', 'direct', '300000.00', 6), labour('A', 'guard', '100000.00', 2),
      line({ workOrderId: 'A', amount: '50000.00' }),
    ]);
    const f = r.workOrders[0];
    expect(f.direct).toBe('850000.00');
    expect(f.labour).toEqual([
      { classId: 'direct', hours: 14, amount: '700000.00' },
      { classId: 'guard', hours: 2, amount: '100000.00' },
    ]);
    expect(f.directBySource.timesheet_entry).toBe('800000.00');
  });

  it('AC-LCM-017 hours with no rate stay named apart and add no money', () => {
    const r = run([wo('A')], [
      labour('A', 'direct', '400000.00', 8),
      line({ source: 'timesheet_entry', workOrderId: 'A', amount: null, reason: 'no-rate', quantity: 5, quantityUnit: 'hours', personId: 'u2' }),
    ]);
    expect(r.workOrders[0].uncostedHours).toBe(5);
    expect(r.workOrders[0].direct).toBe('400000.00');
    expect(r.workOrders[0].labour).toEqual([{ classId: 'direct', hours: 8, amount: '400000.00' }]);
  });

  it('AC-LCM-011 labour with no work order is shared cost and is allocated, not added to any direct cost', () => {
    const r = run([wo('A'), wo('B')], [
      line({ workOrderId: 'A', amount: '600.00' }), line({ workOrderId: 'B', amount: '400.00' }),
      labour(null, 'direct', '100.00', 1),
    ]);
    expect(r.workOrders.map((f) => f.direct)).toEqual(['600.00', '400.00']);
    expect(r.workOrders.map((f) => f.allocated)).toEqual(['60.00', '40.00']);
    expect(r.workOrders[0].labour).toBeUndefined();
  });

  it('AC-LCM-001 with no labour class on any line the figures have no labour block (existing organisations)', () => {
    const r = run([wo('A')], [line({ workOrderId: 'A', amount: '10.00' }),
      line({ source: 'timesheet_entry', workOrderId: 'A', amount: null, reason: 'no-rate', quantity: 8, quantityUnit: 'hours' })]);
    expect(r.workOrders[0].labour).toBeUndefined();
  });

  it('labour in another currency is listed apart and never converted', () => {
    const r = run([wo('A', { currency: 'USD' })], [labour('A', 'direct', '400000.00', 8, { currency: 'IDR' })]);
    expect(r.workOrders[0].direct).toBe('0.00');
    expect(r.workOrders[0].otherCurrency).toEqual([{ currency: 'IDR', amount: '400000.00' }]);
    expect(r.workOrders[0].labour).toBeUndefined();
  });
});

const attendance = (workOrderId: string | null, classId: string | null, amount: string | null, hours: number, extra: Partial<CostAmountLine> = {}) =>
  line({ source: 'attendance_day', workOrderId, labourClassId: classId, amount, quantity: hours, quantityUnit: 'hours', personId: 'w1',
         reason: amount === null ? 'no-rate' : 'counted', currency: amount === null ? null : 'IDR', ...extra });

describe('rollupProject — approved hours of people with no login (no-login-labour-cost)', () => {
  it('AC-NLL-013 attendance labour joins the labour per class and the direct cost once, beside timesheet labour', () => {
    const r = run([wo('A')], [
      labour('A', 'direct', '400000.00', 8), attendance('A', 'direct', '320000.00', 8), attendance('A', 'guard', '160000.00', 8),
    ]);
    const f = r.workOrders[0];
    expect(f.direct).toBe('880000.00');
    expect(f.labour).toEqual([
      { classId: 'direct', hours: 16, amount: '720000.00' },
      { classId: 'guard', hours: 8, amount: '160000.00' },
    ]);
    expect(f.directBySource.attendance_day).toBe('480000.00');
    expect(f.directBySource.timesheet_entry).toBe('400000.00');
  });

  it('AC-NLL-013 attendance hours are crew hours, and unpriced ones are named apart with no money', () => {
    const r = run([wo('A')], [
      labour('A', 'direct', '400000.00', 8, { personId: 'u1' }),
      attendance('A', 'direct', '320000.00', 8, { personId: 'w1' }),
      attendance('A', null, null, 5, { personId: 'w2' }),
    ]);
    const f = r.workOrders[0];
    expect(f.crewHours).toBe(21);
    expect(f.crewSize).toBe(3);
    expect(f.uncostedHours).toBe(5);
    expect(f.pendingCrewHours).toBe(0);
    expect(f.direct).toBe('720000.00');
  });

  it('AC-NLL-013 a Project Manager aggregate attendance row (no record, no person) still counts its hours and money', () => {
    const r = run([wo('A')], [attendance('A', 'direct', '440000.00', 10, { recordId: null, occurredOn: null, personId: null })]);
    expect(r.workOrders[0].crewHours).toBe(10);
    expect(r.workOrders[0].labour).toEqual([{ classId: 'direct', hours: 10, amount: '440000.00' }]);
  });
});

const headcount = (workOrderId: string | null, classId: string | null, amount: string | null, hours: number | null, extra: Partial<CostAmountLine> = {}) =>
  line({ source: 'headcount_day', workOrderId, labourClassId: classId, amount, quantity: hours, quantityUnit: 'hours', personId: null,
         reason: amount === null ? 'no-rate' : 'counted', currency: amount === null ? null : 'IDR', ...extra });

describe('rollupProject — daily head counts (guard-headcount)', () => {
  it('AC-HC-010 head-count money joins the labour per class and the direct cost once, beside timesheet and attendance labour', () => {
    const r = run([wo('A')], [
      labour('A', 'direct', '400000.00', 8), attendance('A', 'guard', '160000.00', 8), headcount('A', 'guard', '960000.00', 24),
    ]);
    const f = r.workOrders[0];
    expect(f.direct).toBe('1520000.00');
    expect(f.labour).toEqual([
      { classId: 'direct', hours: 8, amount: '400000.00' },
      { classId: 'guard', hours: 32, amount: '1120000.00' },
    ]);
    expect(f.directBySource.headcount_day).toBe('960000.00');
  });

  it('AC-HC-010 head-count person-hours are crew hours but add no person to the crew size; an unpriced line adds nothing', () => {
    const r = run([wo('A')], [
      attendance('A', 'direct', '320000.00', 8, { personId: 'w1' }),
      headcount('A', 'guard', '960000.00', 24),
      headcount('A', null, null, null),
    ]);
    const f = r.workOrders[0];
    expect(f.crewHours).toBe(32);
    expect(f.crewSize).toBe(1);
    expect(f.uncostedHours).toBe(0);
  });

  it('AC-HC-010 a Project Manager aggregate head-count row (no record, no date) still counts its hours and money', () => {
    const r = run([wo('A')], [headcount('A', 'guard', '1120000.00', 32, { recordId: null, occurredOn: null })]);
    expect(r.workOrders[0].crewHours).toBe(32);
    expect(r.workOrders[0].labour).toEqual([{ classId: 'guard', hours: 32, amount: '1120000.00' }]);
  });
});

