/**
 * Odoo's harness for the shared contract suites (ECA §6.2): drives the SHIPPED Odoo adapter code over the in-memory
 * JSON-2 fake and answers in PMO terms. `bringIn` keeps its own reference store (see its note); the shipped apply is
 * proved by pgTAP `odoo_party_adoption`.
 */
import { pickPartyCandidate, proposeMatches } from '../connect/match.ts';
import type { MasterKind, NormalisedMaster } from '../connect/types.ts';
import type { ConnectHarness, ErpHarness, ErpPartyInput, InboundInvoiceDoc, PartyMatchResult, PmoPartyCandidate } from '../contractSuite/harness.ts';
import type { AdapterCommand, CommandResult } from '../contract.ts';
import { assertNotPreCutover } from '../cutoverGate.ts';
import type { PurchaseOrderRevise } from '../purchaseOrderRevise.ts';
import { bindCall } from './client.ts';
import { createOdooSetupAdapter, LIST_PAGE, type OdooConnectCtx } from './connectAdapter.ts';
import { createFakeOdoo, type FakeOdoo } from './fakeOdoo.ts';
import { createOdooProcurementAdapter, readOrderLines, type PaymentFacts } from './procurementAdapter.ts';
import { readActuals } from './contract.ledger.harness.ts';
import { productionProcurement, productionPurchase } from './contract.production.harness.ts';
import type { BillCtx, BillInput } from './purchase/billBody.ts';
import { parseOdooExternalRef } from './purchase/anchors.ts';
import { PURCHASE_SPECS } from './purchase/feed.ts';
import type { OrderCtx, OrderInput } from './purchase/orderBody.ts';
import type { ReviseLine } from './purchase/orderRevise.ts';
import { planReceipt } from './purchase/receiptBody.ts';
import { buildInvoiceBody } from './revenue/invoiceBody.ts';
import { buildReceiptBody } from './revenue/receiptBody.ts';
import { normaliseItem, normaliseParty, normaliseProject } from './normalise.ts';
import { REVENUE_FEED_SPECS } from './revenue/feed.ts';
import { assertOdooRevenueCommandScope } from '../../../../../supabase/functions/adapter-dispatch/odooRevenueGate.ts';

const KEY = 'test-key';
const CTX: OdooConnectCtx = { companyId: 1, analyticPlanId: 7, unitMap: { sak: '11' } };
const MODEL: Partial<Record<MasterKind, string>> = { party: 'res.partner', project: 'account.analytic.account', item: 'product.product' };
const WRITES = new Set(['create', 'write']);
const ACCOUNTING = new Set(['account.account', 'account.tax', 'account.fiscal.position']);
const PURCHASE_ORDER_ID = '123e4567-e89b-42d3-a456-426614174000';
const PURCHASE_BILL_ID = '55555555-5555-4555-8555-555555555555';
const PURCHASE_PAYMENT_ID = 'dddddddd-dddd-4ddd-8ddd-000000001505';
const PURCHASE_CTX: OrderCtx = { companyId: 1, currencyId: 12, itemMap: { 'Cable tray': '55' }, unitMap: {}, costAccountId: '101', taxIds: [] };
const PURCHASE_ORDER: OrderInput = {
  vendor: 'Vendor:9', caseNumber: 'PRC-001', vendorReference: 'PO-77', expectedDate: '2026-12-01', projectIds: ['project-1'],
  lines: [{ name: 'Cable tray', quantity: 1, rate: 50 }],
};
const PURCHASE_BILL: BillInput = {
  vendor: 'Vendor:9', reference: 'INV-77', invoiceDate: '2026-12-05', projectIds: [],
  lines: [{ name: 'Cable tray', quantity: 1, rate: 50 }],
};
const PURCHASE_BILL_CTX: BillCtx = { companyId: 1, currencyId: 12, itemMap: PURCHASE_CTX.itemMap, unitMap: {}, costAccountId: null, taxes: [] };

