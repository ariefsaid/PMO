import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Database } from '@/src/lib/supabase/database.types';

/**
 * Vendor response time on an equipment breakdown (#2702, migrations 1372-1374). Everything moves through RPCs; nothing
 * here sends `org_id`, a recorder or a recording time.
 */
export interface BreakdownRow {
  asset_id: string;
  period_start: string;
  period_end: string | null;
  vendor_id: string | null;
  reported_at: string;
  responded_at: string | null;
  response_minutes: number | null;
  note: string | null;
}
export interface VendorResponseInput {
  asset_id: string;
  period_start: string;
  responded_at: string;
  reported_at?: string | null;
  note?: string | null;
}

type BreakdownRpcRow = Database['public']['Functions']['list_equipment_breakdowns']['Returns'][number];

export async function listBreakdowns(assetIds: string[], from: string, to: string): Promise<BreakdownRow[]> {
  if (!assetIds.length) return [];
  const { data, error } = await supabase.rpc('list_equipment_breakdowns', { p_asset_ids: assetIds, p_from: from, p_to: to });
  if (error) throw new AppError(error.message, error.code);
  // `returns table` states no nullability, so the generated row marks every column NOT NULL. The period end, the vendor
  // and the response are absent until a vendor answers; the interface above states that contract, and this maps onto it.
  return (data ?? []).map((row: BreakdownRpcRow) => ({
    asset_id: row.asset_id,
    period_start: row.period_start,
    period_end: row.period_end ?? null,
    vendor_id: row.vendor_id ?? null,
    reported_at: row.reported_at,
    responded_at: row.responded_at ?? null,
    response_minutes: row.response_minutes ?? null,
    note: row.note ?? null,
  }));
}

export async function recordVendorResponse(input: VendorResponseInput): Promise<string> {
  const { data, error } = await supabase.rpc('record_equipment_vendor_response', {
    p_asset: input.asset_id, p_period_start: input.period_start, p_responded_at: input.responded_at,
    // Both parameters DEFAULT to null, so omitting an absent one is the same request.
    p_reported_at: input.reported_at ?? undefined, p_note: input.note ?? undefined,
  });
  if (error) throw new AppError(error.message, error.code);
  return data;
}

export async function clearVendorResponse(assetId: string, periodStart: string): Promise<void> {
  const { error } = await supabase.rpc('clear_equipment_vendor_response', { p_asset: assetId, p_period_start: periodStart });
  if (error) throw new AppError(error.message, error.code);
}
