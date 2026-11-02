/** Integrations repository implementation: ERP setup edge actions, bindings, connect/disconnect, health, ClickUp/ERPNext project links and item reads. */
import { parseErpActivationRefusal, withErpActivationRefusal } from './erpActivationRefusal';
import { supabase } from '@/src/lib/supabase/client';
import { invokeWithTimeout } from '@/src/lib/supabase/invokeWithTimeout';
import { wrap, throwInvokeError } from './repositoryErrors';
import type { ClickUpListItem, ConnectAcceptResult, ConnectCounts, ConnectCredential, ConnectResponse, DisconnectResponse, ErpProjectLink, ErpProjectOption, ErpSetupReadiness, ExternalTier, IntegrationBinding, IntegrationHealth, IntegrationsRepository, LinkInput, LinkResponse, ProjectBinding, UnlinkInput, UnlinkResponse } from './contracts/integrations';

export async function erpSetupRequest<T>(setupAction: string, input: Record<string, unknown> = {}, tier: 'erpnext' | 'odoo' = 'erpnext'): Promise<T> {
  return wrap(async () => {
    const { data, error } = await invokeWithTimeout(supabase.functions.invoke<T>('external-set-company', {
      body: { tier, setupAction, ...input },
    }));
    if (error) await throwInvokeError(error);
    return data as T;
  });
}

const ACCEPT_REQUESTS_MAX = 50;   // each request makes up to 20 bounded calls of 500 rows

function addCounts(into: ConnectCounts, from: ConnectCounts): void {
  for (const [kind, fields] of Object.entries(from)) {
    const row = (into[kind] ??= { link: 0, bring_in: 0, send: 0, left_open: 0 });
    for (const f of ['link', 'bring_in', 'send', 'left_open'] as const) row[f] += fields[f] ?? 0;
  }
}

