import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Vendor response time on an equipment breakdown (#2702, migrations 1372-1374). Everything moves through RPCs; nothing
 * here sends `org_id`, a recorder or a recording time. The RPC types are not yet in the generated `database.types.ts`.
 */
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
const call = async (name: string, args?: Record<string, unknown>): Promise<unknown> => {
  const { data, error } = await (supabase.rpc as unknown as (n: string, a?: Record<string, unknown>) => Promise<RpcResult>)(name, args);
  if (error) throw new AppError(error.message, error.code);
  return data;
};

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

export async function listBreakdowns(assetIds: string[], from: string, to: string): Promise<BreakdownRow[]> {
  if (!assetIds.length) return [];
  return ((await call('list_equipment_breakdowns', { p_asset_ids: assetIds, p_from: from, p_to: to })) ?? []) as BreakdownRow[];
}
export async function recordVendorResponse(input: VendorResponseInput): Promise<string> {
  return (await call('record_equipment_vendor_response', {
    p_asset: input.asset_id, p_period_start: input.period_start, p_responded_at: input.responded_at,
    p_reported_at: input.reported_at ?? null, p_note: input.note ?? null,
  })) as string;
}
export async function clearVendorResponse(assetId: string, periodStart: string): Promise<void> {
  await call('clear_equipment_vendor_response', { p_asset: assetId, p_period_start: periodStart });
}
