import { AppError } from '../appError.ts';

/** Structural service-role table client seam (matches supabase-js): `.from(t).upsert(rows, {onConflict})`. */
export interface ServiceRoleTableClient {
  from(table: string): {
    upsert(rows: unknown, options: { onConflict: string }): Promise<{ error: { message: string; code?: string } | null }>;
  };
}

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

/** Insert-only `external_refs` link: refuses (23505) when the PMO record OR the external record is already
 *  linked, instead of `recordExternalRef`'s upsert, which would silently re-point a PMO record that is
 *  already linked to another external record. Used where a first-time link claims an existing PMO row. */
export interface ExternalRefInsertClient {
  from(table: string): { insert(row: unknown): PromiseLike<{ error: { message: string; code?: string } | null }> };
}
export async function insertExternalRef(client: ExternalRefInsertClient, input: ExternalRefRecord): Promise<void> {
  const { error } = await client.from('external_refs').insert({
    org_id: input.orgId,
    domain: input.domain,
    pmo_record_id: input.pmoRecordId,
    external_tier: input.externalTier,
    external_record_id: input.externalRecordId,
  });
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

/** The `in (...)` read `findPmoRecordIds` issues: the filter builder ends in `.in`, which returns the rows. */
export interface ExternalRefsBatchLookupClient {
  from(table: string): { select(columns: string): ExternalRefsBatchFilterBuilder };
}
export interface ExternalRefsBatchFilterBuilder {
  eq(column: string, value: string): ExternalRefsBatchFilterBuilder;
  in(column: string, values: string[]): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/** Ids per `in (...)` read: keeps the request URL well under proxy limits. */
export const FIND_PMO_RECORD_IDS_CHUNK = 100;

/** `findPmoRecordId` for many ids at once (#2119): `externalId → pmoRecordId` for the ids that are mapped, in one read
 *  per FIND_PMO_RECORD_IDS_CHUNK ids. An absent id is simply not in the map; a failed read throws. */
export async function findPmoRecordIds(
  client: ExternalRefsBatchLookupClient,
  orgId: string,
  domain: string,
  externalRecordIds: readonly string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (let i = 0; i < externalRecordIds.length; i += FIND_PMO_RECORD_IDS_CHUNK) {
    const { data, error } = await client
      .from('external_refs')
      .select('external_record_id, pmo_record_id')
      .eq('org_id', orgId)
      .eq('domain', domain)
      .in('external_record_id', externalRecordIds.slice(i, i + FIND_PMO_RECORD_IDS_CHUNK));
    if (error) throw new AppError(error.message, error.code);
    for (const row of (data ?? []) as Array<{ external_record_id: string; pmo_record_id: string }>) found.set(row.external_record_id, row.pmo_record_id);
  }
  return found;
}

/** Structural client seam for one batched `external_refs` read: `.from(t).select(c).eq(...).in(...).in(...)`, awaited. */
export interface ExternalRefsBatchClient {
  from(table: string): { select(columns: string): ExternalRefsBatchBuilder };
}
export interface ExternalRefsBatchBuilder extends PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  eq(column: string, value: string): ExternalRefsBatchBuilder;
  in(column: string, values: string[]): ExternalRefsBatchBuilder;
}

/**
 * Resolve many `pmoRecordId → externalId` links of one org in ONE query, across the given domains. The map is keyed
 * `<domain>:<pmoRecordId>`; a record with no link is simply absent. The caller keeps the id list under the platform
 * row cap (a stock document has at most 200 lines).
 */
export async function resolveExternalRefs(
  client: ExternalRefsBatchClient,
  orgId: string,
  domains: string[],
  pmoRecordIds: string[],
): Promise<Map<string, string>> {
  const { data, error } = await client
    .from('external_refs')
    .select('domain, pmo_record_id, external_record_id')
    .eq('org_id', orgId)
    .in('domain', domains)
    .in('pmo_record_id', pmoRecordIds);
  if (error) throw new AppError(error.message, error.code);
  const out = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ domain: string; pmo_record_id: string; external_record_id: string }>) {
    out.set(`${r.domain}:${r.pmo_record_id}`, r.external_record_id);
  }
  return out;
}
