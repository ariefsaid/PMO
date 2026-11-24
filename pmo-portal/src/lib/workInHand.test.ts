import { describe, expect, it } from 'vitest';
import {
  deriveWorkInHand,
  rankWorkInHand,
  formatBacklogTenths,
  hiddenFigures,
  monthsOfWorkAvailable,
  workInHandSummary,
  type WipInputRow,
} from './workInHand';

/** AC-WIH-001..008 (docs/specs/work-in-hand-backlog.spec.md). Money is exact decimal text; no float arithmetic. */
const AS_OF = '2026-12-10'; // window = June..November 2026; December is the current partial month

function contract(over: Partial<WipInputRow> & { id: string }): WipInputRow {
  return {
    kind: 'contract', parentId: null, name: over.id, code: null, status: 'Ongoing Project', currency: 'IDR',
    value: '1000000.00', incomplete: false, foreignCurrencyInvoiceCount: 0, unpricedInvoiceCount: 0,
    billedToDate: '0.00', firstBillingMonth: null, windowMonths: [], ...over,
  };
}
const m = (month: string, billed: string) => ({ month, billed });

describe('deriveWorkInHand', () => {
  it('AC-WIH-001 the hand-calculation fixture: billed 340,000, Left to bill 860,000, rate 100,000, backlog 8.6', () => {
    const [row] = deriveWorkInHand([contract({
      id: 'c', value: '1200000.00', billedToDate: '340000.00', firstBillingMonth: '2026-09-01',
      windowMonths: [m('2026-09-01', '100000.00'), m('2026-10-01', '150000.00'), m('2026-11-01', '50000.00')],
    })], AS_OF);
    expect(row.state).toBe('figures');
    expect(row.billedCents).toBe(34000000n);
    expect(row.leftToBillCents).toBe(86000000n);
    expect(row.rate).toEqual({ state: 'rate', perMonthCents: 10000000n, monthsCounted: 3, windowSumCents: 30000000n });
    expect(row.backlogTenths).toBe(86n);
    expect(formatBacklogTenths(row.backlogTenths as bigint)).toBe('8.6');
    expect(row.overBilled).toBe(false);
  });

  it('AC-WIH-002 no billing in the window: rate and backlog are undefined and flagged, not 0 and not infinity', () => {
    const [row] = deriveWorkInHand([contract({ id: 'c', billedToDate: '50000.00', firstBillingMonth: '2026-02-01' })], AS_OF);
    expect(row.rate).toEqual({ state: 'none', cause: 'nothing-billed' });
    expect(row.backlogTenths).toBeNull();
    expect(row.leftToBillCents).toBe(95000000n);
  });

  it('AC-WIH-002 never billed at all is the same state', () => {
    const [row] = deriveWorkInHand([contract({ id: 'c' })], AS_OF);
    expect(row.rate).toEqual({ state: 'none', cause: 'nothing-billed' });
    expect(row.backlogTenths).toBeNull();
  });

  it('AC-WIH-003 first billed in the current partial month only: M = 0, the rate is undefined and the cause is named', () => {
    const [row] = deriveWorkInHand([contract({ id: 'c', billedToDate: '40000.00', firstBillingMonth: '2026-12-01' })], AS_OF);
    expect(row.rate).toEqual({ state: 'none', cause: 'began-this-month' });
    expect(row.backlogTenths).toBeNull();
  });

  it('AC-WIH-004 a gap month inside the span counts in M and contributes zero', () => {
    // First billed in August (third month of the window), nothing in September or November.
    const [row] = deriveWorkInHand([contract({
      id: 'c', billedToDate: '150000.00', firstBillingMonth: '2026-08-01',
      windowMonths: [m('2026-08-01', '90000.00'), m('2026-10-01', '60000.00')],
    })], AS_OF);
    expect(row.rate).toEqual({ state: 'rate', perMonthCents: 3750000n, monthsCounted: 4, windowSumCents: 15000000n });
    expect(row.months.map((x) => x.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(row.months.find((x) => x.month === '2026-09')?.billedCents).toBe(0n);
  });

  it('AC-WIH-004 a contract billing before the window is divided by the full 6 months', () => {
    const [row] = deriveWorkInHand([contract({
      id: 'c', billedToDate: '60000.00', firstBillingMonth: '2025-01-01', windowMonths: [m('2026-11-01', '60000.00')],
    })], AS_OF);
    expect(row.rate).toMatchObject({ state: 'rate', monthsCounted: 6, perMonthCents: 1000000n });
  });

  it('AC-WIH-005 billed over value: Left to bill is 0, backlog 0.0, the row is marked, no negative figure', () => {
    const [row] = deriveWorkInHand([contract({
      id: 'c', value: '100000.00', billedToDate: '130000.00', firstBillingMonth: '2026-10-01',
      windowMonths: [m('2026-10-01', '130000.00')],
    })], AS_OF);
    expect(row.leftToBillCents).toBe(0n);
    expect(row.overBilled).toBe(true);
    expect(row.backlogTenths).toBe(0n);
    expect(formatBacklogTenths(0n)).toBe('0.0');
  });

  it('AC-WIH-005 fully billed exactly: Left to bill 0 and not over-billed', () => {
    const [row] = deriveWorkInHand([contract({ id: 'c', value: '100000.00', billedToDate: '100000.00' })], AS_OF);
    expect(row.leftToBillCents).toBe(0n);
    expect(row.overBilled).toBe(false);
    expect(row.backlogTenths).toBe(0n);
  });

  it('AC-WIH-006 1 cent over a rate of 3 cents rounds half up in integers to 0.3', () => {
    const [row] = deriveWorkInHand([contract({
      id: 'c', value: '0.04', billedToDate: '0.03', firstBillingMonth: '2026-11-01', windowMonths: [m('2026-11-01', '0.03')],
    })], AS_OF);
    expect(row.leftToBillCents).toBe(1n);
    expect(row.rate).toMatchObject({ perMonthCents: 3n });
    expect(row.backlogTenths).toBe(3n);
  });

  it('AC-WIH-006 an exact half rounds up (0.05 months -> 0.1)', () => {
    // left 1 cent, rate 20 cents: 1/20 = 0.05 months -> tenths 0.5 -> rounds half up to 1
    const [row] = deriveWorkInHand([contract({
      id: 'c', value: '0.21', billedToDate: '0.20', firstBillingMonth: '2026-11-01', windowMonths: [m('2026-11-01', '0.20')],
    })], AS_OF);
    expect(row.backlogTenths).toBe(1n);
  });

  it('keeps huge values exact (no float)', () => {
    const [row] = deriveWorkInHand([contract({
      id: 'c', value: '9007199254740993.99', billedToDate: '0.00',
    })], AS_OF);
    expect(row.leftToBillCents).toBe(900719925474099399n);
  });

  it('a no-value contract and an incomplete contract carry no figures', () => {
    const [noValue, incomplete] = deriveWorkInHand([
      contract({ id: 'a', value: '0.00' }),
      contract({ id: 'b', incomplete: true, billedToDate: null, foreignCurrencyInvoiceCount: 1 }),
    ], AS_OF);
    expect(noValue.state).toBe('no-value');
    expect(noValue.leftToBillCents).toBeNull();
    expect(incomplete.state).toBe('incomplete');
    expect(incomplete.billedCents).toBeNull();
    expect(incomplete.backlogTenths).toBeNull();
  });

  it('a malformed money value is an error, never a plausible 0', () => {
    expect(() => deriveWorkInHand([contract({ id: 'c', billedToDate: 'abc' })], AS_OF)).toThrow();
    expect(() => deriveWorkInHand([contract({ id: 'c', value: '1.234' })], AS_OF)).toThrow();
  });
});

describe('rankWorkInHand', () => {
  const ratedWindow = (billed: string) => [m('2026-11-01', billed)];
  const rated = (id: string, over: Partial<WipInputRow> = {}) => contract({
    id, name: id, firstBillingMonth: '2026-11-01', windowMonths: ratedWindow('100000.00'), billedToDate: '100000.00', ...over,
  });

  function ids(groups: ReturnType<typeof rankWorkInHand>, currency = 'IDR') {
    return groups.find((g) => g.currency === currency)?.contracts.map((c) => c.contract.id);
  }

  it('AC-WIH-007 ranks by Left to bill within each currency; no-rate rows follow rows with a rate; no cross-currency total', () => {
    const rows = deriveWorkInHand([
      rated('small-rate', { value: '1500000.00' }),                      // left 1.4M, rate 100k
      rated('big-rate', { value: '9000000.00' }),                        // left 8.9M, rate 100k
      contract({ id: 'huge-no-rate', value: '50000000.00' }),            // left 50M but no rate -> after rated rows
      rated('usd-a', { currency: 'USD', value: '300000.00' }),
      rated('usd-b', { currency: 'USD', value: '900000.00' }),
    ], AS_OF);
    const groups = rankWorkInHand(rows, 'leftToBill', 'IDR');
    expect(groups.map((g) => g.currency)).toEqual(['IDR', 'USD']);
    expect(ids(groups)).toEqual(['big-rate', 'small-rate', 'huge-no-rate']);
    expect(ids(groups, 'USD')).toEqual(['usd-b', 'usd-a']);
    expect(groups[0].totals.leftToBillCents).toBe((890000000n + 140000000n + 5000000000n));
    expect(groups[1].totals.leftToBillCents).toBe(80000000n + 20000000n);
    // each total lives in its own group; nothing spans currencies
    expect(groups.every((g) => g.contracts.every((c) => c.contract.currency === g.currency))).toBe(true);
  });

  it('AC-WIH-007 over-billed and fully billed rows rank last among rows with a rate', () => {
    const rows = deriveWorkInHand([
      rated('over', { value: '50000.00', billedToDate: '100000.00' }),
      rated('open', { value: '400000.00' }),
      contract({ id: 'no-rate', value: '700000.00' }),
    ], AS_OF);
    expect(ids(rankWorkInHand(rows, 'leftToBill', 'IDR'))).toEqual(['open', 'over', 'no-rate']);
  });

  it('AC-WIH-008 backlog order: months of backlog descending, no billing rate last', () => {
    const rows = deriveWorkInHand([
      rated('fast', { value: '1000000.00' }),                                           // left 900k / 100k = 9.0
      rated('slow', { value: '400000.00', windowMonths: ratedWindow('10000.00'), billedToDate: '10000.00' }), // left 390k / 10k = 39.0
      contract({ id: 'huge-no-rate', value: '90000000.00' }),
    ], AS_OF);
    expect(ids(rankWorkInHand(rows, 'leftToBill', 'IDR'))).toEqual(['fast', 'slow', 'huge-no-rate']);
    expect(ids(rankWorkInHand(rows, 'backlog', 'IDR'))).toEqual(['slow', 'fast', 'huge-no-rate']);
  });

  it('ties on Left to bill break by months of backlog descending, then name', () => {
    const rows = deriveWorkInHand([
      rated('b', { value: '1000000.00' }),
      rated('a', { value: '1000000.00' }),
      rated('slower', { value: '1000000.00', windowMonths: ratedWindow('50000.00'), billedToDate: '100000.00' }),
    ], AS_OF);
    // all left 900k; 'slower' has the lower rate (50k) -> 18 months -> first; then a, b by name
    expect(ids(rankWorkInHand(rows, 'leftToBill', 'IDR'))).toEqual(['slower', 'a', 'b']);
  });

  it('puts the organisation currency first even when another currency has the larger total', () => {
    const rows = deriveWorkInHand([
      rated('usd', { currency: 'USD', value: '9000000.00' }),
      rated('idr', { value: '300000.00' }),
    ], AS_OF);
    expect(rankWorkInHand(rows, 'leftToBill', 'IDR').map((g) => g.currency)).toEqual(['IDR', 'USD']);
  });

  it('keeps incomplete and no-value rows out of the ranking and the totals', () => {
    const rows = deriveWorkInHand([
      rated('ok', { value: '300000.00' }),
      contract({ id: 'inc', incomplete: true, billedToDate: null, value: '99999999.00' }),
      contract({ id: 'nov', value: '0.00' }),
    ], AS_OF);
    const [g] = rankWorkInHand(rows, 'leftToBill', 'IDR');
    expect(g.contracts.map((c) => c.contract.id)).toEqual(['ok']);
    expect(g.totals.leftToBillCents).toBe(20000000n);
  });

  it('total backlog is total Left to bill over total rate, from rows that have a rate only, counting rows left out', () => {
    const rows = deriveWorkInHand([
      rated('r1', { value: '1100000.00' }),   // left 1.0M, rate 100k
      rated('r2', { value: '300000.00', windowMonths: ratedWindow('50000.00'), billedToDate: '50000.00' }), // left 250k, rate 50k
      contract({ id: 'no-rate', value: '900000.00' }),
    ], AS_OF);
    const [g] = rankWorkInHand(rows, 'leftToBill', 'IDR');
    expect(g.totals.leftToBillCents).toBe(100000000n + 25000000n + 90000000n);
    expect(g.totals.ratePerMonthCents).toBe(15000000n);
    // rated left 1.25M over rate 150k = 8.33 months -> 8.3
    expect(g.totals.backlogTenths).toBe(83n);
    expect(g.totals.leftOutCount).toBe(1);
  });

  it('lists work orders beneath their contract, ranked, and never adds them to the contract totals', () => {
    const rows = deriveWorkInHand([
      rated('c1', { id: 'c1', value: '2000000.00' }),
      { ...rated('w-small', { value: '200000.00' }), kind: 'workOrder', parentId: 'c1' },
      { ...rated('w-big', { value: '900000.00' }), kind: 'workOrder', parentId: 'c1' },
      { ...rated('w-orphan', { value: '500000.00' }), kind: 'workOrder', parentId: 'hidden-contract' },
    ], AS_OF);
    const [g] = rankWorkInHand(rows, 'leftToBill', 'IDR');
    expect(g.contracts).toHaveLength(1);
    expect(g.contracts[0].workOrders.map((w) => w.id)).toEqual(['w-big', 'w-small']);
    expect(g.unparentedWorkOrders.map((w) => w.id)).toEqual(['w-orphan']);
    expect(g.totals.leftToBillCents).toBe(190000000n);
    expect(g.workOrderTotals.leftToBillCents).toBe(10000000n + 80000000n + 40000000n);
  });
});

describe('hiddenFigures', () => {
  it('counts every figure it cannot show, with its cause (NFR-WIH-004)', () => {
    const rows = deriveWorkInHand([
      contract({ id: 'ok', billedToDate: '1.00', firstBillingMonth: '2026-11-01', windowMonths: [m('2026-11-01', '1.00')] }),
      contract({ id: 'nr', value: '500.00' }),
      contract({ id: 'inc1', incomplete: true, billedToDate: null, foreignCurrencyInvoiceCount: 2 }),
      contract({ id: 'inc2', incomplete: true, billedToDate: null, unpricedInvoiceCount: 1 }),
      contract({ id: 'nov', value: '0.00' }),
    ], AS_OF);
    expect(hiddenFigures(rows, { noValueContractCount: 1, undatedInvoiceCount: 3, truncated: true })).toEqual({
      noValue: 2,                 // the one the database listed plus the one derived here
      noRate: 1,
      incomplete: 2,
      foreignCurrencyInvoices: 2,
      unpricedInvoices: 1,
      undatedInvoices: 3,
      truncated: true,
    });
  });

  it('does not count a fully billed row as missing a rate', () => {
    const rows = deriveWorkInHand([contract({ id: 'done', value: '100.00', billedToDate: '100.00' })], AS_OF);
    expect(hiddenFigures(rows, { noValueContractCount: 0, undatedInvoiceCount: 0, truncated: false }).noRate).toBe(0);
  });
});

describe('work-in-hand months by monthly capacity', () => {
  it('AC-M8-001 divides only the organisation-currency backlog by the configured monthly capacity', () => {
    const rows = deriveWorkInHand([
      contract({ id: 'idr', value: '25000000.00', currency: 'IDR' }),
      contract({ id: 'usd', value: '900000.00', currency: 'USD' }),
    ], AS_OF);
    const groups = rankWorkInHand(rows, 'leftToBill', 'IDR');
    expect(monthsOfWorkAvailable(groups, 'IDR', 250000000n)).toBe(100n); // 25m / 2.5m = 10.0
    expect(formatBacklogTenths(100n)).toBe('10.0');
    expect(monthsOfWorkAvailable(groups, 'IDR', 2500000000n)).toBe(10n); // 25m / 25m = 1.0
    expect(groups.filter((g) => g.currency !== 'IDR').map((g) => g.currency)).toEqual(['USD']);
  });

  it('AC-M8-001 returns no months when capacity is unset or zero', () => {
    expect(monthsOfWorkAvailable([], 'IDR', null)).toBeNull();
    expect(monthsOfWorkAvailable([], 'IDR', 0n)).toBeNull();
  });

  it('AC-M8-001 summarizes org-currency backlog, other currencies separately, and capacity months without conversion', () => {
    const rows = deriveWorkInHand([
      contract({ id: 'idr', value: '25000000.00', billedToDate: '5000000.00', currency: 'IDR' }), // left 20m
      contract({ id: 'usd', value: '900000.00', billedToDate: '0.00', currency: 'USD' }),
    ], AS_OF);
    const withCapacity = workInHandSummary(rows, 'IDR', '8000000.00'); // 20m / 8m = 2.5
    expect(withCapacity.orgLeftToBillCents).toBe(2000000000n);
    expect(withCapacity.otherCurrencies).toEqual([{ currency: 'USD', leftToBillCents: 90000000n }]);
    expect(withCapacity.capacityCents).toBe(800000000n);
    expect(withCapacity.monthsTenths).toBe(25n);

    const withoutCapacity = workInHandSummary(rows, 'IDR', null);
    expect(withoutCapacity.orgLeftToBillCents).toBe(2000000000n);
    expect(withoutCapacity.otherCurrencies).toEqual([{ currency: 'USD', leftToBillCents: 90000000n }]);
    expect(withoutCapacity.capacityCents).toBeNull();
    expect(withoutCapacity.monthsTenths).toBeNull();
  });

  it('AC-M8-001 reports zero org-currency work in hand when only foreign-currency contracts exist', () => {
    const rows = deriveWorkInHand([contract({ id: 'usd', value: '900000.00', currency: 'USD' })], AS_OF);
    const summary = workInHandSummary(rows, 'IDR', '2500000.00');
    expect(summary.orgLeftToBillCents).toBe(0n);
    expect(summary.monthsTenths).toBe(0n);
    expect(summary.otherCurrencies).toEqual([{ currency: 'USD', leftToBillCents: 90000000n }]);
  });
});
