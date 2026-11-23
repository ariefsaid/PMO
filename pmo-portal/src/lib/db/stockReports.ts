import { supabase } from '@/src/lib/supabase/client';
import { AppError, toAppError } from '@/src/lib/appError';
import { listItemTagNames } from './stockMaster';

/** Quantities and money arrive as decimal strings from the read RPCs and stay strings (NFR-STK-007). Cost keys are absent below rank 20. */
export interface StockOnHandRow {
  itemId: string; itemCode: string; itemName: string; unitCode: string; wholeOnly: boolean;
  warehouseId: string; warehouseCode: string; warehouseName: string; warehouseKind: 'central' | 'site' | 'yard' | 'staging' | 'vendor';
  qtyOnHand: string; valueOnHand?: string; avgCost?: string;
  /** Only on a vendor location: the linked vendor company's name, when it has one. */
  vendorName?: string;
  /** The organisation's own tag for this item (its word for client-supplied stock); absent on an ordinary item. */
  tagName?: string;
}
export interface StockLedgerRow {
  seq: number; id: string; documentId: string; documentNumber: string; documentStatus: string; kind: string;
  postedAt: string; occurredOn: string; postedBy: string; actorName: string | null;
  itemId: string; itemCode: string; itemName: string; unitCode: string; warehouseId: string; warehouseCode: string;
  projectId: string | null; projectName: string | null; boqItemId: string | null; boqItemCode: string | null;
  qtyDelta: string; qtyAfter: string; valueDelta?: string; valueAfter?: string;
  /** The organisation's own tag for this item (its word for client-supplied stock); absent on an ordinary item. */
  tagName?: string;
}

/**
 * The read RPCs carry no item tag, so a screen that must mark client-supplied stock joins the organisation's tag by
 * item id here — one narrow read of tagged items only. An untagged item gets no key (absent, never a blank or a zero).
 */
async function withItemTags<T extends { itemId: string; tagName?: string }>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const tagByItem = new Map((await listItemTagNames()).map((t) => [t.itemId, t.tagName] as const));
  for (const row of rows) {
    const tagName = tagByItem.get(row.itemId);
    if (tagName) row.tagName = tagName;
  }
  return rows;
}
export interface StockLedgerFilters {
  itemId?: string; warehouseId?: string; projectId?: string; boqItemId?: string; documentId?: string; from?: string; to?: string;
}
export interface StockLedgerPage { rows: StockLedgerRow[]; nextBeforeSeq: number | null }

/** #2694: one row per location holding stock; money keys exist only when the server sent them (rank >= 20). */
export interface StockAtRiskRow {
  warehouseId: string; warehouseCode: string; warehouseName: string; warehouseKind: 'central' | 'site' | 'yard' | 'staging';
  projectId: string | null; projectName: string | null;
  stockValue?: string; coverValue?: string | null; atRisk?: string;
}

/** The project consumption report (#1512 S5, FR-STK-042/043). Per-month rows carry consumption only; allowances are cumulative to `to`. */
interface ConsumptionKey { boqItemId: string; boqItemCode: string; boqDescription: string; itemId: string; itemCode: string; itemName: string; unitCode: string }
export interface ConsumptionMonthRow extends ConsumptionKey {
  month: string; issued: string; returned: string; netConsumed: string; issuedBy: string[]; netValue?: string;
}
export interface ConsumptionAllowanceRow extends ConsumptionKey {
  id: string; plannedQuantity: string; netToDate: string; variance: string; overAllowance: boolean;
}
export interface ConsumptionUnplannedRow extends ConsumptionKey { netToDate: string }
/** #2282: material issued in Odoo whose cost is in the project's actuals but which has no single work item (no PMO document, or two lines
 *  of one item). `value` only for a member with the stock cost permission. */
