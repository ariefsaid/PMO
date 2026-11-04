/**
 * "Did Odoo already commit this document?" (AC-OPP-053, FR-OPP-072, primer bucket 2). Pure over an `OdooCall`; every Odoo field
 * and model name for the anchor lives here and in anchors.ts (NFR-OPP-009).
 *
 * Order, transfer and bill anchor on a stock external identifier (`ir.model.data`, module `pmo`); the payment anchors on its
 * memo, which a clerk can edit. All lookups are EQUALITY on a key `anchorValue` has already validated as a PMO purchase key,
 * so no LIKE metacharacter can reach a query and one key cannot match another. A payment whose memo was edited falls back to a
 * composite (vendor, amount, window, and the bill Odoo shows it reconciled to), run by the caller in a RECOVERY only. It adopts ONLY the
 * one unique conjunction; every other candidate, several, or one not reconciled to our bill, throws (the row is held); a payment that
 * carries another PMO anchor is not a candidate. Nothing in the window is null, which the payment kind turns into a hold, never a reissue.
 */
import { AdapterError } from '../../contract.ts';
import type { OdooCall } from '../client.ts';
import { anchorValue, externalIdentifier, odooExternalRef } from './anchors.ts';
import type { PurchaseKind } from './nextStep.ts';

const MODEL: Record<PurchaseKind, string> = { order: 'purchase.order', receipt: 'stock.picking', bill: 'account.move', payment: 'account.payment' };

/**
 * A payment's: vendor, amount, the window the first attempt could have created it in (bounded above too) and the bill it pays. The bill is
 * the conjunct that tells our payment from a look-alike: Odoo shows which bills a payment is reconciled to (`reconciled_bill_ids`).
 */
export interface PaymentComposite { partnerId: number; amount: string | number; createdAfter: string; createdBefore?: string; billId?: number }
/** An order's create-to-anchor composite: vendor, untaxed amount, line count and the window the first attempt could have created it in. */
export interface OrderComposite { partnerId: number; amount: string | number; lineCount: number; createdAfter: string; createdBefore?: string }
/** A vendor bill's: the same facts. Its window is bounded above too: a vendor bill made long after the first attempt cannot be ours. */
export type BillComposite = OrderComposite;
/** `externalRecordId` is the model-qualified ref (`stock.picking:42`), see `odooExternalRef`. */
export type ProbeHit = { externalRecordId: string } | null;

const ambiguous = () => new AdapterError('commit-rejected', 'ambiguous-anchor');

async function byIdentifier(call: OdooCall, kind: PurchaseKind, key: string): Promise<ProbeHit> {
  const { module, name } = externalIdentifier(key);
  const rows = await call<Array<{ res_id: number }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', module], ['name', '=', name], ['model', '=', MODEL[kind]]], fields: ['res_id'], limit: 2,
  });
  if (rows.length > 1) throw ambiguous();
  return rows.length === 1 ? { externalRecordId: odooExternalRef(MODEL[kind], rows[0].res_id) } : null;
}

/**
 * Orders and bills: the identifier is a second write after the create, so a crash between the two leaves a document without it. The
 * composite finds that document: our vendor, inside the window, no PMO identifier of its own. An ORDER that is exactly one such
 * document whose untaxed amount and line count equal ours is adopted. A BILL never is: vendors' bills are authored in Odoo all the
 * time (a clerk, the vendor-bill alias, the order's "Create Bill"), so a look-alike may be someone else's and posting it would
 * mirror it as PMO's (I1, #1505 P5 review); any unanchored vendor bill in the window is doubt. ANY other unanchored document of
 * the vendor in the window is doubt and throws (the row is held): Odoo's own figure can differ from the edge's formula (float
 * ties, unit precision, price-included taxes, a clerk's edit), so a near-miss may be our own document and absence is claimed only
 * when the vendor has no unanchored document in the window at all (OQ-OPP-10, DD-OPP-4 amendment: any doubt holds and never
 * reissues).
 */
