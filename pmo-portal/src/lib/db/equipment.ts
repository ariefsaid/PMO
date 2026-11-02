import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Database, Json, Tables } from '@/src/lib/supabase/database.types';

/**
 * Equipment usage DAL (#1519 S5, plan S5.1).
 *
 * Usage, approval and costing move ONLY through the RPCs (migrations 0447/0460/0471): nothing here sends `org_id`, a
 * status, an author or a stamp — the RPCs state them (`save_equipment_usage` sets Draft + author). The thin asset
 * reference is the one table write, and it sends granted columns only (`code`, `name`, `default_unit`, `archived_at`).
 * Lists are bounded at `LIST_LIMIT + 1` so a silently trimmed read can never be read as the whole set (money-path
 * primer bucket 5). Reads never carry an amount an RPC withheld: the server (not this module) decides who sees money.
 */
export type EquipmentAssetRow = Tables<'equipment_assets'>;
export type EquipmentUsageRow = Tables<'equipment_usage_entries'>;
export type EquipmentCostingRow = Database['public']['Functions']['list_equipment_costing']['Returns'][number];
export type EquipmentAllocationRow = Database['public']['Functions']['list_equipment_allocations']['Returns'][number];
export type EquipmentUsageTotalRow = Database['public']['Functions']['list_equipment_usage_totals']['Returns'][number];
export type UsageStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected';
export interface UsageInput {
  id?: string;
  asset_id: string;
  project_id: string;
  work_date: string;
  quantity: number;
  unit: 'hours' | 'days';
  kind: 'work' | 'standby';
  fuel_litres?: number | null;
  trips?: number | null;
  note?: string | null;
}
/** OQ-7: the day's total across projects WARNS (never blocks) — `over_24h` is a message, not a refusal. */
export interface UsageSaveResult { id: string; status: UsageStatus; day_total_hours: number; over_24h: boolean }
export interface CostingDraft {
  setting_key?: string | null;
  expected_version?: number | null;
  asset_id: string;
  basis: 'none' | 'hire_rate' | 'actual_cost';
  work_rate?: number | null;
  standby_rate?: number | null;
  rate_unit?: 'hours' | 'days' | null;
  driver?: 'units' | 'fuel' | 'trips' | null;
  count_standby?: boolean;
  charge_category?: string | null;
  account?: string;
  account_group?: string;
  cost_center?: string | null;
  party_type?: string | null;
  party?: string | null;
  effective_from: string;
  effective_to?: string | null;
}
/** One preview row: `project_id` is null for a pool no approved usage drove, `category` null when the account maps to none. */
export interface CostingPreviewRow {
  project_id: string | null;
  month: string;
  category: string | null;
  basis: string;
  amount: number | null;
  driver_total: number | null;
  entry_count: number;
}
export interface CostingSaveResult { setting_key: string; version: number; changed: boolean }

export const LIST_LIMIT = 200;
export interface Bounded<T> { rows: T[]; truncated: boolean }
const bounded = <T>(rows: T[] | null): Bounded<T> =>
  ({ rows: (rows ?? []).slice(0, LIST_LIMIT), truncated: (rows ?? []).length > LIST_LIMIT });
const fail = (error: { message: string; code?: string } | null): void => { if (error) throw new AppError(error.message, error.code); };

