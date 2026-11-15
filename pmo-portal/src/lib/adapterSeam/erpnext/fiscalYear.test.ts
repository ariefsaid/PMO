/**
 * #1599 ECX-5 — the ERPNext fiscal-year step and the fake it is proved against. The fake must answer every recorded bed case
 * the way the bed did (`__fixtures__/fiscalYear.json`), or the shared suite (`contractSuite/fiscalYear.suite.ts`) proves nothing.
 */
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/fiscalYear.json';
import { fakeFiscalYearErp } from './fakeFiscalYearErp.ts';
import { ensureNextFiscalYear, readYearsIntersecting } from './fiscalYear.ts';
import { erpFullYearEnd, fiscalYearName, nextYearSpan } from '../fiscalYearEnsure.ts';

const COMPANY = 'ECX Probe Co';
interface Case { label: string; request: { method: string; path: string; body: Record<string, unknown> | null; as: string }; status: number; response: Record<string, unknown> }

describe('the fake Fiscal Year answers every recorded bed case as the bed did', () => {
  it('replays the fixture in order: same status, same list rows', async () => {
    // The bed held the global years 2026 and 2027 before the probe.
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] },
      { name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [] },
    ], { companies: [COMPANY, 'Other Co'] });
    const withoutRole = fakeFiscalYearErp([], { companies: [COMPANY] });
    withoutRole.denyCreate();
    for (const c of fixture.cases as Case[]) {
      const target = c.request.as === 'apiUserWithoutSystemManager' && c.request.method === 'POST' ? withoutRole : erp;
      const [path, query = ''] = c.request.path.split('?');
      const url = new URL(`https://erp.test${path.replace(/ /g, '%20')}`);
      for (const part of query.split('&').filter(Boolean)) {
        const i = part.indexOf('=');
        url.searchParams.set(part.slice(0, i), part.slice(i + 1));
      }
      const res = await target.fetchImpl(url.toString(), { method: c.request.method, ...(c.request.body ? { body: JSON.stringify(c.request.body) } : {}) });
      expect(res.status, c.label).toBe(c.status);
      const body = await res.json() as Record<string, unknown>;
      if (c.status !== 200) {
        expect(body.exc_type, c.label).toBe(c.response.exc_type);
      } else if (c.request.method === 'GET' && c.request.as === 'apiUserWithSystemManager') {
        expect((body.data as Array<{ name: string }>).map((r) => r.name), c.label)
          .toEqual((c.response.data as Array<{ name: string }>).map((r) => r.name));
      }
    }
  });
});

describe('the fake answers the v16 bed cases as the v16 bed did', () => {
  it('replays the v16 block: identical dates beside another company or a global year are accepted, a shared company is not', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] },
      { name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [] },
      { name: '2028', start: '2028-01-01', end: '2028-12-31', companies: [] },
      { name: 'ECX 2031', start: '2031-01-01', end: '2031-12-31', companies: [COMPANY] },
      { name: 'ECX 2032', start: '2032-01-01', end: '2032-12-31', companies: [] },
    ], { companies: [COMPANY, 'Other Co'], version: 16 });
    for (const c of fixture.v16.cases as Case[]) {
      const res = await erp.fetchImpl('https://erp.test/api/resource/Fiscal%20Year', { method: 'POST', body: JSON.stringify(c.request.body) });
      expect(res.status, c.label).toBe(c.status);
    }
  });
});

describe('ERPNext ensureNextFiscalYear on v16 rules', () => {
  it('a global next year is still used: v16 would accept a second, company-scoped one, so the lookup is what prevents it', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] },
      { name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [] },
    ], { version: 16 });
    expect(await ensureNextFiscalYear(erp.client, COMPANY, '2026-12-01')).toEqual({ state: 'ready', current: '2026', next: '2027', created: false });
    expect(erp.writes()).toEqual([]);
  });

  it('another company\'s year with the same dates does not serve this company: v16 accepts this company\'s own year', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [COMPANY] },
      { name: 'Other 2027', start: '2027-01-01', end: '2027-12-31', companies: ['Other Co'] },
    ], { version: 16 });
    expect(await ensureNextFiscalYear(erp.client, COMPANY, '2026-12-01')).toEqual({ state: 'ready', current: '2026', next: '2027', created: true });
  });
});

