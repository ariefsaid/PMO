import { describe, it, expect } from 'vitest';
import {
  buildManagementPack,
  leftToBillAt,
  mulDivRound,
  pctOf,
  plannedForMonth,
  selectBilledWorkByMonth,
  selectBilledWorkCumulative,
  selectBilledWorkInPeriod,
  selectBilledWorkOpening,
  selectLeftToBillTotals,
} from './managementPack';
import type { ManagementPackFacts, PackFactsProject } from '@/src/lib/db/managementPack';

const c = (major: number) => Math.round(major * 100);

const P1: PackFactsProject = {
  id: 'p1', name: 'Alpha', pmo_project_number: 'PRJ-26-0001', code: null, status: 'Ongoing Project', on_hand: true,
  currency: 'IDR', contract_net: 1_200_000, start_date: '2026-01-01', end_date: '2026-04-30',
  project_manager_id: 'u-pm', client_name: 'Client A',
};
const P2: PackFactsProject = {
  ...P1, id: 'p2', name: 'Beta', pmo_project_number: 'PRJ-26-0002', currency: 'EUR', contract_net: 0,
};

function facts(over: Partial<ManagementPackFacts> = {}): ManagementPackFacts {
  return {
    from: '2026-01-01', to: '2026-04-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
    projects: [P1], invoiced: [], invoiced_before: [], progress: [], ...over,
  };
}

describe('AC-MMP-006 planned revenue (DD-MMP-2)', () => {
  it('AC-003 #1325: report rows keep the contractual name when a display alias exists', () => {
    const aliasProject = { ...P1, short_name: 'North Terminal' };
    const row = buildManagementPack(facts({ projects: [aliasProject] })).rows[0];
    expect(row.projectName).toBe('Alpha');
    expect(row.projectName).not.toBe('North Terminal');
  });
  it('AC-MMP-006: spreads the net contract straight-line by calendar day', () => {
    const months = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'];
    expect(months.map((m) => plannedForMonth(c(1_200_000), '2026-01-01', '2026-04-30', m)))
      .toEqual([c(310_000), c(280_000), c(310_000), c(300_000)]);
    expect(plannedForMonth(c(1_200_000), '2026-01-01', '2026-04-30', '2026-05-01')).toBe(0);
    expect(plannedForMonth(c(1_200_000), '2026-01-01', '2026-04-30', '2025-12-01')).toBe(0);
  });

  it('AC-MMP-006: rounds the cumulative figure so the months sum exactly to the contract', () => {
    expect(plannedForMonth(10_000, '2026-01-30', '2026-02-01', '2026-01-01')).toBe(6667);
    expect(plannedForMonth(10_000, '2026-01-30', '2026-02-01', '2026-02-01')).toBe(3333);
  });

  it('AC-MMP-006: a project without a usable schedule has no plan', () => {
    expect(plannedForMonth(c(1_000), '2026-01-01', null, '2026-01-01')).toBeNull();
    expect(plannedForMonth(c(1_000), '2026-03-01', '2026-01-01', '2026-01-01')).toBeNull();
  });

  it('AC-MMP-006: the pack row carries the plan per month', () => {
    const row = buildManagementPack(facts()).rows[0];
    expect(row.months.map((m) => m.planned)).toEqual([c(310_000), c(280_000), c(310_000), c(300_000)]);
  });

  it('AC-MMP-006 support: proportional splits round half up, exactly', () => {
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(pctOf(10_001, 33.33)).toBe(3333);
    expect(pctOf(c(1_200_000), 40)).toBe(c(480_000));
  });
});

const prog = (month: string, pct: number) =>
  ({ project_id: 'p1', month, pct_complete: pct, entered_at: `${month}T10:00:00Z`, entered_by_name: 'Fin' });
const inv = (project_id: string | null, currency: string, month: string, net: number, invoice_count = 1) =>
  ({ project_id, currency, month, net, invoice_count });
