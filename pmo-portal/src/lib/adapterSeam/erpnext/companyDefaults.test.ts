/**
 * #1599 ECX-3 — ERPNext wire format for company-defaults.set, replayed from the bed (`__fixtures__/companyDefaults.json`).
 * The shared behaviour is proved by `contractSuite/companyDefaults.suite.ts`; this file pins what only ERPNext does.
 */
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/companyDefaults.json';
import { COST_CENTRE_PAGE, createErpnextCompanyDefaults, listErpnextCostCentres } from './companyDefaults.ts';

type Case = { label: string; request: { method: string; path: string; body: Record<string, unknown> | null }; status: number; response: Record<string, unknown> };
const cases = (fixture as { cases: Case[] }).cases;
const byLabel = (label: string) => { const c = cases.find((x) => x.label === label); if (!c) throw new Error(label); return c; };
const COMPANY = 'ECX Probe Co';

/** Bed accounts as `GET Account/<name>` returns them (the Standard chart's types). */
const ACCOUNTS: Record<string, Record<string, unknown>> = {
  'Probe Bank A - EPC': { name: 'Probe Bank A - EPC', company: COMPANY, is_group: 0, disabled: 0, root_type: 'Asset', account_type: 'Bank' },
  'Cash - EPC': { name: 'Cash - EPC', company: COMPANY, is_group: 0, disabled: 0, root_type: 'Asset', account_type: 'Cash' },
  // stale PMO view: the ERP turned it into a group after PMO read it (the PUT is then refused by the ERP itself)
  'Bank Accounts - EPC': { name: 'Bank Accounts - EPC', company: COMPANY, is_group: 0, disabled: 0, root_type: 'Asset', account_type: 'Bank' },
};

function bed(put: Case) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  let company = { ...((byLabel('nosm GET company defaults').response as { data: Record<string, unknown> }).data), default_bank_account: null as unknown };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = decodeURIComponent(u.pathname);
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (path.startsWith('/api/resource/Account/')) { const a = ACCOUNTS[path.slice('/api/resource/Account/'.length)]; return a ? json(200, { data: a }) : json(404, {}); }
    if (path === `/api/resource/Company/${COMPANY}` && method === 'GET') return json(200, { data: company });
    if (path === put.request.path && method === 'PUT') {
      if (put.status === 200) company = { ...company, ...(put.response as { data: Record<string, unknown> }).data };
      return json(put.status, put.response);
    }
    return json(404, {});
  }) as typeof fetch;
  return { calls, writer: createErpnextCompanyDefaults({ fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.test', maxRetries: 0 }, COMPANY) };
}

describe('ERPNext company defaults (bed fixtures)', () => {
  it('AC-ECX-020 sets the bank default with one partial PUT on the Company, then reads it back', async () => {
    const put = byLabel('bank<-Bank leaf (accept)');
    const b = bed(put);
    const r = await b.writer.set({ bank: 'Probe Bank A - EPC' });
    expect(r).toMatchObject({ written: ['bank'], readBack: { bank: 'Probe Bank A - EPC' } });
    const puts = b.calls.filter((c) => c.method === 'PUT');
    expect(puts).toEqual([{ method: 'PUT', path: put.request.path, body: put.request.body }]);
    expect(b.calls.at(-1)).toMatchObject({ method: 'GET', path: `/api/resource/Company/${COMPANY}` });
  });

  it('AC-ECX-020 a Cash account as the bank default is refused before the PUT the bed accepted (200)', async () => {
    const put = byLabel('bank<-Cash type');
    expect(put.status).toBe(200);
    const b = bed(put);
    await expect(b.writer.set({ bank: 'Cash - EPC' })).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringMatching(/not a bank account/) });
    expect(b.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('AC-ECX-020 the ERP\'s own refusal (a group account, 417) reaches the Admin as a refusal and nothing is reported set', async () => {
    const put = byLabel('bank<-group');
    expect(put.status).toBe(417);
    const b = bed(put);
    await expect(b.writer.set({ bank: 'Bank Accounts - EPC' })).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringMatching(/group account/) });
  });

  it.each([
    ['v15', byLabel('stale modified')],
    ['v16', (fixture as unknown as { v16: { cases: Case[] } }).v16.cases.find((c) => c.label === 'stale modified')!],
  ])('AC-ECX-020 a refusal because the ERP company changed since it was read (%s, 417 TimestampMismatchError) says reload', async (_v, stale) => {
    expect(stale).toMatchObject({ status: 417, response: { exc_type: 'TimestampMismatchError' } });
    const b = bed({ ...stale, request: { ...stale.request, path: `/api/resource/Company/${COMPANY}` } });
    await expect(b.writer.set({ bank: 'Probe Bank A - EPC' })).rejects.toMatchObject({
      code: 'commit-rejected',
      message: 'The company accounts were changed in the ERP after PMO read them, so nothing was saved. Reload and try again.',
    });
  });
});

describe('ERPNext cost centre list', () => {
  const list = (data: unknown[]) => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => { urls.push(String(input)); return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
    return { urls, client: { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.test', maxRetries: 0 } };
  };

  it('lists the company\'s cost centres, filtered by company', async () => {
    const l = list([{ name: 'Main - EPC', is_group: 0, disabled: 0 }, { name: 'ECX Probe Co - EPC', is_group: 1, disabled: 0 }]);
    expect(await listErpnextCostCentres(l.client, COMPANY)).toEqual([
      { name: 'Main - EPC', isGroup: false, disabled: false }, { name: 'ECX Probe Co - EPC', isGroup: true, disabled: false }]);
    expect(JSON.parse(new URL(l.urls[0]).searchParams.get('filters')!)).toEqual([['company', '=', COMPANY]]);
  });

  it('a full page fails closed instead of offering a cut-off list', async () => {
    const l = list(Array.from({ length: COST_CENTRE_PAGE }, (_, i) => ({ name: `CC ${i}`, is_group: 0 })));
    await expect(listErpnextCostCentres(l.client, COMPANY)).rejects.toMatchObject({ code: 'external-unreachable' });
  });
});