describe('date rules', () => {
  it('the next year starts the day after and runs one year', () => {
    expect(nextYearSpan('2026-12-31')).toEqual({ start: '2027-01-01', end: '2027-12-31' });
    expect(nextYearSpan('2027-03-31')).toEqual({ start: '2027-04-01', end: '2028-03-31' });
    expect(nextYearSpan('2028-02-28')).toEqual({ start: '2028-02-29', end: '2029-02-28' });
  });
  it('the ERP\'s full-year end clamps a Feb 29 start, so PMO\'s Feb 28 end needs the short-year flag', async () => {
    expect(erpFullYearEnd('2027-01-01')).toBe('2027-12-31');
    expect(erpFullYearEnd('2028-02-29')).toBe('2029-02-27');
    const erp = fakeFiscalYearErp([], { companies: [COMPANY] });
    const post = (body: Record<string, unknown>) => erp.fetchImpl('https://erp.test/api/resource/Fiscal%20Year', { method: 'POST', body: JSON.stringify(body) });
    const base = { year_start_date: '2028-02-29', year_end_date: '2029-02-28', companies: [{ company: COMPANY }] };
    const refused = await post({ ...base, year: 'L1' });
    expect([refused.status, (await refused.json() as { exc_type: string }).exc_type]).toEqual([417, 'InvalidDates']);
    expect((await post({ ...base, year: 'L2', is_short_year: 1 })).status).toBe(200);
  });
  it('names a calendar year by its year and any other by both', () => {
    expect(fiscalYearName({ start: '2027-01-01', end: '2027-12-31' })).toBe('2027');
    expect(fiscalYearName({ start: '2027-04-01', end: '2028-03-31' })).toBe('2027-2028');
  });
});

describe('ERPNext ensureNextFiscalYear', () => {
  it('looks years up by date range only and reads each year\'s company rows (a global year has none to filter on)', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] },
      { name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [] },
    ]);
    await ensureNextFiscalYear(erp.client, COMPANY, '2026-12-01');
    const lists = erp.calls().filter((c) => c.method === 'GET' && !c.path.startsWith('/api/resource/Fiscal%20Year/'));
    expect(lists.length).toBeGreaterThan(0);
    for (const c of lists) expect(decodeURIComponent(c.path)).not.toContain('Fiscal Year Company');
    expect(erp.calls().some((c) => c.path.startsWith('/api/resource/Fiscal%20Year/2027'))).toBe(true);
  });

  it('a disabled year serves no one', async () => {
    const erp = fakeFiscalYearErp([{ name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [], disabled: true }]);
    expect(await ensureNextFiscalYear(erp.client, COMPANY, '2026-12-01')).toEqual({ state: 'needs-operator', reason: 'no-current-year' });
  });

  it('a create that never reached the ERP and reads back nothing is thrown for a later retry, not reported as a refusal', async () => {
    const erp = fakeFiscalYearErp([{ name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] }]);
    erp.failNextWrite('transport');
    await expect(ensureNextFiscalYear(erp.client, COMPANY, '2026-12-01')).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(erp.years().map((y) => y.name)).toEqual(['2026']);
  });

  it('the permission refusal is sent once, never retried', async () => {
    const erp = fakeFiscalYearErp([{ name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] }]);
    erp.denyCreate();
    await ensureNextFiscalYear(erp.client, COMPANY, '2026-12-01');
    expect(erp.writes()).toHaveLength(1);
  });

  it('refuses to decide when a span holds more years than it reads', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `S${i}`, start: '2026-01-01', end: '2026-12-31', companies: [`C${i}`] }));
    const erp = fakeFiscalYearErp(many);
    await expect(readYearsIntersecting(erp.client, '2026-06-01', '2026-06-01')).rejects.toThrow(/too many years/);
  });

  it('a 403 on the lookup is the same Operator task as a 403 on the create, and nothing is written', async () => {
    const erp = fakeFiscalYearErp([{ name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] }]);
    erp.denyRead();
    expect(await ensureNextFiscalYear(erp.client, COMPANY, '2026-12-01')).toEqual({ state: 'needs-operator', reason: 'missing-role' });
    expect(erp.writes()).toEqual([]);
  });

  it('a span holding more years than PMO reads is reported as refused in plain words, not thrown', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `S${i}`, start: '2026-01-01', end: '2026-12-31', companies: [`C${i}`] }));
    const erp = fakeFiscalYearErp(many);
    const out = await ensureNextFiscalYear(erp.client, COMPANY, '2026-12-01');
    expect(out).toEqual({ state: 'refused', message: expect.stringMatching(/^too many years/) });
    expect(erp.writes()).toEqual([]);
  });

  it('when the company-named year is also taken, the refusal is reported and nothing else is tried', async () => {
    const erp = fakeFiscalYearErp([
      { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [COMPANY] },
      { name: '2027', start: '2027-04-01', end: '2028-03-31', companies: ['Other Co'] },
      { name: `2027 - ${COMPANY}`, start: '2027-01-01', end: '2027-12-31', companies: [COMPANY], disabled: true },
    ]);
    const out = await ensureNextFiscalYear(erp.client, COMPANY, '2026-12-01');
    expect(out.state).toBe('refused');
    expect(erp.writes().map((w) => w.year)).toEqual([`2027 - ${COMPANY}`]);
  });
});
