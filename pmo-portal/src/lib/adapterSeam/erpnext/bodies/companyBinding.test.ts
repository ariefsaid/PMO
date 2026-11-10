/**
 * Which COMPANY an outbound procurement money body lands in.
 *
 * ERPNext files a created document under the company STATED ON THE BODY, else under the integration
 * user's default company. The org binding names exactly one company
 * (`external_org_bindings.config.company`), and the sweep's purchase mirror feed scopes every read to
 * that same company. A PO/PI/GR body that omits it therefore lands in the wrong company on any ERP that
 * holds more than one (ERPNext refuses the create with "Project ... does not belong to the Company ..."
 * when a project is set, and silently files elsewhere when it is not) — and the document can never
 * mirror back, so the PMO purchase never turns Ordered.
 *
 * The Material Request body already carries `config.company`; these three did not. Fail closed like
 * `paymentEntry`'s account defaults: a binding that names no company refuses BEFORE any ERP call.
 */
import { describe, expect, it, vi } from 'vitest';
import { AdapterError, type PmoRecord } from '../../contract.ts';
import { createErpAdapter } from '../adapter.ts';
import { DOCTYPE_BODIES } from '../doctypeBodies.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { grToBody } from './goodsReceipt.ts';
import { mrToBody } from './materialRequest.ts';
import { piToBody } from './purchaseInvoice.ts';
import { poToBody } from './purchaseOrder.ts';

const CTX: ErpCtx = {
  refs: { supplier: 'Spike Supplier', po: 'PUR-ORD-2026-00001' },
  config: { company: 'PMO Smoke Co' },
};

const RECORD: PmoRecord = {
  id: 'pmo-1',
  items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 100000, schedule_date: '2026-11-20', po_item_child_name: 'i7d62dicpp' }],
};

const BODIES = [
  ['purchase request (Material Request)', mrToBody],
  ['purchase order', poToBody],
  ['supplier invoice (Purchase Invoice)', piToBody],
  ['goods receipt (Purchase Receipt)', grToBody],
] as const;

describe('outbound procurement money docs carry the binding company', () => {
  it.each(BODIES)('%s body states the binding company verbatim', (_label, toBody) => {
    expect(toBody(RECORD, CTX)).toMatchObject({ company: 'PMO Smoke Co' });
  });

  // The binding company is ERPNext's primary key for the Company record: sent EXACTLY as configured.
  it.each(BODIES)('%s body never trims or rewrites the configured company', (_label, toBody) => {
    const body = toBody(RECORD, { ...CTX, config: { company: 'PT Contoh  Dua' } }) as Record<string, unknown>;
    expect(body.company).toBe('PT Contoh  Dua');
  });

  it.each(BODIES)('%s refuses a binding with NO company (commit-rejected, naming the setting)', (_label, toBody) => {
    for (const config of [{}, { company: undefined }, { company: null }, { company: '' }, { company: 42 }]) {
      try {
        toBody(RECORD, { ...CTX, config } as ErpCtx);
        expect.unreachable(`${_label} must refuse a binding that names no company`);
      } catch (err) {
        expect(err).toBeInstanceOf(AdapterError);
        expect((err as AdapterError).code).toBe('commit-rejected');
        expect((err as AdapterError).message).toMatch(/company/i);
        expect((err as AdapterError).message).toMatch(/Administration/i);
      }
    }
  });

  it.each(['purchase-request', 'purchase-order', 'purchase-invoice', 'goods-receipt'] as const)(
    'a %s create with no configured company never reaches ERPNext',
    async (kind) => {
      const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
      const adapter = createErpAdapter({
        client: { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' },
        doctypeBodies: DOCTYPE_BODIES,
        ctx: { refs: { supplier: 'Spike Supplier', po: 'PUR-ORD-2026-00001' }, config: {} },
      });
      await expect(adapter.commit({
        domain: 'procurement', operation: 'create',
        record: { ...RECORD, erp_doc_kind: kind },
      })).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringMatching(/company/i) });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});
