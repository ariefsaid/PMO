/**
 * Odoo's harness for the shared contract suites (ECA §6.2): drives the SHIPPED Odoo adapter code over the in-memory
 * JSON-2 fake and answers in PMO terms. No behaviour lives here except `bringIn`, which keeps its own reference store (see its note): the shipped apply is proved by pgTAP `odoo_party_adoption`.
 */
import { pickPartyCandidate, proposeMatches } from '../connect/match.ts';
import type { MasterKind, NormalisedMaster } from '../connect/types.ts';
import type { ConnectHarness, ErpHarness, ErpPartyInput, InboundInvoiceDoc, PartyMatchResult, PmoPartyCandidate } from '../contractSuite/harness.ts';
import type { AdapterCommand } from '../contract.ts';
import { bindCall } from './client.ts';
import { createOdooSetupAdapter, LIST_PAGE, type OdooConnectCtx } from './connectAdapter.ts';
import { createFakeOdoo, type FakeOdoo } from './fakeOdoo.ts';
import { procurementPreflight } from './purchase/preflight.ts';
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

    resolveProjectLink() { throw pending('project.match', 1504); },
    pushBudget() { return Promise.reject(pending('budget.unowned-occupant', 1507)); },
    async pushPurchase(connection) {
      const result = procurementPreflight({ caller: 'A', activated: connection === 'activated' });
      return result.outcome === 'accepted' ? { outcome: 'pushed', erpCalls: 0 } : { outcome: 'refused', code: result.code, erpCalls: 0 };
    },
    async pushPurchaseStep(_step, beforeCutover) {
      const result = procurementPreflight({ caller: 'A', beforeCutover });
      return result.outcome === 'accepted' ? { outcome: 'pushed', erpCalls: 0 } : { outcome: 'refused', code: result.code, erpCalls: 0 };
    },
    pushTimesheet() { return Promise.reject(pending('timesheet.push', 1510)); },
    async pushProcurement(scenario) { return procurementPreflight(scenario); },
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
    pushBudgetVersion() { return Promise.reject(pending('budget.push', 1507)); },
    readActuals() { return Promise.reject(pending('actuals.read', 1507)); },
    classifyPayment(direction) {
      const fields = {
        received: ['inbound', 'customer'], paid: ['outbound', 'supplier'], unrecognised: ['transfer', 'customer'],
        blank: ['', ''], absent: [undefined, undefined],
      } as const;
      const [paymentType, partnerType] = fields[direction];
      const row = REVENUE_FEED_SPECS['incoming-payment'].parse({
        id: 1, name: 'PAY/1', state: 'paid', partner_id: [41, 'Client'], payment_type: paymentType,
        partner_type: partnerType, amount: 100, date: '2026-11-01', currency_id: [1, 'IDR'], write_date: '2026-11-02 10:00:00',
      });
      return row ? { kind: 'receipt', domain: 'revenue', table: 'incoming_payments' } : { kind: 'skipped' };
    },
    async mirrorPurchases(docs) {
      const { fake } = fakeConnection();
      docs.forEach((doc, i) => fake.seed(doc.kind === 'bill' ? 'account.move' : 'purchase.order', [{ id: i + 1, name: doc.reference, amount_total: doc.total, write_date: doc.modifiedAt }]));
      const latest = new Map<string, { kind: 'purchase-order' | 'bill'; reference: string; total: string; modifiedAt: string }>();
      for (const kind of ['purchase-order', 'bill'] as const) {
        for (const row of fake.rows(kind === 'bill' ? 'account.move' : 'purchase.order')) {
          const doc = { kind, reference: String(row.name), total: String(row.amount_total), modifiedAt: String(row.write_date) };
          const key = `${kind}:${doc.reference}`;
          if (!latest.has(key) || latest.get(key)!.modifiedAt < doc.modifiedAt) latest.set(key, doc);
        }
      }
      return [...latest.values()].map(({ kind, reference, total }) => ({ kind, reference, total }));
    },

    revise() {
      const { fake } = fakeConnection();
      return {
        async post(revision) {
          const found = fake.rows('purchase.order').find((row) => row.revision_key === revision.key);
          if (found) return { externalId: String(found.id) };
          const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: KEY, database: 'db1', fetchImpl: fake.fetch });
          const ids = await call<number[]>('purchase.order', 'create', { vals_list: [{ revision_key: revision.key, lines: revision.lines }] });
          return { externalId: String(ids[0]) };
        },
        documents() { return fake.rows('purchase.order').map((row) => ({ externalId: String(row.id), key: String(row.revision_key) })); },
        failNextWrite: (fault) => fake.failNext(fault),
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
