/**
 * ERPNext's harness for the shared contract suites (spec §6.2): drives the SHIPPED ERPNext code with the
 * transport mocked and answers in PMO terms. No behaviour lives here; it only translates.
 */
import { AppError } from '../../appError.ts';
import type {
  BudgetPushResult, BudgetPushScenario, ErpHarness, ErpPartyInput, PartyMatchResult, PmoPartyCandidate,
  ProjectLinkResult, PushBeforeConnectionResult,
} from '../contractSuite/harness.ts';
import { budgetAccountIdentity } from './budgetAccountIdentity.ts';
import { DOCTYPE_BODIES } from './doctypeBodies.ts';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { adoptParty } from './partyAdopt.ts';
import { invertProjectMap } from './projectMap.ts';

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
      maybeSingle: async () => ({ data: table === 'external_org_bindings' ? binding : table === 'projects' ? { org_id: ORG } : null, error: null }),
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

export function createErpnextHarness(): ErpHarness {
  return {
    tier: 'erpnext',

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
