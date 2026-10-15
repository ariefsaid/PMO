import { describe, it, expect, vi } from 'vitest';
import { createErpAdapter } from './adapter';
import { DOCTYPE_BODIES } from './doctypeBodies';
import { budgetAccountIdentity } from './budgetAccountIdentity';

const VERSION = '44444444-4444-4444-8444-444444444444';
const COMPANY = 'Test Co';
const PROJECT = 'ERP-PROJ';

type Scenario = { account: string; amount: string; oldName?: string; oldAmount?: string; intent?: 'ensure' | 'remove'; failCancelOnce?: boolean; wrongCompany?: boolean; wrongAccount?: boolean; wrongYear?: boolean; wrongProject?: boolean; draft?: boolean };
function harness(s: Scenario) {
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  let status = s.draft ? 0 : 1;
  let failCancelOnce = s.failCancelOnce ?? false;
  const oldName = s.oldName ?? `OLD-${s.account}`;
  const transport = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ method, url: String(url), body });
    if (method === 'POST') { status = 0; return new Response(JSON.stringify({ data: { name: `NEW-${s.account}`, ...body, docstatus: 0 } }), { status: 200 }); }
    if (method === 'PUT') {
      if (body?.docstatus === 2) status = 2;
      if (body?.docstatus === 2 && failCancelOnce) { failCancelOnce = false; return new Response('unreachable', { status: 503 }); }
      if (body?.docstatus === 1) status = 1;
      return new Response(JSON.stringify({ data: { name: url.split('/').pop(), docstatus: status } }), { status: 200 });
    }
    const name = decodeURIComponent(String(url).split('/').pop()!);
    const currentName = name === oldName ? oldName : `NEW-${s.account}`;
    return new Response(JSON.stringify({ data: {
      name: currentName, docstatus: status, company: s.wrongCompany ? 'Other Co' : COMPANY,
      project: s.wrongProject ? 'OTHER-PROJECT' : PROJECT, account: s.wrongAccount ? 'Other Account' : s.account,
      from_fiscal_year: s.wrongYear ? '2025' : '2026', to_fiscal_year: '2026', budget_amount: currentName === oldName ? (s.oldAmount ?? s.amount) : s.amount,
      modified: '2026-01-01', amended_from: currentName === oldName ? null : oldName,
    } }), { status: 200 });
  }) as unknown as typeof fetch;
  const intent = s.intent ?? 'ensure';
  const record = {
    id: VERSION, erp_doc_kind: 'budget', projectId: 'project', fiscal_year: '2026', erp_account: s.account,
    budget_intent: intent, budget_predecessor: s.oldName ?? null,
    outbox_identity: budgetAccountIdentity(VERSION, '2026', s.account),
    line_items: intent === 'remove' ? [] : [{ category: s.account, budgeted_amount: s.amount }],
  };
  const adapter = createErpAdapter({
    client: { fetchImpl: transport, apiKey: 'key', apiSecret: 'secret', baseUrl: 'https://erp.test' },
    doctypeBodies: DOCTYPE_BODIES,
    ctx: {
      refs: { project: PROJECT, ...(s.oldName ? { self: s.oldName } : {}) },
      config: { company: COMPANY, category_account_map: [{ category: s.account, erp_account: s.account }] },
      versionMajor: 16, budgetAccount: { intent, predecessor: s.oldName ?? null },
    },
  });
  return { adapter, record, calls, transport };
}

const commit = (h: ReturnType<typeof harness>) => h.adapter.commit({
  domain: 'budget', operation: 'create', record: h.record, idempotencyKey: 'bud16:unit',
} as never);

function methodCalls(h: ReturnType<typeof harness>) { return h.calls.map((call) => call.method); }

