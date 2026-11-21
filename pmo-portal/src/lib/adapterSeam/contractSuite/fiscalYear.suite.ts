import { describe, expect, it } from 'vitest';
import type { ErpHarness, FiscalYearHarness, Suite } from './harness.ts';

const CAL_2026 = { name: '2026', start: '2026-01-01', end: '2026-12-31' };
const DEC_1 = '2026-12-01';

function fyOf(h: ErpHarness): FiscalYearHarness {
  if (!h.fiscalYear) throw new Error(`${h.tier} has no fiscalYear harness`);
  return h.fiscalYear();
}

export const fiscalYearSuite: Suite = (h) => {
  describe('fiscal-year.ensure discovery (AC-ECX-040)', () => {
    it('global and company year: an existing next year is used and nothing is written', async () => {
      const f = fyOf(h);
      f.seed({ ...CAL_2026, companies: [] });
      f.seed({ name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [] });
      expect(await f.discover(DEC_1)).toEqual({ state: 'ready', current: '2026', next: '2027' });
      expect(f.writes()).toEqual([]);

      const f2 = fyOf(h);
      f2.seed({ ...CAL_2026, companies: [f2.company] });
      f2.seed({ name: 'FY 2027', start: '2027-01-01', end: '2027-12-31', companies: [f2.company] });
      expect(await f2.discover(DEC_1)).toEqual({ state: 'ready', current: '2026', next: 'FY 2027' });
      expect(f2.writes()).toEqual([]);
    });

    it('other-company year: does not cover this company, create is proposed with plain name and no write occurs', async () => {
      const f = fyOf(h);
      f.seed({ ...CAL_2026, companies: [f.company] });
      f.seed({ name: 'Other 2027', start: '2026-07-01', end: '2027-06-30', companies: ['Other Co'] });
      expect(await f.discover(DEC_1)).toEqual({
        state: 'create',
        current: '2026',
        start: '2027-01-01',
        end: '2027-12-31',
        yearName: '2027',
        isShortYear: false,
      });
      expect(f.writes()).toEqual([]);
    });

    it('other-company year holding the plain name: proposed create names the company, and no write occurs', async () => {
      const f = fyOf(h);
      f.seed({ ...CAL_2026, companies: [f.company] });
      f.seed({ name: '2027', start: '2027-04-01', end: '2028-03-31', companies: ['Other Co'] });
      expect(await f.discover(DEC_1)).toEqual({
        state: 'create',
        current: '2026',
        start: '2027-01-01',
        end: '2027-12-31',
        yearName: `2027 - ${f.company}`,
        isShortYear: false,
      });
      expect(f.writes()).toEqual([]);
    });

    it('enabled applicable multiple overlaps: reports operator task and no write occurs', async () => {
      const f = fyOf(h);
      f.seed({ ...CAL_2026, companies: [f.company] });
      f.seed({ name: '2027-A', start: '2027-01-01', end: '2027-12-31', companies: [f.company] });
      f.seed({ name: '2027-Global', start: '2027-01-01', end: '2027-12-31', companies: [] });
      expect(await f.discover(DEC_1)).toEqual({ state: 'operator', reason: 'ambiguous-overlap' });
      expect(f.writes()).toEqual([]);
    });

    it('later partial overlap: year overlapping later in the target range is reported as operator task and no write occurs', async () => {
      const f = fyOf(h);
      f.seed({ ...CAL_2026, companies: [f.company] });
      f.seed({ name: '2027-Late', start: '2027-03-01', end: '2028-02-29', companies: [f.company] });
      expect(await f.discover(DEC_1)).toEqual({ state: 'operator', reason: 'ambiguous-overlap' });
      expect(f.writes()).toEqual([]);
    });

    it('disabled exact year: reported as operator task naming the year and no write occurs', async () => {
      const f = fyOf(h);
      f.seed({ ...CAL_2026, companies: [f.company] });
      f.seed({ name: 'Disabled 2027', start: '2027-01-01', end: '2027-12-31', companies: [f.company], disabled: true });
      expect(await f.discover(DEC_1)).toEqual({ state: 'operator', reason: 'disabled-year', year: 'Disabled 2027' });
      expect(f.writes()).toEqual([]);

      const f2 = fyOf(h);
      f2.seed({ ...CAL_2026, companies: [] });
      f2.seed({ name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [], disabled: true });
      expect(await f2.discover(DEC_1)).toEqual({ state: 'operator', reason: 'disabled-year', year: '2027' });
      expect(f2.writes()).toEqual([]);
    });

    it('403 read refusal: reported as operator task with missing-role and no write occurs', async () => {
      const f = fyOf(h);
      f.seed({ ...CAL_2026, companies: [] });
      f.denyRead();
      expect(await f.discover(DEC_1)).toEqual({ state: 'operator', reason: 'missing-role' });
      expect(f.writes()).toEqual([]);
    });

    it('more than 45 days before the end: reported not-due and no write occurs', async () => {
      const f = fyOf(h);
      f.seed({ ...CAL_2026, companies: [] });
      expect(await f.discover('2026-11-15')).toEqual({ state: 'not-due', current: '2026' });
      expect(f.writes()).toEqual([]);
    });

    it('with no current year: reported as operator task with no-current-year and no write occurs', async () => {
      const f = fyOf(h);
      f.seed({ name: 'Other 2026', start: '2026-01-01', end: '2026-12-31', companies: ['Other Co'] });
      expect(await f.discover(DEC_1)).toEqual({ state: 'operator', reason: 'no-current-year' });
      expect(f.writes()).toEqual([]);
    });
  });
};
