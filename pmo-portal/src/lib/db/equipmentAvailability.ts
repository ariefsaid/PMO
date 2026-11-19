import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { EquipmentStatus } from '@/src/lib/equipmentMetrics';

/**
 * Equipment availability DAL (#2526, migrations 0985-0986). Everything moves through RPCs; nothing here sends `org_id`,
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
export interface RentalTermInput {
  asset_id: string; vendor_id: string; rate: string; basis: 'day' | 'month'; currency: string; rented_from: string; rented_to?: string | null;
}

export async function listStatusDays(from: string, to: string, assetIds?: string[]): Promise<StatusDayRow[]> {
  if (assetIds && !assetIds.length) return [];
  type Query = { select: (c: string) => Query; in: (c: string, v: string[]) => Query; gte: (c: string, v: string) => Query; lte: (c: string, v: string) => Query; order: (c: string) => Query; range: (from: number, to: number) => Promise<RpcResult> };
  const client = supabase as unknown as { from: (t: string) => Query };
  const rows: StatusDayRow[] = [];
  const size = 1000;
  for (let offset = 0; ; offset += size) {
    let query = client.from('equipment_status_days').select('asset_id, status_date, status, note')
      .gte('status_date', from).lte('status_date', to);
    if (assetIds) query = query.in('asset_id', assetIds);
    const { data, error } = await query.order('status_date').order('asset_id').range(offset, offset + size - 1);
    if (error) throw new AppError(error.message, error.code);
    const page = (data ?? []) as StatusDayRow[];
    rows.push(...page);
    if (page.length < size) return rows;
  }
}
/** Latest recorded state per machine, including previous months. Each response is bounded and deterministically ordered. */
export async function listLatestStatusDays(assetIds: string[], asOf: string): Promise<StatusDayRow[]> {
  if (!assetIds.length) return [];
  type Query = { select: (c: string) => Query; in: (c: string, v: string[]) => Query; lte: (c: string, v: string) => Query; order: (c: string, o?: { ascending: boolean }) => Query; range: (from: number, to: number) => Promise<RpcResult> };
  const client = supabase as unknown as { from: (t: string) => Query };
  const found = new Map<string, StatusDayRow>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('equipment_status_days').select('asset_id, status_date, status, note')
      .in('asset_id', assetIds).lte('status_date', asOf).order('status_date', { ascending: false }).order('asset_id').range(offset, offset + 999);
    if (error) throw new AppError(error.message, error.code);
    const page = (data ?? []) as StatusDayRow[];
    for (const row of page) if (!found.has(row.asset_id)) found.set(row.asset_id, row);
    if (page.length < 1000 || found.size === assetIds.length) return [...found.values()];
  }
}
export interface EquipmentProofState { asset_id: string; proven: boolean }
export async function listEquipmentProofs(assetIds: string[], date: string): Promise<EquipmentProofState[]> {
  return ((await call('list_equipment_proofs', { p_asset_ids: assetIds, p_on: date })) ?? []) as EquipmentProofState[];
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
export interface RentalTermRow { id: string; vendor_id: string; rate: number; basis: 'day' | 'month'; currency: string; rented_from: string; rented_to: string | null }
export async function listRentalTerms(assetId: string): Promise<RentalTermRow[]> {
  type Query = { select: (columns: string) => Query; eq: (column: string, value: string) => Query; order: (column: string, options: { ascending: boolean }) => Query; range: (from: number, to: number) => Promise<RpcResult> };
  const client = supabase as unknown as { from: (table: string) => Query };
  const rows: RentalTermRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('equipment_rental_terms').select('id, vendor_id, rate, basis, currency, rented_from, rented_to').eq('asset_id', assetId).order('rented_from', { ascending: false }).range(offset, offset + 999);
    if (error) throw new AppError(error.message, error.code);
    const page = (data ?? []) as RentalTermRow[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
export async function saveRentalTerm(term: RentalTermInput): Promise<string> {
  return (await call('save_equipment_rental_term', { p_term: term })) as string;
}
export async function changeRentalRate(assetId: string, effectiveOn: string, newRate: string): Promise<string> {
  return (await call('change_equipment_rental_rate', { p_asset: assetId, p_effective_on: effectiveOn, p_new_rate: newRate })) as string;
}

export async function setWorkingHours(hours: string): Promise<void> {
  await call('set_equipment_working_hours', { p_hours: hours });
}

export interface RentalCheckDay { date: string; status: EquipmentStatus; proven: boolean; deducted: boolean; proofs: { id: string; file_name: string; file_path: string }[] }
export interface RentalCheckResult { currency: string | null; rental_amount: string; deduction: string; expected_amount: string; difference: string | null; days: RentalCheckDay[]; unproven_days: string[]; included_unproven_reason: string | null }
export async function rentalCheck(assetId: string, from: string, to: string, invoiceAmount?: string | null, includeUnprovenReason?: string | null): Promise<RentalCheckResult> {
  return (await call('equipment_rental_check', { p_asset: assetId, p_from: from, p_to: to, p_invoice_amount: invoiceAmount ?? null, p_include_unproven_reason: includeUnprovenReason ?? null })) as RentalCheckResult;
}
export async function proofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('equipment-proof').createSignedUrl(path, 60);
  if (error) throw new AppError(error.message);
  if (!data?.signedUrl) throw new AppError('Proof link is unavailable');
  return data.signedUrl;
}
