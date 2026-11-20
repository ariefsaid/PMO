import { describe, expect, it } from 'vitest';
import {
  allocateShared,
  apportion,
  parseSplitPercent,
  planVariance,
  rollupProject,
  type CostAmountLine,
  type PvaWorkOrder,
} from './workOrderPlanVsActual';

/** Layer-1 money gate-tests for plan vs actual per work order (#2519, spec docs/specs/work-order-plan-vs-actual.spec.md). */

const wo = (id: string, woNumber: string, extra: Partial<PvaWorkOrder> = {}): PvaWorkOrder => ({
  id, woNumber, title: id, status: 'Issued', currency: 'IDR', revenue: '0.00', revenueComplete: true, ...extra,
});

let seq = 0;
const line = (extra: Partial<CostAmountLine>): CostAmountLine => ({
  source: 'vendor_bill', recordId: `r${++seq}`, projectId: 'p1', workOrderId: null, disciplineId: null,
  occurredOn: '2026-11-01', reference: null, currency: 'IDR', amount: '0.00', reason: 'counted',
  quantity: null, quantityUnit: null, personId: null, ...extra,
});

describe('allocateShared (FR-WPVA-020..024)', () => {
  it('AC-WPVA-004 splits shared cost by each work order\'s share of direct cost when no custom split exists', () => {
    const r = allocateShared(
      [{ workOrderId: 'A', woNumber: 'WO-1', direct: 60000n, cancelled: false }, { workOrderId: 'B', woNumber: 'WO-2', direct: 40000n, cancelled: false }],
      10000n,
      null,
    );
    expect(r.basis).toBe('direct-share');
    expect(r.allocations.get('A')).toBe(6000n);
    expect(r.allocations.get('B')).toBe(4000n);
    expect(r.unallocated).toBe(0n);
  });

  it('AC-WPVA-005 distributes the remaining cent to the largest fraction', () => {
    const split = [
      { workOrderId: 'C', percent: '33.3334' },
      { workOrderId: 'A', percent: '33.3333' },
      { workOrderId: 'B', percent: '33.3333' },
    ];
    const r = allocateShared(
      [
        { workOrderId: 'A', woNumber: 'WO-1', direct: 0n, cancelled: false },
        { workOrderId: 'B', woNumber: 'WO-2', direct: 0n, cancelled: false },
        { workOrderId: 'C', woNumber: 'WO-3', direct: 0n, cancelled: false },
      ],
      10000n,
      split,
    );
    expect(r.basis).toBe('custom');
    expect([r.allocations.get('A'), r.allocations.get('B'), r.allocations.get('C')]).toEqual([3333n, 3333n, 3334n]);
    expect([...r.allocations.values()].reduce((a, b) => a + b, 0n)).toBe(10000n);
  });

  it('AC-WPVA-007 treats a custom split as stale once a work order is added, and uses the default', () => {
    const r = allocateShared(
      [
        { workOrderId: 'A', woNumber: 'WO-1', direct: 30000n, cancelled: false },
        { workOrderId: 'B', woNumber: 'WO-2', direct: 10000n, cancelled: false },
        { workOrderId: 'N', woNumber: 'WO-3', direct: 0n, cancelled: false },
      ],
      1000n,
      [{ workOrderId: 'A', percent: '50' }, { workOrderId: 'B', percent: '50' }],
    );
    expect(r.stale).toBe(true);
    expect(r.basis).toBe('direct-share');
    expect(r.allocations.get('A')).toBe(750n);
    expect(r.allocations.get('B')).toBe(250n);
  });

  it('AC-WPVA-007 treats a custom split as stale once one of its work orders is cancelled', () => {
    const r = allocateShared(
      [
        { workOrderId: 'A', woNumber: 'WO-1', direct: 100n, cancelled: false },
        { workOrderId: 'B', woNumber: 'WO-2', direct: 0n, cancelled: true },
      ],
      1000n,
      [{ workOrderId: 'A', percent: '50' }, { workOrderId: 'B', percent: '50' }],
    );
    expect(r.stale).toBe(true);
    expect(r.allocations.get('A')).toBe(1000n);
  });

  it('never uses a split that does not sum to exactly 100', () => {
    const r = allocateShared(
      [{ workOrderId: 'A', woNumber: 'WO-1', direct: 100n, cancelled: false }, { workOrderId: 'B', woNumber: 'WO-2', direct: 300n, cancelled: false }],
      400n,
      [{ workOrderId: 'A', percent: '50' }, { workOrderId: 'B', percent: '49.9999' }],
    );
    expect(r.basis).toBe('direct-share');
    expect(r.stale).toBe(true);
    expect(r.allocations.get('A')).toBe(100n);
  });

  it('AC-WPVA-008 leaves shared cost unassigned when no work order has positive direct cost', () => {
    const r = allocateShared(
      [
        { workOrderId: 'A', woNumber: 'WO-1', direct: 0n, cancelled: false },
        { workOrderId: 'B', woNumber: 'WO-2', direct: 0n, cancelled: false },
        { workOrderId: 'C', woNumber: 'WO-3', direct: 0n, cancelled: false },
        { workOrderId: 'X', woNumber: 'WO-4', direct: 0n, cancelled: true },
      ],
      9000n,
      null,
    );
    expect(r.basis).toBe('none');
    expect(r.allocations.size).toBe(0);
    expect(r.unallocated).toBe(9000n);
  });

  it('includes a cancelled work order in the default split only when it carries cost', () => {
    const r = allocateShared(
      [{ workOrderId: 'A', woNumber: 'WO-1', direct: 300n, cancelled: false }, { workOrderId: 'X', woNumber: 'WO-2', direct: 100n, cancelled: true }],
      400n,
      null,
    );
    expect(r.allocations.get('X')).toBe(100n);
  });

  it('gives negative direct cost no default weight and leaves cost unassigned when no weight is positive', () => {
    const r = allocateShared([{ workOrderId: 'A', woNumber: 'WO-1', direct: -100n, cancelled: false },
      { workOrderId: 'B', woNumber: 'WO-2', direct: 200n, cancelled: false }], 100n, null);
    expect(r.allocations.get('A') ?? 0n).toBe(0n);
    expect(r.allocations.get('B')).toBe(100n);
    const none = allocateShared([{ workOrderId: 'A', woNumber: 'WO-1', direct: -100n, cancelled: false },
      { workOrderId: 'B', woNumber: 'WO-2', direct: 0n, cancelled: false }], 100n, null);
    expect(none.unallocated).toBe(100n);
    expect(none.allocations.size).toBe(0);
  });

  it('leaves shared cost unallocated when the project has no live work order', () => {
    const r = allocateShared([], 500n, null);
    expect(r.basis).toBe('none');
    expect(r.unallocated).toBe(500n);
  });
});

