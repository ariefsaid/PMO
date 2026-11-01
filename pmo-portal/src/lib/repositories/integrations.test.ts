/** integrationsRepository: each method reads/invokes the right table or edge function with the right arguments and returns the mapped result. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  const results: Record<string, { data: unknown; error: unknown }> = {};
  const make = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
      chain[m] = (...args: unknown[]) => { calls.push([`${table}.${m}`, args]); return chain; };
    }
    chain.maybeSingle = () => Promise.resolve(results[table] ?? { data: null, error: null });
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(results[table] ?? { data: [], error: null }).then(res, rej);
    return chain;
  };
  return { calls, results, from: vi.fn(make), invoke: vi.fn() };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, functions: { invoke: h.invoke } } }));

import { integrationsRepository as repo } from './integrations';

const ok = (data: unknown) => h.invoke.mockResolvedValue({ data, error: null });
const lastInvoke = () => h.invoke.mock.calls.at(-1)!;

beforeEach(() => {
  h.calls.length = 0;
  for (const k of Object.keys(h.results)) delete h.results[k];
  h.invoke.mockReset();
});

describe('ERP setup edge actions', () => {
  const cases: Array<[string, () => Promise<unknown>, string, Record<string, unknown>]> = [
    ['getErpSetup', () => repo.getErpSetup(), 'readiness', {}],
    ['saveErpDefaults', () => repo.saveErpDefaults({ warehouse: 'W' } as never), 'save-defaults', { warehouse: 'W' }],
    ['ensureErpProject', () => repo.ensureErpProject('p1'), 'ensure-project', { projectId: 'p1' }],
    ['linkErpProject', () => repo.linkErpProject('p1', 'PRJ-1', 'PRJ-0'), 'link-project', { projectId: 'p1', erpProject: 'PRJ-1', expectedErpProject: 'PRJ-0' }],
    ['employErpDomain', () => repo.employErpDomain('companies' as never), 'employ-domain', { domain: 'companies' }],
    ['saveExpenseAccount', () => repo.saveExpenseAccount({ accountKey: 'k', erpAccount: 'a' } as never), 'save-expense-account', { accountKey: 'k', erpAccount: 'a' }],
    ['clearExpenseAccount', () => repo.clearExpenseAccount('k' as never), 'clear-expense-account', { accountKey: 'k' }],
    ['onboardErpParties', () => repo.onboardErpParties(), 'onboard-parties', {}],
  ];
  it.each(cases)('%s posts the %s action to external-set-company and returns its data', async (_n, run, action, extra) => {
    ok({ result: action });
    await expect(run()).resolves.toEqual({ result: action });
    expect(lastInvoke()).toEqual(['external-set-company', { body: { tier: 'erpnext', setupAction: action, ...extra } }]);
  });

  it('listErpProjects sends the query and unwraps the projects list', async () => {
    ok({ projects: [{ name: 'PRJ-1' }] });
    await expect(repo.listErpProjects('prj')).resolves.toEqual([{ name: 'PRJ-1' }]);
    expect(lastInvoke()[1]).toEqual({ body: { tier: 'erpnext', setupAction: 'list-projects', query: 'prj' } });
  });

  it('an edge failure with a JSON message surfaces that message and code', async () => {
    const err = Object.assign(new Error('non-2xx'), {
      context: new Response(JSON.stringify({ error: 'CONFIG_REJECTED', message: 'Not supported' }), { status: 422 }),
    });
    h.invoke.mockResolvedValue({ data: null, error: err });
    await expect(repo.getErpSetup()).rejects.toMatchObject({ message: 'Not supported', code: 'CONFIG_REJECTED' });
  });
});

describe('ECA setup verbs (ECA2-T16)', () => {
  const cases: Array<[string, () => Promise<unknown>, string, Record<string, unknown>]> = [
    ['startConnectCensus', () => repo.startConnectCensus('odoo'), 'census', {}],
    ['getConnectStatus', () => repo.getConnectStatus('odoo'), 'connect-status', {}],
    ['listConnectProposals', () => repo.listConnectProposals('odoo', 'party', 'link', 'p9'), 'list-proposals', { kind: 'party', outcome: 'link', afterId: 'p9' }],
    ['acceptConnectProposals (a kind)', () => repo.acceptConnectProposals('odoo', 'party', ['a', 'b']), 'accept-proposals', { kind: 'party', ids: ['a', 'b'] }],
    ['acceptConnectProposals (all)', () => repo.acceptConnectProposals('odoo', null, null), 'accept-proposals', { kind: null, ids: null }],
    ['decideConnectReview', () => repo.decideConnectReview('odoo', 'r1', { action: 'dismiss' }), 'decide-review', { id: 'r1', choice: { action: 'dismiss' } }],
    ['unlinkConnectMatch', () => repo.unlinkConnectMatch('odoo', 'l1'), 'unlink-match', { id: 'l1' }],
    ['retryConnectSend', () => repo.retryConnectSend('odoo', 'h1'), 'retry-send', { id: 'h1' }],
  ];
  it.each(cases)('%s posts the %s verb with the tier', async (_n, run, action, extra) => {
    ok({ result: action, counts: {}, remaining: 0 });
    await run();
    expect(lastInvoke()).toEqual(['external-set-company', { body: { tier: 'odoo', setupAction: action, ...extra } }]);
  });

  it('acceptConnectProposals keeps going until nothing is left, adding the counts of each request', async () => {
    h.invoke.mockResolvedValueOnce({ data: { counts: { party: { link: 500, bring_in: 0, send: 0, left_open: 0 } }, remaining: 20 }, error: null })
      .mockResolvedValueOnce({ data: { counts: { party: { link: 20, bring_in: 1, send: 0, left_open: 0 } }, remaining: 0 }, error: null });
    await expect(repo.acceptConnectProposals('erpnext', 'party', null)).resolves.toEqual({ counts: { party: { link: 520, bring_in: 1, send: 0, left_open: 0 } }, remaining: 0 });
    expect(h.invoke).toHaveBeenCalledTimes(2);
  });

  it('acceptConnectProposals stops when a request applies nothing, and reports what is left', async () => {
    ok({ counts: {}, remaining: 3 });
    await expect(repo.acceptConnectProposals('erpnext', null, null)).resolves.toEqual({ counts: {}, remaining: 3 });
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('bindings and health', () => {
  const binding = { org_id: 'o1', external_tier: 'erpnext', status: 'connected', connected_by: 'u1', connected_at: 't1' };

  it('getBinding reads one org+tier binding row', async () => {
    h.results.external_org_bindings = { data: binding, error: null };
    await expect(repo.getBinding('o1', 'erpnext')).resolves.toEqual(binding);
    expect(h.calls).toContainEqual(['external_org_bindings.eq', ['org_id', 'o1']]);
    expect(h.calls).toContainEqual(['external_org_bindings.eq', ['external_tier', 'erpnext']]);
  });

  it('getBinding failure keeps the database code', async () => {
    h.results.external_org_bindings = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(repo.getBinding('o1', 'erpnext')).rejects.toMatchObject({ code: '42501' });
  });

  it('listBindings returns the org rows, empty on null', async () => {
    h.results.external_org_bindings = { data: [binding], error: null };
    await expect(repo.listBindings('o1')).resolves.toEqual([binding]);
    h.results.external_org_bindings = { data: null, error: null };
    await expect(repo.listBindings('o1')).resolves.toEqual([]);
  });

  it('getIntegrationHealth combines binding, last sync and outbox state counts', async () => {
    h.results.external_org_bindings = { data: binding, error: null };
    h.results.external_sync_watermarks = { data: { updated_at: 'sync-t' }, error: null };
    h.results.external_command_outbox = { data: [{ state: 'pending' }, { state: 'pending' }, { state: 'failed' }, { state: 'held' }, { state: 'other' }], error: null };
    await expect(repo.getIntegrationHealth('o1', 'erpnext')).resolves.toEqual({
      tier: 'erpnext', status: 'connected', connected_by: 'u1', connected_at: 't1', last_sync: 'sync-t',
      state_counts: { pending: 2, failed: 1, quarantined: 0, held: 1 },
    });
    expect(h.calls).toContainEqual(['external_command_outbox.in', ['state', ['pending', 'failed', 'quarantined', 'held']]]);
  });

  it('getIntegrationHealth for a never-connected tier reports disconnected with no sync', async () => {
    await expect(repo.getIntegrationHealth('o1', 'clickup')).resolves.toEqual({
      tier: 'clickup', status: 'disconnected', connected_by: null, connected_at: null, last_sync: null,
      state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 },
    });
  });

  it('getIntegrationHealth surfaces a watermark or outbox read error', async () => {
    h.results.external_sync_watermarks = { data: null, error: { message: 'w', code: '42501' } };
    await expect(repo.getIntegrationHealth('o1', 'erpnext')).rejects.toMatchObject({ code: '42501' });
    delete h.results.external_sync_watermarks;
    h.results.external_command_outbox = { data: null, error: { message: 'o', code: '42P01' } };
    await expect(repo.getIntegrationHealth('o1', 'erpnext')).rejects.toMatchObject({ code: '42P01' });
  });

  it('listProjectBindings reads only active (not disconnected) project bindings of the org', async () => {
    h.results.external_project_bindings = { data: [{ id: 'b1' }], error: null };
    await expect(repo.listProjectBindings('o1')).resolves.toEqual([{ id: 'b1' }]);
    expect(h.calls).toContainEqual(['external_project_bindings.is', ['disconnected_at', null]]);
    h.results.external_project_bindings = { data: null, error: null };
    await expect(repo.listProjectBindings('o1')).resolves.toEqual([]);
  });
});

describe('edge function calls', () => {
  it('connectIntegration sends tier and credential', async () => {
    ok({ ok: true });
    await expect(repo.connectIntegration('o1', { tier: 'clickup', credential: { token: 't' } } as never)).resolves.toEqual({ ok: true });
    expect(lastInvoke()).toEqual(['external-connect', { body: { tier: 'clickup', credential: { token: 't' } } }]);
  });

  it('disconnectIntegration sends the tier', async () => {
    ok({ ok: true });
    await repo.disconnectIntegration('o1', 'erpnext');
    expect(lastInvoke()).toEqual(['external-disconnect', { body: { tier: 'erpnext' } }]);
  });

  it('listProjectLists asks ClickUp for lists and unwraps them', async () => {
    ok({ lists: [{ id: 'l1' }] });
    await expect(repo.listProjectLists('o1')).resolves.toEqual([{ id: 'l1' }]);
    expect(lastInvoke()).toEqual(['external-lists', { body: { tier: 'clickup' } }]);
  });

  it('linkProject and unlinkProject forward their input as the body', async () => {
    ok({ ok: true });
    await repo.linkProject('o1', { projectId: 'p1', listId: 'l1' } as never);
    expect(lastInvoke()).toEqual(['external-link', { body: { projectId: 'p1', listId: 'l1' } }]);
    await repo.unlinkProject('o1', { projectId: 'p1' } as never);
    expect(lastInvoke()).toEqual(['external-unlink', { body: { projectId: 'p1' } }]);
  });

  it('listCompanies is empty for non-ERPNext tiers without calling the edge, else unwraps companies', async () => {
    await expect(repo.listCompanies('o1', 'clickup')).resolves.toEqual([]);
    expect(h.invoke).not.toHaveBeenCalled();
    ok({ companies: [{ name: 'ACME' }] });
    await expect(repo.listCompanies('o1', 'erpnext')).resolves.toEqual([{ name: 'ACME' }]);
    expect(lastInvoke()).toEqual(['external-companies', { body: { tier: 'erpnext' } }]);
  });

  it('listPurchaseTaxTemplates and listItems read external-items by purpose; a missing payload is an error', async () => {
    ok({ templates: [{ name: 'PPN' }] });
    await expect(repo.listPurchaseTaxTemplates()).resolves.toEqual([{ name: 'PPN' }]);
    expect(lastInvoke()).toEqual(['external-items', { body: { purpose: 'purchase-tax-templates' } }]);
    ok({ items: [{ code: 'DP', name: 'Down payment' }] });
    await expect(repo.listItems('down-payment' as never)).resolves.toEqual([{ code: 'DP', name: 'Down payment' }]);
    expect(lastInvoke()).toEqual(['external-items', { body: { purpose: 'down-payment' } }]);
    ok({});
    await expect(repo.listPurchaseTaxTemplates()).rejects.toThrow('purchase tax templates could not be read');
    await expect(repo.listItems('down-payment' as never)).rejects.toThrow('item catalog could not be read');
  });

  it('setCompany selects the company for ERPNext only', async () => {
    ok({ ok: true, companyId: 'ACME' });
    await expect(repo.setCompany('o1', 'erpnext', 'ACME')).resolves.toEqual({ ok: true, companyId: 'ACME' });
    expect(lastInvoke()).toEqual(['external-set-company', { body: { tier: 'erpnext', companyId: 'ACME' } }]);
    await expect(repo.setCompany('o1', 'clickup', 'ACME')).rejects.toThrow('Only erpnext tier supports company selection');
  });

  it('an invoke error without a response body surfaces as an AppError', async () => {
    h.invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('boom'), { code: 'X1' }) });
    await expect(repo.disconnectIntegration('o1', 'erpnext')).rejects.toMatchObject({ message: 'boom' });
  });
});
