import { expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory';
import type { AdapterCommand } from '../contract';
import type { ErpCtx } from './doctypeRegistry';

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
