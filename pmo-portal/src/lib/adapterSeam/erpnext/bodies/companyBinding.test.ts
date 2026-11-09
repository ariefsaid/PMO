/**
 * Which COMPANY an outbound money body lands in.
 *
 * ERPNext files a created document under the company STATED ON THE BODY, else under the integration
 * user's default company. The org binding names exactly one company
 * (`external_org_bindings.config.company`), and every company-scoped mirror feed scopes its reads to
 * that same company. A body that omits it therefore lands in the wrong company on any ERP that holds
 * more than one (ERPNext refuses the create with "Project ... does not belong to the Company ..." when
 * a project is set, and silently files elsewhere when it is not) — and the document can never mirror
 * back, so the PMO record never reaches its pushed state.
 *
 * Fail closed like `paymentEntry`'s account defaults: a binding that names no company refuses BEFORE
 * any ERP call, with the dedicated non-retryable `erp-company-unset` code (so the push surfaces can
 * name the remedy instead of offering a Retry that can only fail).
 *
 * ⚑ Review r8 I-1: an AMEND builds this body BEFORE the predecessor is cancelled. The body is the point
 * of no return's gate — building it after the cancel refused a replacement onto an already-cancelled
 * ERP document ("a cancelled tombstone with no replacement").
 */
import { describe, expect, it, vi } from 'vitest';
import { AdapterError, type PmoRecord } from '../../contract.ts';
import { createErpAdapter } from '../adapter.ts';
import { isCompanyScopedKind } from '../companyScope.ts';
import { DOCTYPE_BODIES } from '../doctypeBodies.ts';
import { DOCTYPE_REGISTRY, type ErpCtx, type ErpDocKind } from '../doctypeRegistry.ts';
import { grToBody } from './goodsReceipt.ts';
import { peReceiveToBody } from './incomingPayment.ts';
import { imprestTransferToBody } from './imprestTransfer.ts';
import { mrToBody } from './materialRequest.ts';
import { piToBody } from './purchaseInvoice.ts';
import { poToBody } from './purchaseOrder.ts';
import { rfqToBody } from './rfq.ts';
import { supplierQuotationToBody } from './supplierQuotation.ts';
import { tsToBody } from './timesheet.ts';

const COMPANY = 'PMO Smoke Co';

const ITEMS = [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 100000, schedule_date: '2026-11-20', po_item_child_name: 'i7d62dicpp' }];

const RECORD: PmoRecord = { id: 'pmo-1', items: ITEMS };

const CTX: ErpCtx = {
  refs: { supplier: 'Spike Supplier', po: 'PUR-ORD-2026-00001' },
  config: { company: COMPANY },
};

const TS_RECORD: PmoRecord = {
  id: 'ts-1',
  entries: [{ project_id: 'p-a', entry_date: '2026-11-20', hours: '2.5' }],
};
const TS_CTX: ErpCtx = {
  refs: { employee: 'HR-EMP-00001', 'project:p-a': 'PROJ-0001' },
  config: { company: COMPANY, default_activity_type: 'Execution', timesheet_day_start: '09:00:00' },
};

const RECEIPT_RECORD: PmoRecord = { id: 'ip-1', paid_amount: '1000.00', received_amount: '1000.00' };
const RECEIPT_CTX: ErpCtx = {
  refs: { customer: 'Demo Customer' },
  config: { company: COMPANY, default_receivable_account: 'Debtors - DEMO', default_cash_account: 'Cash - DEMO' },
};

const IMPREST_RECORD: PmoRecord = {
  id: '15150000-0000-0000-0000-0000000000e3', erp_doc_kind: 'imprest-transfer', company: COMPANY,
  idempotency_key: 'impt:15150000-0000-0000-0000-0000000000e3:1791367200123', from_account: 'Bank - PSC',
  to_account: 'Site Cash F - PSC', amount: '800000.00', posting_date: '2026-11-01', reference: 'REP-2611010003',
};