describe('AC-BV16-005 revises only changed accounts and removes the dropped account', () => {
  it('AC-BV16-005 revises only changed accounts and removes the dropped account', async () => {
    const salary = harness({ account: 'Salary', amount: '60000.00', oldAmount: '50000.00', oldName: 'OLD-Salary' });
    const salaryResult = await commit(salary);
    expect(methodCalls(salary)).toEqual(['GET', 'PUT', 'POST', 'PUT', 'GET']);
    expect(salary.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ account: 'Salary', budget_amount: '60000.00', amended_from: 'OLD-Salary' });
    expect(salaryResult.canonical.id).toBe(VERSION);
    expect(salaryResult.canonical.erp_account).toBe('Salary');

    const cogs = harness({ account: 'COGS', amount: '25000.00', oldAmount: '25000.00', oldName: 'OLD-COGS' });
    const cogsResult = await commit(cogs);
    expect(methodCalls(cogs)).toEqual(['GET']);
    expect(cogsResult.externalRecordId).toBe('OLD-COGS');

    const equipment = harness({ account: 'Equipment', amount: '10000.00' });
    await commit(equipment);
    expect(methodCalls(equipment)).toEqual(['POST', 'PUT', 'GET']);

    const travel = harness({ account: 'Travel', amount: '0.00', oldAmount: '5000.00', oldName: 'OLD-Travel', intent: 'remove' });
    const travelResult = await commit(travel);
    expect(methodCalls(travel)).toEqual(['GET', 'PUT', 'GET']);
    expect(travel.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(travelResult.canonical.erp_docstatus).toBe(2);
    expect(travelResult.canonical.budget_intent).toBe('remove');
  });

  it('replayed removal is read-only; a lost cancel response converges from the cancelled document', async () => {
    const repeat = harness({ account: 'Travel', amount: '0', oldName: 'OLD-Travel', intent: 'remove' });
    await commit(repeat);
    repeat.calls.length = 0;
    await commit(repeat);
    expect(methodCalls(repeat)).toEqual(['GET']);

    const uncertain = harness({ account: 'Travel', amount: '0', oldName: 'OLD-Travel', intent: 'remove', failCancelOnce: true });
    await commit(uncertain);
    uncertain.calls.length = 0;
    const retry = await commit(uncertain);
    expect(methodCalls(uncertain)).toEqual(['GET']);
    expect(retry.canonical.erp_docstatus).toBe(2);
  });

  it('removal refuses missing predecessor, drafts, and mismatched dimensions before any write', async () => {
    const missing = harness({ account: 'Travel', amount: '0', intent: 'remove' });
    missing.record.budget_predecessor = null;
    await expect(commit(missing)).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(methodCalls(missing)).toEqual([]);

    const draft = harness({ account: 'Travel', amount: '0', oldName: 'OLD-Travel', intent: 'remove', draft: true });
    await expect(commit(draft)).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(methodCalls(draft)).toEqual(['GET']);

    const mismatch = harness({ account: 'Travel', amount: '0', oldName: 'OLD-Travel', intent: 'remove', wrongCompany: true });
    await expect(commit(mismatch)).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(methodCalls(mismatch)).toEqual(['GET']);
  });

  it('removal checks account, project, company, and both fiscal-year dimensions before writing', async () => {
    for (const mismatch of [
      { wrongCompany: true }, { wrongAccount: true }, { wrongYear: true }, { wrongProject: true },
    ]) {
      const h = harness({ account: 'Travel', amount: '0', oldName: 'OLD-Travel', intent: 'remove', ...mismatch });
      await expect(commit(h)).rejects.toMatchObject({ code: 'commit-rejected' });
      expect(methodCalls(h)).toEqual(['GET']);
    }
  });

  it('compares amounts as exact cents and rejects malformed values', async () => {
    for (const same of ['50000', '50000.0', '50000.00']) {
      const h = harness({ account: 'Salary', amount: '50000.00', oldAmount: same, oldName: 'OLD-Salary' });
      await commit(h);
      expect(methodCalls(h)).toEqual(['GET']);
    }
    const changed = harness({ account: 'Salary', amount: '50000.01', oldAmount: '50000.00', oldName: 'OLD-Salary' });
    await commit(changed);
    expect(methodCalls(changed)).toContain('POST');
    const malformed = harness({ account: 'Salary', amount: '50000.00', oldAmount: 'NaN', oldName: 'OLD-Salary' });
    await expect(commit(malformed)).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(methodCalls(malformed)).toEqual(['GET']);
  });
});
