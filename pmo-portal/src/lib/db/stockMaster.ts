import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded, toAppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type StockUnitRow = Tables<'stock_units'>;
export type StockItemRow = Tables<'stock_items'>;
export type StockWarehouseRow = Tables<'stock_warehouses'>;
export type StockKeeperRow = Tables<'stock_warehouse_keepers'>;
export interface StockUnitInput { code: string; name: string; wholeOnly: boolean }
export interface StockItemInput { code: string; name: string; description: string | null; unitId: string; leadTimeDays: number | null; tagId?: string | null }
export interface StockWarehouseInput { code: string; name: string; kind: 'central' | 'site' | 'yard' | 'staging'; projectId: string | null; coverValue: string | null }
export interface StockItemFilters { includeArchived?: boolean; tagId?: string; tagIds?: string[]; limit?: number }

const PAGE = 500;                 // below PostgREST max_rows (1000); a 1,203-row list is three pages, never truncated
const MAX_PAGES = 40;             // 20,000 rows; beyond that the call throws instead of silently truncating
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  limit?: number,
): Promise<T[]> {
  const out: T[] = [];
  const maxPages = limit !== undefined ? Math.max(1, Math.ceil(limit / PAGE)) : MAX_PAGES;
  for (let i = 0; i < maxPages; i++) {
    const from = i * PAGE;
    const to = limit !== undefined ? Math.min(from + PAGE - 1, limit - 1) : from + PAGE - 1;
    if (to < from) return out;
    const { data, error } = await page(from, to);
    if (error) throw toAppError(error);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < (to - from + 1)) return out;
    if (limit !== undefined && out.length >= limit) return out.slice(0, limit);
  }
  if (limit !== undefined) return out.slice(0, limit);
  throw new AppError('Too many rows to list; narrow the filter.', 'STK_TOO_MANY');
}

export const listStockUnits = (includeArchived = false) =>
  readAll<StockUnitRow>((a, b) => {
    let q = supabase.from('stock_units').select('*').order('code').order('id').range(a, b);
    if (!includeArchived) q = q.is('archived_at', null);
    return q;
  });
export const listStockItems = (filters: boolean | StockItemFilters = false): Promise<StockItemRow[]> => {
  const f: StockItemFilters = typeof filters === 'boolean' ? { includeArchived: filters } : filters;
  if (f.tagIds && f.tagIds.length === 0) return Promise.resolve([]);
  return readAll<StockItemRow>((a, b) => {
    let q = supabase.from('stock_items').select('*').order('code').order('id').range(a, b);
    if (!f.includeArchived) q = q.is('archived_at', null);
    if (f.tagId) q = q.eq('tag_id', f.tagId);
    if (f.tagIds && f.tagIds.length > 0) q = q.in('tag_id', f.tagIds);
    return q;
  }, f.limit);
};
export const listStockWarehouses = (includeArchived = false) =>
  readAll<StockWarehouseRow>((a, b) => {
    let q = supabase.from('stock_warehouses').select('*').order('code').order('id').range(a, b);
    if (!includeArchived) q = q.is('archived_at', null);
    return q;
  });
export const listWarehouseKeepers = () =>
  readAll<StockKeeperRow>((a, b) => supabase.from('stock_warehouse_keepers').select('*').order('warehouse_id').order('user_id').range(a, b));

export async function createStockUnit(i: StockUnitInput): Promise<StockUnitRow> {
  const { data, error } = await supabase.from('stock_units').insert({ code: i.code.trim(), name: i.name.trim(), whole_only: i.wholeOnly }).select('*').single();
  if (error) throw toAppError(error);
  return data;
}
export async function updateStockUnit(id: string, i: StockUnitInput): Promise<void> {
  const { data, error } = await supabase.from('stock_units').update({ code: i.code.trim(), name: i.name.trim(), whole_only: i.wholeOnly }).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot change this unit.');
}
export async function createStockItem(i: StockItemInput): Promise<StockItemRow> {
  const { data, error } = await supabase.from('stock_items').insert({
    code: i.code.trim(), name: i.name.trim(), description: i.description?.trim() || null, unit_id: i.unitId, lead_time_days: i.leadTimeDays,
    ...(i.tagId !== undefined ? { tag_id: i.tagId } : {}),
  }).select('*').single();
  if (error) throw toAppError(error);
  return data;
}
export async function updateStockItem(id: string, i: StockItemInput): Promise<void> {
  const { data, error } = await supabase.from('stock_items').update({
    code: i.code.trim(), name: i.name.trim(), description: i.description?.trim() || null, unit_id: i.unitId, lead_time_days: i.leadTimeDays,
    ...(i.tagId !== undefined ? { tag_id: i.tagId } : {}),
  }).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot change this item.');
}
export async function createStockWarehouse(i: StockWarehouseInput): Promise<StockWarehouseRow> {
  const { data, error } = await supabase.from('stock_warehouses').insert({ code: i.code.trim(), name: i.name.trim(), kind: i.kind, project_id: i.projectId, cover_value: i.coverValue as unknown as number }).select('*').single();
  if (error) throw toAppError(error);
  return data;
}
export async function updateStockWarehouse(id: string, i: StockWarehouseInput): Promise<void> {
  const { data, error } = await supabase.from('stock_warehouses').update({ code: i.code.trim(), name: i.name.trim(), kind: i.kind, project_id: i.projectId, cover_value: i.coverValue as unknown as number }).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot change this warehouse.');
}
export async function setArchived(table: 'stock_units' | 'stock_items' | 'stock_warehouses', id: string, archived: boolean): Promise<void> {
  const { data, error } = await supabase.from(table).update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot archive this record.');
}
export const archiveStockItem = (id: string) => setArchived('stock_items', id, true);
export async function setWarehouseKeeper(a: { warehouseId: string; userId: string; assigned: boolean }): Promise<void> {
  const { error } = await supabase.rpc('set_stock_warehouse_keeper', { p_warehouse_id: a.warehouseId, p_user_id: a.userId, p_assigned: a.assigned });
  if (error) throw toAppError(error);
}
