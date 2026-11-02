import { type SupabaseClient } from '@supabase/supabase-js';
import type { Adapter, AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { createReferenceAdapter, REFERENCE_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/referenceAdapter.ts';
import { CLICKUP_TASKS_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/clickup/adapter.ts';
import { resolveClickUpDispatchAdapter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/dispatchFactory.ts';
import { ClickUpRateLimiter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/rateLimit.ts';
import {
  ERPNEXT_BUDGET_DOMAIN,
  ERPNEXT_COMPANIES_DOMAIN,
  ERPNEXT_PROCUREMENT_DOMAIN,
  ERPNEXT_REVENUE_DOMAIN,
  ERPNEXT_TIMESHEETS_DOMAIN,
  ERPNEXT_TIER,
} from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { resolveErpDispatchAdapter, type ProcurementSourceLine } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { lookupOrgBindingSecretRef, resolveOrgSecretOrFallback } from '../_shared/perOrgSecret.ts';
import { resolveErpAuthPair, type ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { externalConnectEnabled } from '../_shared/externalConnectEnabled.ts';
import { guardedErpFetch } from '../_shared/erpHostGuard.ts';
import { DOCTYPE_BODIES } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts';
import { maybeFault, type FaultGate } from './faultSeams.ts';
import { isBudgetPushCommand } from './budgetDispatch.ts';

/** The adapter-select context: the caller's org, the parsed command, and the service-role client for
 * per-request config lookups (project binding, external_refs resolution). Never used for adapter.commit(). */
export interface AdapterSelectContext {
  orgId: string;
  command: AdapterCommand;
  serviceClient: SupabaseClient;
  /** The VERIFIED caller's user id (`verified.sub` — never a client-supplied body field). Persisted
   *  onto the money-outbox row as `actor_user_id` (0108 §C) so a LATER sweep finalize — which has no
   *  request JWT — can still attribute `sales_invoices.author_user_id` and keep the submit SoD real. */
  userId: string;
  /** Read-only pass-through so a tier's factory can wire an in-flow fault seam (e.g. ERP's
   *  two-step submit) — factories that don't need it simply ignore this field. */
  faultGate: FaultGate;
  /** #651: the per-REQUEST auth-pair memo. Not module-level — a shared isolate must never hold one
   *  tenant's credential across requests, and a rotated credential must not outlive a request. */
  erpAuth: ErpAuthPairCache;
  replay?: boolean;
  trustedReceiptSnapshot?: boolean;
  captureProcurementSourceLines?: (lines: ProcurementSourceLine[]) => void;
  /** ECA-6: told the recorded consent a budget push used to amend an ERP budget PMO did not create. */
  captureOccupantConsent?: (consentId: string) => void;
  procurementSnapshot?: { caseId: string; lines: ProcurementSourceLine[] };
  procurementInputDigest?: string;
}

export type AdapterFactory = (ctx: AdapterSelectContext) => Adapter | Promise<Adapter>;

// Shared across invocations of this isolate (module scope) — the token bucket's budget is real
// only if it persists across requests, not recreated per-call (NFR-CUA-PERF-003).
const clickUpRateLimiter = new ClickUpRateLimiter();

// ClickUp config/member resolution stays inside its adapter factory. The dispatcher passes the
// caller's org + command + an injected service-client seam and ClickUp client deps.
async function resolveClickUpAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  const connectEnabled = externalConnectEnabled();
  if (!connectEnabled) {
    throw new AppError('external integrations are disabled by the operator', 'config-rejected');
  }
  const clickUpToken = await resolveOrgSecretOrFallback(
    {
      connectEnabled,
      orgId: ctx.orgId,
      tier: 'clickup',
      lookupBinding: lookupOrgBindingSecretRef(ctx.serviceClient),
      readVaultSecret: async (ref) => {
        const { data, error } = await ctx.serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
        if (error) throw new AppError(error.message, error.code);
        return (data as string | null) ?? null;
      },
    },
    Deno.env.get('CLICKUP_API_TOKEN') ?? '',
  );

  return resolveClickUpDispatchAdapter({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    command: ctx.command,
    fetchImpl: fetch,
    token: clickUpToken,
    baseUrl: Deno.env.get('CLICKUP_API_BASE_URL') ?? undefined,
    rateLimiter: clickUpRateLimiter,
  });
}

// ERPNext adapter factory; the binding row is authoritative for site URL and config, and the shared
// per-org resolver owns credentials. The request-scoped auth memo must never cross org boundaries.
export const erpRateLimiter = { acquire: async () => {} };

export interface ErpBindingRow {
  site_url: string;
  secret_ref: string;
  version_major: number | null;
  config: Record<string, unknown> | null;
  activated_at: string | null;
}

export async function resolveErpBindingRow(serviceClient: SupabaseClient, orgId: string): Promise<ErpBindingRow> {
  const { data, error } = await serviceClient
    .from('external_org_bindings')
    .select('site_url, secret_ref, version_major, config, activated_at')
    .eq('org_id', orgId)
    .eq('external_tier', ERPNEXT_TIER)
    .maybeSingle();
  if (error || !data) {
    throw new AppError('no erpnext binding configured for this org', error?.code ?? 'BINDING_NOT_FOUND');
  }
  return data as ErpBindingRow;
}

export async function resolveErpAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  if (!externalConnectEnabled()) {
    throw new AppError('external integrations are disabled by the operator', 'config-rejected');
  }
  const binding = await resolveErpBindingRow(ctx.serviceClient, ctx.orgId);
  if (isBudgetPushCommand(ctx.command) && binding.version_major !== 15 && binding.version_major !== 16) {
    throw new AppError('budget push requires an ERP binding with supported version major 15 or 16', 'config-rejected');
  }
  const { apiKey, apiSecret } = await resolveErpAuthPair(ctx.serviceClient, { orgId: ctx.orgId, secretRef: binding.secret_ref }, ctx.erpAuth);
  return resolveErpDispatchAdapter({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    command: ctx.command,
    fetchImpl: guardedErpFetch(binding.site_url),
    apiKey,
    apiSecret,
    replay: ctx.replay,
    trustedReceiptSnapshot: ctx.trustedReceiptSnapshot,
    captureProcurementSourceLines: ctx.captureProcurementSourceLines,
    onOccupantConsent: ctx.captureOccupantConsent,
    rateLimiter: erpRateLimiter,
    doctypeBodies: DOCTYPE_BODIES,
    afterSubmitHook: () => maybeFault('after-submit-before-mirror', ctx.faultGate),
    afterCancelHook: () => maybeFault('after-cancel-before-create', ctx.faultGate),
  });
}

// Registry keyed by the PMO domain the tier natively owns.
export const ADAPTER_REGISTRY: Record<string, AdapterFactory> = {
  [REFERENCE_DOMAIN]: () => createReferenceAdapter('commit-success'),
  [CLICKUP_TASKS_DOMAIN]: resolveClickUpAdapter,
  [ERPNEXT_COMPANIES_DOMAIN]: resolveErpAdapter,
  [ERPNEXT_PROCUREMENT_DOMAIN]: resolveErpAdapter,
  [ERPNEXT_REVENUE_DOMAIN]: resolveErpAdapter,
  [ERPNEXT_BUDGET_DOMAIN]: resolveErpAdapter,
  [ERPNEXT_TIMESHEETS_DOMAIN]: resolveErpAdapter,
};