describe('apportion and parseSplitPercent', () => {
  it('sums exactly to the total for awkward weights, negative totals included', () => {
    const out = apportion(1001n, [1n, 1n, 1n]);
    expect(out).toEqual([334n, 334n, 333n]);
    expect(apportion(-1001n, [1n, 1n, 1n]).reduce((a, b) => a + b, 0n)).toBe(-1001n);
  });
  it('distributes leftover cents by largest fractional remainder without charging a zero share', () => {
    expect(apportion(1n, [50n, 50n, 0n])).toEqual([1n, 0n, 0n]);
    expect(apportion(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(apportion(-100n, [1n, 1n, 1n])).toEqual([-34n, -33n, -33n]);
  });
  it('reads 0..100 with up to 4 decimals and refuses anything else', () => {
    expect(parseSplitPercent('33.3333')).toBe(333333n);
    expect(parseSplitPercent('100')).toBe(1000000n);
    expect(parseSplitPercent('100.0001')).toBeNull();
    expect(parseSplitPercent('1.23456')).toBeNull();
    expect(parseSplitPercent('-1')).toBeNull();
  });
});

describe('rollupProject — actuals and roll-ups (FR-WPVA-010..032)', () => {
  it('AC-WPVA-003 totals reachable PMO money sources and retains stock as context', () => {
    const r = rollupProject({
      workOrders: [wo('A', 'WO-1')],
      lines: [
        line({ workOrderId: 'A', source: 'vendor_bill', amount: '100.00', disciplineId: 'civ' }),
        line({ workOrderId: 'A', source: 'stock_document', amount: null, reason: 'outside-basis', disciplineId: 'ele' }),
        line({ workOrderId: 'A', source: 'equipment_usage', amount: '10.25', quantity: 4, quantityUnit: 'hours' }),
        // a purchase order is a commitment — listed, never summed (no double count with its bill)
        line({ workOrderId: 'A', source: 'purchase_order', amount: null, reason: 'commitment' }),
      ],
      plans: [], split: null, restricted: false,
    });
    const a = r.workOrders[0];
    expect(a.direct).toBe('110.25');
    expect(a.directBySource).toEqual({ vendor_bill: '100.00', equipment_usage: '10.25' });
    expect(a.lines.find((l) => l.source === 'stock_document')?.reason).toBe('outside-basis');
    const groups = a.disciplines.map((d) => d.direct);
    expect(groups).toEqual(['100.00', '10.25']);
  });

  it('AC-WPVA-004 result after shared cost = revenue - direct - allocated', () => {
    const r = rollupProject({
      workOrders: [wo('A', 'WO-1', { revenue: '1000.00' }), wo('B', 'WO-2', { revenue: '500.00' })],
      lines: [
        line({ workOrderId: 'A', amount: '600.00' }),
        line({ workOrderId: 'B', amount: '400.00' }),
        line({ workOrderId: null, amount: '100.00' }),
      ],
      plans: [], split: null, restricted: false,
    });
    const [a, b] = r.workOrders;
    expect(a.allocated).toBe('60.00');
    expect(b.allocated).toBe('40.00');
    expect(a.directMargin).toEqual({ amount: '400.00', reason: null });
    expect(a.result).toEqual({ amount: '340.00', reason: null });
    expect(b.result).toEqual({ amount: '60.00', reason: null });
  });

  it('AC-WPVA-011 discipline direct and allocated shared cost sum to the work order\'s figures', () => {
    const r = rollupProject({
      workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2')],
      lines: [
        line({ workOrderId: 'A', amount: '200.00', disciplineId: 'civ' }),
        line({ workOrderId: 'A', amount: '100.00', disciplineId: 'ele' }),
        line({ workOrderId: 'B', amount: '33.33', disciplineId: 'civ' }),
        line({ workOrderId: null, amount: '10.01' }),
      ],
      plans: [], split: null, restricted: false,
    });
    for (const w of r.workOrders) {
      const sum = (k: 'direct' | 'allocated') => w.disciplines.reduce((t, d) => t + BigInt(Math.round(Number(d[k]) * 100)), 0n);
      expect(sum('direct')).toBe(BigInt(Math.round(Number(w.direct) * 100)));
      expect(sum('allocated')).toBe(BigInt(Math.round(Number(w.allocated) * 100)));
    }
    // project discipline roll-up: civil spans both work orders
    const civ = r.disciplines.find((d) => d.disciplineId === 'civ');
    expect(civ?.direct).toBe('233.33');
  });

  it('rolls discipline plans into work-order and project discipline figures, including plan-only disciplines', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2')], lines: [], split: null, restricted: false,
      plans: [
        { id: 'p1', workOrderId: 'A', disciplineId: 'civ', kind: 'direct_budget', value: '100.00', note: null },
        { id: 'p2', workOrderId: 'B', disciplineId: 'civ', kind: 'direct_budget', value: '50.00', note: null },
        { id: 'p3', workOrderId: 'A', disciplineId: 'civ', kind: 'indirect_budget', value: '20.00', note: null },
      ] });
    expect(r.workOrders[0].disciplines).toEqual([{ disciplineId: 'civ', direct: '0.00', allocated: '0.00', planDirect: '100.00', planIndirect: '20.00' }]);
    expect(r.disciplines.find((d) => d.disciplineId === 'civ')).toMatchObject({ planDirect: '150.00', planIndirect: '20.00' });
  });

  it('retains the allocation basis for each currency in a mixed-currency project', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2', { currency: 'USD' })],
      plans: [], split: null, restricted: false,
      lines: [line({ workOrderId: 'A', amount: '100.00' }), line({ currency: 'USD', amount: '10.00' })] });
    expect(r.allocation.byCurrency).toEqual([{ currency: 'IDR', basis: 'direct-share' }, { currency: 'USD', basis: 'none' }]);
  });

  it('rolls hours and distinct crew across work orders and unassigned entries', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2')], split: null, restricted: false,
      plans: [{ id: 'p', workOrderId: 'A', disciplineId: null, kind: 'crew_hours', value: '20.00', note: null }],
      lines: [line({ workOrderId: 'A', source: 'timesheet_entry', reason: 'no-rate', amount: null, quantity: 4, quantityUnit: 'hours', personId: 'u1' }),
        line({ workOrderId: 'B', source: 'timesheet_entry', reason: 'no-rate', amount: null, quantity: 3, quantityUnit: 'hours', personId: 'u1' }),
        line({ source: 'equipment_usage', reason: 'no-rate', amount: null, quantity: 2, quantityUnit: 'hours' })] });
    expect(r.hours).toMatchObject({ crewHours: 7, crewSize: 1, equipmentHours: 2, planCrewHours: 20 });
  });

  it('AC-TEL-018 counts only approved equipment usage in plan-versus-actual hours (#2599)', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1')], plans: [], split: null, restricted: false,
      lines: [
        line({ workOrderId: 'A', source: 'equipment_usage', reason: 'not-posted', amount: null, quantity: 8, quantityUnit: 'hours' }),
        line({ workOrderId: 'A', source: 'equipment_usage', reason: 'no-rate', amount: null, quantity: 3, quantityUnit: 'hours' }),
      ] });
    expect(r.workOrders[0].equipmentHours).toBe(3);
  });

  it('rolls planned direct and indirect budgets up by project currency', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2')], lines: [], split: null, restricted: false,
      plans: [
        { id: 'a', workOrderId: 'A', disciplineId: null, kind: 'direct_budget', value: '100.00', note: null },
        { id: 'b', workOrderId: 'B', disciplineId: null, kind: 'direct_budget', value: '50.00', note: null },
        { id: 'c', workOrderId: 'A', disciplineId: null, kind: 'indirect_budget', value: '20.00', note: null },
      ] });
    expect(r.totals[0]).toMatchObject({ planDirect: '150.00', planIndirect: '20.00' });
  });

  it('shows project revenue and both margins using project billing, including revenue not linked to a work order', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1', { revenue: '100.00' })],
      lines: [line({ workOrderId: 'A', amount: '60.00' }), line({ amount: '40.00', reason: 'unassigned' })],
      plans: [], split: null, restricted: false,
      projectRevenue: [{ currency: 'IDR', work_revenue: '200.00', missing_work: 0 }] });
    expect(r.totals[0]).toMatchObject({ revenue: '200.00', directMargin: { amount: '140.00', reason: null },
      result: { amount: '100.00', reason: null } });
  });

  it('shows zero project revenue when the successful billing read has no invoices', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1')], plans: [], split: null, restricted: false,
      lines: [line({ workOrderId: 'A', amount: '60.00' })], projectRevenue: [] });
    expect(r.totals[0]).toMatchObject({ revenue: '0.00', result: { amount: '-60.00', reason: null } });
  });

  it('states other revenue separately without counting it as cost', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1')], plans: [], split: null, restricted: false,
      projectRevenue: [{ currency: 'IDR', work_revenue: '200.00', missing_work: 0 }],
      lines: [line({ workOrderId: 'A', amount: '60.00' }),
        line({ source: 'other_revenue', reason: 'other-revenue', amount: '30.00' })] });
    expect(r.totals[0]).toMatchObject({ total: '60.00', revenue: '200.00', otherRevenue: '30.00' });
  });

  it('AC-WPVA-012 project total = sum of work orders + Not assigned = sum of every counted line, once', () => {
    const lines = [
      line({ workOrderId: 'A', amount: '123.45' }),
      line({ workOrderId: 'B', amount: '0.01' }),
      line({ workOrderId: null, amount: '77.77' }),
      line({ workOrderId: null, amount: '5.00', currency: 'USD' }),
      line({ workOrderId: 'A', amount: '999.00', reason: 'commitment' }),
    ];
    const r = rollupProject({ workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2')], lines, plans: [], split: null, restricted: false });
    const idr = r.totals.find((t) => t.currency === 'IDR');
    expect(idr?.total).toBe('201.23');
    const woSum = r.workOrders.reduce((t, w) => t + BigInt(Math.round(Number(w.direct) * 100)) + BigInt(Math.round(Number(w.allocated) * 100)), 0n);
    expect(woSum + BigInt(Math.round(Number(idr?.notAssigned) * 100))).toBe(20123n);
    // the shared USD cost has no USD work order to land on → Not assigned
    expect(r.totals.find((t) => t.currency === 'USD')).toMatchObject({ total: '5.00', notAssigned: '5.00' });
  });

  it('AC-WPVA-009 a restricted read makes every money figure restricted and hides margin', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1', { revenue: '10.00' })], lines: [], plans: [], split: null, restricted: true });
    expect(r.restricted).toBe(true);
    expect(r.workOrders[0].direct).toBeNull();
    expect(r.workOrders[0].directMargin).toEqual({ amount: null, reason: 'restricted-rows' });
    expect(r.workOrders[0].result).toEqual({ amount: null, reason: 'restricted-rows' });
    expect(r.totals).toEqual([]);
  });

  it('AC-WPVA-007 flags a saved split as stale even before any cost is recorded', () => {
    const r = rollupProject({
      workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2')], lines: [], plans: [],
      split: [{ workOrderId: 'A', percent: '100' }], restricted: false,
    });
    expect(r.allocation.stale).toBe(true);
    expect(r.allocation.basis).toBe('none');
  });

  it('flags a stale split even when a cost amount is unknown', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2')], plans: [], restricted: false,
      lines: [line({ workOrderId: 'A', amount: null })], split: [{ workOrderId: 'A', percent: '100' }] });
    expect(r.allocation.stale).toBe(true);
  });

  it('keeps a paid amount with no work-order link unassigned instead of splitting it', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1')], plans: [], split: null, restricted: false,
      lines: [line({ workOrderId: 'A', amount: '40.00' }), line({ amount: '60.00', reason: 'unassigned' })] });
    expect(r.workOrders[0].allocated).toBe('0.00');
    expect(r.totals[0]).toMatchObject({ total: '100.00', notAssigned: '60.00' });
  });

  it('keeps a work-order cost unknown without losing a known project total', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1', { revenue: '100.00' })], plans: [], split: null, restricted: false,
      lines: [line({ workOrderId: 'A', amount: null, reason: 'unresolved-direct' }),
        line({ amount: '20.00', reason: 'unassigned' })] });
    expect(r.workOrders[0].direct).toBeNull();
    expect(r.workOrders[0].directMargin.amount).toBeNull();
    expect(r.totals[0].total).toBe('20.00');
  });

  it('does not show a margin when an unassigned project cost is unknown', () => {
    const r = rollupProject({ workOrders: [wo('A', 'WO-1', { revenue: '100.00' })], plans: [], split: null, restricted: false,
      lines: [line({ amount: null, reason: 'unassigned' })] });
    expect(r.workOrders[0].result.amount).toBeNull();
  });

  it('keeps unlinked ERP actuals unassigned unless a valid custom split exists', () => {
    const args = { workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2')], plans: [], restricted: false,
      lines: [line({ amount: '100.00', reason: 'split-when-custom' })] };
    const without = rollupProject({ ...args, split: null });
    expect(without.totals[0]).toMatchObject({ total: '100.00', notAssigned: '100.00' });
    const withSplit = rollupProject({ ...args, split: [{ workOrderId: 'A', percent: '60' }, { workOrderId: 'B', percent: '40' }] });
    expect(withSplit.workOrders.map((w) => w.allocated)).toEqual(['60.00', '40.00']);
    expect(withSplit.totals[0].notAssigned).toBe('0.00');
    const stale = rollupProject({ ...args, split: [{ workOrderId: 'A', percent: '100' }] });
    expect(stale.allocation.stale).toBe(true);
    expect(stale.totals[0].notAssigned).toBe('100.00');
  });

  it('AC-WPVA-010 a vendor bill in a second currency is listed apart and margin is not comparable', () => {
    const r = rollupProject({
      workOrders: [wo('A', 'WO-1', { revenue: '100.00' })],
      lines: [line({ workOrderId: 'A', amount: '40.00' }), line({ workOrderId: 'A', amount: '7.00', currency: 'USD' })],
      plans: [], split: null, restricted: false,
    });
    const a = r.workOrders[0];
    expect(a.direct).toBe('40.00');
    expect(a.otherCurrency).toEqual([{ currency: 'USD', amount: '7.00' }]);
    expect(a.directMargin).toEqual({ amount: null, reason: 'different-currencies' });
  });

  it('a counted line whose amount cannot be read makes the work order\'s cost unknown, never a smaller number', () => {
    const r = rollupProject({
      workOrders: [wo('A', 'WO-1', { revenue: '100.00' })],
      lines: [line({ workOrderId: 'A', amount: '40.00' }), line({ workOrderId: 'A', amount: null })],
      plans: [], split: null, restricted: false,
    });
    expect(r.workOrders[0].direct).toBeNull();
    expect(r.workOrders[0].directMargin.reason).toBe('actuals-unavailable');
  });

  it('keeps allocated cost and result unknown when a shared cost is unknown', () => {
    const r = rollupProject({
      workOrders: [wo('A', 'WO-1', { revenue: '100.00' })],
      lines: [line({ workOrderId: 'A', amount: '40.00' }), line({ amount: null })],
      plans: [], split: null, restricted: false,
    });
    expect(r.workOrders[0].allocated).toBeNull();
    expect(r.workOrders[0].result.amount).toBeNull();
  });

  it('AC-WPVA-013 equipment hours show as hours, day entries separately (no silent conversion)', () => {
    const r = rollupProject({
      workOrders: [wo('A', 'WO-1')],
      lines: [
        line({ workOrderId: 'A', source: 'equipment_usage', amount: null, reason: 'no-rate', quantity: 6, quantityUnit: 'hours' }),
        line({ workOrderId: 'A', source: 'equipment_usage', amount: null, reason: 'no-rate', quantity: 2.5, quantityUnit: 'hours' }),
        line({ workOrderId: 'A', source: 'equipment_usage', amount: null, reason: 'no-rate', quantity: 1, quantityUnit: 'days' }),
      ],
      plans: [], split: null, restricted: false,
    });
    expect(r.workOrders[0].equipmentHours).toBe(8.5);
    expect(r.workOrders[0].equipmentDays).toBe(1);
  });

  it('crew hours and crew size come from timesheet lines naming the work order', () => {
    const r = rollupProject({
      workOrders: [wo('A', 'WO-1')],
      lines: [
        line({ workOrderId: 'A', source: 'timesheet_entry', amount: null, reason: 'no-rate', quantity: 8, quantityUnit: 'hours', personId: 'u1' }),
        line({ workOrderId: 'A', source: 'timesheet_entry', amount: null, reason: 'no-rate', quantity: 4, quantityUnit: 'hours', personId: 'u1' }),
        line({ workOrderId: 'A', source: 'timesheet_entry', amount: null, reason: 'no-rate', quantity: 6, quantityUnit: 'hours', personId: 'u2' }),
        line({ workOrderId: 'A', source: 'timesheet_entry', amount: null, reason: 'no-rate', quantity: 0, quantityUnit: 'hours', personId: 'u3' }),
      ],
      plans: [], split: null, restricted: false,
    });
    expect(r.workOrders[0].crewHours).toBe(18);
    expect(r.workOrders[0].crewSize).toBe(2);
  });

  it('puts plan figures beside the matching actuals', () => {
    const r = rollupProject({
      workOrders: [wo('A', 'WO-1')],
      lines: [line({ workOrderId: 'A', amount: '120.00' })],
      plans: [
        { id: 'p1', workOrderId: 'A', disciplineId: null, kind: 'direct_budget', value: '100.00', note: null },
        { id: 'p2', workOrderId: 'A', disciplineId: 'civ', kind: 'direct_budget', value: '5.00', note: null },
        { id: 'p3', workOrderId: 'A', disciplineId: null, kind: 'crew_hours', value: '40', note: null },
      ],
      split: null, restricted: false,
    });
    expect(r.workOrders[0].plan.direct_budget).toBe('105.00');
    expect(r.workOrders[0].plan.crew_hours).toBe(40);
    expect(r.workOrders[0].plan.indirect_budget).toBeNull();
  });
});

describe('planVariance (FR-WPVA-041)', () => {
  it('AC-WPVA-014 states overspend as an amount over plan', () => {
    expect(planVariance('100.00', '120.50')).toEqual({ state: 'over', by: '20.50' });
    expect(planVariance('100.00', '80.00')).toEqual({ state: 'within', by: '20.00' });
    expect(planVariance(null, '80.00')).toEqual({ state: 'no-plan', by: null });
    expect(planVariance('100.00', null)).toEqual({ state: 'unknown', by: null });
  });
});
