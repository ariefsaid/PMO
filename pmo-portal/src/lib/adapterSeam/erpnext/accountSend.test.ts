/**
 * #1599 ECX-4 (AC-ECX-030) — the ERPNext account send against the bed's own answers (`__fixtures__/accountCreate.json`, ERPNext v15,
 * recorded on the local bed). The shipped connect adapter runs over a mocked fetch that replays the recorded responses verbatim.
 */
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/accountCreate.json';
import { createErpnextConnectAdapter } from './connectAdapter.ts';
import type { ErpClientDeps } from './client.ts';

type Case = (typeof fixture.cases)[number];
/** A recorded answer, or one derived from it (a status and a JSON body). */
type Answer = { status: number; response: unknown };
const recorded = (label: string): Case => {
  const c = fixture.cases.find((x) => x.label === label);
  if (!c) throw new Error(`no fixture case ${label}`);
  return c;
};
const reply = (c: Answer) => new Response(JSON.stringify(c.response), { status: c.status });
const COMPANY = 'ECX Probe Co';
const GROUP = 'Direct Expenses - EPC';

/** Answers: the lookup list, the create, and single-account reads by name. Records every request. */
function erp(answers: { lookup: Answer; create?: Answer; doc?: Record<string, Answer> }) {
  const seen: Array<{ method: string; path: string; body: Record<string, unknown> | null; filters: unknown }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    const path = decodeURIComponent(u.pathname);
    seen.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null, filters: JSON.parse(u.searchParams.get('filters') ?? 'null') });
    if (method === 'GET' && path === '/api/resource/Account') return reply(answers.lookup);
    if (method === 'POST' && path === '/api/resource/Account' && answers.create) return reply(answers.create);
    const doc = method === 'GET' ? answers.doc?.[path.replace('/api/resource/Account/', '')] : undefined;
    if (doc) return reply(doc);
    return new Response(JSON.stringify({ exc_type: 'DoesNotExistError' }), { status: 404 });
  }) as typeof fetch;
  const client: ErpClientDeps = { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.test', maxRetries: 0 };
  return { adapter: createErpnextConnectAdapter(client, COMPANY), seen };
}
const send = (a: ReturnType<typeof erp>['adapter'], name: string, parent = GROUP) =>
  a.sendMaster('account', { id: 'Materials', name, parentAccount: parent }, 'seed:account:Materials');
const asDoc = (label: string): Answer => ({ status: 200, response: recorded(label).response });
const docOf = (label: string) => (recorded(label).response as { data: Record<string, unknown> }).data;

describe('AC-ECX-030 ERPNext account send, against the bed fixtures', () => {
  it('looks up by company and account name, then creates with account_name, parent_account and company only, and records the read-back name', async () => {
    const e = erp({ lookup: recorded('lookup (absent)'), create: recorded('create w/ only account_name+parent+company'),
      doc: { 'Probe Direct Cost D - EPC': asDoc('create w/ only account_name+parent+company') } });
    expect(await send(e.adapter, 'Probe Direct Cost D')).toEqual({ externalId: 'Probe Direct Cost D - EPC' });
    expect(e.seen[0]).toMatchObject({ method: 'GET', filters: [['company', '=', COMPANY], ['account_name', '=', 'Probe Direct Cost D']] });
    const posts = e.seen.filter((r) => r.method === 'POST');
    expect(posts.map((r) => r.body)).toEqual([{ account_name: 'Probe Direct Cost D', parent_account: GROUP, company: COMPANY }]);
    expect(e.seen.at(-1)).toMatchObject({ method: 'GET', path: '/api/resource/Account/Probe Direct Cost D - EPC' });
  });

  it('an account found at lookup that is a leaf of the company under the expense root is linked with no create', async () => {
    const e = erp({ lookup: recorded('lookup by company+account_name (found)'), doc: { 'Probe Direct Cost A - EPC': asDoc('create full (accept)') } });
    expect(await send(e.adapter, 'Probe Direct Cost A')).toEqual({ externalId: 'Probe Direct Cost A - EPC' });
    expect(e.seen.filter((r) => r.method !== 'GET')).toEqual([]);
  });

  it('a 409 duplicate whose account is a leaf of the same company under the expense root is linked, not created again', async () => {
    const e = erp({ lookup: recorded('lookup (absent)'), create: recorded('create duplicate different case'),
      doc: { 'probe direct cost a - EPC': asDoc('create full (accept)') } });
    expect(await send(e.adapter, 'probe direct cost a')).toEqual({ externalId: 'Probe Direct Cost A - EPC' });
    expect(e.seen.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('a 409 duplicate whose account is a group, of another company, outside the expense root or disabled is refused in plain words', async () => {
    const group = asDoc('is_group=1 create');
    const otherCompany = { status: 200, response: { data: { ...docOf('create full (accept)'), company: 'Other Co' } } };
    const asset = { status: 200, response: { data: { ...docOf('create full (accept)'), root_type: 'Asset' } } };
    const disabled = { status: 200, response: { data: { ...docOf('create full (accept)'), disabled: 1 } } };
    for (const existing of [group, otherCompany, asset, disabled]) {
      const e = erp({ lookup: recorded('lookup (absent)'), create: recorded('create duplicate different case'), doc: { 'probe direct cost a - EPC': existing } });
      await expect(send(e.adapter, 'probe direct cost a')).rejects.toMatchObject({
        code: 'commit-rejected', message: 'The ERP already has an account named probe direct cost a that cannot hold direct costs. Choose another name.',
      });
    }
  });

  it('the ERP refusing a parent that is a ledger is a refusal, and nothing is linked', async () => {
    const e = erp({ lookup: recorded('lookup (absent)'), create: recorded('parent is leaf') });
    await expect(send(e.adapter, 'Probe Under Leaf', 'Cost of Goods Sold - EPC')).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringMatching(/can not be a ledger/) });
  });

  it('a name is sent trimmed, and a blank one is refused before any ERP call', async () => {
    const e = erp({ lookup: recorded('lookup (absent)'), create: recorded('whitespace name'), doc: { 'Probe Spaces - EPC': asDoc('whitespace name') } });
    expect(await send(e.adapter, '  Probe Spaces  ')).toEqual({ externalId: 'Probe Spaces - EPC' });
    expect(e.seen.find((r) => r.method === 'POST')?.body).toEqual({ account_name: 'Probe Spaces', parent_account: GROUP, company: COMPANY });
    const blank = erp({ lookup: recorded('lookup (absent)') });
    for (const name of ['', '   ']) await expect(send(blank.adapter, name)).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(blank.seen).toEqual([]);
  });
});