const before = (project_id: string | null, currency: string, net: number, invoice_count: number) =>
  ({ project_id, currency, net, invoice_count });

const scenario = facts({
  invoiced_before: [before('p1', 'IDR', 100_000, 1)],
  invoiced: [inv('p1', 'IDR', '2026-01-01', 200_000), inv('p1', 'IDR', '2026-03-01', 300_000)],
  progress: [prog('2026-02-01', 40), prog('2026-04-01', 55)],
});

describe('AC-MMP-007 recognised revenue (DD-MMP-1)', () => {
  it('AC-MMP-007: billing basis until the first entry, then percent of the net contract, carried forward', () => {
    const row = buildManagementPack(scenario).rows[0];
    expect(row.months.map((m) => m.recognisedToDate)).toEqual([c(300_000), c(480_000), c(480_000), c(660_000)]);
    expect(row.months.map((m) => m.recognised)).toEqual([c(200_000), c(180_000), 0, c(180_000)]);
    expect(row.months.map((m) => m.basis)).toEqual(['invoiced', 'progress', 'progress', 'progress']);
    expect(row.latestProgress).toMatchObject({ month: '2026-04-01', pctComplete: 55 });
  });

  it('AC-MMP-007: an entry from before the window carries in, with nothing recognised in month', () => {
    const row = buildManagementPack(facts({ progress: [prog('2025-11-01', 10)] })).rows[0];
    expect(row.months[0]).toMatchObject({ basis: 'progress', recognisedToDate: c(120_000), recognised: 0 });
  });

  it('AC-MMP-007: a lower percent than last month recognises a negative amount', () => {
    const row = buildManagementPack(facts({ progress: [prog('2026-01-01', 40), prog('2026-02-01', 30)] })).rows[0];
    expect(row.months[1].recognised).toBe(-c(120_000));
  });
});

describe('AC-1279 recognised revenue from per-line earned value', () => {
  const earned = (month: string, earned_value: number) => ({ project_id: 'p1', month, earned_value });

  it('AC-1279: a project with contract lines recognises earned value, not percent x contract, month by month', () => {
    const row = buildManagementPack(facts({
      progress: [prog('2026-02-01', 40)],
      earned: [earned('2025-12-01', 0), earned('2026-01-01', 50_000), earned('2026-02-01', 400_000), earned('2026-03-01', 400_000), earned('2026-04-01', 1_300_000)],
    })).rows[0];
    expect(row.months.map((m) => m.recognisedToDate)).toEqual([c(50_000), c(400_000), c(400_000), c(1_300_000)]);
    expect(row.months.map((m) => m.recognised)).toEqual([c(50_000), c(350_000), 0, c(900_000)]);
    expect(row.months.map((m) => m.basis)).toEqual(['earned', 'earned', 'earned', 'earned']);
    expect(row.months[3].remainingWork).toBe(-c(100_000));
  });

  it('AC-1279: the month before the window is the baseline for the first month', () => {
    const row = buildManagementPack(facts({ earned: [earned('2025-12-01', 100_000), earned('2026-01-01', 130_000)] })).rows[0];
    expect(row.months[0]).toMatchObject({ recognised: c(30_000), recognisedToDate: c(130_000) });
  });

  it('AC-1279: a project without earned facts keeps the percent basis', () => {
    const row = buildManagementPack(facts({ progress: [prog('2026-02-01', 40)], earned: [{ project_id: 'other', month: '2026-02-01', earned_value: 5 }] })).rows[0];
    expect(row.months.map((m) => m.basis)).toEqual(['invoiced', 'progress', 'progress', 'progress']);
    expect(row.months[1].recognisedToDate).toBe(c(480_000));
  });
});

