import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Three-way match DAL (#2622, migration 1018, docs/specs/three-way-match.spec.md). The rule, the payment gate and the
 * exception's separation of duties all live in the database; this module only reads a bill's match and carries a
 * person's exception approval. Nothing here sends `org_id`, an actor or a stamp.
 *
 * The 1018 RPCs and table are not yet in the generated `database.types.ts` (no local database in the session that wrote
 * this): `rpc` and `table` below are the one cast each, to be dropped when the types are regenerated.
 */
type RpcResult = { data: unknown; error: { message: string; code?: string; details?: string | null } | null };
const rpc = (name: string, args: Record<string, unknown>): Promise<RpcResult> =>
  (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<RpcResult>)(name, args);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see the note above: the table is not in the generated types yet.
const table = (name: string): any => supabase.from(name as never);

/** A refusal is classified by its machine-readable detail when it carries one, else by its SQLSTATE. */
function fail(error: { message: string; code?: string; details?: string | null }): never {
  const detail = typeof error.details === 'string' && /^[a-z][a-z0-9-]*$/.test(error.details) ? error.details : undefined;
  throw new AppError(error.message, detail ?? error.code);
}

export type BillMatchStatus = 'not_applicable' | 'matched' | 'held' | 'exception_approved';
export type BillMatchReason = 'no_lines' | 'amount_mismatch';
export type BillMatchLineReason = 'not_on_order' | 'over_received' | 'over_ordered' | 'price_variance';

export interface BillMatchLine {
  itemId: string;
  itemName: string | null;
  /** Quantities and rates as the database states them (exact decimal text); null when not on the order. */
  ordered: string | null;
  orderRate: string | null;
  received: string;
  billedToDate: string;
  billQuantity: string;
  billRate: string | null;
  billAmount: string | null;
  reasons: BillMatchLineReason[];
}

export interface BillMatch {
  status: BillMatchStatus;
  reasons: BillMatchReason[];
  lines: BillMatchLine[];
  quantityTolerancePct: string | null;
  amountTolerancePct: string | null;
  exception: { approvedBy: string; approvedAt: string; reason: string } | null;
}

export interface ThreeWayMatchSettings {
  enabled: boolean;
  quantityTolerancePct: string;
  amountTolerancePct: string;
}

const STATUSES: readonly BillMatchStatus[] = ['not_applicable', 'matched', 'held', 'exception_approved'];
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** A malformed match is an error, never a plausible status (a wrong "matched" would hide a hold). */
export function parseBillMatch(raw: unknown): BillMatch {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || !STATUSES.includes(m.status as BillMatchStatus)) {
    throw new AppError('Three-way match read: unexpected result', 'bill-match-malformed');
  }
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const lines = (Array.isArray(m.lines) ? m.lines : []).map((l: Record<string, unknown>) => ({
    itemId: String(l.item_id),
    itemName: text(l.item_name),
    ordered: text(l.ordered),
    orderRate: text(l.order_rate),
    received: text(l.received) ?? '0',
    billedToDate: text(l.billed_to_date) ?? '0',
    billQuantity: text(l.bill_quantity) ?? '0',
    billRate: text(l.bill_rate),
    billAmount: text(l.bill_amount),
    reasons: list(l.reasons) as BillMatchLineReason[],
  }));
  const e = m.exception as Record<string, unknown> | null | undefined;
  return {
    status: m.status as BillMatchStatus,
    reasons: list(m.reasons) as BillMatchReason[],
    lines,
    quantityTolerancePct: text(m.quantity_tolerance_pct),
    amountTolerancePct: text(m.amount_tolerance_pct),
    exception: e ? { approvedBy: String(e.approved_by), approvedAt: String(e.approved_at), reason: String(e.reason ?? '') } : null,
  };
}

/** One bill's match (Admin, Executive, Project Manager, Finance; 1018 §11). */
export async function getBillMatch(invoiceId: string): Promise<BillMatch> {
  const { data, error } = await rpc('get_bill_match', { p_invoice_id: invoiceId });
  if (error) fail(error);
  return parseBillMatch(data);
}

