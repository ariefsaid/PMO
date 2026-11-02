/**
 * Odoo's harness for the shared contract suites (ECA §6.2): drives the SHIPPED Odoo adapter code over the in-memory
 * JSON-2 fake and answers in PMO terms. No behaviour lives here except `bringIn`, which keeps its own reference store (see its note): the shipped apply is proved by pgTAP `odoo_party_adoption`.
 */
import { pickPartyCandidate, proposeMatches } from '../connect/match.ts';
import type { MasterKind, NormalisedMaster } from '../connect/types.ts';
import type { ConnectHarness, ErpHarness, ErpPartyInput, PartyMatchResult, PmoPartyCandidate } from '../contractSuite/harness.ts';
import { bindCall } from './client.ts';
import { createOdooSetupAdapter, LIST_PAGE, type OdooConnectCtx } from './connectAdapter.ts';
import { createFakeOdoo, type FakeOdoo } from './fakeOdoo.ts';
import { procurementPreflight } from './purchase/preflight.ts';
import { normaliseItem, normaliseParty, normaliseProject } from './normalise.ts';

const KEY = 'test-key';
const CTX: OdooConnectCtx = { companyId: 1, analyticPlanId: 7, unitMap: { sak: '11' } };
const MODEL: Partial<Record<MasterKind, string>> = { party: 'res.partner', project: 'account.analytic.account', item: 'product.product' };
const WRITES = new Set(['create', 'write']);

/** A fresh fake Odoo; `armWrite` makes its next create/write fail with the given fault. */
function fakeConnection() {
  const fake = createFakeOdoo({ key: KEY });
  let armed: 'transport' | 'lost-response' | null = null;
  const fetchImpl = ((url: string, init?: RequestInit) => {
    if (armed && WRITES.has(String(url).split('/').pop()!)) { fake.failNext(armed); armed = null; }
    return fake.fetch(url, init);
  }) as typeof fetch;
  const adapter = createOdooSetupAdapter(bindCall({ baseUrl: 'https://odoo.example.test', apiKey: KEY, database: 'db1', fetchImpl }), CTX);
  return { fake, adapter, armWrite: (f: 'transport' | 'lost-response') => { armed = f; } };
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
    pushRevenue() { return Promise.reject(pending('invoice.push', 1506)); },
    pushBudgetVersion() { return Promise.reject(pending('budget.push', 1507)); },
    readActuals() { return Promise.reject(pending('actuals.read', 1507)); },
    classifyPayment() { throw pending('receipt.read', 1506); },
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
      const { fake, adapter, armWrite } = fakeConnection();
      return {
        adapter, documents: (kind) => documents(fake, kind), failNextWrite: armWrite, pageSize: LIST_PAGE,
        load: (kind, rows) => load(fake, kind, rows),
        calls: () => ({ reads: fake.calls.filter((c) => !WRITES.has(c.method)).length, writes: fake.calls.filter((c) => WRITES.has(c.method)).length }),
      };
    },
  };
}