export const integrationsRepository: IntegrationsRepository = {
  getErpSetup: () => erpSetupRequest<ErpSetupReadiness>('readiness'),
  saveErpDefaults: (input) => erpSetupRequest<{ ok: true }>('save-defaults', input),
  ensureErpProject: (projectId) => erpSetupRequest<ErpProjectLink>('ensure-project', { projectId }),
  listErpProjects: async (query) => (await erpSetupRequest<{ projects: ErpProjectOption[] }>('list-projects', { query })).projects,
  linkErpProject: (projectId, erpProject, expectedErpProject) => erpSetupRequest<ErpProjectLink>('link-project', { projectId, erpProject, expectedErpProject }),
  employErpDomain: (domain) => erpSetupRequest<{ ok: true }>('employ-domain', { domain }),
  saveExpenseAccount: (input) => erpSetupRequest<{ ok: true }>('save-expense-account', input),
  clearExpenseAccount: (accountKey) => erpSetupRequest<{ ok: true }>('clear-expense-account', { accountKey }),
  onboardErpParties: () => erpSetupRequest<{ ok: true }>('onboard-parties'),
  startConnectCensus: (tier) => erpSetupRequest('census', {}, tier),
  getConnectStatus: (tier) => erpSetupRequest('connect-status', {}, tier),
  listConnectProposals: (tier, kind, outcome, afterId, state) =>
    erpSetupRequest('list-proposals', { kind, outcome, afterId, ...(state ? { state } : {}) }, tier),
  acceptConnectProposals: async (tier, kind, ids) => {
    const total: ConnectAcceptResult = { counts: {}, remaining: 0 };
    for (let i = 0; i < ACCEPT_REQUESTS_MAX; i += 1) {
      const r = await erpSetupRequest<ConnectAcceptResult>('accept-proposals', { kind, ids }, tier);
      addCounts(total.counts, r.counts);
      total.remaining = r.remaining;
      if (r.remaining === 0 || Object.keys(r.counts).length === 0) break;
    }
    return total;
  },
  decideConnectReview: async (tier, id, choice) => { await erpSetupRequest('decide-review', { id, choice }, tier); },
  unlinkConnectMatch: async (tier, id) => { await erpSetupRequest('unlink-match', { id }, tier); },
  retryConnectSend: async (tier, id) => { await erpSetupRequest('retry-send', { id }, tier); },
  getBinding: async (orgId: string, tier: ExternalTier): Promise<IntegrationBinding | null> => {
    return wrap(async () => {
      const { data, error } = await supabase
        .from('external_org_bindings')
        .select('org_id, external_tier, site_url, status, connected_by, connected_at, disconnected_at, config')
        .eq('org_id', orgId)
        .eq('external_tier', tier)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as IntegrationBinding | null;
    });
  },
  listBindings: async (orgId: string): Promise<IntegrationBinding[]> => {
    return wrap(async () => {
      const { data, error } = await supabase
        .from('external_org_bindings')
        .select('org_id, external_tier, site_url, status, connected_by, connected_at, disconnected_at, config')
        .eq('org_id', orgId);
      if (error) throw error;
      return (data ?? []) as unknown as IntegrationBinding[];
    });
  },
  connectIntegration: async (orgId: string, credential: ConnectCredential): Promise<ConnectResponse> => {
    return wrap(async () => {
      const { data, error } = await invokeWithTimeout(
        supabase.functions.invoke<ConnectResponse>('external-connect', {
          body: { tier: credential.tier, credential: credential.credential },
        }),
      );
      // The refusal's code and message reach the caller (Odoo's card localises key-rejected, confirm-discard, ...).
      if (error) await throwInvokeError(error);
      return data as ConnectResponse;
    });
  },
  disconnectIntegration: async (orgId: string, tier: ExternalTier): Promise<DisconnectResponse> => {
    return wrap(async () => {
      const { data, error } = await invokeWithTimeout(
        supabase.functions.invoke<DisconnectResponse>('external-disconnect', {
          body: { tier },
        }),
      );
      if (error) throw error;
      return data as DisconnectResponse;
    });
  },
  getIntegrationHealth: async (orgId: string, tier: ExternalTier): Promise<IntegrationHealth> => {
    return wrap(async () => {
      const binding = await integrationsRepository.getBinding(orgId, tier);

      const { data: watermark, error: watermarkError } = await supabase
        .from('external_sync_watermarks')
        .select('updated_at')
        .eq('org_id', orgId)
        .eq('external_tier', tier)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (watermarkError) throw watermarkError;

      const { data: outboxRows, error: outboxError } = await supabase
        .from('external_command_outbox')
        // `state` is explicitly granted by migration 0134. Select only it: the single RLS-scoped
        // read lets us distinguish normal pending work from states that need attention, without
        // reading payloads or widening the table grant.
        .select('state')
        .eq('org_id', orgId)
        .eq('external_tier', tier)
        .in('state', ['pending', 'failed', 'quarantined', 'held']);

      if (outboxError) throw outboxError;
      const state_counts = { pending: 0, failed: 0, quarantined: 0, held: 0 };
      for (const row of outboxRows ?? []) {
        if (row.state in state_counts) state_counts[row.state as keyof typeof state_counts] += 1;
      }

      return {
        tier,
        status: binding?.status ?? 'disconnected',
        connected_by: binding?.connected_by ?? null,
        connected_at: binding?.connected_at ?? null,
        last_sync: (watermark as { updated_at?: string } | null)?.updated_at ?? null,
        state_counts,
      };
    });
  },
  listProjectLists: async (_orgId: string): Promise<ClickUpListItem[]> => {
    return wrap(async () => {
      const { data, error } = await invokeWithTimeout(
        supabase.functions.invoke<{ lists: ClickUpListItem[] }>('external-lists', {
          body: { tier: 'clickup' },
        }),
      );
      if (error) throw error;
      return (data as { lists: ClickUpListItem[] }).lists;
    });
  },
  linkProject: async (_orgId: string, input: LinkInput): Promise<LinkResponse> => {
    return wrap(async () => {
      const { data, error } = await invokeWithTimeout(
        supabase.functions.invoke<LinkResponse>('external-link', {
          body: { ...input },
        }),
      );
      if (error) throw error;
      return data as LinkResponse;
    });
  },
  unlinkProject: async (_orgId: string, input: UnlinkInput): Promise<UnlinkResponse> => {
    return wrap(async () => {
      const { data, error } = await invokeWithTimeout(
        supabase.functions.invoke<UnlinkResponse>('external-unlink', {
          body: { ...input },
        }),
      );
      if (error) throw error;
      return data as UnlinkResponse;
    });
  },
  listProjectBindings: async (orgId: string): Promise<ProjectBinding[]> => {
    return wrap(async () => {
      const { data, error } = await supabase
        .from('external_project_bindings')
        .select('id, org_id, project_id, external_tier, external_container_id, config, linked_by, linked_at, disconnected_at')
        .eq('org_id', orgId)
        .is('disconnected_at', null);
      if (error) throw error;
      return (data ?? []) as unknown as ProjectBinding[];
    });
  },
  listCompanies: async (orgId: string, tier: ExternalTier): Promise<{ name: string }[]> => {
    return wrap(async () => {
      if (tier !== 'erpnext') {
        return [];
      }
      const { data, error } = await invokeWithTimeout(
        supabase.functions.invoke<{ companies: { name: string }[] }>('external-companies', {
          body: { tier: 'erpnext' },
        }),
      );
      if (error) throw error;
      return (data as { companies: { name: string }[] }).companies;
    });
  },
  listPurchaseTaxTemplates: () => wrap(async () => {
    const { data, error } = await invokeWithTimeout(supabase.functions.invoke<{ templates: Array<{ name: string }> }>('external-items', { body: { purpose: 'purchase-tax-templates' } }));
    if (error) throw error;
    if (!data?.templates) throw new Error('ERP purchase tax templates could not be read');
    return data.templates;
  }),
  listItems: (purpose) => wrap(async () => {
    const { data, error } = await invokeWithTimeout(supabase.functions.invoke<{ items: Array<{ code: string; name: string }> }>('external-items', { body: { purpose } }));
    if (error) throw error;
    if (!data?.items) throw new Error('ERP item catalog could not be read');
    return data.items;
  }),
  setCompany: async (orgId: string, tier: ExternalTier, companyId: string): Promise<{ ok: true; companyId: string }> => {
    return wrap(async () => {
      if (tier !== 'erpnext') {
        throw new Error('Only erpnext tier supports company selection');
      }
      const { data, error } = await invokeWithTimeout(
        supabase.functions.invoke<{ ok: true; companyId: string }>('external-set-company', {
          body: { tier: 'erpnext', companyId },
        }),
      );
      // #656: an actionable refusal (missing reads / unsupported version) rides along for the dialog.
      if (error) await throwInvokeError(error, (appError, body) => {
        const refusal = parseErpActivationRefusal(body);
        if (refusal) withErpActivationRefusal(appError, refusal);
      });
      return data as { ok: true; companyId: string };
    });
  },
};
