/**
 * ERPNext dispatch factory (task 2.13, mirrors `clickup/dispatchFactory.ts`). Resolves the per-org
 * erpnext adapter from the ALREADY-ACTIVATED `external_org_bindings` row (0095) — the version
 * handshake (FR-ENA-012) runs once at bind-create/refresh time, not on every dispatch. Credentials
 * (`apiKey`/`apiSecret`) are resolved from `secret_ref` at the edge-fn boundary and passed in — this
 * module never reads `secret_ref`/vault/env itself (NFR-ENA-SEC-002). `ctx.refs` stays empty this
 * slice — the multi-domain ref resolver (companies/PO/PO-item) lands in slices 3/5.
 */
import { createErpAdapter, ERPNEXT_TIER, type DoctypeBodyFns, type ErpAdapterDeps } from './adapter.ts';
import type { ErpDocKind } from './doctypeRegistry.ts';
import type { ErpRateLimiter } from './client.ts';
import type { Adapter, AdapterCommand } from '../contract.ts';
import { AppError } from '../../appError.ts';

/** Structural service-role client seam (matches supabase-js): `.from(t).select(c).eq(...).eq(...).maybeSingle()`. */
export interface DispatchServiceClient {
  from(table: string): {
    select(columns: string): DispatchFilterBuilder;
  };
}
export interface DispatchFilterBuilder {
  eq(column: string, value: string): DispatchFilterBuilder;
  maybeSingle(): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

interface ExternalOrgBindingRow {
  site_url: string;
  version_major: number | null;
  activated_at: string | null;
  config: Record<string, unknown>;
}

export interface ErpDispatchFactoryDeps {
  serviceClient: DispatchServiceClient;
  orgId: string;
  command: AdapterCommand;
  fetchImpl: typeof fetch;
  /** Resolved from `secret_ref` at the edge-fn boundary (vault `AS`/fn secrets) — never read here. */
  apiKey: string;
  apiSecret: string;
  /** A modest per-org token bucket (FR-ENA-014), shared across a request. Optional. */
  rateLimiter?: ErpRateLimiter;
  /** The (kind)->{toBody,fromDoc} side table — empty until slices 3-6 wire real doctype bodies. */
  doctypeBodies?: Partial<Record<ErpDocKind, DoctypeBodyFns>>;
}

/**
 * Resolve the erpnext adapter for one command: read the org's `external_org_bindings` row, refuse
 * `config-rejected` when it is missing or not yet activated (`activated_at === null` — a version
 * mismatch or a binding never activated, FR-ENA-012), then build the adapter over the resolved
 * `site_url`/`config`.
 */
export async function resolveErpDispatchAdapter(deps: ErpDispatchFactoryDeps): Promise<Adapter> {
  const { data, error } = await deps.serviceClient
    .from('external_org_bindings')
    .select('site_url, version_major, activated_at, config')
    .eq('org_id', deps.orgId)
    .eq('external_tier', ERPNEXT_TIER)
    .maybeSingle();
  if (error || !data) {
    throw new AppError('no erpnext binding configured for this org', error?.code ?? 'BINDING_NOT_FOUND');
  }
  const binding = data as ExternalOrgBindingRow;
  if (!binding.activated_at) {
    throw new AppError('erpnext binding is not activated (version handshake mismatch or never activated)', 'config-rejected');
  }

  const adapterDeps: ErpAdapterDeps = {
    client: {
      fetchImpl: deps.fetchImpl,
      apiKey: deps.apiKey,
      apiSecret: deps.apiSecret,
      baseUrl: binding.site_url,
      rateLimiter: deps.rateLimiter,
    },
    doctypeBodies: deps.doctypeBodies ?? {},
    // Ref resolution (supplier/PO/PO-item) is wired by slices 3/5's dispatch-factory extensions;
    // this slice ships the engine with an empty refs bag (inert — no org is flipped).
    ctx: { refs: {}, config: binding.config },
  };
  return createErpAdapter(adapterDeps);
}