describe('AC-MMP-008 unbilled (DD-MMP-3)', () => {
  it('S02: keeps selected-period, cumulative, and opening billed work distinct', () => {
    const pack = buildManagementPack(facts({
      from: '2026-11-01', to: '2026-11-01',
      invoiced_before: [before('p1', 'IDR', 40, 1)],
      invoiced: [inv('p1', 'IDR', '2026-11-01', 60), inv('p1', 'IDR', '2026-11-01', 50)],
    }));

    expect(selectBilledWorkInPeriod(pack, '2026-11', '2026-11')).toEqual([{ currency: 'IDR', amount: 110 }]);
    expect(selectBilledWorkByMonth(pack, '2026-11', '2026-11', 'IDR')).toEqual([{ month: '2026-11', amount: 110 }]);
    expect(selectBilledWorkCumulative(pack, '2026-11')).toEqual([{ currency: 'IDR', amount: 150 }]);
    expect(selectBilledWorkOpening(pack, '2026-11')).toEqual([{ currency: 'IDR', amount: 40 }]);
  });

  it('S02: a current-year empty period stays zero while cumulative and opening retain historical-only billed work', () => {
    const pack = buildManagementPack(facts({
      from: '2026-01-01', to: '2026-02-01',
      projects: [],
      invoiced_before: [before(null, 'USD', 40, 1)],
    }));

    expect(selectBilledWorkInPeriod(pack, '2026-01', '2026-02')).toEqual([{ currency: 'USD', amount: 0 }]);
    expect(selectBilledWorkCumulative(pack, '2026-02')).toEqual([{ currency: 'USD', amount: 40 }]);
    expect(selectBilledWorkOpening(pack, '2026-01')).toEqual([{ currency: 'USD', amount: 40 }]);
  });

  it('AC-MMP-008: recognised to date minus invoiced to date; negative means billed ahead', () => {
    const row = buildManagementPack(scenario).rows[0];
    expect(row.months.map((m) => m.invoicedToDate)).toEqual([c(300_000), c(300_000), c(600_000), c(600_000)]);
    expect(row.months.map((m) => m.unbilled)).toEqual([0, c(180_000), -c(120_000), c(60_000)]);
  });

  it('D1: Left to bill uses contract value less invoiced value in the as-at currency', () => {
    const pack = buildManagementPack(scenario);
    expect(leftToBillAt(pack.rows, 'IDR', '2026-04-01')).toBe(c(600_000));
    expect(selectLeftToBillTotals(pack)).toEqual([{ currency: 'IDR', amount: 600_000 }]);
  });

  it('AC-1405-REPORT-001: invoice counts use dated monthly facts and accumulate through the as-at month', () => {
    const row = buildManagementPack(scenario).rows[0];
    expect(row.months.map((month) => month.invoiceCount)).toEqual([1, 0, 1, 0]);
    expect(row.months.map((month) => month.invoiceCountToDate)).toEqual([2, 2, 3, 3]);
    expect(buildManagementPack(scenario).totals[0]?.months.map((month) => month.invoiceCountToDate)).toEqual([2, 2, 3, 3]);
  });
});

