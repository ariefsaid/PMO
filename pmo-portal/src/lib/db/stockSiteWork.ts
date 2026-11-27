/**
 * stockSiteWork.ts (#2523) — stock tags (the org's own word for client-supplied stock), attachments on stock
 * documents, and the balance per work order. Spec docs/specs/stock-site-work.spec.md. The database enforces every rule
 * (zero-cost receive, frozen tag, posted-attachment lock, paper required); this file only reads, writes and maps.
 * Quantities and money stay decimal strings (NFR-STK-007); value keys are absent for roles that do not read stock value.
 */
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded, toAppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type StockTagRow = Tables<'stock_tags'>;
export type StockDocumentFileRow = Tables<'stock_document_files'>;
export interface StockTagInput { name: string; zeroCost: boolean; paperRequired: boolean }

export interface WorkOrderStockRow {
  workOrderId: string | null;           // null = movements whose document names no work order ("unassigned")
  itemId: string; itemCode: string; itemName: string; unitCode: string;
  warehouseId: string; warehouseCode: string; warehouseKind: 'central' | 'site' | 'yard' | 'staging' | 'vendor';
  tagId: string | null; tagName: string | null; zeroCost: boolean;
  receivedQty: string; movedOutQty: string; issuedQty: string; onSiteQty: string;
  receivedValue?: string; movedOutValue?: string; issuedValue?: string; onSiteValue?: string;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PAGE = 500;
const MAX_PAGES = 40;
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < MAX_PAGES; index++) {
    const { data, error } = await page(index * PAGE, (index + 1) * PAGE - 1);
    if (error) throw toAppError(error);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return rows;
  }
  throw new AppError('Too many rows to list; narrow the filter.', 'STK_TOO_MANY');
}
export function listStockTags(includeArchived = false): Promise<StockTagRow[]> {
  return readAll<StockTagRow>((from, to) => {
    let q = supabase.from('stock_tags').select('*').order('name').order('id').range(from, to);
    if (!includeArchived) q = q.is('archived_at', null);
    return q;
  });
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

export function listStockDocumentFiles(documentId: string): Promise<StockDocumentFileRow[]> {
  return readAll<StockDocumentFileRow>((from, to) => supabase.from('stock_document_files').select('*').eq('document_id', documentId)
    .order('created_at', { ascending: false }).order('id').range(from, to));
}
export async function addStockDocumentFile(a: { documentId: string; filePath: string; label: string | null }): Promise<StockDocumentFileRow> {
  const { data, error } = await supabase.from('stock_document_files')
    .insert({ document_id: a.documentId, file_path: a.filePath, label: a.label?.trim() || null }).select('*').single();
  if (error) throw toAppError(error);
  return data;
}
export async function deleteStockDocumentFile(id: string, filePath: string): Promise<void> {
  const { data, error } = await supabase.from('stock_document_files').delete().eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot remove this attachment.');
  const { error: storageError } = await supabase.storage.from('stock-documents').remove([filePath]);
  if (storageError) throw toAppError(storageError);
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

export interface MaterialCompletionRow {
  itemId: string; itemCode: string; itemName: string; unitCode: string;
  issued: string; returned: string; movedIn: string; movedOut: string; countedDifference: string; balance: string;
  issuedValue?: string; returnedValue?: string; balanceValue?: string;
}
export interface MaterialCompletionTotal { unitCode: string; issued: string; returned: string; movedIn: string; movedOut: string; countedDifference: string; balance: string }
export interface MaterialCompletion { rows: MaterialCompletionRow[]; totals: MaterialCompletionTotal[]; valueTotals: { issued: string; returned: string; balance: string } | null }

/** One read for the printable material completion of a work order (1124d). Cost fields arrive only for roles with cost access. */
export async function getWorkOrderMaterialCompletion(workOrderId: string): Promise<MaterialCompletion> {
  const { data, error } = await supabase.rpc('get_work_order_material_completion', { p_work_order_id: workOrderId } as never);
  if (error) throw toAppError(error);
  const d = (data ?? {}) as Json;
  return {
    rows: ((d.rows ?? []) as Json[]).map((r) => {
      const out: MaterialCompletionRow = {
        itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, unitCode: r.unit_code, issued: r.issued, returned: r.returned,
        movedIn: r.moved_in, movedOut: r.moved_out, countedDifference: r.counted_difference, balance: r.balance,
      };
      if (r.issued_value !== undefined) { out.issuedValue = r.issued_value; out.returnedValue = r.returned_value; out.balanceValue = r.balance_value; }
      return out;
    }),
    totals: ((d.totals ?? []) as Json[]).map((x) => ({ unitCode: x.unit_code, issued: x.issued, returned: x.returned, movedIn: x.moved_in, movedOut: x.moved_out, countedDifference: x.counted_difference, balance: x.balance })),
    valueTotals: d.value_totals ? { issued: d.value_totals.issued, returned: d.value_totals.returned, balance: d.value_totals.balance } : null,
  };
}

/** Upload before recording metadata, so a failed upload never counts as paper. */
export async function uploadStockDocumentFile(orgId: string, documentId: string, file: File, label: string | null): Promise<void> {
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160) || 'attachment';
  const filePath = `${orgId}/${documentId}/${id}/${safeName}`;
  const { error: uploadError } = await supabase.storage.from('stock-documents').upload(filePath, file);
  if (uploadError) throw toAppError(uploadError);
  const { error } = await supabase.from('stock_document_files').insert({ id, document_id: documentId, file_path: filePath, label });
  if (error) {
    await supabase.storage.from('stock-documents').remove([filePath]);
    throw toAppError(error);
  }
}
export async function stockDocumentFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('stock-documents').createSignedUrl(path, 300);
  if (error) throw toAppError(error);
  return data.signedUrl;
}
