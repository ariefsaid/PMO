import { type SupabaseClient } from '@supabase/supabase-js';
import type { Adapter, AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { createReferenceAdapter, REFERENCE_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/referenceAdapter.ts';
import { CLICKUP_TASKS_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/clickup/adapter.ts';
import { resolveClickUpDispatchAdapter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/dispatchFactory.ts';
import { ClickUpRateLimiter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/rateLimit.ts';
import {
  ERPNEXT_DISPATCH_DOMAINS,
  ERPNEXT_TIER,
} from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { resolveErpDispatchAdapter, type ProcurementSourceLine } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { lookupOrgBindingSecretRef, resolveOrgSecretOrFallback } from '../_shared/perOrgSecret.ts';
import { resolveErpAuthPair, type ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { externalConnectEnabled } from '../_shared/externalConnectEnabled.ts';
import { guardedErpFetch } from '../_shared/erpHostGuard.ts';
import { DOCTYPE_BODIES } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { ODOO_ADAPTER_REGISTRY } from './odooAdapters.ts';
import { maybeFault, type FaultGate } from './faultSeams.ts';
import { isBudgetPushCommand } from './budgetDispatch.ts';
import type { ReservedOdooCallBudget } from '../_shared/odooCallBudget.ts';

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
  /** #1783 item 1: the ORIGINAL inbound command carried caller-directed receipt lines (tier-keyed
   *  guard). Receipt-scoped by construction: the money-outbox resolvers use it to verify a LEGACY
   *  accepted row (no stored digest) in memory from its persisted payload + persisted operation
   *  before the M-3 comparison. Whole-purchase Basic receipts and every other document kind leave it
   *  unset, so their shipped skip-digest behavior is byte-for-byte unchanged. */
  receiptLineIntent?: boolean;
  captureProcurementSourceLines?: (lines: ProcurementSourceLine[]) => void;
  /** ECA-6: told the recorded consent a budget push used to amend an ERP budget PMO did not create. */
  captureOccupantConsent?: (consentId: string) => void;
  procurementSnapshot?: { caseId: string; lines: ProcurementSourceLine[] };
  procurementInputDigest?: string;
  /** Sweep-only per-tick budget for every Odoo request made by revenue outbox recovery. */
  odooCallBudget?: ReservedOdooCallBudget;
  /** Recovery-only owner check; procurement probes call it before anchoring or settling a hit. */
  odooAnchorOwnedElsewhere?: (externalRecordId: string) => Promise<boolean>;
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
    actorUserId: ctx.userId,
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

/** A tier's own registry; a tier not listed (ERPNext, and the non-ERP domains) is served by `ADAPTER_REGISTRY`. A lookup, not a tier-name branch (AC-ECA-043). */
const TIER_REGISTRIES: Record<string, Record<string, AdapterFactory>> = { [ODOO_TIER]: ODOO_ADAPTER_REGISTRY };

/**
 * Whether a purchase-order revise on this tier CANCELS the ERP order to replace it (read by the revise guard, `poReviseGuard.ts`,
 * which names no tier). ERPNext amends (cancel then create); Odoo edits the confirmed order's lines in place and never cancels
 * (DD-OPP-9; its adapter has no cancel call). A tier not listed is treated as cancelling: the stricter check.
 */
export const TIER_REVISE_CANCELS: Readonly<Record<string, boolean>> = { [ERPNEXT_TIER]: true, [ODOO_TIER]: false };
export const reviseCancels = (tier: string | undefined): boolean => TIER_REVISE_CANCELS[tier ?? ''] ?? true;

/** The adapter factory for a command: the tier that owns the domain for this org (authGuard's answer) picks the registry. */
export function selectAdapterFactory(tier: string | undefined, domain: string): AdapterFactory | undefined {
  return (TIER_REGISTRIES[tier ?? ''] ?? ADAPTER_REGISTRY)[domain];
}

// Registry keyed by the PMO domain the tier natively owns.
export const ADAPTER_REGISTRY: Record<string, AdapterFactory> = {
  [REFERENCE_DOMAIN]: () => createReferenceAdapter('commit-success'),
  [CLICKUP_TASKS_DOMAIN]: resolveClickUpAdapter,
  ...Object.fromEntries(ERPNEXT_DISPATCH_DOMAINS.map((domain) => [domain, resolveErpAdapter])),
};