describe('AC-2201 billed work counts every project and never reads an unpriced invoice as zero', () => {
  const closedHistory = { invoiced_history: [{ currency: 'IDR', net: 50, invoice_count: 1 }] };

  it('AC-2201-01: a closed or archived project\'s earlier billing stays in cumulative and opening billed work', () => {
    const pack = buildManagementPack(facts({
      from: '2026-11-01', to: '2026-11-01',
      invoiced_before: [before('p1', 'IDR', 40, 1)],
      invoiced: [inv('p1', 'IDR', '2026-11-01', 60)],
      ...closedHistory,
    }));
    expect(selectBilledWorkCumulative(pack, '2026-11')).toEqual([{ currency: 'IDR', amount: 150 }]);
    expect(selectBilledWorkOpening(pack, '2026-11')).toEqual([{ currency: 'IDR', amount: 90 }]);
  });

  it('AC-2201-01: history in a currency with no listed row still counts', () => {
    const pack = buildManagementPack(facts({
      from: '2026-11-01', to: '2026-11-01', projects: [],
      invoiced_history: [{ currency: 'USD', net: 25, invoice_count: 1 }],
    }));
    expect(selectBilledWorkCumulative(pack, '2026-11')).toEqual([{ currency: 'USD', amount: 25 }]);
    expect(selectBilledWorkOpening(pack, '2026-11')).toEqual([{ currency: 'USD', amount: 25 }]);
  });

  it('AC-2201-02: an unpriced dated invoice makes the billed figures that include its month unavailable, never zero', () => {
    const pack = buildManagementPack(facts({
      from: '2026-10-01', to: '2026-11-01',
      invoiced: [inv('p1', 'IDR', '2026-10-01', 60)],
      unpriced: [{ currency: 'IDR', month: '2026-11-01', invoice_count: 1 }],
    }));
    expect(selectBilledWorkInPeriod(pack, '2026-11', '2026-11')).toEqual([{ currency: 'IDR', amount: null }]);
    expect(selectBilledWorkInPeriod(pack, '2026-10', '2026-10')).toEqual([{ currency: 'IDR', amount: 60 }]);
    expect(selectBilledWorkCumulative(pack, '2026-11')).toEqual([{ currency: 'IDR', amount: null }]);
    expect(selectBilledWorkOpening(pack, '2026-11')).toEqual([{ currency: 'IDR', amount: 60 }]);
    expect(pack.unpricedInvoiceCount).toBe(1);
  });

  it('AC-2201-02: a period whose only invoice is unpriced, in a currency with no row, reads unavailable', () => {
    const pack = buildManagementPack(facts({
      from: '2026-11-01', to: '2026-11-01', projects: [],
      unpriced: [{ currency: 'USD', month: '2026-11-01', invoice_count: 2 }],
    }));
    expect(selectBilledWorkInPeriod(pack, '2026-11', '2026-11')).toEqual([{ currency: 'USD', amount: null }]);
    expect(selectBilledWorkCumulative(pack, '2026-11')).toEqual([{ currency: 'USD', amount: null }]);
    expect(pack.unpricedInvoiceCount).toBe(2);
  });

  it('AC-2201-03: history and unpriced facts leave every row, total and other figure identical', () => {
    const base = facts({
      invoiced_before: [before('p1', 'IDR', 100_000, 1)],
      invoiced: [inv('p1', 'IDR', '2026-01-01', 200_000), inv('p1', 'IDR', '2026-03-01', 300_000)],
      progress: [prog('2026-02-01', 40), prog('2026-04-01', 55)],
    });
    const plain = buildManagementPack(base);
    const withFacts = buildManagementPack({
      ...base,
      invoiced_history: [{ currency: 'IDR', net: 50, invoice_count: 1 }],
      unpriced: [{ currency: 'IDR', month: '2026-02-01', invoice_count: 1 }],
    });
    expect(withFacts.rows).toEqual(plain.rows);
    expect(withFacts.totals).toEqual(plain.totals);
    expect(selectLeftToBillTotals(withFacts)).toEqual(selectLeftToBillTotals(plain));
    expect(selectBilledWorkByMonth(withFacts, '2026-01', '2026-04', 'IDR')).toEqual(selectBilledWorkByMonth(plain, '2026-01', '2026-04', 'IDR'));
    expect(selectBilledWorkInPeriod(withFacts, '2026-03', '2026-04')).toEqual(selectBilledWorkInPeriod(plain, '2026-03', '2026-04'));
  });

  it('AC-2201-03: a pre-0908 server without the new keys reads as before', () => {
    const pack = buildManagementPack(facts({ invoiced: [inv('p1', 'IDR', '2026-01-01', 10)] }));
    expect(selectBilledWorkCumulative(pack, '2026-04')).toEqual([{ currency: 'IDR', amount: 10 }]);
    expect(pack.unpricedInvoiceCount).toBe(0);
  });
});

