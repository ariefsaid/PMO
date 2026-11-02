/**
 * ERPNext's harness for the shared contract suites (spec §6.2): drives the SHIPPED ERPNext code with the
 * transport mocked and answers in PMO terms. No behaviour lives here; it only translates.
 */
import { AppError } from '../../appError.ts';
import type {
  ConnectHarness,
  BudgetPushResult, BudgetPushScenario, ErpHarness, ErpPartyInput, PartyMatchResult, PmoPartyCandidate,
  ProjectLinkResult, PushBeforeConnectionResult, TransferHarness,
} from '../contractSuite/harness.ts';
import type { ImprestTransfer } from '../imprestTransfer.ts';
import { createErpAdapter } from './adapter.ts';
import { assertNotPreCutover } from '../cutoverGate.ts';
import { imprestTransferToBody } from './bodies/imprestTransfer.ts';
import { probeErpByAnchorKey } from './recoveryProbe.ts';
import { expenseJournalFromDoc } from './bodies/expenseJournal.ts';
import { budgetAccountIdentity } from './budgetAccountIdentity.ts';
import { DOCTYPE_BODIES } from './doctypeBodies.ts';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { createErpnextConnectAdapter, ERP_CONNECT_PAGE } from './connectAdapter.ts';
import { fakeErp } from './fakeErp.ts';
import { onboardParties } from './onboarding.ts';
import { adoptParty } from './partyAdopt.ts';
import { invertProjectMap } from './projectMap.ts';
import { createPushAndReadHarness } from './contract.pushAndRead.harness.ts';

const ORG = 'org';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const ACTIVATED_BINDING = {
  site_url: 'https://erp.test', version_major: 16, activated_at: '2026-01-01T00:00:00Z',
  config: { company: 'Test Co', project_map: { project: 'ERP-PROJ' } },
};

/** Counts every call and every write that reaches the (fake) ERP. */
function erpTransport(grain: Array<Record<string, unknown>> = [], budget?: { account: string; fiscalYear: string }) {
  const stats = { calls: 0, writes: 0 };
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    stats.calls += 1;
    const method = init?.method ?? 'GET';
    if (method === 'POST' || method === 'PUT') stats.writes += 1;
    if (method === 'POST') return new Response(JSON.stringify({ data: { name: 'BUD-1' } }), { status: 200 });
    if (String(url).includes('filters=')) return new Response(JSON.stringify({ data: grain }), { status: 200 });
    return new Response(JSON.stringify({ data: {
      name: 'BUD-1', docstatus: 1, modified: '2026-01-01', from_fiscal_year: budget?.fiscalYear, to_fiscal_year: budget?.fiscalYear,
      account: budget?.account, company: 'Test Co', project: 'ERP-PROJ', budget_amount: '50000.00',
    } }), { status: 200 });
  }) as typeof fetch;
  return { stats, fetchImpl };
}

/** A fake service client answering only what dispatch resolution reads. */
function serviceClient(binding: unknown, categoryAccount = 'Salary'): DispatchServiceClient {
  return { from(table: string) { return { select() {
    const chain = {
      eq() { return chain; }, order() { return chain; }, limit() { return chain; }, gt() { return chain; },
      maybeSingle: async () => ({ data: table === 'external_org_bindings' ? binding : table === 'projects' || table === 'procurements' ? { org_id: ORG } : null, error: null }),
      then(resolve: (value: unknown) => unknown) {
        resolve({ data: table === 'budget_category_account_map' ? [{ category: 'Labor', erp_account: categoryAccount }] : [], error: null });
      },
    };
    return chain;
  } }; } } as unknown as DispatchServiceClient;
}

const GRAINS: Record<BudgetPushScenario['occupant'], Array<Record<string, unknown>>> = {
  'none': [],
  'one-live': [{ name: 'DESK-BUDGET', docstatus: 1 }],
  'two-live': [{ name: 'LIVE-1', docstatus: 1 }, { name: 'LIVE-2', docstatus: 1 }],
  'draft': [{ name: 'BUD-DRAFT', docstatus: 0 }],
};

