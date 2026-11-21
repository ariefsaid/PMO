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
