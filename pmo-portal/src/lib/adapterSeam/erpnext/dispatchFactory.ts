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
import { resolveExternalRef, type ExternalRefsLookupClient } from '../refs.ts';

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
  /** Threaded straight into `ErpAdapterDeps.afterSubmitHook` (FR-ENA-003 — the `after-submit-before-
   *  mirror` fault seam, wired by the edge fn at task 2.14). Optional — a production caller that
   *  never arms the fault gate can omit it (a true no-op). */
  afterSubmitHook?: () => Promise<void>;
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
    // Ref resolution (task 4.6/4.7): a command carrying a PMO `vendorId` (RFQ/Supplier Quotation both
    // need a real ERP supplier, FR-ENA-111/112) resolves it through the SAME `companies` domain
    // external_refs mapping the parties flip (slice 3) writes — `resolveExternalRef` is the
    // already-generalized multi-domain resolver (task 1.6). Full PO/PO-item-child-row resolution
    // lands in slice 5's dispatch-factory extension; this is the minimal slice-4 seam MR/RFQ/SQ need.
    ctx: { refs: { supplier: await resolveSupplierRef(deps.serviceClient, deps.orgId, deps.command) }, config: binding.config },
    afterSubmitHook: deps.afterSubmitHook,
  };
  return createErpAdapter(adapterDeps);
}

/** Strips the `"<Doctype>:<name>"` encoding (task 3.2's companies-domain adopt convention, reused
 *  generically by `adapter.ts`'s `parseExternalId`) down to the bare ERP `name` the body-builders
 *  expect in `ctx.refs.supplier`. Returns the value unmodified if it carries no doctype prefix. */
function stripDoctypePrefix(externalRecordId: string): string {
  const separatorIndex = externalRecordId.indexOf(':');
  return separatorIndex === -1 ? externalRecordId : externalRecordId.slice(separatorIndex + 1);
}

async function resolveSupplierRef(serviceClient: DispatchServiceClient, orgId: string, command: AdapterCommand): Promise<string | null> {
  const vendorId = (command.record as { vendorId?: unknown }).vendorId;
  if (typeof vendorId !== 'string' || vendorId.length === 0) return null;
  const externalRecordId = await resolveExternalRef(serviceClient as unknown as ExternalRefsLookupClient, orgId, 'companies', vendorId);
  return externalRecordId ? stripDoctypePrefix(externalRecordId) : null;
}