/** A fake ERPNext holding Journal Entries: create, submit, list-by-`user_remark like`, read. */
function fakeJournalErp() {
  const docs: Array<Record<string, unknown>> = [];
  let armed: 'transport' | 'lost-response' | null = null;
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url), 'https://erp.test');
    const method = init?.method ?? 'GET';
    const name = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    if (method === 'POST') {
      const fault = armed; armed = null;
      if (fault === 'transport') return respond({}, 503);
      const doc = { ...JSON.parse(String(init?.body)), name: `ACC-JV-${docs.length + 1}`, docstatus: 0 };
      docs.push(doc);
      return fault === 'lost-response' ? respond({}, 503) : respond(doc);
    }
    if (method === 'PUT') {
      const doc = docs.find((d) => d.name === name);
      if (!doc) return respond({}, 404);
      Object.assign(doc, JSON.parse(String(init?.body)));
      return respond(doc);
    }
    if (u.searchParams.has('filters')) {
      const [[field, , pattern]] = JSON.parse(u.searchParams.get('filters') as string) as Array<[string, string, string]>;
      const needle = pattern.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1');
      return respond(docs.filter((d) => String(d[field] ?? '').includes(needle)).map((d) => ({ name: d.name })));
    }
    const doc = docs.find((d) => d.name === name);
    return doc ? respond(doc) : respond({}, 404);
  }) as typeof fetch;
  return { docs, fetchImpl, arm: (fault: 'transport' | 'lost-response') => { armed = fault; } };
}

function createTransferHarness(): TransferHarness {
  const erp = fakeJournalErp();
  const client = { fetchImpl: erp.fetchImpl, apiKey: 'key', apiSecret: 'secret', baseUrl: 'https://erp.test', maxRetries: 0 };
  const adapter = createErpAdapter({ client, doctypeBodies: DOCTYPE_BODIES, ctx: { refs: {}, config: {} } });
  const record = (t: ImprestTransfer) => ({
    id: t.key.split(':')[1], erp_doc_kind: 'imprest-transfer', company: 'Test Co', idempotency_key: t.key, from_account: t.fromAccount,
    to_account: t.toAccount, amount: t.amount, posting_date: t.date, reference: t.reference,
  });
  const probe = (id: string) => ({ client, doctype: 'Journal Entry', anchorField: 'user_remark', fromDoc: expenseJournalFromDoc, pmoRecordId: id });
  return {
    // The ADR-0058 sequence the dispatch runs: probe the anchor first, create only when ERP holds nothing under the key.
    async post(t) {
      const adopted = await probeErpByAnchorKey(probe(t.key), t.key);
      if (adopted) return { externalId: adopted.externalRecordId };
      const rec = record(t);
      const result = await adapter.commit({ domain: 'expenses', operation: 'create', record: rec, idempotencyKey: t.key });
      return { externalId: result.externalRecordId };
    },
    seed(t) {
      const body = imprestTransferToBody(record(t), { refs: {}, config: {} }) as Record<string, unknown>;
      erp.docs.push({ ...body, user_remark: t.key, name: `ACC-JV-${erp.docs.length + 1}`, docstatus: 1 });
    },
    lines(key) {
      const doc = erp.docs.find((d) => d.user_remark === key);
      const rows = (doc?.accounts ?? []) as Array<{ account: string; debit_in_account_currency?: number; credit_in_account_currency?: number }>;
      return rows.map((row) => ({ account: row.account, debit: (row.debit_in_account_currency ?? 0).toFixed(2), credit: (row.credit_in_account_currency ?? 0).toFixed(2) }));
    },
    documents: () => erp.docs.map((d) => ({ externalId: String(d.name), key: String(d.user_remark) })),
    failNextWrite: (fault) => erp.arm(fault),
  };
}

