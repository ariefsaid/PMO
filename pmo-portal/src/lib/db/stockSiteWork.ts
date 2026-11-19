/**
 * stockSiteWork.ts (#2523) — stock tags (the org's own word for client-supplied stock), attachments on stock
 * documents, and the balance per work order. Spec docs/specs/stock-site-work.spec.md. The database enforces every rule
 * (zero-cost receive, frozen tag, posted-attachment lock, paper required); this file only reads, writes and maps.
 * Quantities and money stay decimal strings (NFR-STK-007); value keys are absent for roles that do not read stock value.
 */
import { supabase } from '@/src/lib/supabase/client';
import { assertWriteLanded, toAppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type StockTagRow = Tables<'stock_tags'>;
export type StockDocumentFileRow = Tables<'stock_document_files'>;
export interface StockTagInput { name: string; zeroCost: boolean; paperRequired: boolean }

export interface WorkOrderStockRow {
  workOrderId: string | null;           // null = movements whose document names no work order ("unassigned")
  itemId: string; itemCode: string; itemName: string; unitCode: string;
  warehouseId: string; warehouseCode: string; warehouseKind: 'site' | 'yard' | 'staging';
  tagId: string | null; tagName: string | null; zeroCost: boolean;
  receivedQty: string; movedOutQty: string; issuedQty: string; onSiteQty: string;
  receivedValue?: string; movedOutValue?: string; issuedValue?: string; onSiteValue?: string;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function listStockTags(includeArchived = false): Promise<StockTagRow[]> {
  let q = supabase.from('stock_tags').select('*').order('name').order('id').limit(500);
  if (!includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q;
  if (error) throw toAppError(error);
  return data ?? [];
}
export async function createStockTag(i: StockTagInput): Promise<StockTagRow> {
  const { data, error } = await supabase.from('stock_tags')
    .insert({ name: i.name.trim(), zero_cost: i.zeroCost, paper_required: i.zeroCost && i.paperRequired }).select('*').single();
  if (error) throw toAppError(error);
  return data;
}
export async function updateStockTag(id: string, i: StockTagInput): Promise<void> {
  const { data, error } = await supabase.from('stock_tags')
    .update({ name: i.name.trim(), zero_cost: i.zeroCost, paper_required: i.zeroCost && i.paperRequired }).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot change this tag.');
}
export async function setStockTagArchived(id: string, archived: boolean): Promise<void> {
  const { data, error } = await supabase.from('stock_tags').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot change this tag.');
}

export async function listStockDocumentFiles(documentId: string): Promise<StockDocumentFileRow[]> {
  const { data, error } = await supabase.from('stock_document_files').select('*').eq('document_id', documentId)
    .order('created_at', { ascending: false }).order('id').limit(200);
  if (error) throw toAppError(error);
  return data ?? [];
}
export async function addStockDocumentFile(a: { documentId: string; filePath: string; label: string | null }): Promise<StockDocumentFileRow> {
  const { data, error } = await supabase.from('stock_document_files')
    .insert({ document_id: a.documentId, file_path: a.filePath, label: a.label?.trim() || null }).select('*').single();
  if (error) throw toAppError(error);
  return data;
}
export async function deleteStockDocumentFile(id: string): Promise<void> {
  const { data, error } = await supabase.from('stock_document_files').delete().eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot remove this attachment.');
}
export async function archiveStockDocumentFile(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('archive_stock_document_file', { p_file_id: id, p_reason: reason });
  if (error) throw toAppError(error);
}

/** Per work order (or, with a project, every bucket incl. unassigned). An empty list is "nothing moved yet", never zero money. */
export async function getWorkOrderStockBalance(f: { workOrderId?: string; projectId?: string }): Promise<WorkOrderStockRow[]> {
  const args: Json = {};
  if (f.workOrderId) args.p_work_order_id = f.workOrderId;
  if (f.projectId) args.p_project_id = f.projectId;
  const { data, error } = await supabase.rpc('get_work_order_stock_balance', args as never);
  if (error) throw toAppError(error);
  return ((data ?? []) as Json[]).map((r) => {
    const out: Json = {
      workOrderId: r.work_order_id ?? null, itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, unitCode: r.unit_code,
      warehouseId: r.warehouse_id, warehouseCode: r.warehouse_code, warehouseKind: r.warehouse_kind,
      tagId: r.tag_id ?? null, tagName: r.tag_name ?? null, zeroCost: r.zero_cost === true,
      receivedQty: r.received_qty, movedOutQty: r.moved_out_qty, issuedQty: r.issued_qty, onSiteQty: r.on_site_qty,
    };
    for (const [k, to] of [['received_value', 'receivedValue'], ['moved_out_value', 'movedOutValue'], ['issued_value', 'issuedValue'], ['on_site_value', 'onSiteValue']] as const) {
      if (r[k] !== undefined) out[to] = r[k];
    }
    return out as WorkOrderStockRow;
  });
}
