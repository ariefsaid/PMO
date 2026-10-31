import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type StockDocumentKind = 'receive' | 'transfer' | 'issue' | 'return' | 'adjustment' | 'count';
export type StockDocumentStatus = 'Draft' | 'Posted' | 'Cancelled';
export type StockDocumentRow = Tables<'stock_documents'>;

/** Quantities and costs are decimal strings end to end (NFR-STK-007): the client never holds them as floats. */
export interface StockLineInput {
  itemId: string;
  quantity?: string;
  unitCost?: string;
  boqItemId?: string;
  sourceLineId?: string;
  countedQuantity?: string;
  direction?: 'in' | 'out';
}
export interface StockDocumentInput {
  kind: StockDocumentKind;
  warehouseId: string;
  toWarehouseId?: string;
  projectId?: string;
  procurementId?: string;
  reason?: string;
  note?: string;
  occurredOn?: string;
  lines: StockLineInput[];
}

const defined = (o: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<string, string>;
const header = (i: StockDocumentInput) => defined({
  kind: i.kind, warehouse_id: i.warehouseId, to_warehouse_id: i.toWarehouseId, project_id: i.projectId,
  procurement_id: i.procurementId, reason: i.reason, note: i.note, occurred_on: i.occurredOn,
});
const lines = (i: StockDocumentInput) => i.lines.map((l) => defined({
  item_id: l.itemId, quantity: l.quantity, unit_cost: l.unitCost, boq_item_id: l.boqItemId,
  source_line_id: l.sourceLineId, counted_quantity: l.countedQuantity, direction: l.direction,
}));

/** `clientRequestId` is stable across retries of one submit (FR-STK-015), so a replay returns the same document. */
export async function createStockDocument(input: StockDocumentInput, opts: { post: boolean; clientRequestId: string }): Promise<string> {
  const { data, error } = await supabase.rpc('create_stock_document', {
    p_header: header(input), p_lines: lines(input), p_post: opts.post, p_client_request_id: opts.clientRequestId,
  });
  if (error) throw toAppError(error);
  return data as string;
}
export async function saveStockDraft(documentId: string, input: StockDocumentInput): Promise<void> {
  const { error } = await supabase.rpc('save_stock_draft', { p_document_id: documentId, p_header: header(input), p_lines: lines(input) });
  if (error) throw toAppError(error);
}
export async function postStockDocument(documentId: string): Promise<void> {
  const { error } = await supabase.rpc('post_stock_document', { p_document_id: documentId });
  if (error) throw toAppError(error);
}
export async function cancelStockDocument(documentId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_stock_document', { p_document_id: documentId });
  if (error) throw toAppError(error);
}

const DOC_COLS = 'id, number, kind, status, warehouse_id, to_warehouse_id, project_id, procurement_id, reason, note, occurred_on, created_by, created_at, posted_by, posted_at, cancelled_at';
const DOC_LIST_SELECT = `${DOC_COLS}, warehouse:stock_warehouses!warehouse_id(code,name), to_warehouse:stock_warehouses!to_warehouse_id(code,name), project:projects(name), author:profiles!created_by(full_name)`;

export interface StockDocumentListRow {
  id: string; number: string; kind: StockDocumentKind; status: StockDocumentStatus;
  warehouse_id: string; to_warehouse_id: string | null; project_id: string | null; occurred_on: string; created_by: string; created_at: string;
  warehouse: { code: string; name: string } | null; to_warehouse: { code: string; name: string } | null;
  project: { name: string } | null; author: { full_name: string } | null;
}
export interface StockDocumentFilters {
  kind?: StockDocumentKind; status?: StockDocumentStatus; warehouseId?: string; projectId?: string;
  limit?: number; before?: { createdAt: string; id: string };
}

/** Newest first, keyset on (created_at, id). Never `select *`: `unit_cost` is not column-granted on the line table. */
export async function listStockDocuments(f: StockDocumentFilters = {}): Promise<StockDocumentListRow[]> {
  let q = supabase.from('stock_documents').select(DOC_LIST_SELECT).order('created_at', { ascending: false }).order('id', { ascending: false });
  if (f.kind) q = q.eq('kind', f.kind);
  if (f.status) q = q.eq('status', f.status);
  if (f.warehouseId) q = q.eq('warehouse_id', f.warehouseId);
  if (f.projectId) q = q.eq('project_id', f.projectId);
  if (f.before) q = q.or(`created_at.lt.${f.before.createdAt},and(created_at.eq.${f.before.createdAt},id.lt.${f.before.id})`);
  const { data, error } = await q.limit(Math.min(Math.max(f.limit ?? 50, 1), 100));
  if (error) throw toAppError(error);
  return (data ?? []) as unknown as StockDocumentListRow[];
}

export interface StockDocumentLine {
  id: string; line_no: number; item_id: string;
  quantity: string | null; counted_quantity: string | null; expected_quantity: string | null;
  direction: 'in' | 'out' | null; boq_item_id: string | null; source_line_id: string | null;
  item: { code: string; name: string; unit: { code: string; whole_only: boolean } } | null;
}
export interface StockDocumentDetail extends StockDocumentListRow {
  procurement_id: string | null; reason: string | null; note: string | null; posted_by: string | null; posted_at: string | null; cancelled_at: string | null;
  lines: StockDocumentLine[];
}
const LINE_SELECT = 'stock_document_lines(id, line_no, item_id, quantity, counted_quantity, expected_quantity, direction, boq_item_id, source_line_id, item:stock_items(code,name,unit:stock_units(code,whole_only)))';
const dec = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function getStockDocument(id: string): Promise<StockDocumentDetail | null> {
  const { data, error } = await supabase.from('stock_documents').select(`${DOC_LIST_SELECT}, ${LINE_SELECT}`).eq('id', id).maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return null;
  const { stock_document_lines: ls, ...doc } = data as unknown as StockDocumentDetail & { stock_document_lines: StockDocumentLine[] };
  const lines = [...(ls ?? [])].sort((a, b) => a.line_no - b.line_no)
    .map((l) => ({ ...l, quantity: dec(l.quantity), counted_quantity: dec(l.counted_quantity), expected_quantity: dec(l.expected_quantity) }));
  return { ...doc, lines };
}

export interface IssuableWorkItem { id: string; line_no: number | null; item_code: string; description: string; unit: string | null }
/** Work items of a project to issue material to. Never the rate: an Engineer storekeeper must not receive prices here. */
export async function listIssuableWorkItems(projectId: string): Promise<IssuableWorkItem[]> {
  const { data, error } = await supabase.from('boq_items').select('id, line_no, item_code, description, unit').eq('project_id', projectId).order('line_no').order('item_code');
  if (error) throw toAppError(error);
  return (data ?? []) as unknown as IssuableWorkItem[];
}