export function createErpnextHarness(): ErpHarness {
  return {
    tier: 'erpnext',
    transfer: createTransferHarness,
    connect: createConnectHarness,
    ...createPushAndReadHarness(),

    async matchParty(party: ErpPartyInput, existing: readonly PmoPartyCandidate[]): Promise<PartyMatchResult> {
      try {
        const adopted = await adoptParty(
          { doctype: party.role === 'vendor' ? 'Supplier' : 'Customer', id: party.externalId, name: party.name, taxId: party.taxId, isInternal: party.internal },
          { findCandidates: async () => existing.map((c) => ({ pmoRecordId: c.pmoId, taxId: c.taxId })) },
        );
        const linked = existing.find((c) => c.pmoId === adopted.canonical.id);
        return linked
          ? { outcome: 'link', pmoId: linked.pmoId, externalId: adopted.externalRecordId, role: party.role }
          : { outcome: 'bring-in', externalId: adopted.externalRecordId, role: party.role };
      } catch (error) {
        if (error instanceof AppError && error.code === 'action-required') return { outcome: 'review' };
        if (error instanceof AppError && error.code === 'config-rejected') return { outcome: 'refused' };
        throw error;
      }
    },

    async bringIn(parties, existing, runs = 1) {
      // Every candidate the suite passes is named "Acme Co". The store refuses duplicates like the database does.
      const companies = new Map<string, { name: string }>(existing.map((c) => [c.pmoId, { name: 'Acme Co' }]));
      const refs = new Map<string, string>(); // external id -> pmo id, unique like external_refs
      const linked: string[] = [];
      let review = 0;
      for (let i = 0; i < runs; i += 1) {
        await onboardParties(parties.map((p) => ({ doctype: p.role === 'vendor' ? 'Supplier' : 'Customer', id: p.externalId, name: p.name, taxId: p.taxId ?? null })), {
          findPmoRecordId: async (ext) => refs.get(ext) ?? null,
          findCandidates: async () => existing.filter((c) => ![...refs.values()].includes(c.pmoId)).map((c) => ({ pmoRecordId: c.pmoId, taxId: c.taxId })),
          insertCompaniesMirror: async (c) => {
            if (companies.has(c.id)) throw Object.assign(new Error('duplicate'), { code: '23505' });
            companies.set(c.id, { name: String(c.name) });
          },
          updateCompaniesMirror: async (id) => {
            if (!companies.has(id)) throw new Error('update of a missing company');
            if (!linked.includes(id) && existing.some((c) => c.pmoId === id)) linked.push(id);
          },
          recordExternalRef: async ({ pmoRecordId, externalRecordId }) => {
            if (refs.has(externalRecordId) || [...refs.values()].includes(pmoRecordId)) throw Object.assign(new Error('dup'), { code: '23505' });
            refs.set(externalRecordId, pmoRecordId);
          },
          mirrorExists: async (id) => companies.has(id),
          notifyUnclearMatch: async () => { review += 1; },
          recordReview: async () => {},   // the persisted row is the database's; the suite counts the decision
        });
      }
      return { companies: companies.size, refs: refs.size, linked, review: review / runs };
    },

    resolveProjectLink(links, erpProjectName): ProjectLinkResult {
      const inverse = invertProjectMap(links);
      if (!inverse.has(erpProjectName)) return { status: 'none' };
      const pmoProjectId = inverse.get(erpProjectName);
      return pmoProjectId === null || pmoProjectId === undefined ? { status: 'ambiguous' } : { status: 'linked', pmoProjectId };
    },

    async pushBudget({ account, fiscalYear, occupant }: BudgetPushScenario): Promise<BudgetPushResult> {
      const { stats, fetchImpl } = erpTransport(GRAINS[occupant], { account, fiscalYear });
      const record = {
        id: VERSION_ID, erp_doc_kind: 'budget', projectId: 'project', fiscal_year: fiscalYear,
        line_items: [{ category: 'Labor', budgeted_amount: '50000.00' }],
        erp_account: account, budget_intent: 'ensure', budget_predecessor: null, outbox_identity: budgetAccountIdentity(VERSION_ID, fiscalYear, account),
      };
      const command = { domain: 'budget', operation: 'create', record, idempotencyKey: 'bud16:contract' } as never;
      try {
        const adapter = await resolveErpDispatchAdapter({
          serviceClient: serviceClient(ACTIVATED_BINDING, account), orgId: ORG, command,
          fetchImpl, apiKey: 'key', apiSecret: 'secret', doctypeBodies: DOCTYPE_BODIES,
        });
        await adapter.commit(command);
        return { outcome: 'pushed', erpWrites: stats.writes };
      } catch (error) {
        const e = error as Error & { code?: string };
        return { outcome: 'refused', code: e.code, message: e.message, erpWrites: stats.writes };
      }
    },

    async pushPurchaseStep(step, orderedBeforeConnect): Promise<PushBeforeConnectionResult> {
      const { stats, fetchImpl } = erpTransport();
      // The caller's own client, as dispatch holds it: `pre_cutover_procurement` answers null when it cannot decide.
      const callerClient = { rpc: async () => ({ data: orderedBeforeConnect === 'unknown' ? null : orderedBeforeConnect, error: null }) };
      const command = { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', procurementId: 'case-1', erp_doc_kind: step } } as never;
      try {
        await assertNotPreCutover(callerClient, command);
        await resolveErpDispatchAdapter({
          serviceClient: serviceClient(ACTIVATED_BINDING), orgId: ORG, command,
          fetchImpl, apiKey: 'key', apiSecret: 'secret',
        });
        return { outcome: 'pushed', erpCalls: stats.calls };
      } catch (error) {
        return { outcome: 'refused', code: (error as { code?: string }).code, erpCalls: stats.calls };
      }
    },

    async pushPurchase(connection): Promise<PushBeforeConnectionResult> {
      const { stats, fetchImpl } = erpTransport();
      const binding = connection === 'absent' ? null : { ...ACTIVATED_BINDING, activated_at: connection === 'activated' ? ACTIVATED_BINDING.activated_at : null };
      try {
        await resolveErpDispatchAdapter({
          serviceClient: serviceClient(binding), orgId: ORG,
          command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order' } },
          fetchImpl, apiKey: 'key', apiSecret: 'secret',
        });
        return { outcome: 'pushed', erpCalls: stats.calls };
      } catch (error) {
        return { outcome: 'refused', code: (error as { code?: string }).code, erpCalls: stats.calls };
      }
    },
  };
}

/** A fake ERPNext behind the connect adapter, loaded in PMO terms. Reads only until ECA-3 teaches it to send. */
function createConnectHarness(): ConnectHarness {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const { client, seen } = fakeErp(tables);
  const put = (doctype: string, row: Record<string, unknown>) => { (tables[doctype] ??= []).push({ company: 'Test Co', ...row }); };
  const notYet = () => { throw new Error('erpnext sends arrive with ECA-3'); };
  return {
    adapter: createErpnextConnectAdapter(client, 'Test Co'),
    pageSize: ERP_CONNECT_PAGE,
    documents: notYet,
    failNextWrite: notYet,
    calls: () => ({ reads: seen.filter((r) => r.method === 'GET').length, writes: seen.filter((r) => r.method !== 'GET').length }),
    load(kind, rows) {
      for (const r of rows) {
        const disabled = r.active ? 0 : 1;
        if (kind === 'party') {
          const vendor = r.role !== 'client';
          put(vendor ? 'Supplier' : 'Customer', vendor
            ? { name: r.externalId, supplier_name: r.name, tax_id: r.taxId ?? null, disabled, is_internal_supplier: r.internal ? 1 : 0 }
            : { name: r.externalId, customer_name: r.name, tax_id: r.taxId ?? null, disabled, is_internal_customer: r.internal ? 1 : 0 });
        } else if (kind === 'project') put('Project', { name: r.externalId, project_name: r.name, status: r.active ? 'Open' : 'Cancelled' });
        else if (kind === 'item') put('Item', { name: r.externalId, item_name: r.name, disabled });
        else if (kind === 'employee') put('Employee', { name: r.externalId, employee_name: r.name, company_email: r.code ?? null, user_id: null, status: r.active ? 'Active' : 'Left' });
        else if (kind === 'account') {
          // The adapter derives the category from the account itself, so the account is named for the category it carries.
          put('Account', { name: r.externalId, account_name: r.name, account_number: '5100', parent_account: 'Cost of Sales - TC', root_type: 'Expense', is_group: 0, disabled });
        }
      }
    },
  };
}