/** Every company-scoped body that states the BINDING's company, with the record + context it needs. */
const BODIES: ReadonlyArray<{ kind: ErpDocKind; toBody: (rec: PmoRecord, ctx: ErpCtx) => unknown; record: PmoRecord; ctx: ErpCtx }> = [
  { kind: 'purchase-request', toBody: mrToBody, record: RECORD, ctx: CTX },
  { kind: 'rfq', toBody: rfqToBody, record: RECORD, ctx: CTX },
  { kind: 'quotation', toBody: supplierQuotationToBody, record: RECORD, ctx: CTX },
  { kind: 'purchase-order', toBody: poToBody, record: RECORD, ctx: CTX },
  { kind: 'goods-receipt', toBody: grToBody, record: RECORD, ctx: CTX },
  { kind: 'purchase-invoice', toBody: piToBody, record: RECORD, ctx: CTX },
  { kind: 'timesheet', toBody: tsToBody, record: TS_RECORD, ctx: TS_CTX },
  { kind: 'incoming-payment', toBody: peReceiveToBody, record: RECEIPT_RECORD, ctx: RECEIPT_CTX },
  { kind: 'imprest-transfer', toBody: imprestTransferToBody, record: IMPREST_RECORD, ctx: { refs: {}, config: { company: COMPANY } } },
];

const labelOf = (b: (typeof BODIES)[number]): string => b.kind;

describe('outbound company-scoped money docs carry the binding company', () => {
  it.each(BODIES)('$kind body states the binding company verbatim', (b) => {
    expect(b.toBody(b.record, b.ctx)).toMatchObject({ company: COMPANY });
  });

  // The binding company is ERPNext's primary key for the Company record: sent EXACTLY as configured.
  it.each(BODIES)('$kind body never trims or rewrites the configured company', (b) => {
    const body = b.toBody(b.record, { ...b.ctx, config: { ...b.ctx.config, company: 'PT Contoh  Dua' } }) as Record<string, unknown>;
    expect(body.company).toBe('PT Contoh  Dua');
  });

  it.each(BODIES)('$kind refuses a binding with NO company (erp-company-unset, naming the setting)', (b) => {
    for (const config of [{}, { company: undefined }, { company: null }, { company: '' }, { company: 42 }]) {
      const { company: _dropped, ...withoutCompany } = b.ctx.config;
      try {
        b.toBody(b.record, { ...b.ctx, config: { ...withoutCompany, ...config } } as ErpCtx);
        expect.unreachable(`${labelOf(b)} must refuse a binding that names no company`);
      } catch (err) {
        expect(err).toBeInstanceOf(AdapterError);
        expect((err as AdapterError).code).toBe('erp-company-unset');
        expect((err as AdapterError).message).toMatch(/company/i);
        expect((err as AdapterError).message).toMatch(/Administration/i);
      }
    }
  });

  it.each(['purchase-request', 'rfq', 'quotation', 'purchase-order', 'goods-receipt', 'purchase-invoice'] as const)(
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
      })).rejects.toMatchObject({ code: 'erp-company-unset', message: expect.stringMatching(/company/i) });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  // ⚑ I-1 (review r8): the amend's replacement body is built BEFORE the cancel, so a refusal leaves the
  // live ERP document untouched. Before this, the cancel landed first and the refusal stranded a
  // cancelled tombstone with no replacement — the HIGH-1 window `commitAmend` exists to keep closed.
  it.each(['purchase-order', 'purchase-invoice'] as const)(
    'I-1 an edit of a submitted %s with no configured company refuses BEFORE the cancel — no PUT, no POST',
    async (kind) => {
      const calls: Array<{ method: string; url: string }> = [];
      const fetchImpl = async (url: string, init?: RequestInit) => {
        calls.push({ method: init?.method ?? 'GET', url });
        // the routeEdit probe: the document is submitted, so the edit routes to amend
        return new Response(JSON.stringify({ name: 'ACC-DOC-2026-00001', docstatus: 1 }), { status: 200 });
      };
      const adapter = createErpAdapter({
        client: { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' },
        doctypeBodies: DOCTYPE_BODIES,
        ctx: { refs: { supplier: 'Spike Supplier', po: 'PUR-ORD-2026-00001' }, config: {} },
      });
      await expect(adapter.commit({
        domain: 'procurement', operation: 'update',
        record: { ...RECORD, erp_doc_kind: kind, externalRecordId: 'ACC-DOC-2026-00001' },
        idempotencyKey: 'idem-amend-nocompany',
      })).rejects.toMatchObject({ code: 'erp-company-unset' });
      // ONLY the docstatus read: the live ERP document was never cancelled and no replacement was POSTed.
      expect(calls.map((c) => c.method)).toEqual(['GET']);
    },
  );

  it.each(['purchase-request', 'purchase-order'] as const)(
    'I-1 a transition amend of a %s with no configured company refuses BEFORE the cancel',
    async (kind) => {
      const calls: Array<{ method: string; url: string }> = [];
      const fetchImpl = async (url: string, init?: RequestInit) => {
        calls.push({ method: init?.method ?? 'GET', url });
        return new Response(JSON.stringify({ name: 'ACC-DOC-2026-00001', docstatus: 1 }), { status: 200 });
      };
      const adapter = createErpAdapter({
        client: { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' },
        doctypeBodies: DOCTYPE_BODIES,
        ctx: { refs: { supplier: 'Spike Supplier', po: 'PUR-ORD-2026-00001' }, config: {} },
      });
      await expect(adapter.commit({
        domain: 'procurement', operation: 'transition',
        record: { ...RECORD, erp_doc_kind: kind, externalRecordId: 'ACC-DOC-2026-00001', verb: 'amend' },
        idempotencyKey: 'idem-amend-nocompany',
      })).rejects.toMatchObject({ code: 'erp-company-unset' });
      expect(calls).toEqual([]);
    },
  );
});

