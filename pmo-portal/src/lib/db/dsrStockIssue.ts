/**
 * dsrStockIssue.ts (#2676) — what a validated daily report did to stock, the organisation setting that turns it on, the work order's site
 * location and the item's consumable flag. Spec docs/specs/daily-report-stock-issue.spec.md. The database decides everything (migrations
 * 1320-1324); this file only reads, writes and maps. Quantities stay decimal strings.
 */
import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { toAppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { readOrgColumnsStrict } from './orgSettingsBatch';

export type DsrStockItems = 'all' | 'consumables';
export type DsrStockState = 'posted' | 'partial' | 'flagged' | 'out_of_scope';
export type DsrStockLineState = 'posted' | 'short' | 'no_location' | 'no_work_item' | 'not_stocked' | 'failed' | 'pending';
export interface DsrStockSettings { enabled: boolean; items: DsrStockItems }
export interface DsrStockLine {
  consumableId: string; position: number; itemCode: string; itemName: string; unit: string; quantity: string;
  state: DsrStockLineState; shortBy: string | null; reason: string | null;
}
export interface DsrStockStatus {
  state: DsrStockState; reason: string | null; occurredOn: string | null; reversed: boolean; location: string | null;
  documentNumber: string | null; lines: DsrStockLine[];
}
export interface SiteLocationOption { id: string; name: string; kind: string }

const OFF: DsrStockSettings = { enabled: false, items: 'all' };
const FLAGGED: DsrStockLineState[] = ['short', 'no_location', 'no_work_item', 'failed'];
export const isFlaggedLine = (s: DsrStockLineState): boolean => FLAGGED.includes(s);

/** The shape `dsr_stock_status` builds in jsonb; the RPC states no columns, so this module does. */
interface DsrStockStatusRpc {
  state: DsrStockState; reason: string | null; occurred_on: string | null; reversed: boolean | null;
  location: string | null; document_number: string | null;
  lines: Array<{
    consumable_id: string; position: number; item_code: string; item_name: string; unit: string; quantity: string | number;
    state: DsrStockLineState; short_by: string | number | null; reason: string | null;
  }> | null;
}

/** The organisation's setting; a read that fails counts as off, so a screen never shows the feature by accident. */
export async function getDsrStockSettings(): Promise<DsrStockSettings> {
  try {
    const { data, error } = await readOrgColumnsStrict(['dsr_stock_issue', 'dsr_stock_issue_items']);
    if (error || !data) return OFF;
    return { enabled: data.dsr_stock_issue === true, items: data.dsr_stock_issue_items === 'consumables' ? 'consumables' : 'all' };
  } catch {
    return OFF;
  }
}

/** Admin only (the database refuses anyone else). */
export async function setDsrStockSettings(enabled: boolean, items: DsrStockItems): Promise<void> {
  const { error } = await supabase.rpc('set_dsr_stock_issue', { p_on: enabled, p_items: items });
  if (error) throw toAppError(error);
}

/** The report's stock result, or null when it posted nothing (setting off, or not yet validated). */
export async function getDsrStockStatus(reportId: string): Promise<DsrStockStatus | null> {
  const { data, error } = await supabase.rpc('dsr_stock_status', { p_report: reportId });
  if (error) throw toAppError(error);
  if (!data) return null;
  // `dsr_stock_status` is declared `returns jsonb`, so the generated type is `Json` and carries no shape; the interface
  // above is the contract and this maps onto it, keeping every figure a decimal string.
  const status = data as unknown as DsrStockStatusRpc;
  return {
    state: status.state, reason: status.reason ?? null, occurredOn: status.occurred_on ?? null, reversed: status.reversed === true,
    location: status.location ?? null, documentNumber: status.document_number ?? null,
    lines: (status.lines ?? []).map((l) => ({
      consumableId: l.consumable_id, position: Number(l.position), itemCode: l.item_code, itemName: l.item_name, unit: l.unit, quantity: String(l.quantity),
      state: l.state, shortBy: l.short_by == null ? null : String(l.short_by), reason: l.reason ?? null,
    })),
  };
}

/** Which of these reports have a stock flag, for the list marker (one page of the list at most, so the id list is bounded). */
export async function listDsrStockFlags(reportIds: string[]): Promise<Set<string>> {
  if (reportIds.length === 0) return new Set();
  const rows = await fetchAllPages<{ report_id: string }>((from, to) =>
    supabase.from('dsr_stock_postings').select('report_id').in('report_id', reportIds).in('state', ['partial', 'flagged']).is('reversed_at', null).order('id').range(from, to));
  return new Set(rows.map((r) => r.report_id));
}

export async function listSiteLocations(projectId: string): Promise<SiteLocationOption[]> {
  return fetchAllPages<SiteLocationOption>((from, to) => supabase.from('stock_warehouses').select('id, name, kind').eq('project_id', projectId)
    .in('kind', ['site', 'yard', 'staging']).is('archived_at', null).order('name').order('id').range(from, to));
}
export async function getWorkOrderSiteLocation(workOrderId: string): Promise<string | null> {
  const { data, error } = await supabase.from('work_orders').select('site_warehouse_id').eq('id', workOrderId).maybeSingle();
  if (error) throw toAppError(error);
  return data?.site_warehouse_id ?? null;
}
export async function setWorkOrderSiteLocation(workOrderId: string, warehouseId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_work_order_site_location', { p_work_order_id: workOrderId, p_warehouse_id: nullableArg(warehouseId) });
  if (error) throw toAppError(error);
}

export async function listConsumableFlags(): Promise<{ id: string; code: string; name: string; consumable: boolean }[]> {
  return fetchAllPages<{ id: string; code: string; name: string; consumable: boolean }>((from, to) =>
    supabase.from('stock_items').select('id, code, name, consumable').is('archived_at', null).order('code').order('id').range(from, to));
}
export async function setItemConsumable(itemId: string, consumable: boolean): Promise<void> {
  const { error } = await supabase.from('stock_items').update({ consumable }).eq('id', itemId);
  if (error) throw toAppError(error);
}
