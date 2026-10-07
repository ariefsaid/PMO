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
    const fetchImpl = vi.fn(async () =>
      Response.json({
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
    expect(fetchImpl).not.toHaveBeenCalled();
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