/**
 * Approve a held bill's exception with a reason (Admin or Finance; never the bill's author nor the person who recorded
 * its lines — the database refuses with `three-way-match-own-bill` / `three-way-match-author-unknown`). Returns the match
 * as it now stands.
 */
export async function approveBillMatchException(invoiceId: string, reason: string): Promise<BillMatch> {
  const { data, error } = await rpc('approve_bill_match_exception', { p_invoice_id: invoiceId, p_reason: reason });
  if (error) fail(error);
  return parseBillMatch(data);
}

/** The organisation's match setting; null when it was never set (the match is off). */
export async function getThreeWayMatchSettings(): Promise<ThreeWayMatchSettings | null> {
  const { data, error } = await table('org_three_way_match_settings')
    .select('enabled,quantity_tolerance_pct,amount_tolerance_pct').maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  return { enabled: data.enabled === true, quantityTolerancePct: String(data.quantity_tolerance_pct), amountTolerancePct: String(data.amount_tolerance_pct) };
}

// ── #2634: the Admin setting and the line editors (1357 over 1018). Nothing here sends org_id, an actor or a stamp.

/** Save the organisation's match setting (Admin only; the database refuses anyone else with 42501). */
export async function setThreeWayMatchSettings(input: { enabled: boolean; quantityTolerancePct: number; amountTolerancePct: number }): Promise<ThreeWayMatchSettings> {
  const { data, error } = await rpc('set_three_way_match_settings', {
    p_enabled: input.enabled, p_quantity_tolerance_pct: input.quantityTolerancePct, p_amount_tolerance_pct: input.amountTolerancePct,
  });
  if (error) fail(error);
  const r = data as Record<string, unknown>;
  return { enabled: r.enabled === true, quantityTolerancePct: String(r.quantity_tolerance_pct), amountTolerancePct: String(r.amount_tolerance_pct) };
}

/** How many bills of the organisation are held now (Admin only), shown before the match is switched off. */
export async function getThreeWayMatchHeldCount(): Promise<number> {
  const { data, error } = await rpc('three_way_match_held_count', {});
  if (error) fail(error);
  return Number(data ?? 0);
}

/** A purchase's ordered items: the order lines the receipt and bill lines are keyed on (D-TWM-1). */
export interface OrderedItem { id: string; name: string; quantity: string; rate: string }
export async function listOrderedItems(procurementId: string): Promise<OrderedItem[]> {
  const { data, error } = await table('procurement_items').select('id,name,quantity,rate').eq('procurement_id', procurementId).order('name');
  if (error) fail(error);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), name: String(r.name ?? ''), quantity: String(r.quantity), rate: String(r.rate) }));
}

/** The lines already recorded for a receipt (kind `receipt`) or a bill (kind `bill`), for the editor to start from. */
export interface MatchLineInput { itemId: string; quantity: string; rate?: string }
export async function getRecordedMatchLines(kind: 'receipt' | 'bill', id: string): Promise<MatchLineInput[]> {
  const receipt = kind === 'receipt';
  const { data, error } = await table(receipt ? 'procurement_receipt_lines' : 'procurement_bill_match_lines')
    .select(receipt ? 'item_id,quantity' : 'item_id,quantity,rate').eq(receipt ? 'receipt_id' : 'invoice_id', id);
  if (error) fail(error);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    itemId: String(r.item_id), quantity: String(r.quantity), ...(receipt ? {} : { rate: String(r.rate) }),
  }));
}

/** Replace a receipt's lines (receipt roles). Returns nothing the screen needs; it refreshes the bills' matches. */
export async function recordReceiptMatchLines(receiptId: string, lines: Array<{ itemId: string; quantity: number }>): Promise<void> {
  const { error } = await rpc('record_receipt_match_lines', { p_receipt_id: receiptId, p_lines: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })) });
  if (error) fail(error);
}

/** Replace a bill's match lines (bill roles); returns the match as it now stands so a cleared hold shows at once. */
export async function recordBillMatchLines(invoiceId: string, lines: Array<{ itemId: string; quantity: number; rate: number }>): Promise<BillMatch> {
  const { data, error } = await rpc('record_bill_match_lines', {
    p_invoice_id: invoiceId, p_lines: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, rate: l.rate })),
  });
  if (error) fail(error);
  return parseBillMatch(data);
}
