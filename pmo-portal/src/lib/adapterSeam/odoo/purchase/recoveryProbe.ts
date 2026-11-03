/**
 * "Did Odoo already commit this document?" (AC-OPP-053, FR-OPP-072, primer bucket 2). Pure over an `OdooCall`; every Odoo field
 * and model name for the anchor lives here and in anchors.ts (NFR-OPP-009).
 *
 * Order, transfer and bill anchor on a stock external identifier (`ir.model.data`, module `pmo`); the payment anchors on its
 * memo, which a clerk can edit. All lookups are EQUALITY on a key `anchorValue` has already validated as a PMO purchase key,
 * so no LIKE metacharacter can reach a query and one key cannot match another. A payment whose memo was edited falls back to a
 * composite (vendor, amount, window), excluding any payment that carries another PMO anchor; the result must be unique.
 * ponytail: the composite has no bill conjunct yet. Odoo's reconciled-bill field is computed and unverified on the bed (V-OPP7);
 * P6-T6 adds it once pinned. Until then a doubtful match is null, which the payment kind turns into a hold, never a reissue.
 */
import { AdapterError } from '../../contract.ts';
import type { OdooCall } from '../client.ts';
import { anchorValue, externalIdentifier } from './anchors.ts';
import type { PurchaseKind } from './nextStep.ts';

const MODEL: Record<PurchaseKind, string> = { order: 'purchase.order', receipt: 'stock.picking', bill: 'account.move', payment: 'account.payment' };

export interface PaymentComposite { partnerId: number; amount: string | number; createdAfter: string }
/** An order's create-to-anchor composite: vendor, untaxed amount, line count and the window the first attempt could have created it in. */
export interface OrderComposite { partnerId: number; amount: string | number; lineCount: number; createdAfter: string }
export type ProbeHit = { externalRecordId: string } | null;

const ambiguous = () => new AdapterError('commit-rejected', 'ambiguous-anchor');

async function byIdentifier(call: OdooCall, kind: PurchaseKind, key: string): Promise<ProbeHit> {
  const { module, name } = externalIdentifier(key);
  const rows = await call<Array<{ res_id: number }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', module], ['name', '=', name], ['model', '=', MODEL[kind]]], fields: ['res_id'], limit: 2,
  });
  if (rows.length > 1) throw ambiguous();
  return rows.length === 1 ? { externalRecordId: String(rows[0].res_id) } : null;
}

/**
 * Orders: the identifier is a second write after the create, so a crash between the two leaves an order without it. The
 * composite finds that order: our vendor, inside the window, no PMO identifier of its own. Exactly one such order whose untaxed
 * amount and line count equal ours is adopted. ANY other unanchored order of the vendor in the window is doubt and throws (the row
 * is held): Odoo's own figure can differ from the edge's formula (float ties, unit precision, price-included taxes, a clerk's
 * edit), so a near-miss may be our own order and absence is claimed only when the vendor has no unanchored order in the window
 * at all (OQ-OPP-10, DD-OPP-4 amendment: any doubt holds and never reissues).
 */
async function byOrderComposite(call: OdooCall, composite: OrderComposite): Promise<ProbeHit> {
  const rows = await call<Array<{ id: number; order_line: unknown; amount_untaxed: unknown }>>('purchase.order', 'search_read', {
    domain: [['partner_id', '=', composite.partnerId], ['state', '!=', 'cancel'], ['create_date', '>=', composite.createdAfter]],
    fields: ['id', 'order_line', 'amount_untaxed'], limit: 21, context: { active_test: false },
  });
  if (rows.length === 0) return null;
  const anchored = await call<Array<{ res_id: number }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', 'pmo'], ['model', '=', 'purchase.order'], ['res_id', 'in', rows.map((r) => r.id)]], fields: ['res_id'], limit: 21,
  });
  const taken = new Set(anchored.map((a) => a.res_id));
  const unanchored = rows.filter((r) => !taken.has(r.id));
  if (unanchored.length === 0) return null;
  const cents = (v: unknown) => Math.round(Number(v) * 100);
  const [only] = unanchored;
  if (unanchored.length === 1 && Array.isArray(only.order_line) && only.order_line.length === composite.lineCount && cents(only.amount_untaxed) === cents(composite.amount)) {
    return { externalRecordId: String(only.id) };
  }
  throw ambiguous();
}

const OUTBOUND = [['payment_type', '=', 'outbound'], ['partner_type', '=', 'supplier']];

async function byMemo(call: OdooCall, key: string, composite?: PaymentComposite): Promise<ProbeHit> {
  const anchor = anchorValue(key);
  const exact = await call<Array<{ id: number }>>('account.payment', 'search_read', {
    domain: [...OUTBOUND, ['memo', '=', anchor]], fields: ['id'], limit: 2, context: { active_test: false },
  });
  if (exact.length > 1) throw ambiguous();
  if (exact.length === 1) return { externalRecordId: String(exact[0].id) };
  if (!composite) return null;
  // 21 rows is more than any honest window holds; the filter below then needs exactly one survivor.
  const rows = await call<Array<{ id: number; memo: unknown }>>('account.payment', 'search_read', {
    domain: [...OUTBOUND, ['partner_id', '=', composite.partnerId], ['amount', '=', Number(composite.amount)], ['state', '!=', 'canceled'], ['create_date', '>=', composite.createdAfter]],
    fields: ['id', 'memo'], limit: 21, context: { active_test: false },
  });
  const memo = (r: { memo: unknown }) => (typeof r.memo === 'string' ? r.memo : '');
  // Only an exact memo adopts (above). Any memo that still carries a PMO anchor is held, never adopted.
  const survivors = rows.filter((r) => !memo(r).includes('pmo:'));
  return survivors.length === 1 ? { externalRecordId: String(survivors[0].id) } : null;
}

/** Throws for a key that is not a PMO purchase key (before any call) and for an ambiguous exact anchor. */
export async function probeOdooByAnchor(call: OdooCall, kind: PurchaseKind, key: string, composite?: PaymentComposite | OrderComposite): Promise<ProbeHit> {
  anchorValue(key);
  if (kind === 'payment') return byMemo(call, key, composite as PaymentComposite | undefined);
  const hit = await byIdentifier(call, kind, key);
  return hit ?? (kind === 'order' && composite ? byOrderComposite(call, composite as OrderComposite) : null);
}