/**
 * The company-scoped kinds whose body does NOT read the binding company, each with the reason. This is
 * the completeness half of the guard (the same discipline as `companyScope.test.ts`'s exhaustive
 * exemption list): a `Set`/registry test fails silently by OMISSION, so adding a company-scoped kind
 * must force an explicit decision here rather than quietly re-open the misfiling defect.
 */
const KINDS_NOT_STATING_BINDING_COMPANY: ReadonlyArray<[ErpDocKind, string]> = [
  ['sales-invoice', 'P3a spike-frozen shape: ERP derives the company from the receivable account the dispatch resolves'],
  ['payment', 'both accounts come from the binding, so ERPNext derives the company from them (R9 §2)'],
  ['budget', 'states `config.company` through the budget body\'s own `requireString` guard (bodies/budget.ts)'],
  ['employee', 'READ-ONLY kind: `toBody` always throws, `fromDoc` is the only function ever invoked (FR-TSP-093)'],
  ['expense-journal', 'carries the company on the resolved posting command (PMO posting truth), not the binding config'],
  ['expense-payment', 'carries the company on the resolved posting command'],
  ['expense-receipt', 'carries the company on the resolved posting command'],
];

describe('company-scoped kinds are classified: they state the binding company, or are reasoned here', () => {
  it('no company-scoped kind is silently unclassified', () => {
    const exempt = new Set<ErpDocKind>(KINDS_NOT_STATING_BINDING_COMPANY.map(([kind]) => kind));
    const covered = new Set<ErpDocKind>(BODIES.map((b) => b.kind));
    const unclassified = (Object.keys(DOCTYPE_REGISTRY) as ErpDocKind[])
      .filter((kind) => isCompanyScopedKind(kind) && !covered.has(kind) && !exempt.has(kind));
    expect(unclassified).toEqual([]);
  });

  it('every reason names a real rationale, not a placeholder', () => {
    for (const [kind, reason] of KINDS_NOT_STATING_BINDING_COMPANY) {
      expect(isCompanyScopedKind(kind)).toBe(true);
      expect(reason.length).toBeGreaterThan(30);
    }
  });
});
