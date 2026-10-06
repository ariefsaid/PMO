import { describe, it, expect } from 'vitest';
import { buildManagementPack, mulDivRound, pctOf, plannedForMonth } from './managementPack';
import type { ManagementPackFacts, PackFactsProject } from '@/src/lib/db/managementPack';

const c = (major: number) => Math.round(major * 100);

const P1: PackFactsProject = {
  id: 'p1', name: 'Alpha', pmo_project_number: 'PRJ-26-0001', code: null, status: 'Ongoing Project',
  currency: 'IDR', contract_net: 1_200_000, start_date: '2026-01-01', end_date: '2026-04-30',
  project_manager_id: 'u-pm', client_name: 'Client A',
};

function facts(over: Partial<ManagementPackFacts> = {}): ManagementPackFacts {
  return {
    from: '2026-01-01', to: '2026-04-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
    projects: [P1], invoiced: [], invoiced_before: [], progress: [], ...over,
  };
}

describe('AC-MMP-006 planned revenue (DD-MMP-2)', () => {
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
const inv = (project_id: string | null, currency: string, month: string, net: number) =>
  ({ project_id, currency, month, net, invoice_count: 1 });

const scenario = facts({
  invoiced_before: [{ project_id: 'p1', currency: 'IDR', net: 100_000 }],
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

describe('AC-MMP-008 unbilled (DD-MMP-3)', () => {
  it('AC-MMP-008: recognised to date minus invoiced to date; negative means billed ahead', () => {
    const row = buildManagementPack(scenario).rows[0];
    expect(row.months.map((m) => m.invoicedToDate)).toEqual([c(300_000), c(300_000), c(600_000), c(600_000)]);
    expect(row.months.map((m) => m.unbilled)).toEqual([0, c(180_000), -c(120_000), c(60_000)]);
  });
});

describe('AC-MMP-009 backlog (DD-MMP-3)', () => {
  it('AC-MMP-009: net contract minus recognised to date, per month', () => {
    const row = buildManagementPack(scenario).rows[0];
    expect(row.months.map((m) => m.backlog)).toEqual([c(900_000), c(720_000), c(720_000), c(540_000)]);
  });

  it('AC-MMP-009: recognised above the contract gives a negative backlog, not a clamped zero', () => {
    const row = buildManagementPack(facts({ invoiced: [inv('p1', 'IDR', '2026-01-01', 1_300_000)] })).rows[0];
    expect(row.months[0].backlog).toBe(-c(100_000));
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

  it('AC-MMP-010: rows without a contract recognise on billing basis with no plan and no backlog', () => {
    const usd = pack.rows[1];
    expect(usd.projectName).toBe('Alpha');
    expect(usd.months[1]).toMatchObject({ invoiced: 5_000, recognised: 5_000, unbilled: 0, planned: null, backlog: null, basis: 'invoiced' });
  });

  it('AC-MMP-010: totals are one series per currency and never mix them', () => {
    expect(pack.totals.map((t) => t.currency)).toEqual(['IDR', 'USD']);
    const idr = pack.totals[0].months;
    const usd = pack.totals[1].months;
    expect(idr[0].invoiced).toBe(c(201_000));
    expect(idr[1].invoiced).toBe(0);
    expect(usd[1].invoiced).toBe(5_000);
    expect(idr[0].backlog).toBe(c(1_200_000) - c(200_000));
  });
});
