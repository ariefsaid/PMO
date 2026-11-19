import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { EquipmentStatus, RentalCheck } from '@/src/lib/equipmentMetrics';

/**
 * Equipment availability DAL (#2526, migrations 0985-0987). Everything moves through RPCs; nothing here sends `org_id`,
 * an actor or a stamp. The RPC types are not yet in the generated `database.types.ts` (no local database in the session
 * that wrote this): `rpc` below is the one cast, to be dropped when the types are regenerated.
 */
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
const rpc = (name: string, args?: Record<string, unknown>): Promise<RpcResult> =>
  (supabase.rpc as unknown as (n: string, a?: Record<string, unknown>) => Promise<RpcResult>)(name, args);
const call = async (name: string, args?: Record<string, unknown>): Promise<unknown> => {
  const { data, error } = await rpc(name, args);
  if (error) throw new AppError(error.message, error.code);
  return data;
};

export interface StatusDayRow { asset_id: string; status_date: string; status: EquipmentStatus; note: string | null }
export interface MetricsRow {
  asset_id: string; bucket_start: string; in_service_days: number; available_days: number; unrecorded_days: number;
  work_hours: number; availability_pct: number | null; utilisation_pct: number | null; pending_usage_entries: number;
}
export interface DowntimeFlag { asset_id: string; period_start: string; down_days: number }
export interface RentalCheckDay { date: string; status: EquipmentStatus; proven: boolean; deducted: boolean; proofs: { id: string; file_name: string; file_path: string }[] }
export type RentalCheckResult = Omit<RentalCheck, 'deductedDays' | 'unprovenDays' | 'includedUnprovenReason'> & {
  days: RentalCheckDay[]; unproven_days: string[]; included_unproven_reason: string | null;
};
export interface RentalTermInput {
  asset_id: string; vendor_id: string; rate: string; basis: 'day' | 'month'; currency: string; rented_from: string; rented_to?: string | null;
}

export type RentedAssetInput = Omit<RentalTermInput, 'asset_id'> & { code: string; name: string; default_unit: 'hours' | 'days' };
export async function createRentedAsset(input: RentedAssetInput): Promise<string> {
  return (await call('create_rented_equipment_asset', { p_code: input.code, p_name: input.name, p_unit: input.default_unit,
    p_vendor: input.vendor_id, p_rate: input.rate, p_basis: input.basis, p_currency: input.currency,
    p_from: input.rented_from, p_to: input.rented_to ?? null })) as string;
}

export async function listStatusDays(from: string, to: string): Promise<StatusDayRow[]> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { gte: (c: string, v: string) => { lte: (c: string, v: string) => { order: (c: string) => { limit: (n: number) => Promise<RpcResult> } } } } } })
    .from('equipment_status_days').select('asset_id, status_date, status, note').gte('status_date', from).lte('status_date', to)
    .order('status_date').limit(5000);
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []) as StatusDayRow[];
}
export async function setStatusBulk(date: string, items: { asset_id: string; status: EquipmentStatus; note?: string }[]): Promise<number> {
  return (await call('set_equipment_status_bulk', { p_date: date, p_items: items })) as number;
}
export async function setStatus(assetId: string, date: string, status: EquipmentStatus, note?: string): Promise<void> {
  await call('set_equipment_status', { p_asset: assetId, p_date: date, p_status: status, p_note: note ?? null });
}
export async function addProof(assetId: string, proofDate: string, fileName: string, note?: string): Promise<{ id: string; path: string }> {
  return (await call('add_equipment_downtime_proof', { p_asset: assetId, p_proof_date: proofDate, p_file_name: fileName, p_note: note ?? null })) as { id: string; path: string };
}
/** Uploads the file to the private bucket at the path the proof row returned (RLS: status roles only). */
export async function uploadProof(path: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from('equipment-proof').upload(path, file, { upsert: false });
  if (error) throw new AppError(error.message);
}
export async function getMetrics(assetIds: string[], from: string, to: string, grain: 'day' | 'week' | 'month'): Promise<MetricsRow[]> {
  return ((await call('equipment_metrics', { p_asset_ids: assetIds, p_from: from, p_to: to, p_grain: grain })) ?? []) as MetricsRow[];
}
export async function listDowntimeFlags(): Promise<DowntimeFlag[]> {
  return ((await call('list_equipment_downtime_flags')) ?? []) as DowntimeFlag[];
}
export async function setOwnership(assetId: string, ownership: 'owned' | 'rented', inServiceOn: string | null): Promise<void> {
  await call('set_equipment_ownership', { p_asset: assetId, p_ownership: ownership, p_in_service_on: inServiceOn });
}
export async function saveRentalTerm(term: RentalTermInput): Promise<string> {
  return (await call('save_equipment_rental_term', { p_term: term })) as string;
}
export async function changeRentalRate(assetId: string, effectiveOn: string, newRate: string): Promise<string> {
  return (await call('change_equipment_rental_rate', { p_asset: assetId, p_effective_on: effectiveOn, p_new_rate: newRate })) as string;
}
export async function rentalCheck(assetId: string, from: string, to: string, invoiceAmount?: string | null, includeUnprovenReason?: string | null): Promise<RentalCheckResult> {
  return (await call('equipment_rental_check', {
    p_asset: assetId, p_from: from, p_to: to, p_invoice_amount: invoiceAmount ?? null, p_include_unproven_reason: includeUnprovenReason ?? null,
  })) as RentalCheckResult;
}
