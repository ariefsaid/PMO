import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import type { AdapterCommand } from '../contract.ts';
import { siToBody, siFromDoc } from './bodies/salesInvoice.ts';
import { poToBody, poFromDoc } from './bodies/purchaseOrder.ts';
import { piToBody, piFromDoc } from './bodies/purchaseInvoice.ts';
import { canonicalCommandDigest } from '../../../../../supabase/functions/adapter-dispatch/moneyOutboxDeps.ts';

function client(tables: Record<string, unknown> = {}): DispatchServiceClient {
  return {
    from: (table: string) => {
      const result = {
        data:
          tables[table] ??
          (table === 'external_org_bindings'
            ? { site_url: 'https://erp.example.com', activated_at: '2026-10-05', config: { company: 'Test Co' } }
            : table === 'organizations' ? { default_currency: 'USD' } : null), // #866: an invoice with no project is in the org currency
        error: null,
      };
      const builder = {
        eq: () => builder,
        select: () => builder,
        maybeSingle: async () => result,
        then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return builder;
    },
  } as unknown as DispatchServiceClient;
}

describe('item catalog money preflight', () => {
  it.each(['sales-invoice', 'purchase-order', 'purchase-invoice'])(
    'AC-ITM-003 %s refuses an unknown line before any ERP money write',
    async (kind) => {
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(init?.method).toBe('GET');
        // #856: a VAT-on sales invoice reads the default tax template first; it is not an item-catalog read.
        const path = decodeURIComponent(new URL(String(_url)).pathname);
        if (path === '/api/resource/Company/Test Co') return Response.json({ data: { default_currency: 'USD' } }); // #866: the billing-currency check
        if (path === '/api/resource/Sales Taxes and Charges Template') return Response.json({ data: [{ name: 'Test Tax' }] });
        // #915: the neither-path reads the company's default purchase tax template first; this org has none.
        if (path === '/api/resource/Purchase Taxes and Charges Template') return Response.json({ data: [] });
        if (path === '/api/resource/Sales Taxes and Charges Template/Test Tax') {
          return Response.json({ data: { name: 'Test Tax', taxes: [{ charge_type: 'On Net Total', account_head: 'VAT', rate: 11 }] } });
        }
        return Response.json({
          data: [
            {
              name: 'ITEM-TEST',
              item_name: 'Test service',
              disabled: 0,
              is_sales_item: 1,
              is_purchase_item: 1,
            },
          ],
        });
      });
      const command: AdapterCommand = {
        domain: kind === 'sales-invoice' ? 'revenue' : 'procurement', operation: 'create',
        record: { id: 'record-test', erp_doc_kind: kind, items: [
          { item_code: 'ITEM-TEST', qty: 1, rate: 2 },
          { item_code: 'ITEM-UNKNOWN', qty: 1, rate: 2 },
        ] },
      };
      await expect((async () => {
        const adapter = await resolveErpDispatchAdapter({
          serviceClient: client(), orgId: 'org-test', command,
          apiKey: 'test', apiSecret: 'test', fetchImpl: fetchImpl as typeof fetch,
          doctypeBodies: {
            'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc },
            'purchase-order': { toBody: poToBody, fromDoc: poFromDoc },
            'purchase-invoice': { toBody: piToBody, fromDoc: piFromDoc },
          },
        });
        await adapter.commit(command);
      })()).rejects.toThrow('Line 2: item "ITEM-UNKNOWN"');
      expect(fetchImpl.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/api/resource/Item')).toHaveLength(1);
    },
  );

  it('AC-ITM-002 puts resolved case code and description into the command before its outbox snapshot', async () => {
    const command = {
      domain: 'procurement',
      operation: 'create',
      record: { id: 'record-test', erp_doc_kind: 'purchase-invoice', procurementId: 'case-test' },
    } as const;
    const before = await canonicalCommandDigest(command);
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) =>
      // #915: the neither-path's default-template lookup happens during resolve; this org has no default.
      decodeURIComponent(new URL(String(url)).pathname) === '/api/resource/Purchase Taxes and Charges Template'
        ? Response.json({ data: [] })
        : Response.json({
            data: [
              {
                name: 'ITEM-TEST',
                item_name: 'Test service',
                disabled: 0,
                is_sales_item: 1,
                is_purchase_item: 1,
              },
            ],
          }),
    );
    await resolveErpDispatchAdapter({
      serviceClient: client({
        procurements: { org_id: 'org-test', vendor_id: null },
        procurement_items: [
          { name: 'ITEM-TEST', description: 'Inspection of test unit', quantity: 2, rate: 10 },
        ],
      }),
      orgId: 'org-test',
      command,
      apiKey: 'test',
      apiSecret: 'test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(command.record).toMatchObject({
      items: [{ item_code: 'ITEM-TEST', description: 'Inspection of test unit', qty: 2, rate: 10 }],
    });
    // #915: the resolve phase makes no ERP read beyond the mandated default-template lookup — no catalog read, no write.
    expect(fetchImpl.mock.calls.map(([url]) => decodeURIComponent(new URL(String(url)).pathname)))
      .toEqual(['/api/resource/Purchase Taxes and Charges Template']);
    const resolved = await canonicalCommandDigest(command);
    expect(resolved).not.toBe(before);
    expect(await canonicalCommandDigest(command)).toBe(resolved);
    expect(await canonicalCommandDigest({ ...command, record: { ...command.record, items: [{ item_code: 'ITEM-TEST', description: 'Different test work', qty: 2, rate: 10 }] } })).not.toBe(resolved);
  });

  it('rejects an unresolved amendment item before cancelling its predecessor', async () => {
    const command: AdapterCommand = { domain: 'revenue', operation: 'transition', record: {
      id: 'record-test', erp_doc_kind: 'sales-invoice', verb: 'amend', externalRecordId: 'ERP-OLD',
      items: [{ item_code: 'ITEM-UNKNOWN', qty: 1, rate: 2 }],
    } };
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      return Response.json({ data: [] });
    });
    await expect((async () => {
      // OD-BILL-1: an amend is stated in its mirror row's currency.
      const adapter = await resolveErpDispatchAdapter({ serviceClient: client({ sales_invoices: { currency: 'USD' } }), orgId: 'org-test',
        command, apiKey: 'test', apiSecret: 'test', fetchImpl: fetchImpl as typeof fetch,
        doctypeBodies: { 'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc } },
      });
      await adapter.commit(command);
    })()).rejects.toThrow('Line 1: item "ITEM-UNKNOWN"');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not look up authoring items for submit/cancel transitions', async () => {
    const fetchImpl = vi.fn();
    await resolveErpDispatchAdapter({
      serviceClient: client(),
      orgId: 'org-test',
      command: {
        domain: 'revenue',
        operation: 'transition',
        record: {
          id: 'record-test',
          erp_doc_kind: 'sales-invoice',
          verb: 'submit',
          items: [{ item_code: 'ITEM-UNKNOWN' }],
        },
      },
      apiKey: 'test',
      apiSecret: 'test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// #2116: the commit-time item check reads only the command's codes, not the whole catalogue.
describe('item catalog money preflight is filtered to the command codes (#2116)', () => {
  const CATALOG = [
    ...Array.from({ length: 5000 }, (_, i) => ({
      name: `ITEM-${String(i).padStart(4, '0')}`, item_name: `Item ${i}`, disabled: 0, is_sales_item: 1, is_purchase_item: 1,
    })),
    { name: 'ITEM-DISABLED', item_name: 'Disabled', disabled: 1, is_sales_item: 1, is_purchase_item: 1 },
  ];
  type Row = (typeof CATALOG)[number];

  /** An ERPNext-faithful fake: honours `filters`, `fields` and the page window like Frappe's REST list. */
  function erpFake() {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(String(url));
      const path = decodeURIComponent(parsed.pathname);
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({ data: { ...body, name: 'ERP-NEW', docstatus: 0 } });
      }
      if (path === '/api/resource/Company/Test Co') return Response.json({ data: { default_currency: 'USD' } });
      if (path === '/api/resource/Sales Taxes and Charges Template') return Response.json({ data: [{ name: 'Test Tax' }] });
      if (path === '/api/resource/Sales Taxes and Charges Template/Test Tax') {
        return Response.json({ data: { name: 'Test Tax', taxes: [{ charge_type: 'On Net Total', account_head: 'VAT', rate: 11 }] } });
      }
      if (path === '/api/resource/Purchase Taxes and Charges Template') return Response.json({ data: [] });
      if (path === '/api/resource/Item') {
        const filters = JSON.parse(parsed.searchParams.get('filters') ?? '[]') as Array<[keyof Row, string, unknown]>;
        const hit = CATALOG.filter((row) => filters.every(([field, op, value]) =>
          op === 'in' ? (value as unknown[]).includes(row[field]) : row[field] === value));
        const start = Number(parsed.searchParams.get('limit_start') ?? 0);
        const size = Number(parsed.searchParams.get('limit_page_length') ?? 20);
        const fields = JSON.parse(parsed.searchParams.get('fields') ?? '["name"]') as Array<keyof Row>;
        return Response.json({
          data: hit.slice(start, start + size).map((row) => Object.fromEntries(fields.map((f) => [f, row[f]]))),
        });
      }
      return Response.json({ data: {} });
    });
  }

  const bodies = {
    'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc },
    'purchase-order': { toBody: poToBody, fromDoc: poFromDoc },
    'purchase-invoice': { toBody: piToBody, fromDoc: piFromDoc },
  };
  const commandFor = (kind: string, codes: string[]): AdapterCommand => ({
    domain: kind === 'sales-invoice' ? 'revenue' : 'procurement', operation: 'create',
    record: { id: 'record-test', erp_doc_kind: kind, items: codes.map((item_code) => ({ item_code, qty: 1, rate: 2, schedule_date: '2026-11-20' })) },
  });
  async function commit(kind: string, codes: string[], fetchImpl: ReturnType<typeof erpFake>) {
    const command = commandFor(kind, codes);
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: client(), orgId: 'org-test', command,
      apiKey: 'test', apiSecret: 'test', fetchImpl: fetchImpl as unknown as typeof fetch, doctypeBodies: bodies,
    });
    return adapter.commit(command);
  }
  const itemCalls = (fetchImpl: ReturnType<typeof erpFake>) =>
    fetchImpl.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/api/resource/Item');
  const writes = (fetchImpl: ReturnType<typeof erpFake>) =>
    fetchImpl.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');

  it.each(['sales-invoice', 'purchase-order', 'purchase-invoice'])(
    '#2116 %s create with 3 item codes over a 5,000-item catalogue issues exactly 1 catalogue GET, then the create',
    async (kind) => {
      const fetchImpl = erpFake();
      const result = await commit(kind, ['ITEM-4999', 'ITEM-0007', 'ITEM-2500', 'ITEM-0007'], fetchImpl);
      expect(result.externalRecordId).toBe('ERP-NEW');
      expect(itemCalls(fetchImpl)).toHaveLength(1);
      const filters = JSON.parse(new URL(String(itemCalls(fetchImpl)[0][0])).searchParams.get('filters')!) as unknown[][];
      expect(filters).toContainEqual(['name', 'in', ['ITEM-4999', 'ITEM-0007', 'ITEM-2500']]);
      expect(filters).toContainEqual(['disabled', '=', 0]);
      expect(filters).toContainEqual([kind === 'sales-invoice' ? 'is_sales_item' : 'is_purchase_item', '=', 1]);
      const order = fetchImpl.mock.calls.map(([url, init]) => `${init?.method} ${new URL(String(url)).pathname}`);
      expect(order.indexOf('GET /api/resource/Item')).toBeLessThan(order.findIndex((c) => c.startsWith('POST')));
      expect(writes(fetchImpl).filter(([, init]) => init?.method === 'POST')).toHaveLength(1); // one create (PO/PI then submit via PUT)
    },
  );

  it.each([
    ['sales-invoice', 'ITEM-UNKNOWN'], ['purchase-order', 'ITEM-UNKNOWN'], ['purchase-invoice', 'ITEM-UNKNOWN'],
    ['sales-invoice', 'ITEM-DISABLED'], ['purchase-order', 'ITEM-DISABLED'], ['purchase-invoice', 'ITEM-DISABLED'],
  ])('#2116 %s refuses %s with the unchanged message and sends no create', async (kind, bad) => {
    const fetchImpl = erpFake();
    await expect(commit(kind, ['ITEM-0001', bad, 'ITEM-0002'], fetchImpl))
      .rejects.toThrow(`Line 2: item "${bad}" is not an enabled ERP item`);
    expect(itemCalls(fetchImpl)).toHaveLength(1);
    expect(writes(fetchImpl)).toHaveLength(0);
  });

  it('#2116 refuses a wrong-purpose item even when ERP ignores the query filters', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({ data: { name: 'ERP-NEW', docstatus: 0 } });
      const path = decodeURIComponent(new URL(String(url)).pathname);
      if (path === '/api/resource/Item') {
        return Response.json({ data: [{ name: 'ITEM-SALES-ONLY', disabled: 0, is_sales_item: 1, is_purchase_item: 0 }] });
      }
      return Response.json({ data: path.endsWith('Template') ? [] : {} });
    });
    await expect(commit('purchase-order', ['ITEM-SALES-ONLY'], fetchImpl as unknown as ReturnType<typeof erpFake>))
      .rejects.toThrow('Line 1: item "ITEM-SALES-ONLY" is not an enabled ERP item');
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });
});