describe('AC-MMP-009 remaining work (DD-MMP-3)', () => {
  it('AC-MMP-009: net contract minus recognised to date, per month', () => {
    const row = buildManagementPack(scenario).rows[0];
    expect(row.months.map((m) => m.remainingWork)).toEqual([c(900_000), c(720_000), c(720_000), c(540_000)]);
  });

  it('AC-MMP-009: recognised above the contract gives negative remaining work, not a clamped zero', () => {
    const row = buildManagementPack(facts({ invoiced: [inv('p1', 'IDR', '2026-01-01', 1_300_000)] })).rows[0];
    expect(row.months[0].remainingWork).toBe(-c(100_000));
  });

  it('RF-036: foreign-currency invoices make contract-currency remaining work and Left to bill unavailable without reconciliation', () => {
    const pack = buildManagementPack(facts({
      invoiced: [inv('p1', 'USD', '2026-02-01', 1_200_000)],
    }));
    expect(pack.rows[0].months.map((m) => m.remainingWork)).toEqual([null, null, null, null]);
    expect(pack.rows.find((r) => r.kind === 'otherCurrency')?.months[1].remainingWork).toBeNull();
    expect(pack.totals.find((t) => t.currency === 'IDR')?.months[0].remainingWork).toBeNull();
    expect(pack.rows[0].months.map((m) => m.leftToBill)).toEqual([null, null, null, null]);
    expect(pack.rows.find((r) => r.kind === 'otherCurrency')?.months[1].leftToBill).toBeNull();
    expect(pack.totals.find((t) => t.currency === 'IDR')?.months[0].leftToBill).toBeNull();
  });

  it('AC-MIP-008 RF-039: totals omit currencies with no activity, contract, or meaningful balance in range', () => {
    const pack = buildManagementPack(facts({
      projects: [{ ...P1, currency: 'IDR' }, { ...P1, id: 'p2', currency: 'USD', contract_net: 0 }],
      invoiced: [inv(null, 'EUR', '2026-02-01', 10)],
    }));
    expect(pack.totals.map((t) => t.currency)).toEqual(['EUR', 'IDR', 'USD']);
    const noActivity = buildManagementPack(facts({
      projects: [],
      invoiced_before: [before(null, 'JPY', 0, 0)],
    }));
    expect(noActivity.totals).toEqual([]);
  });

  it('AC-MIP-003: earlier foreign invoice presence blocks remaining work and Left to bill when the group nets to zero', () => {
    const pack = buildManagementPack(facts({
      invoiced_before: [before('p1', 'USD', 0, 2)],
    }));
    expect(pack.rows[0].months.map((month) => month.remainingWork)).toEqual([null, null, null, null]);
    expect(pack.totals.find((totals) => totals.currency === 'IDR')?.months.map((month) => month.remainingWork))
      .toEqual([null, null, null, null]);
    expect(pack.rows[0].months.map((month) => month.leftToBill)).toEqual([null, null, null, null]);
    expect(pack.totals.find((totals) => totals.currency === 'IDR')?.months.map((month) => month.leftToBill))
      .toEqual([null, null, null, null]);
  });

  it.each([
    ['no earlier group', []],
    ['zero earlier count', [before('p1', 'USD', 0, 0)]],
    ['same-currency earlier invoice', [before('p1', 'IDR', 0, 1)]],
    ['unassigned earlier invoice', [before(null, 'USD', 0, 1)]],
    ['unknown project earlier invoice', [before('missing', 'USD', 0, 1)]],
  ])('AC-MIP-004: %s does not independently hide this project remaining work and Left to bill', (_label, invoiced_before) => {
    const pack = buildManagementPack(facts({ invoiced_before }));
    const p1 = pack.rows.find((row) => row.kind === 'contract' && row.projectId === 'p1');
    expect(p1?.months.map((month) => month.remainingWork)).toEqual([c(1_200_000), c(1_200_000), c(1_200_000), c(1_200_000)]);
    expect(p1?.months.map((month) => month.leftToBill)).toEqual([c(1_200_000), c(1_200_000), c(1_200_000), c(1_200_000)]);
    expect(pack.totals.find((totals) => totals.currency === 'IDR')?.months.map((month) => month.leftToBill))
      .toEqual([c(1_200_000), c(1_200_000), c(1_200_000), c(1_200_000)]);
  });

  it('AC-MIP-004: another known project foreign invoice does not hide this project remaining work and Left to bill', () => {
    const pack = buildManagementPack(facts({
      projects: [P1, P2],
      invoiced_before: [before('p2', 'USD', 0, 1)],
    }));
    const p1 = pack.rows.find((row) => row.kind === 'contract' && row.projectId === 'p1');
    const p2 = pack.rows.find((row) => row.kind === 'contract' && row.projectId === 'p2');
    expect(p1?.months.map((month) => month.remainingWork)).toEqual([c(1_200_000), c(1_200_000), c(1_200_000), c(1_200_000)]);
    expect(p2?.months.map((month) => month.remainingWork)).toEqual([null, null, null, null]);
    expect(p1?.months.map((month) => month.leftToBill)).toEqual([c(1_200_000), c(1_200_000), c(1_200_000), c(1_200_000)]);
    expect(p2?.months.map((month) => month.leftToBill)).toEqual([null, null, null, null]);
  });

  it('AC-MIP-004: a zero-net in-window foreign invoice still uses the existing count behavior', () => {
    const pack = buildManagementPack(facts({
      invoiced: [inv('p1', 'USD', '2026-02-01', 0)],
    }));
    expect(pack.rows[0].months.map((month) => month.remainingWork)).toEqual([null, null, null, null]);
    expect(pack.rows[0].months.map((month) => month.leftToBill)).toEqual([null, null, null, null]);
  });

  it('AC-MIP-003: moving the selected start across a billing month preserves foreign presence', () => {
    const earlier = buildManagementPack(facts({
      from: '2026-03-01',
      invoiced_before: [before('p1', 'USD', 0, 2)],
    }));
    const movedIntoWindow = buildManagementPack(facts({
      from: '2026-02-01',
      invoiced: [inv('p1', 'USD', '2026-02-01', 0, 2)],
    }));
    const march = (pack: ReturnType<typeof buildManagementPack>) =>
      pack.rows.find((row) => row.kind === 'contract' && row.projectId === 'p1')
        ?.months.find((month) => month.month === '2026-03-01');
    expect(march(earlier)?.remainingWork).toBeNull();
    expect(march(movedIntoWindow)?.remainingWork).toBeNull();
    expect(march(earlier)?.leftToBill).toBeNull();
    expect(march(movedIntoWindow)?.leftToBill).toBeNull();
  });
});