/** An isolated Odoo fake wired to the shipped procurement adapter; each contract case starts with empty ERP state. */
function purchaseConnection() {
  const fake = createFakeOdoo({ key: KEY });
  fake.seed('product.product', [{ id: 55, name: 'Cable tray', supplier_taxes_id: [] }]);
  fake.seed('account.journal', [{ id: 7, name: 'Bank', type: 'bank', active: true, outbound_payment_method_line_ids: [31], company_id: 1 }]);
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: KEY, database: 'db1', fetchImpl: fake.fetch });
  let paymentBillRef: string | null = null;
  let reviseOrderId: number | null = null;
  let reviseLines: readonly ReviseLine[] = [];
  const adapter = createOdooProcurementAdapter({
    call,
    resolveOrder: async () => ({ input: PURCHASE_ORDER, ctx: PURCHASE_CTX }),
    resolveRevise: async () => {
      if (reviseOrderId === null) throw new Error('revision order is not initialized');
      return { orderId: reviseOrderId, lines: reviseLines, ctx: PURCHASE_CTX };
    },
    resolveBill: async () => ({ input: PURCHASE_BILL, ctx: PURCHASE_BILL_CTX }),
    resolvePayment: async (): Promise<PaymentFacts> => ({
      billRef: paymentBillRef, amount: '50.00', date: '2026-12-10', vendorPartnerId: 9, journalId: 7, companyCurrencyId: 12,
    }),
  });

  const orderCommand = (id = PURCHASE_ORDER_ID): AdapterCommand => ({
    domain: 'procurement', operation: 'create', idempotencyKey: `p9-order:${id}`,
    record: { id, erp_doc_kind: 'purchase-order', procurementId: 'case-1', amount: '50.00', date: '2026-12-01' },
  });
  const billCommand = (id = PURCHASE_BILL_ID): AdapterCommand => ({
    domain: 'procurement', operation: 'create', idempotencyKey: `p9-bill:${id}`,
    record: { id, erp_doc_kind: 'purchase-invoice', procurementId: 'case-1', amount: '50.00' },
  });
  const paymentCommand = (id = PURCHASE_PAYMENT_ID): AdapterCommand => ({
    domain: 'procurement', operation: 'create', idempotencyKey: `p9-payment:${id}`,
    record: { id, erp_doc_kind: 'payment', procurementId: 'case-1', invoiceId: 'invoice-1', paid_amount: '50.00', date: '2026-12-10' },
  });
  const pushOrder = (id = PURCHASE_ORDER_ID) => adapter.commit(orderCommand(id));
  const pushBill = async (id = PURCHASE_BILL_ID): Promise<CommandResult> => adapter.commit(billCommand(id));
  const pushPayment = async (billRef: string, id = PURCHASE_PAYMENT_ID) => {
    paymentBillRef = billRef;
    return adapter.commit(paymentCommand(id));
  };
  const callCount = () => fake.calls.length;

  return {
    fake, call, adapter, orderCommand, billCommand, paymentCommand, pushOrder, pushBill, pushPayment, callCount,
    setRevision: (orderId: number, lines: readonly ReviseLine[]) => { reviseOrderId = orderId; reviseLines = lines; },
    setPaymentBill: (billRef: string) => { paymentBillRef = billRef; },
  };
}

function commandFailure(error: unknown): { code: string; message: string } {
  const e = error as { code?: unknown; message?: unknown };
  return { code: typeof e.code === 'string' ? e.code : 'commit-rejected', message: typeof e.message === 'string' ? e.message : 'purchase command failed' };
}

/** A fresh fake Odoo; `armWrite` makes its next create/write fail with the given fault. */
function fakeConnection() {
  const fake = createFakeOdoo({ key: KEY });
  let armed: 'transport' | 'lost-response' | null = null;
  let reject = false;
  const touched = new Set<string>();
  const fetchImpl = ((url: string, init?: RequestInit) => {
    touched.add(String(url).split('/').slice(-2)[0]);   // /json/2/<model>/<method>
    if (reject && WRITES.has(String(url).split('/').pop()!)) {
      reject = false;
      return Promise.resolve(Response.json({ name: 'odoo.exceptions.ValidationError', message: 'The record is invalid' }, { status: 422 }));
    }
    if (armed && WRITES.has(String(url).split('/').pop()!)) { fake.failNext(armed); armed = null; }
    return fake.fetch(url, init);
  }) as typeof fetch;
  const adapter = createOdooSetupAdapter(bindCall({ baseUrl: 'https://odoo.example.test', apiKey: KEY, database: 'db1', fetchImpl }), CTX);
  return {
    fake, adapter, armWrite: (f: 'transport' | 'lost-response') => { armed = f; },
    rejectNextWrite: () => { reject = true; }, touchedAccounting: () => [...touched].some((m) => ACCOUNTING.has(m)),
  };
}