const COMPOSITE_SHAPE = {
  order: { model: 'purchase.order', lines: 'order_line', where: [] as unknown[] },
  bill: { model: 'account.move', lines: 'invoice_line_ids', where: [['move_type', '=', 'in_invoice']] as unknown[] },
} as const;

async function byDocumentComposite(call: OdooCall, kind: keyof typeof COMPOSITE_SHAPE, composite: OrderComposite): Promise<ProbeHit> {
  const shape = COMPOSITE_SHAPE[kind];
  const rows = await call<Array<Record<string, unknown> & { id: number }>>(shape.model, 'search_read', {
    domain: [...shape.where, ['partner_id', '=', composite.partnerId], ['state', '!=', 'cancel'], ['create_date', '>=', composite.createdAfter], ...(composite.createdBefore ? [['create_date', '<=', composite.createdBefore]] : [])],
    fields: ['id', shape.lines, 'amount_untaxed'], limit: 21, context: { active_test: false },
  });
  if (rows.length === 0) return null;
  const anchored = await call<Array<{ res_id: number }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', 'pmo'], ['model', '=', shape.model], ['res_id', 'in', rows.map((r) => r.id)]], fields: ['res_id'], limit: 21,
  });
  const taken = new Set(anchored.map((a) => a.res_id));
  const unanchored = rows.filter((r) => !taken.has(r.id));
  if (unanchored.length === 0) return null;
  const cents = (v: unknown) => Math.round(Number(v) * 100);
  const [only] = unanchored;
  const lines = only[shape.lines];
  if (kind === 'order' && unanchored.length === 1 && Array.isArray(lines) && lines.length === composite.lineCount && cents(only.amount_untaxed) === cents(composite.amount)) {
    return { externalRecordId: odooExternalRef(shape.model, only.id) };
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
  if (exact.length === 1) return { externalRecordId: odooExternalRef(MODEL.payment, exact[0].id) };
  if (!composite) return null;
  // The memo is editable, so a miss on it proves nothing (C-1). 21 rows is more than any honest window holds; every one is doubt.
  const rows = await call<Array<{ id: number; memo: unknown; reconciled_bill_ids?: unknown }>>('account.payment', 'search_read', {
    domain: [...OUTBOUND, ['partner_id', '=', composite.partnerId], ['amount', '=', Number(composite.amount)], ['state', '!=', 'canceled'], ['create_date', '>=', composite.createdAfter], ...(composite.createdBefore ? [['create_date', '<=', composite.createdBefore]] : [])],
    fields: ['id', 'memo', 'reconciled_bill_ids'], limit: 21, context: { active_test: false },
  });
  const memo = (r: { memo: unknown }) => (typeof r.memo === 'string' ? r.memo : '');
  // Another PMO payment's anchor is that payment, not a candidate; our own anchor with extra text is certainly ours but not exactly readable: doubt.
  const candidates = rows.filter((r) => !memo(r).includes('pmo:') || memo(r).includes(anchor));
  if (candidates.length === 0) return null;
  const [only] = candidates;
  const reconciled = Array.isArray(only.reconciled_bill_ids) ? only.reconciled_bill_ids.map((b) => (Array.isArray(b) ? Number(b[0]) : Number(b))) : [];
  // ponytail: a clerk's identical payment of this bill in the same minutes would be adopted as ours (money is right, the payer wrong); the bounded window keeps that to minutes.
  if (candidates.length === 1 && composite.billId != null && !memo(only).includes(anchor) && reconciled.includes(composite.billId)) {
    return { externalRecordId: odooExternalRef(MODEL.payment, only.id) };
  }
  throw ambiguous();
}

/** Throws for a key that is not a PMO purchase key (before any call) and for an ambiguous exact anchor. */
export async function probeOdooByAnchor(call: OdooCall, kind: PurchaseKind, key: string, composite?: PaymentComposite | OrderComposite | BillComposite): Promise<ProbeHit> {
  anchorValue(key);
  if (kind === 'payment') return byMemo(call, key, composite as PaymentComposite | undefined);
  const hit = await byIdentifier(call, kind, key);
  return hit ?? ((kind === 'order' || kind === 'bill') && composite ? byDocumentComposite(call, kind, composite as OrderComposite) : null);
}
