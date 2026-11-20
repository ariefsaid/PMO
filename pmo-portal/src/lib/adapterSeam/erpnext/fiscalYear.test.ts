import { describe, expect, it } from 'vitest';
import {
  FISCAL_YEAR_LEAD_DAYS,
  daysBetween,
  nextYearSpan,
  erpFullYearEnd,
  coversCompany,
  type FiscalYearSpan,
} from '../fiscalYearEnsure.ts';
import { fakeFiscalYearErp } from './fakeFiscalYearErp.ts';
import { discoverFiscalYear } from './fiscalYear.ts';
import { erpReason } from './erpReason.ts';

const COMPANY = 'Acme Corp';

describe('fiscalYear pure date and span rules (Task 1)', () => {
  it('45 days is due and 46 is not', () => {
    const end = '2026-12-31';
    expect(daysBetween('2026-11-16', end)).toBe(45);
    expect(daysBetween('2026-11-16', end) <= FISCAL_YEAR_LEAD_DAYS).toBe(true);

    expect(daysBetween('2026-11-15', end)).toBe(46);
    expect(daysBetween('2026-11-15', end) <= FISCAL_YEAR_LEAD_DAYS).toBe(false);
  });

  it('non-calendar and leap day next spans', () => {
    expect(nextYearSpan('2027-03-31')).toEqual({ start: '2027-04-01', end: '2028-03-31' });

    const leapSpan = nextYearSpan('2028-02-28');
    expect(leapSpan).toEqual({ start: '2028-02-29', end: '2029-02-28' });

    expect(erpFullYearEnd('2028-02-29')).toBe('2029-02-27');
    expect(erpFullYearEnd('2027-01-01')).toBe('2027-12-31');
    expect(erpFullYearEnd(leapSpan.start) === leapSpan.end).toBe(false);
  });

  it('global and other-company coverage', () => {
    const globalYear: FiscalYearSpan = {
      name: '2026',
      start: '2026-01-01',
      end: '2026-12-31',
      companies: [],
      disabled: false,
    };
    expect(coversCompany(globalYear, COMPANY)).toBe(true);
    expect(coversCompany(globalYear, 'Other Co')).toBe(true);

    const matchingYear: FiscalYearSpan = {
      name: '2026-Acme',
      start: '2026-01-01',
      end: '2026-12-31',
      companies: [COMPANY],
      disabled: false,
    };
    expect(coversCompany(matchingYear, COMPANY)).toBe(true);
    expect(coversCompany(matchingYear, 'Other Co')).toBe(false);

    const otherCompanyYear: FiscalYearSpan = {
      name: '2026-Other',
      start: '2026-01-01',
      end: '2026-12-31',
      companies: ['Other Co'],
      disabled: false,
    };
    expect(coversCompany(otherCompanyYear, COMPANY)).toBe(false);

    const disabledGlobalYear: FiscalYearSpan = {
      ...globalYear,
      disabled: true,
    };
    expect(coversCompany(disabledGlobalYear, COMPANY)).toBe(false);
  });
});

