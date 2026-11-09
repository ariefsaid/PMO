/**
 * erpnext/watermark.ts — shared watermark helpers for ERPNext feeds (ledger feed, purchase feed).
 * Manages monotonic cursors on `external_sync_watermarks`.
 */
import { AppError } from '../../appError.ts';

export const ERPNEXT_TIER = 'erpnext';

export interface WatermarkServiceClient {
  from(table: string): WatermarkTable;
}

export interface WatermarkTable {
  select(columns: string): WatermarkSelectBuilder;
  update(values: Record<string, unknown>, opts?: { count?: 'exact' }): WatermarkUpdateBuilder;
  upsert(rows: unknown | unknown[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): Promise<{ error: { message: string; code?: string } | null }>;
}

export interface WatermarkSelectBuilder {
  eq(column: string, value: string | number | boolean | null): WatermarkSelectBuilder;
  maybeSingle(): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface WatermarkUpdateBuilder extends PromiseLike<{ count: number | null; error: { message: string; code?: string } | null }> {
  eq(column: string, value: string | number | boolean | null): WatermarkUpdateBuilder;
  lt(column: string, value: string): WatermarkUpdateBuilder;
}

export async function readWm(sc: WatermarkServiceClient, orgId: string, domain: string): Promise<string | null> {
  const { data, error } = await sc.from('external_sync_watermarks').select('watermark_cursor')
    .eq('org_id', orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', domain).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return (data as { watermark_cursor?: string } | null)?.watermark_cursor ?? null;
}

export async function advanceWm(
  sc: WatermarkServiceClient,
  orgId: string,
  domain: string,
  next: string | null,
  prev: string | null,
): Promise<string | null> {
  // Monotonic: never rewind. next null (no rows this feed) keeps the prior cursor.
  const value = next === null ? prev : prev !== null && prev > next ? prev : next;
  if (value === null) return null;

  // A read-then-upsert is racy: another tick can advance the row after `prev` was read, then this
  // tick's ordinary upsert would rewind it. Update only a row that is still strictly behind value.
  const table = sc.from('external_sync_watermarks');
  const { count, error: updateError } = await table.update(
    { watermark_cursor: value },
    { count: 'exact' },
  ).eq('org_id', orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', domain)
    .lt('watermark_cursor', value);
  if (updateError) throw new AppError(updateError.message, updateError.code);

  // If no row matched, it is either already at/ahead of value or absent. Insert-if-absent handles
  // first activation without overwriting a concurrent winner; the final read reports the stored truth.
  if (count === 0) {
    const { error: insertError } = await sc.from('external_sync_watermarks').upsert(
      { org_id: orgId, external_tier: ERPNEXT_TIER, domain, watermark_cursor: value },
      { onConflict: 'org_id,external_tier,domain', ignoreDuplicates: true },
    );
    if (insertError) throw new AppError(insertError.message, insertError.code);
  }
  return readWm(sc, orgId, domain);
}
