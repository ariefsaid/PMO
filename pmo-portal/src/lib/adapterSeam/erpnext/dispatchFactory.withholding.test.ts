import { expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory';
import type { AdapterCommand } from '../contract';
import type { ErpCtx } from './doctypeRegistry';
import { DOCTYPE_BODIES } from './doctypeBodies';

type OrgAccounts = { tax_prepaid_account: string | null; pph23_prepaid_account?: string | null; pph4_2_prepaid_account?: string | null };
function serviceClient(accounts: OrgAccounts) {
  const calls: { table: string; filters: [string, string][] }[] = [];
  const client = { from: (table: string) => ({ select: () => {
    const filters: [string, string][] = [];
    const chain = { eq: (key: string, value: string) => { filters.push([key, value]); return chain; },
      maybeSingle: async () => {
        calls.push({ table, filters });
        return { data: table === 'external_org_bindings' ? { activated_at: '2026-10-05', version_major: 15,
          site_url: 'https://erp.example.test', config: { company: 'DEMO', cost_center: 'Main - DEMO',
            tax_prepaid_account: 'Caller-supplied account must not win',
            pph4_2_prepaid_account: 'Caller-supplied' } }
          : table === 'organizations' ? accounts : null, error: null };
      } };
    return chain;
  } }) } as unknown as DispatchServiceClient;
  return { client, calls };
}
const command: AdapterCommand = { domain: 'revenue', operation: 'create', record: {
  id: 'receipt-1', erp_doc_kind: 'incoming-payment', paid_amount: 1000, received_amount: 980,
  withheld_amount: 20, withholding_slip_number: 'WHT-001',
} };

it('AC-WHT-004: missing org account refuses before any ERP call, despite a binding override', async () => {
  const { client } = serviceClient({ tax_prepaid_account: null });
  const fetchImpl = vi.fn();
  await expect(resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
    fetchImpl, apiKey: 'demo', apiSecret: 'demo' })).rejects.toThrow(/Tax-prepaid account.*Administration/i);
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('AC-WHT-004: the account comes from the exact server org row, never the command or binding override', async () => {
  const { client, calls } = serviceClient({ tax_prepaid_account: 'Tax Prepaid - DEMO' });
  let captured: ErpCtx | undefined;
  const adapter = await resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
    fetchImpl: vi.fn(async () => new Response(JSON.stringify({ data: { name: 'PE-001' } }))),
    apiKey: 'demo', apiSecret: 'demo', doctypeBodies: { 'incoming-payment': {
      toBody: (_record, ctx) => { captured = ctx; return {}; }, fromDoc: () => ({ id: 'PE-001' }),
    } } });
  await adapter.commit(command);
  expect(captured?.config.tax_prepaid_account).toBe('Tax Prepaid - DEMO');
  expect(calls.find(call => call.table === 'organizations')?.filters).toEqual([['id', 'org-1']]);
});

/** An ERP that knows two accounts' currencies and records every request it is sent. */
function erpWithAccounts(currencies: Record<string, string>) {
  const requests: { method: string; path: string }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    requests.push({ method: init?.method ?? 'GET', path: decodeURIComponent(url.pathname) });
    const account = decodeURIComponent(url.pathname).match(/^\/api\/resource\/Account\/(.+)$/)?.[1];
    return new Response(JSON.stringify({ data: account ? { name: account, account_currency: currencies[account] }
      : { name: 'PE-001', docstatus: 1 } }));
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests };
}
const bindingAccounts = (client: DispatchServiceClient) => {
  const from = (client as unknown as { from: (t: string) => { select: () => { eq: (k: string, v: string) => unknown } } }).from;
  return { from: (table: string) => {
    const builder = from(table);
    if (table !== 'external_org_bindings') return builder;
    return { select: () => {
      const chain = { eq: () => chain, maybeSingle: async () => ({ data: { activated_at: '2026-10-05', version_major: 15,
        site_url: 'https://erp.example.test', config: { company: 'DEMO', cost_center: 'Main - DEMO',
          default_receivable_account: 'Debtors - DEMO', default_cash_account: 'Cash - DEMO' } }, error: null }) };
      return chain;
    } };
  } } as unknown as DispatchServiceClient;
};

it('AC-WHT-004: the receipt body learns both account currencies from ERPNext before any write', async () => {
  const { client } = serviceClient({ tax_prepaid_account: 'Tax Prepaid - DEMO' });
  const erp = erpWithAccounts({ 'Debtors - DEMO': 'IDR', 'Cash - DEMO': 'IDR' });
  let captured: ErpCtx | undefined;
  const adapter = await resolveErpDispatchAdapter({ serviceClient: bindingAccounts(client), orgId: 'org-1', command,
    fetchImpl: erp.fetchImpl, apiKey: 'demo', apiSecret: 'demo', doctypeBodies: { 'incoming-payment': {
      toBody: (_record, ctx) => { captured = ctx; return {}; }, fromDoc: () => ({ id: 'PE-001' }),
    } } });
  expect(erp.requests.every((r) => r.method === 'GET')).toBe(true);
  await adapter.commit(command);
  expect(captured?.config).toMatchObject({ paid_from_account_currency: 'IDR', paid_to_account_currency: 'IDR' });
});

