import { expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory';
import type { AdapterCommand } from '../contract';
import type { ErpCtx } from './doctypeRegistry';
import { DOCTYPE_BODIES } from './doctypeBodies';

function serviceClient(account: string | null) {
  const calls: { table: string; filters: [string, string][] }[] = [];
  const client = { from: (table: string) => ({ select: () => {
    const filters: [string, string][] = [];
    const chain = { eq: (key: string, value: string) => { filters.push([key, value]); return chain; },
      maybeSingle: async () => {
        calls.push({ table, filters });
        return { data: table === 'external_org_bindings' ? { activated_at: '2026-10-05', version_major: 15,
          site_url: 'https://erp.example.test', config: { company: 'DEMO', cost_center: 'Main - DEMO',
            tax_prepaid_account: 'Caller-supplied account must not win' } }
          : table === 'organizations' ? { tax_prepaid_account: account } : null, error: null };
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
  const { client } = serviceClient(null);
  const fetchImpl = vi.fn();
  await expect(resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
    fetchImpl, apiKey: 'demo', apiSecret: 'demo' })).rejects.toThrow(/Tax-prepaid account.*Administration/i);
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('AC-WHT-004: the account comes from the exact server org row, never the command or binding override', async () => {
  const { client, calls } = serviceClient('Tax Prepaid - DEMO');
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
  const { client } = serviceClient('Tax Prepaid - DEMO');
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
  const { client } = serviceClient('Tax Prepaid - DEMO');
  const erp = erpWithAccounts({ 'Debtors - DEMO': 'IDR', 'Cash - DEMO': 'USD' });
  const adapter = await resolveErpDispatchAdapter({ serviceClient: bindingAccounts(client), orgId: 'org-1',
    command: { ...command, record: { ...command.record, references: [] } },
    fetchImpl: erp.fetchImpl, apiKey: 'demo', apiSecret: 'demo', doctypeBodies: DOCTYPE_BODIES });
  await expect(adapter.commit({ ...command, record: { ...command.record, references: [] } })).rejects.toThrow(/same currency/i);
  expect(erp.requests.filter((r) => r.method !== 'GET')).toEqual([]);
});