/** Place PMO-term masters in the fake Odoo (ids are Odoo's own; the suites never read them back). */
function load(fake: FakeOdoo, kind: MasterKind, rows: readonly Omit<NormalisedMaster, 'kind'>[]) {
  const base = 100 + fake.rows(MODEL[kind] ?? 'account.account').length;
  rows.forEach((r, i) => {
    const id = base + i;
    if (kind === 'party') {
      fake.seed('res.partner', [{ id, name: r.name, vat: r.taxId ?? false, ref: false, is_company: true, parent_id: false, active: r.active,
        supplier_rank: r.role === 'client' ? 0 : 1, customer_rank: r.role === 'client' ? 1 : 0 }]);
    } else if (kind === 'project') {
      fake.seed('account.analytic.account', [{ id, name: r.name, code: r.code ?? false, plan_id: [CTX.analyticPlanId, 'Projects'], active: r.active }]);
    } else if (kind === 'item') {
      fake.seed('product.product', [{ id, name: r.name, default_code: r.code ?? false, active: r.active }]);
    } else {
      fake.seed('account.account', [{ id, name: r.name, code: r.code ?? false, active: r.active }]);
    }
  });
}

/** The fake's rows read straight from its store, normalised: independent of the adapter's own listing. */
function documents(fake: FakeOdoo, kind: MasterKind): NormalisedMaster[] {
  const rows = fake.rows(MODEL[kind] ?? '');
  if (kind === 'party') return rows.flatMap((r) => normaliseParty(r));
  return rows.map(kind === 'project' ? normaliseProject : normaliseItem);
}

type TenantId = 'tenant-A' | 'tenant-B';
type ServiceRow = Record<string, unknown>;

/** A small service-role read model for the Odoo dispatch gate, with tenant ownership enforced by query predicates. */
function revenueServiceClient() {
  const rows: Record<string, ServiceRow[]> = {
    companies: [
      { id: 'customer-a', org_id: 'tenant-A' },
      { id: 'customer-b', org_id: 'tenant-B' },
    ],
    projects: [
      { id: 'project-a', org_id: 'tenant-A' },
      { id: 'project-b', org_id: 'tenant-B' },
    ],
    sales_invoices: [
      { id: 'invoice-a', org_id: 'tenant-A', customer_id: 'customer-a' },
      { id: 'invoice-b', org_id: 'tenant-B', customer_id: 'customer-b' },
    ],
    work_orders: [],
    external_project_bindings: [
      { org_id: 'tenant-A', project_id: 'project-a', external_tier: 'odoo', external_container_id: 'cost-a' },
      { org_id: 'tenant-B', project_id: 'project-b', external_tier: 'odoo', external_container_id: 'cost-b' },
    ],
    external_master_records: [
      { org_id: 'tenant-A', external_tier: 'odoo', kind: 'analytic_account', external_id: 'cost-a', active: true, tombstoned_at: null },
      { org_id: 'tenant-B', external_tier: 'odoo', kind: 'analytic_account', external_id: 'cost-b', active: true, tombstoned_at: null },
    ],
    external_refs: [
      { org_id: 'tenant-A', domain: 'revenue', external_tier: 'odoo', pmo_record_id: 'invoice-a', external_record_id: 'account.move:701' },
      { org_id: 'tenant-B', domain: 'revenue', external_tier: 'odoo', pmo_record_id: 'invoice-b', external_record_id: 'account.move:702' },
    ],
  };
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        async maybeSingle() {
          const data = (rows[table] ?? []).find((row) => filters.every(([column, value]) => row[column] === value)) ?? null;
          return { data, error: null };
        },
      };
      return query;
    },
  };
}

const ownedId = (table: string, owner: 'A' | 'B' | 'nobody' | undefined) =>
  owner === undefined ? undefined : owner === 'nobody' ? `missing-${table}` : `${table}-${owner.toLowerCase()}`;

/**
 * The Odoo-side revenue checks that are not in the shared interface (SD-5, no version bump): a fake Odoo, a bound client
 * and the invoice and receipt builders, so the claim and receipt flows run against the fake.
 */