describe('AC-MMP-010 currencies and unassigned invoices (DD-MMP-5, DD-CUR-6)', () => {
  const pack = buildManagementPack(facts({
    invoiced: [
      inv('p1', 'IDR', '2026-01-01', 200_000),
      inv('p1', 'USD', '2026-02-01', 50),
      inv(null, 'IDR', '2026-01-01', 1_000),
    ],
  }));

  it('AC-MMP-010: one contract row, one other-currency row, one unassigned row', () => {
    expect(pack.rows.map((r) => [r.kind, r.currency])).toEqual([
      ['contract', 'IDR'], ['otherCurrency', 'USD'], ['unassigned', 'IDR'],
    ]);
  });

  it('AC-MMP-010: rows without a contract recognise on billing basis with no plan, no remaining work and no Left to bill', () => {
    const usd = pack.rows[1];
    expect(usd.projectName).toBe('Alpha');
    expect(usd.months[1]).toMatchObject({ invoiced: 5_000, recognised: 5_000, unbilled: 0, planned: null, remainingWork: null, leftToBill: null, basis: 'invoiced' });
  });

  it('AC-MMP-010: totals are one series per currency and never mix them', () => {
    expect(pack.totals.map((t) => t.currency)).toEqual(['IDR', 'USD']);
    const idr = pack.totals[0].months;
    const usd = pack.totals[1].months;
    expect(idr[0].invoiced).toBe(c(201_000));
    expect(idr[1].invoiced).toBe(0);
    expect(usd[1].invoiced).toBe(5_000);
    expect(idr[0].remainingWork).toBeNull();
  });
});