describe('ERPNext discoverFiscalYear (Task 2)', () => {
  it('global and company year: covered without writing', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] },
      { name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [] },
    ]);
    const res = await discoverFiscalYear(erp.client, COMPANY, '2026-12-01');
    expect(res).toEqual({ state: 'ready', current: '2026', next: '2027' });
    expect(erp.writes()).toEqual([]);

    const erpCompany = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [COMPANY] },
      { name: 'FY 2027', start: '2027-01-01', end: '2027-12-31', companies: [COMPANY] },
    ]);
    const resCompany = await discoverFiscalYear(erpCompany.client, COMPANY, '2026-12-01');
    expect(resCompany).toEqual({ state: 'ready', current: '2026', next: 'FY 2027' });
    expect(erpCompany.writes()).toEqual([]);
  });

  it('other-company year: does not cover this company, proposes create with plain name and no write occurs', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [COMPANY] },
      { name: 'Other 2027', start: '2026-07-01', end: '2027-06-30', companies: ['Other Co'] },
    ], { version: 16 });
    const res = await discoverFiscalYear(erp.client, COMPANY, '2026-12-01');
    expect(res).toEqual({
      state: 'create',
      current: '2026',
      start: '2027-01-01',
      end: '2027-12-31',
      yearName: '2027',
      isShortYear: false,
    });
    expect(erp.writes()).toEqual([]);
  });

  it('plain name held by another company: proposes create named for company and no write occurs', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [COMPANY] },
      { name: '2027', start: '2027-04-01', end: '2028-03-31', companies: ['Other Co'] },
    ], { version: 16 });
    const res = await discoverFiscalYear(erp.client, COMPANY, '2026-12-01');
    expect(res).toEqual({
      state: 'create',
      current: '2026',
      start: '2027-01-01',
      end: '2027-12-31',
      yearName: `2027 - ${COMPANY}`,
      isShortYear: false,
    });
    expect(erp.writes()).toEqual([]);
  });

  it('enabled applicable multiple overlaps: reports operator task and no write occurs', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [COMPANY] },
      { name: '2027-A', start: '2027-01-01', end: '2027-12-31', companies: [COMPANY] },
      { name: '2027-Global', start: '2027-01-01', end: '2027-12-31', companies: [] },
    ]);
    const res = await discoverFiscalYear(erp.client, COMPANY, '2026-12-01');
    expect(res).toEqual({ state: 'operator', reason: 'ambiguous-overlap' });
    expect(erp.writes()).toEqual([]);
  });

  it('later partial overlap: discovery attempts create, which ERP then refuses on write', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [COMPANY] },
      { name: '2027-Late', start: '2027-03-01', end: '2028-02-29', companies: [COMPANY] },
    ]);
    const res = await discoverFiscalYear(erp.client, COMPANY, '2026-12-01');
    expect(res).toEqual({
      state: 'create',
      current: '2026',
      start: '2027-01-01',
      end: '2027-12-31',
      yearName: '2027',
      isShortYear: false,
    });
    expect(erp.writes()).toEqual([]);
  });

  it('disabled exact year: reports operator task naming year and no write occurs', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [COMPANY] },
      { name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [], disabled: true },
    ]);
    const res = await discoverFiscalYear(erp.client, COMPANY, '2026-12-01');
    expect(res).toEqual({ state: 'operator', reason: 'disabled-year', year: '2027' });
    expect(erp.writes()).toEqual([]);
  });

  it('malformed child: child company row missing or malformed reports operator task without throwing', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] },
    ]);
    const originalFetch = erp.client.fetchImpl;
    erp.client.fetchImpl = async (input, init) => {
      const res = await originalFetch(input, init);
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/api/resource/Fiscal%20Year/2026')) {
        const doc = await res.json() as Record<string, unknown>;
        return new Response(JSON.stringify({ data: { ...(doc.data as object), companies: 'invalid' } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return res;
    };
    const res = await discoverFiscalYear(erp.client, COMPANY, '2026-12-01');
    expect(res.state).toBe('operator');
    expect(res).toHaveProperty('reason', 'ambiguous-overlap');
    expect(erp.writes()).toEqual([]);
  });

  it('50-row limit: reports operator task without throwing', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      name: `S${i}`, start: '2026-01-01', end: '2026-12-31', companies: [`C${i}`],
    }));
    const erp = fakeFiscalYearErp(many);
    const res = await discoverFiscalYear(erp.client, COMPANY, '2026-06-01');
    expect(res).toEqual({ state: 'operator', reason: 'ambiguous-overlap', message: expect.stringMatching(/too many years/) });
    expect(erp.writes()).toEqual([]);
  });

  it('403 refusal: reports operator task missing-role and no write occurs', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] },
    ]);
    erp.denyRead();
    const res = await discoverFiscalYear(erp.client, COMPANY, '2026-12-01');
    expect(res).toEqual({ state: 'operator', reason: 'missing-role' });
    expect(erp.writes()).toEqual([]);
  });

  it('markup in refusal is stripped: returns plain words, and URLs are rejected', () => {
    const markupOnly = erpReason(new Error('User <strong>admin</strong> has no permission'));
    expect(markupOnly).toBe('User admin has no permission');
    expect(markupOnly).not.toMatch(/[<>]/);

    const withUrl = erpReason(new Error('User <strong>admin</strong> has no permission http://localhost:8000/desk'));
    expect(withUrl).toBeNull();
  });
});