export function createOdooRevenueHarness() {
  const fake = createFakeOdoo({ key: KEY });
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: KEY, database: 'db1', fetchImpl: fake.fetch });
  return { fake, call, buildInvoiceBody, buildReceiptBody };
}

const pending = (workflow: string, issue: number) => new Error(`odoo ${workflow} is pending (#${issue})`);
const unavailable = (workflow: string) => new Error(`odoo ${workflow} is unavailable: Odoo Community has no budget object`);

export function createOdooHarness(): ErpHarness {
  // The suite's opaque party ids → stable Odoo partner ids, so a repeat run sees the same partner.
  const partnerIds = new Map<string, number>();
  const partnerId = (externalId: string) => partnerIds.get(externalId) ?? partnerIds.set(externalId, partnerIds.size + 1).get(externalId)!;

  return {
    tier: 'odoo',

    async matchParty(party: ErpPartyInput, existing: readonly PmoPartyCandidate[]): Promise<PartyMatchResult> {
      const { fake, adapter } = fakeConnection();
      const id = partnerId(party.externalId);
      fake.seed('res.partner', [{
        id, name: party.name, vat: party.taxId ?? false, ref: false, is_company: true, parent_id: false,
        supplier_rank: party.role === 'vendor' ? 1 : 0, customer_rank: party.role === 'client' ? 1 : 0,
      }]);
      if (party.internal) fake.seed('res.company', [{ id: 1, name: party.name, partner_id: [id, party.name] }]);
      const { rows } = await adapter.listMasters('party', null);
      const row = rows.find((r) => r.role === party.role)!;
      if (row.internal) return { outcome: 'refused' };
      const pick = pickPartyCandidate(row.taxId, existing);
      if (pick.outcome === 'review') return { outcome: 'review' };
      return pick.outcome === 'link'
        ? { outcome: 'link', pmoId: pick.candidate.pmoId, externalId: row.externalId, role: party.role }
        : { outcome: 'bring-in', externalId: row.externalId, role: party.role };
    },

    /**
     * Lists Odoo's partners through the shipped adapter, matches them with the shared matcher, and applies the outcomes to a
     * store that refuses duplicates the way `external_refs` does (the reference is claimed first, so a lost race writes no
     * company: `apply_connect_bring_in`). The database half is proved by pgTAP; this proves the listing, the matching and
     * that a repeat or a second reader leaves one company and one reference.
     */
    async bringIn(parties, existing, runs = 1) {
      const companies = new Set<string>(existing.map((c) => c.pmoId));
      const refs = new Map<string, string>();   // Odoo external id -> PMO company id
      const linked: string[] = [];
      let review = 0;
      for (let i = 0; i < runs; i += 1) {
        const { fake, adapter } = fakeConnection();
        parties.forEach((p) => fake.seed('res.partner', [{ id: partnerId(p.externalId), name: p.name, vat: p.taxId ?? false, ref: false,
          is_company: true, parent_id: false, supplier_rank: p.role === 'vendor' ? 1 : 0, customer_rank: p.role === 'client' ? 1 : 0 }]));
        const { rows } = await adapter.listMasters('party', null);
        const pmo = existing.map((c) => ({ id: c.pmoId, name: parties[0].name, role: parties[0].role, taxId: c.taxId }));
        let reviewed = 0;
        for (const o of proposeMatches('party', pmo, rows)) {
          if (o.outcome === 'review') reviewed += 1;
          else if (o.outcome === 'bring-in') {
            if (refs.has(o.externalId)) continue;   // reconciled: the winner's company stays
            const id = `company-${o.externalId}`;
            refs.set(o.externalId, id); companies.add(id);
          } else if (o.outcome === 'link') {
            if (!refs.has(o.externalId) && ![...refs.values()].includes(o.pmoId)) refs.set(o.externalId, o.pmoId);
            if (!linked.includes(o.pmoId)) linked.push(o.pmoId);
          }
        }
        review = reviewed;
      }
      return { companies: companies.size, refs: refs.size, linked, review };
    },

    pushBudget() { return Promise.reject(unavailable('budget.unowned-occupant')); },
    pushPurchase: productionPurchase,
    async pushPurchaseStep(step, beforeCutover) {
      const purchase = purchaseConnection();
      const record = {
        id: '223e4567-e89b-42d3-a456-426614174000',
        erp_doc_kind: step,
        procurementId: 'case-1',
        ...(step === 'payment' ? { invoiceId: 'invoice-1' } : {}),
      };
      try {
        await assertNotPreCutover({
          rpc: async () => ({ data: beforeCutover === 'unknown' ? null : beforeCutover, error: null }),
        }, { domain: 'procurement', record });
        if (step === 'goods-receipt') {
          const order = await purchase.pushOrder();
          const orderId = parseOdooExternalRef('purchase.order', order.externalRecordId);
          if (orderId === null) throw new Error('Odoo order reference was unreadable');
          const plan = await planReceipt(orderId, await readOrderLines(purchase.call, orderId), undefined, PURCHASE_CTX.itemMap);
          await purchase.adapter.commit({
            domain: 'procurement', operation: 'create', idempotencyKey: 'p9-receipt',
            record: { ...record, erp_doc_kind: 'goods-receipt', odooReceipt: plan, receiptDigest: plan.digest },
          });
        } else {
          const bill = await purchase.pushBill();
          if (step === 'payment') await purchase.pushPayment(bill.externalRecordId);
        }
        return { outcome: 'pushed', erpCalls: purchase.callCount() };
      } catch (error) {
        const failure = commandFailure(error);
        return { outcome: 'refused', ...failure, erpCalls: purchase.callCount() };
      }
    },
    pushTimesheet() { return Promise.reject(pending('timesheet.push', 1510)); },
    pushProcurement: productionProcurement,
    async pushRevenue(s) {
      const record: Record<string, unknown> = {
        erp_doc_kind: s.doc === 'receipt' ? 'incoming-payment' : 'sales-invoice',
      };
      const customerId = ownedId('customer', s.customer);
      const projectId = ownedId('project', s.project);
      const salesInvoiceId = ownedId('invoice', s.salesInvoice);
      if (customerId) record.customerId = customerId;
      if (projectId) record.projectId = projectId;
      if (salesInvoiceId) record.salesInvoiceId = salesInvoiceId;
      const command = { domain: 'revenue', operation: 'create', idempotencyKey: 'shared-contract', record } as AdapterCommand;
      try {
        await assertOdooRevenueCommandScope(revenueServiceClient() as never, `tenant-${s.caller}` as TenantId, command);
        return { outcome: 'accepted', erpCalls: 0 };
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'commit-rejected';
        return { outcome: 'refused', code, erpCalls: 0 };
      }
    },
    async mapInboundInvoice(doc: InboundInvoiceDoc) {
      const row = REVENUE_FEED_SPECS['sales-invoice'].parse({
        id: 1, name: doc.number, move_type: 'out_invoice', state: 'posted', partner_id: [41, doc.client],
        invoice_date: doc.date, ref: doc.poRef ?? false, currency_id: [1, doc.currency],
        amount_total: Number(doc.total), amount_untaxed: Number(doc.total) - Number(doc.taxAmount), amount_tax: Number(doc.taxAmount), amount_residual: Number(doc.total),
        write_date: `${doc.date} 00:00:00`,
      });
      if (!row) throw new Error('Odoo invoice did not produce a readable pair candidate');
      return { ...row };
    },
    pushBudgetVersion() { return Promise.reject(unavailable('budget.push')); },
    readActuals,
    classifyPayment(direction) {
      const fields = {
        received: ['inbound', 'customer'], paid: ['outbound', 'supplier'], unrecognised: ['transfer', 'customer'],
        blank: ['', ''], absent: [undefined, undefined],
      } as const;
      const [paymentType, partnerType] = fields[direction];
      const raw = {
        id: 1, name: 'PAY/1', state: 'paid', partner_id: [41, 'Client'], payment_type: paymentType,
        partner_type: partnerType, amount: 100, date: '2026-11-01', currency_id: [1, 'IDR'], write_date: '2026-11-02 10:00:00',
      };
      if (REVENUE_FEED_SPECS['incoming-payment'].parse(raw)) return { kind: 'receipt', domain: 'revenue', table: 'incoming_payments' };
      // The purchase feed selects vendor payments by its search filter, so a row belongs to it only when the filter holds.
      const terms = PURCHASE_SPECS.payment.filter as Array<[string, string, unknown]>;
      if (terms.some(([, op]) => op !== '=')) throw new Error('classifyPayment evaluates "=" terms only; extend it for the new operator');
      const outbound = terms.every(([field, , value]) => (raw as Record<string, unknown>)[field] === value);
      return outbound && PURCHASE_SPECS.payment.parse(raw) ? { kind: 'vendor-payment', domain: 'procurement', table: 'payments' } : { kind: 'skipped' };
    },
    async mirrorPurchases(docs) {
      const latest = new Map<string, { kind: 'purchase-order' | 'bill'; reference: string; total: string; modifiedAt: string }>();
      docs.forEach((doc, i) => {
        const modifiedAt = doc.modifiedAt.length === 10 ? `${doc.modifiedAt} 00:00:00` : doc.modifiedAt;
        const row = doc.kind === 'bill'
          ? PURCHASE_SPECS.bill.parse({
              id: i + 1, name: doc.reference, state: 'posted', move_type: 'in_invoice', partner_id: [9, doc.supplier],
              invoice_date: modifiedAt.slice(0, 10), invoice_date_due: modifiedAt.slice(0, 10), ref: doc.reference,
              currency_id: [12, 'IDR'], amount_total: Number(doc.total), amount_untaxed: Number(doc.total), amount_residual: Number(doc.total),
              invoice_origin: false, write_date: modifiedAt, _taxLines: [], _analytic: [],
            })
          : PURCHASE_SPECS['purchase-order'].parse({
              id: i + 1, name: doc.reference, state: 'purchase', partner_id: [9, doc.supplier], date_order: modifiedAt,
              currency_id: [12, 'IDR'], amount_total: Number(doc.total), amount_untaxed: Number(doc.total), write_date: modifiedAt, _analytic: [],
            });
        if (!row || typeof row.attrs.amount_total !== 'string') return;
        const parsed = { kind: doc.kind, reference: row.name, total: row.attrs.amount_total, modifiedAt: row.source_write_date };
        const key = `${parsed.kind}:${parsed.reference}`;
        if (!latest.has(key) || latest.get(key)!.modifiedAt < parsed.modifiedAt) latest.set(key, parsed);
      });
      return [...latest.values()].map(({ kind, reference, total }) => ({ kind, reference, total }));
    },

    revise() {
      const purchase = purchaseConnection();
      let orderId: number | null = null;
      return {
        async post(revision: PurchaseOrderRevise) {
          if (orderId === null) {
            const order = await purchase.pushOrder(revision.poId);
            orderId = parseOdooExternalRef('purchase.order', order.externalRecordId);
            if (orderId === null) throw new Error('Odoo order reference was unreadable');
          }
          purchase.setRevision(orderId, revision.lines);
          const result = await purchase.adapter.commit({
            domain: 'procurement', operation: 'revise' as never, idempotencyKey: revision.key,
            record: { id: revision.key, erp_doc_kind: 'purchase-order', poId: revision.poId, revision: revision.revision },
          });
          return { externalId: result.externalRecordId };
        },
        documents() {
          return purchase.fake.rows('ir.model.data').flatMap((row) => {
            const match = /^porev_([0-9a-f_]{36})_([1-9][0-9]{0,5})$/.exec(String(row.name));
            if (!match || typeof row.res_id !== 'number') return [];
            const poId = match[1].replaceAll('_', '-');
            return [{ externalId: `purchase.order:${row.res_id}`, key: `porev:${poId}:${match[2]}` }];
          });
        },
        failNextWrite: (fault) => purchase.fake.failNext(fault),
      };
    },

    connect(): ConnectHarness {
      const { fake, adapter, armWrite, rejectNextWrite, touchedAccounting } = fakeConnection();
      return {
        adapter, documents: (kind) => documents(fake, kind), failNextWrite: armWrite, rejectNextWrite, touchedAccounting, pageSize: LIST_PAGE,
        load: (kind, rows) => load(fake, kind, rows),
        calls: () => ({ reads: fake.calls.filter((c) => !WRITES.has(c.method)).length, writes: fake.calls.filter((c) => WRITES.has(c.method)).length }),
      };
    },
  };
}