it('AC-WHT-004: withholding across account currencies is refused before ERPNext receives the receipt', async () => {
  const { client } = serviceClient({ tax_prepaid_account: 'Tax Prepaid - DEMO' });
  const erp = erpWithAccounts({ 'Debtors - DEMO': 'IDR', 'Cash - DEMO': 'USD' });
  const adapter = await resolveErpDispatchAdapter({ serviceClient: bindingAccounts(client), orgId: 'org-1',
    command: { ...command, record: { ...command.record, references: [] } },
    fetchImpl: erp.fetchImpl, apiKey: 'demo', apiSecret: 'demo', doctypeBodies: DOCTYPE_BODIES });
  await expect(adapter.commit({ ...command, record: { ...command.record, references: [] } })).rejects.toThrow(/same currency/i);
  expect(erp.requests.filter((r) => r.method !== 'GET')).toEqual([]);
});

const ALL_ACCOUNTS: OrgAccounts = { tax_prepaid_account: 'Default Prepaid - DEMO', pph23_prepaid_account: 'PPh 23 Prepaid - DEMO',
  pph4_2_prepaid_account: 'PPh 4(2) Prepaid - DEMO' };
const withArticle = (withholding_article: unknown): AdapterCommand => ({ ...command, record: { ...command.record, withholding_article } });
async function postedAccount(accounts: OrgAccounts, cmd: AdapterCommand) {
  const { client } = serviceClient(accounts);
  let captured: ErpCtx | undefined;
  const adapter = await resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command: cmd,
    fetchImpl: vi.fn(async () => new Response(JSON.stringify({ data: { name: 'PE-001' } }))),
    apiKey: 'demo', apiSecret: 'demo', doctypeBodies: { 'incoming-payment': {
      toBody: (_record, ctx) => { captured = ctx; return {}; }, fromDoc: () => ({ id: 'PE-001' }),
    } } });
  await adapter.commit(cmd);
  return captured?.config.tax_prepaid_account;
}

it("AC-WHA-003: a PPh 4(2) receipt posts its deduction to the org's PPh 4(2) prepaid account", async () => {
  expect(await postedAccount(ALL_ACCOUNTS, withArticle('pph4_2'))).toBe('PPh 4(2) Prepaid - DEMO');
});

it('AC-WHA-003: a PPh 23 receipt posts to the PPh 23 prepaid account', async () => {
  expect(await postedAccount(ALL_ACCOUNTS, withArticle('pph23'))).toBe('PPh 23 Prepaid - DEMO');
});

it('AC-WHA-004: an article whose account is not set falls back to the default tax-prepaid account', async () => {
  expect(await postedAccount({ tax_prepaid_account: 'Default Prepaid - DEMO' }, withArticle('pph4_2'))).toBe('Default Prepaid - DEMO');
});

it('AC-WHA-004: a receipt with no article posts to the default account even when article accounts exist', async () => {
  expect(await postedAccount(ALL_ACCOUNTS, command)).toBe('Default Prepaid - DEMO');
});

it('AC-WHA-005: an article account alone, without the default, still posts a receipt of that article and refuses a receipt with no article before any ERP call', async () => {
  const onlyArticle: OrgAccounts = { tax_prepaid_account: null, pph23_prepaid_account: 'PPh 23 Prepaid - DEMO' };
  expect(await postedAccount(onlyArticle, withArticle('pph23'))).toBe('PPh 23 Prepaid - DEMO');
  const { client } = serviceClient(onlyArticle);
  const fetchImpl = vi.fn();
  await expect(resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
    fetchImpl, apiKey: 'demo', apiSecret: 'demo' })).rejects.toThrow(/Tax-prepaid account.*Administration/i);
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('AC-WHA-003: the article comes from the receipt command, never the binding config', async () => {
  // The binding config carries pph4_2_prepaid_account: 'Caller-supplied'; the server org row must win.
  expect(await postedAccount(ALL_ACCOUNTS, withArticle('pph4_2'))).not.toBe('Caller-supplied');
  expect(await postedAccount({ tax_prepaid_account: 'Default Prepaid - DEMO' }, withArticle('pph4_2'))).toBe('Default Prepaid - DEMO');
});

it('AC-WHA-003: an unknown article in the command is refused before any ERP call', async () => {
  const { client } = serviceClient(ALL_ACCOUNTS);
  const fetchImpl = vi.fn();
  await expect(resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command: withArticle('pph21'),
    fetchImpl, apiKey: 'demo', apiSecret: 'demo' })).rejects.toThrow(/PPh 23 or PPh 4\(2\)/);
  expect(fetchImpl).not.toHaveBeenCalled();
});