export interface ConsumptionErpUnattributedRow {
  pickingRef: string; postingDate: string; tieState: 'no-document' | 'ambiguous'; quantity: string; stockDocumentId: string | null; value?: string;
}
export interface ProjectConsumption {
  from: string; to: string; months: ConsumptionMonthRow[]; allowances: ConsumptionAllowanceRow[]; unplanned: ConsumptionUnplannedRow[];
  erpUnattributed: ConsumptionErpUnattributedRow[];
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const defined = (o: Json) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const optional = (o: Json, k: string, to: string, out: Json) => { if (o[k] !== undefined) out[to] = o[k]; };

export async function getStockOnHand(f: { warehouseId?: string; itemId?: string; includeZero?: boolean }): Promise<StockOnHandRow[]> {
  const { data, error } = await supabase.rpc('get_stock_on_hand', defined({ p_warehouse_id: f.warehouseId, p_item_id: f.itemId, p_include_zero: f.includeZero }) as never);
  if (error) throw toAppError(error);
  const rows = ((data ?? []) as Json[]).map((r) => {
    const out: Json = {
      itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, unitCode: r.unit_code, wholeOnly: r.whole_only,
      warehouseId: r.warehouse_id, warehouseCode: r.warehouse_code, warehouseName: r.warehouse_name, warehouseKind: r.warehouse_kind,
      qtyOnHand: r.qty_on_hand,
    };
    optional(r, 'value_on_hand', 'valueOnHand', out); optional(r, 'avg_cost', 'avgCost', out);
    if (r.vendor_name != null) out.vendorName = r.vendor_name;
    return out as StockOnHandRow;
  });
  return withItemTags(rows);
}

export async function getStockAtRisk(): Promise<StockAtRiskRow[]> {
  const { data, error } = await supabase.rpc('get_stock_at_risk');
  if (error) throw toAppError(error);
  return ((data ?? []) as Json[]).map((r) => {
    const out: Json = {
      warehouseId: r.warehouse_id, warehouseCode: r.warehouse_code, warehouseName: r.warehouse_name, warehouseKind: r.warehouse_kind,
      projectId: r.project_id ?? null, projectName: r.project_name ?? null,
    };
    optional(r, 'stock_value', 'stockValue', out); optional(r, 'cover_value', 'coverValue', out); optional(r, 'at_risk', 'atRisk', out);
    return out as StockAtRiskRow;
  });
}

const mapLedger = (r: Json): StockLedgerRow => {
  const out: Json = {
    seq: r.seq, id: r.id, documentId: r.document_id, documentNumber: r.document_number, documentStatus: r.document_status, kind: r.kind,
    postedAt: r.posted_at, occurredOn: r.occurred_on, postedBy: r.posted_by, actorName: r.actor_name,
    itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, unitCode: r.unit_code,
    warehouseId: r.warehouse_id, warehouseCode: r.warehouse_code,
    projectId: r.project_id, projectName: r.project_name, boqItemId: r.boq_item_id, boqItemCode: r.boq_item_code,
    qtyDelta: r.qty_delta, qtyAfter: r.qty_after,
  };
  optional(r, 'value_delta', 'valueDelta', out); optional(r, 'value_after', 'valueAfter', out);
  return out as StockLedgerRow;
};

/** One page of the trace, as the database returns it (no tag join: the cursor loop must not pay it per page). */
async function readStockLedgerPage(f: StockLedgerFilters & { beforeSeq?: number; limit?: number }): Promise<StockLedgerPage> {
  const args = defined({
    p_item_id: f.itemId, p_warehouse_id: f.warehouseId, p_project_id: f.projectId, p_boq_item_id: f.boqItemId, p_document_id: f.documentId,
    p_from: f.from, p_to: f.to, p_before_seq: f.beforeSeq, p_limit: f.limit,
  });
  const { data, error } = await supabase.rpc('get_stock_ledger', args as never);
  if (error) throw toAppError(error);
  const d = (data ?? { rows: [], next_before_seq: null }) as { rows: Json[]; next_before_seq: number | null };
  return { rows: d.rows.map(mapLedger), nextBeforeSeq: d.next_before_seq };
}

/** The screen's page: each row carries its item's configured tag so the trace can mark client-supplied stock. */
export async function getStockLedgerPage(f: StockLedgerFilters & { beforeSeq?: number; limit?: number }): Promise<StockLedgerPage> {
  const page = await readStockLedgerPage(f);
  return { ...page, rows: await withItemTags(page.rows) };
}

/** Follows the cursor to the end. Throws at the page cap rather than silently truncating (FR-STK-044). */
export async function getStockLedgerAll(f: StockLedgerFilters, opts: { maxPages?: number } = {}): Promise<StockLedgerRow[]> {
  const maxPages = opts.maxPages ?? 25;
  const out: StockLedgerRow[] = [];
  let before: number | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await readStockLedgerPage({ ...f, beforeSeq: before, limit: 200 });
    out.push(...page.rows);
    if (page.nextBeforeSeq === null) return out;
    before = page.nextBeforeSeq;
  }
  throw new AppError('Too many ledger rows to load; narrow the filter.', 'STK_TOO_MANY');
}

const mapKey = (r: Json): ConsumptionKey => ({
  boqItemId: r.boq_item_id, boqItemCode: r.boq_item_code, boqDescription: r.boq_description,
  itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, unitCode: r.unit_code,
});

/** Aggregated in SQL (FR-STK-044). A failed or empty response throws: the screen shows an error, never a fabricated zero. */
export async function getProjectConsumption(projectId: string, from: string, to: string): Promise<ProjectConsumption> {
  const { data, error } = await supabase.rpc('get_project_consumption', { p_project_id: projectId, p_from: from, p_to: to });
  if (error) throw toAppError(error);
  if (!data) throw new AppError('The consumption report could not be computed.', 'STK_INVALID');
  const d = data as Json;
  return {
    from: d.from, to: d.to,
    months: (d.months as Json[]).map((r) => {
      const out: Json = { ...mapKey(r), month: r.month, issued: r.issued, returned: r.returned, netConsumed: r.net_consumed, issuedBy: r.issued_by ?? [] };
      optional(r, 'net_value', 'netValue', out);
      return out as ConsumptionMonthRow;
    }),
    allowances: (d.allowances as Json[]).map((r) => ({
      ...mapKey(r), id: r.id, plannedQuantity: r.planned_quantity, netToDate: r.net_to_date, variance: r.variance, overAllowance: r.over_allowance === true,
    })),
    unplanned: (d.unplanned as Json[]).map((r) => ({ ...mapKey(r), netToDate: r.net_to_date })),
    erpUnattributed: ((d.erp_unattributed as Json[] | undefined) ?? []).map((r) => {
      const out: Json = { pickingRef: r.picking_ref, postingDate: r.posting_date, tieState: r.tie_state, quantity: r.quantity, stockDocumentId: r.stock_document_id ?? null };
      optional(r, 'value', 'value', out);
      return out as ConsumptionErpUnattributedRow;
    }),
  };
}