// ── the thin asset reference (OQ-9: hand-made now, adopted to the mirror when #1511/#899 ship) ──────
export async function listAssets(): Promise<Bounded<EquipmentAssetRow>> {
  const { data, error } = await supabase.from('equipment_assets').select('*')
    .is('archived_at', null).order('code').limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
export async function createAsset(input: { code: string; name: string; default_unit: 'hours' | 'days' }): Promise<EquipmentAssetRow> {
  const { data, error } = await supabase.from('equipment_assets')
    .insert({ code: input.code, name: input.name, default_unit: input.default_unit } as never)
    .select('*').single();
  fail(error);
  return data as EquipmentAssetRow;
}
export async function updateAsset(
  id: string,
  patch: Partial<Pick<EquipmentAssetRow, 'code' | 'name' | 'default_unit' | 'archived_at'>>,
): Promise<void> {
  const { data, error } = await supabase.from('equipment_assets').update(patch as never).eq('id', id).select('id');
  fail(error);
  assertWriteLanded(data, 'the asset was not saved: you cannot edit the equipment reference');
}

// ── usage (0447): reads over granted columns, every write an RPC ──────────────────────────────────
export async function listUsage(
  range: { from: string; to: string; assetId?: string; projectId?: string; status?: UsageStatus },
): Promise<Bounded<EquipmentUsageRow>> {
  let query = supabase.from('equipment_usage_entries').select('*')
    .gte('work_date', range.from).lte('work_date', range.to).is('archived_at', null);
  if (range.assetId) query = query.eq('asset_id', range.assetId);
  if (range.projectId) query = query.eq('project_id', range.projectId);
  if (range.status) query = query.eq('status', range.status);
  const { data, error } = await query.order('work_date', { ascending: false }).order('created_at', { ascending: true }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
export async function saveUsage(input: UsageInput): Promise<UsageSaveResult> {
  const { data, error } = await supabase.rpc('save_equipment_usage', { p_entry: input as unknown as Json });
  fail(error);
  return data as unknown as UsageSaveResult;
}
export async function transitionUsage(id: string, to: UsageStatus, notes?: string): Promise<void> {
  // `p_notes` is nullable in SQL with a default of null; the generated type is optimistic (`?: string`), so "no note" is
  // sent as undefined and the DB default applies (the transition core treats a missing note as none).
  const { error } = await supabase.rpc('transition_equipment_usage', { p_id: id, p_to: to, p_notes: notes ?? undefined });
  fail(error);
}
export async function approveWeek(
  assetId: string, weekStart: string,
): Promise<{ approved: number; skipped_own: number; skipped_not_permitted: number }> {
  const { data, error } = await supabase.rpc('approve_equipment_usage_week', { p_asset_id: assetId, p_week_start: weekStart });
  fail(error);
  return data as unknown as { approved: number; skipped_own: number; skipped_not_permitted: number };
}
export async function archiveUsage(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_equipment_usage', { p_id: id });
  fail(error);
}
/** Approved (and waiting) totals per asset, project and month — an Engineer reads these without any amount (FR-EQU-062). */
export async function listUsageTotals(
  q: { projectId?: string; assetId?: string; from: string; to: string },
): Promise<Bounded<EquipmentUsageTotalRow>> {
  const { data, error } = await supabase.rpc('list_equipment_usage_totals', {
    p_project_id: q.projectId ?? undefined, p_asset_id: q.assetId ?? undefined, p_from: q.from, p_to: q.to,
  });
  fail(error);
  return bounded(data);
}

// ── costing settings (0460/0471): Admin/Finance write; amounts are the server's to withhold ───────
export async function listCosting(includeHistory = false): Promise<EquipmentCostingRow[]> {
  const { data, error } = await supabase.rpc('list_equipment_costing', { p_include_history: includeHistory });
  fail(error);
  return data ?? [];
}
export async function saveCosting(draft: CostingDraft): Promise<CostingSaveResult> {
  const { data, error } = await supabase.rpc('save_equipment_costing', { p_setting: draft as unknown as Json });
  fail(error);
  return data as unknown as CostingSaveResult;
}
export async function endCosting(settingKey: string, effectiveTo: string, expectedVersion: number): Promise<void> {
  const { error } = await supabase.rpc('end_equipment_costing', {
    p_setting_key: settingKey, p_effective_to: effectiveTo, p_expected_version: expectedVersion,
  });
  fail(error);
}
/** Preview = save by construction: the draft goes over unchanged and the DB normalises it (same normaliser, conflict
 *  check and charge function the save path uses), so a preview can never promise a different number from the save. */
export async function previewCosting(draft: CostingDraft): Promise<CostingPreviewRow[]> {
  const { data, error } = await supabase.rpc('preview_equipment_costing', { p_setting: draft as unknown as Json });
  fail(error);
  return (data ?? []).map((row) => ({
    project_id: row.project_id ?? null,
    month: row.month,
    category: row.category ?? null,
    basis: row.basis,
    amount: row.amount === null ? null : Number(row.amount),
    driver_total: row.driver_total === null ? null : Number(row.driver_total),
    entry_count: row.entry_count,
  }));
}
/** A costed month per asset and project. `p_project_id` is only sent when given (the RPC defaults it to null). */
export async function listAllocations(
  q: { assetId?: string; projectId?: string; from: string; to: string },
): Promise<Bounded<EquipmentAllocationRow>> {
  const { data, error } = await supabase.rpc('list_equipment_allocations', {
    p_asset_id: (q.assetId ?? null) as unknown as string,
    p_from: q.from,
    p_to: q.to,
    ...(q.projectId ? { p_project_id: q.projectId } : {}),
  });
  fail(error);
  return bounded(data);
}
