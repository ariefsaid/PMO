import { AppError } from '../appError.ts';
import type { ServiceRoleTableClient } from './watermarks.ts';

export interface ExternalRefRecord {
  orgId: string;
  domain: string;
  pmoRecordId: string;
  externalTier: string;
  externalRecordId: string;
}

/** Dispatch-side only external_refs writer (FR-EAS-043, AC-EAS-042 support). */
export async function recordExternalRef(client: ServiceRoleTableClient, input: ExternalRefRecord): Promise<void> {
  const { error } = await client.from('external_refs').upsert(
    {
      org_id: input.orgId,
      domain: input.domain,
      pmo_record_id: input.pmoRecordId,
      external_tier: input.externalTier,
      external_record_id: input.externalRecordId,
    },
    { onConflict: 'org_id,domain,pmo_record_id' },
  );
  if (error) throw new AppError(error.message, error.code);
}

/** Structural service-role client seam for the `external_refs` lookups (matches supabase-js):
 *  `.from(t).select(c).eq(...).eq(...).eq(...).maybeSingle()` — the filter builder is chainable.
 *  Same shape as `clickup/dispatchFactory.ts`'s `DispatchServiceClient` (task 1.6 generalizes it). */
export interface ExternalRefsLookupClient {
  from(table: string): {
    select(columns: string): ExternalRefsFilterBuilder;
  };
}
export interface ExternalRefsFilterBuilder {
  eq(column: string, value: string): ExternalRefsFilterBuilder;
  maybeSingle(): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/**
 * Resolve `pmoRecordId → externalId` through `external_refs` for a given org+domain (task 1.6,
 * generalizes the P1 single-domain `resolveExternalId` in `clickup/dispatchFactory.ts` so a
 * multi-domain command — e.g. a PO resolving its Supplier + upstream PR ref — can look up any
 * domain's mapping through one function). Returns `null` when no mapping is recorded (never throws
 * on absence — the caller decides whether that's an error).
 */
export async function resolveExternalRef(
  client: ExternalRefsLookupClient,
  orgId: string,
  domain: string,
  pmoRecordId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('external_refs')
    .select('external_record_id')
    .eq('org_id', orgId)
    .eq('domain', domain)
    .eq('pmo_record_id', pmoRecordId)
    .maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return (data as { external_record_id: string } | null)?.external_record_id ?? null;
}

/** The exact reverse of `resolveExternalRef`: `externalId → pmoRecordId` (e.g. a webhook/sweep event
 *  resolving an inbound ERP `name` back to its PMO record). Returns `null` when absent. */
export async function findPmoRecordId(
  client: ExternalRefsLookupClient,
  orgId: string,
  domain: string,
  externalRecordId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('external_refs')
    .select('pmo_record_id')
    .eq('org_id', orgId)
    .eq('domain', domain)
    .eq('external_record_id', externalRecordId)
    .maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return (data as { pmo_record_id: string } | null)?.pmo_record_id ?? null;
}