describe('#2203 Left to bill has one derivation, distinct from remaining work', () => {
  const ONE_M: PackFactsProject = { ...P1, contract_net: 1_000_000 };
  const aheadOfInvoicing = facts({
    projects: [ONE_M],
    invoiced: [inv('p1', 'IDR', '2026-02-01', 200_000)],
    progress: [prog('2026-03-01', 60)],
  });

  it('AC-LTB-001: the row and its currency total carry contract less invoiced, apart from contract less recognised', () => {
    const pack = buildManagementPack(aheadOfInvoicing);
    const april = pack.rows[0].months[3];
    expect(april).toMatchObject({ basis: 'progress', recognisedToDate: c(600_000), invoicedToDate: c(200_000) });
    expect(april.leftToBill).toBe(c(800_000));
    expect(april.remainingWork).toBe(c(400_000));
    const total = pack.totals.find((t) => t.currency === 'IDR')!.months[3];
    expect(total.leftToBill).toBe(c(800_000));
    expect(total.remainingWork).toBe(c(400_000));
    expect(leftToBillAt(pack.rows, 'IDR', '2026-04-01')).toBe(c(800_000));
    expect(selectLeftToBillTotals(pack)).toEqual([{ currency: 'IDR', amount: 800_000 }]);
  });

  it('AC-LTB-002: a foreign invoice awaiting reconciliation leaves Left to bill unknown, never 0', () => {
    const pack = buildManagementPack({ ...aheadOfInvoicing, invoiced: [...aheadOfInvoicing.invoiced, inv('p1', 'USD', '2026-02-01', 10)] });
    expect(pack.rows[0].months.map((m) => m.leftToBill)).toEqual([null, null, null, null]);
    expect(pack.rows[0].months.map((m) => m.remainingWork)).toEqual([null, null, null, null]);
    expect(pack.rows.find((r) => r.kind === 'otherCurrency')?.months[1].leftToBill).toBeNull();
    expect(pack.totals.find((t) => t.currency === 'IDR')!.months.map((m) => m.leftToBill)).toEqual([null, null, null, null]);
    expect(pack.totals.find((t) => t.currency === 'USD')!.months.map((m) => m.leftToBill)).toEqual([0, 0, 0, 0]);
    expect(selectLeftToBillTotals(pack)).toEqual([{ currency: 'IDR', amount: null }]);
  });

  // Ticket ruling: Left to bill counts contracts we hold (on-hand status, not archived), the same set as
  // Contract on hand, whatever the selected period.
  const CLOSED: PackFactsProject = { ...P1, id: 'p3', name: 'Gamma', status: 'Loss Tender', contract_net: 500_000, on_hand: false };
  const ARCHIVED: PackFactsProject = { ...P1, id: 'p4', name: 'Delta', status: 'Ongoing Project', contract_net: 700_000, on_hand: false };
  const withUnheld = facts({
    projects: [ONE_M, CLOSED, ARCHIVED],
    invoiced: [inv('p1', 'IDR', '2026-02-01', 200_000), inv('p3', 'IDR', '2026-02-01', 100_000), inv('p4', 'IDR', '2026-02-01', 300_000)],
    progress: [prog('2026-03-01', 60)],
  });

  it('AC-LTB-004: an archived or not-on-hand project billed in the window adds nothing to Left to bill', () => {
    const pack = buildManagementPack(withUnheld);
    const byId = (id: string) => pack.rows.find((r) => r.projectId === id && r.kind === 'contract')!;
    expect(byId('p1').holdsContract).toBe(true);
    expect([byId('p3').holdsContract, byId('p4').holdsContract]).toEqual([false, false]);
    expect(byId('p3').months[3].leftToBill).toBeNull();
    expect(byId('p4').months[3].leftToBill).toBeNull();
    // Remaining work is a separate measure and keeps its own row set.
    expect(byId('p4').months[3].remainingWork).toBe(c(400_000));
    expect(leftToBillAt(pack.rows, 'IDR', '2026-04-01')).toBe(c(800_000));
    expect(pack.totals.find((t) => t.currency === 'IDR')!.months[3].leftToBill).toBe(c(800_000));
    expect(selectLeftToBillTotals(pack)).toEqual([{ currency: 'IDR', amount: 800_000 }]);
  });

  it('AC-LTB-004: home lists no Left to bill currency whose only contract is no longer held', () => {
    const usdArchived: PackFactsProject = { ...ARCHIVED, id: 'p5', name: 'Epsilon', currency: 'USD' };
    const pack = buildManagementPack({ ...withUnheld, projects: [ONE_M, usdArchived], invoiced: [inv('p1', 'IDR', '2026-02-01', 200_000), inv('p5', 'USD', '2026-02-01', 300_000)] });
    expect(selectLeftToBillTotals(pack, 'IDR')).toEqual([{ currency: 'IDR', amount: 800_000 }]);
  });

  it('AC-LTB-004: switching the period does not change Left to bill at the same month', () => {
    // From March the February invoices fall before the window: the unheld projects drop out of the facts
    // (the server returns them only when billed in the window) and p1's invoice moves to invoiced_before.
    const fromMarch = facts({
      from: '2026-03-01', projects: [ONE_M],
      invoiced_before: [{ project_id: 'p1', currency: 'IDR', net: 200_000, invoice_count: 1 }],
      progress: [prog('2026-03-01', 60)],
    });
    const at = (f: ManagementPackFacts) => leftToBillAt(buildManagementPack(f).rows, 'IDR', '2026-04-01');
    expect(at(withUnheld)).toBe(c(800_000));
    expect(at(fromMarch)).toBe(at(withUnheld));
  });

  it('AC-LTB-004: an unheld project awaiting reconciliation does not make Left to bill unknown', () => {
    const pack = buildManagementPack({ ...withUnheld, invoiced: [...withUnheld.invoiced, inv('p4', 'USD', '2026-02-01', 10)] });
    expect(leftToBillAt(pack.rows, 'IDR', '2026-04-01')).toBe(c(800_000));
  });

  it('AC-LTB-004: a project sent without the on-hand flag is not counted, whatever its status', () => {
    // An archived project keeps an on-hand status; only the server's flag knows it is archived.
    const { on_hand: _ignored, ...unflaggedArchived } = ARCHIVED;
    const pack = buildManagementPack({ ...withUnheld, projects: [ONE_M, unflaggedArchived as PackFactsProject] });
    expect(pack.rows.find((r) => r.projectId === 'p4')!.holdsContract).toBe(false);
    expect(pack.rows.find((r) => r.projectId === 'p1')!.holdsContract).toBe(true);
    expect(leftToBillAt(pack.rows, 'IDR', '2026-04-01')).toBe(c(800_000));
  });

  it('AC-LTB-003: on the invoiced basis Left to bill equals remaining work and the basis is unchanged', () => {
    const pack = buildManagementPack(facts({ projects: [ONE_M], invoiced: [inv('p1', 'IDR', '2026-02-01', 200_000)] }));
    const months = pack.rows[0].months;
    expect(months.map((m) => m.basis)).toEqual(['invoiced', 'invoiced', 'invoiced', 'invoiced']);
    expect(months.map((m) => m.leftToBill)).toEqual([c(1_000_000), c(800_000), c(800_000), c(800_000)]);
    expect(months.map((m) => m.remainingWork)).toEqual(months.map((m) => m.leftToBill));
  });
});
