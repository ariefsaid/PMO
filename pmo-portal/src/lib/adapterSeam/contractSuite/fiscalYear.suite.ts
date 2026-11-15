/**
 * fiscal-year.ensure (v1, #1599 ECX-5) — PMO keeps the ERP one fiscal year ahead (AC-ECX-040). The year is looked up by date
 * range and its company rows read (no rows = every company), created only when none covers the day after the current year,
 * always with the bound company's row, then read back. A permission refusal is an Operator task, never a silent skip.
 */
import { describe, expect, it } from 'vitest';
import type { ErpHarness, FiscalYearHarness, Suite } from './harness.ts';

function fyOf(h: ErpHarness): FiscalYearHarness {
  if (!h.fiscalYear) throw new Error(`${h.tier} declares fiscal-year.ensure supported but its harness has no fiscalYear()`);
  return h.fiscalYear();
}

const CAL_2026 = { name: '2026', start: '2026-01-01', end: '2026-12-31' };
const DEC_1 = '2026-12-01'; // 30 days before the end of 2026

export const fiscalYearSuite: Suite = (h) => describe(`fiscal-year.ensure (${h.tier})`, () => {
  it('AC-ECX-040 the year ends within 45 days and no next year exists: one next year is made for the company, a second run makes nothing', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [] });
    const first = await f.ensure(DEC_1);
    expect(first).toEqual({ state: 'ready', current: '2026', next: '2027', created: true });
    expect(f.writes()).toEqual([{ start: '2027-01-01', end: '2027-12-31', companies: [f.company] }]);
    expect(await f.ensure(DEC_1)).toEqual({ state: 'ready', current: '2026', next: '2027', created: false });
    expect(f.writes()).toHaveLength(1);
    expect(f.years().filter((y) => y.start === '2027-01-01')).toHaveLength(1);
  });

  it('AC-ECX-040 a non-calendar year is followed by one with the same start month', async () => {
    const f = fyOf(h);
    f.seed({ name: '2026-2027', start: '2026-04-01', end: '2027-03-31', companies: [f.company] });
    expect(await f.ensure('2027-03-01')).toEqual({ state: 'ready', current: '2026-2027', next: '2027-2028', created: true });
    expect(f.writes()).toEqual([{ start: '2027-04-01', end: '2028-03-31', companies: [f.company] }]);
  });

  it('AC-ECX-040 more than 45 days before the end nothing is written', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [] });
    expect(await f.ensure('2026-11-15')).toEqual({ state: 'not-due', current: '2026' });
    expect(f.writes()).toEqual([]);
  });

  it('AC-ECX-040 a next year with no company rows covers every company: it is used, nothing is written', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [] });
    f.seed({ name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [] });
    expect(await f.ensure(DEC_1)).toEqual({ state: 'ready', current: '2026', next: '2027', created: false });
    expect(f.writes()).toEqual([]);
  });

  it('AC-ECX-040 an existing next year for this company is used, not duplicated', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [f.company] });
    f.seed({ name: 'FY 2027', start: '2027-01-01', end: '2027-12-31', companies: [f.company] });
    expect(await f.ensure(DEC_1)).toEqual({ state: 'ready', current: '2026', next: 'FY 2027', created: false });
    expect(f.writes()).toEqual([]);
  });

  it('AC-ECX-040 another company\'s overlapping year does not cover this one: PMO makes this company\'s year', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [f.company] });
    f.seed({ name: 'Other 2027', start: '2026-07-01', end: '2027-06-30', companies: ['Other Co'] });
    expect(await f.ensure(DEC_1)).toEqual({ state: 'ready', current: '2026', next: '2027', created: true });
    expect(f.writes()).toEqual([{ start: '2027-01-01', end: '2027-12-31', companies: [f.company] }]);
  });

  it('AC-ECX-040 a permission refusal is an Operator task and makes no year', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [] });
    f.denyCreate();
    expect(await f.ensure(DEC_1)).toEqual({ state: 'needs-operator', reason: 'missing-role' });
    expect(f.years().map((y) => y.name)).toEqual(['2026']);
  });

  it('AC-ECX-040 with no year covering today PMO cannot tell when the next starts: an Operator task, nothing written', async () => {
    const f = fyOf(h);
    f.seed({ name: 'Other 2026', start: '2026-01-01', end: '2026-12-31', companies: ['Other Co'] });
    expect(await f.ensure(DEC_1)).toEqual({ state: 'needs-operator', reason: 'no-current-year' });
    expect(f.writes()).toEqual([]);
  });

  it('AC-ECX-040 a lost answer is settled by the read-back: one year, reported ready', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [] });
    f.failNextWrite('lost-response');
    expect(await f.ensure(DEC_1)).toEqual({ state: 'ready', current: '2026', next: '2027', created: true });
    expect(f.years().filter((y) => y.start === '2027-01-01')).toHaveLength(1);
  });

  it('AC-ECX-040 a create the ERP refuses is reported in its own words, and no year is recorded', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [f.company] });
    f.seed({ name: 'Other 2027', start: '2027-01-01', end: '2027-12-31', companies: ['Other Co'] });
    const out = await f.ensure(DEC_1);
    expect(out.state).toBe('refused');
    expect(out.state === 'refused' && out.message).toMatch(/already set/);
    expect(f.years().filter((y) => y.companies.includes(f.company)).map((y) => y.name)).toEqual(['2026']);
  });
});
