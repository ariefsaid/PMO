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
    expect(f.writes()).toEqual([{ name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [f.company], shortYear: false }]);
    expect(await f.ensure(DEC_1)).toEqual({ state: 'ready', current: '2026', next: '2027', created: false });
    expect(f.writes()).toHaveLength(1);
    expect(f.years().filter((y) => y.start === '2027-01-01')).toHaveLength(1);
  });

  it('AC-ECX-040 a non-calendar year is followed by one with the same start month', async () => {
    const f = fyOf(h);
    f.seed({ name: '2026-2027', start: '2026-04-01', end: '2027-03-31', companies: [f.company] });
    expect(await f.ensure('2027-03-01')).toEqual({ state: 'ready', current: '2026-2027', next: '2027-2028', created: true });
    expect(f.writes()).toEqual([{ name: '2027-2028', start: '2027-04-01', end: '2028-03-31', companies: [f.company], shortYear: false }]);
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
    expect(f.writes()).toEqual([{ name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [f.company], shortYear: false }]);
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

  it('AC-ECX-040 the plain name is held by another company\'s year: the new year\'s name carries the company, and it is read back', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [f.company] });
    // Another company's April year already holds the name "2027"; partial overlaps between two companies' years are accepted.
    f.seed({ name: '2027', start: '2027-04-01', end: '2028-03-31', companies: ['Other Co'] });
    const next = `2027 - ${f.company}`;
    expect(await f.ensure(DEC_1)).toEqual({ state: 'ready', current: '2026', next, created: true });
    expect(f.writes()).toEqual([{ name: next, start: '2027-01-01', end: '2027-12-31', companies: [f.company], shortYear: false }]);
    expect(f.years().filter((y) => y.name === next).map((y) => y.companies)).toEqual([[f.company]]);
    // the next run finds it by date range and writes nothing
    expect(await f.ensure(DEC_1)).toEqual({ state: 'ready', current: '2026', next, created: false });
    expect(f.writes()).toHaveLength(1);
  });

  it('AC-ECX-040 this company\'s own year overlapping the next span (not covering its first day) is refused by the ERP: an Operator task in its words', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [f.company] });
    // A March year for the same company leaves January and February uncovered; the ERP refuses an overlapping year (409 NameError).
    f.seed({ name: 'ECX 2027 b', start: '2027-03-01', end: '2028-02-29', companies: [f.company] });
    const out = await f.ensure(DEC_1);
    expect(out.state).toBe('refused');
    expect(out.state === 'refused' && out.message).toMatch(/overlapping with ECX 2027 b/);
    expect(f.years().map((y) => y.name)).toEqual(['2026', 'ECX 2027 b']);
  });

  it('AC-ECX-040 a disabled year with the next year\'s dates is reported as an Operator task: never re-enabled, never a create the ERP refuses every day', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [f.company] });
    f.seed({ name: 'Old 2027', start: '2027-01-01', end: '2027-12-31', companies: [f.company], disabled: true });
    const out = { state: 'needs-operator', reason: 'disabled-year', year: 'Old 2027' };
    expect(await f.ensure(DEC_1)).toEqual(out);
    expect(await f.ensure('2026-12-02')).toEqual(out);
    expect(f.writes()).toEqual([]);
    expect(f.years().find((y) => y.name === 'Old 2027')?.disabled).toBe(true);
  });

  it('AC-ECX-040 a disabled year with no company rows and the next year\'s dates is the same Operator task', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [] });
    f.seed({ name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [], disabled: true });
    expect(await f.ensure(DEC_1)).toEqual({ state: 'needs-operator', reason: 'disabled-year', year: '2027' });
    expect(f.writes()).toEqual([]);
  });

  it('AC-ECX-040 a refusal the ERP words in markup reaches the caller as plain words', async () => {
    const f = fyOf(h);
    f.seed({ ...CAL_2026, companies: [f.company] });
    f.seed({ name: '2027', start: '2027-04-01', end: '2028-03-31', companies: ['Other Co'] });
    // the company-named year is taken too, by a year that does not serve the company: the ERP refuses the duplicate name
    f.seed({ name: `2027 - ${f.company}`, start: '2025-01-01', end: '2025-12-31', companies: [f.company] });
    const out = await f.ensure(DEC_1);
    expect(out).toEqual({ state: 'refused', message: `Fiscal Year 2027 - ${f.company} already exists` });
  });

  it('AC-ECX-040 a short current year is followed by a full year, not flagged short', async () => {
    const f = fyOf(h);
    f.seed({ name: 'FY26 short', start: '2026-07-01', end: '2026-12-31', companies: [f.company] });
    expect(await f.ensure(DEC_1)).toEqual({ state: 'ready', current: 'FY26 short', next: '2027', created: true });
    expect(f.writes()).toEqual([{ name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [f.company], shortYear: false }]);
  });

  it('AC-ECX-040 a year starting on Feb 29 runs to Feb 28 and is flagged short, since the ERP\'s one-year rule would end it Feb 27', async () => {
    const f = fyOf(h);
    f.seed({ name: 'FY 2027-2028', start: '2027-03-01', end: '2028-02-28', companies: [f.company] });
    expect(await f.ensure('2028-02-01')).toEqual({ state: 'ready', current: 'FY 2027-2028', next: '2028-2029', created: true });
    expect(f.writes()).toEqual([{ name: '2028-2029', start: '2028-02-29', end: '2029-02-28', companies: [f.company], shortYear: true }]);
  });
});
