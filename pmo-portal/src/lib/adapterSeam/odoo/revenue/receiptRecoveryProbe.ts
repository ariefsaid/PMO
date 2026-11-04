/** Bounded recovery for customer receipts whose create response and immediate stock anchor were lost. */
import { AdapterError } from '../../contract.ts';
import type { OdooCall } from '../client.ts';
import { odooExternalRef } from '../purchase/anchors.ts';
import { externalIdentifier, ODOO_REVENUE_ANCHORS, REVENUE_KEY_RE } from './anchors.ts';

/** A bounded conjunction for a receipt whose response (and immediate stock anchor) may have been lost. */
export interface ReceiptComposite {
  partnerId: number;
  amount: number;
  date: string;
  invoiceId: number;
  createdAfter: string;
  createdBefore?: string;
}
export type ReceiptProbeHit = { externalRecordId: string } | null;
const RECEIPT_KEY_RE = /^ip:/;
const RECEIPT_ANCHOR = ODOO_REVENUE_ANCHORS['incoming-payment'].model;
const RECEIPT_MEMO_FIELD = ODOO_REVENUE_ANCHORS['incoming-payment'].secondary.field;
const ambiguous = () => new AdapterError('commit-rejected', 'ambiguous-anchor');

/** The stock receipt identifier is primary. The exact memo is only the secondary selector in a bounded recovery. */
export async function probeReceiptByAnchor(call: OdooCall, key: string, composite?: ReceiptComposite): Promise<ReceiptProbeHit> {
  if (!RECEIPT_KEY_RE.test(key)) throw new AdapterError('commit-rejected', 'invalid-receipt-key');
  const { module, name } = externalIdentifier(key);
  const rows = await call<Array<{ res_id: number }>>(RECEIPT_ANCHOR, 'search_read', {
    domain: [['module', '=', module], ['name', '=', name], ['model', '=', 'account.payment']], fields: ['res_id'], limit: 2,
  });
  if (rows.length > 1) throw ambiguous();
  if (rows.length === 1) return { externalRecordId: odooExternalRef('account.payment', rows[0].res_id) };
  if (!composite) return null;

  // A create response can be lost before the identifier is written. Match the PMO memo plus every bounded, immutable fact;
  // multiple matches are doubt, never a reason to choose the newest payment.
  const conjunction = [['payment_type', '=', 'inbound'], ['partner_type', '=', 'customer'], ['partner_id', '=', composite.partnerId],
    ['amount', '=', composite.amount], ['date', '=', composite.date],
    ['create_date', '>=', composite.createdAfter], ['create_date', '<=', composite.createdBefore ?? '9999-12-31 23:59:59'],
    ['state', '!=', 'canceled']] as unknown[][];
  const fields = ['id', RECEIPT_MEMO_FIELD, 'reconciled_invoice_ids', 'state'];
  // The invoice is part of the conjunction: same-customer receipts settled against other invoices are not matches.
  // Keep unlinked rows too, so a changed trace is held and the exact signed memo can bridge a lost external identifier.
  const candidates = await call<Array<{ id: number; reconciled_invoice_ids?: unknown; [field: string]: unknown }>>('account.payment', 'search_read', {
    domain: conjunction, fields, limit: 21,
  });
  if (candidates.length > 20) throw ambiguous();
  const candidateIds = candidates.map(({ id }) => id);
  const anchors = candidateIds.length === 0 ? [] : await call<Array<{ res_id: number; name: string }>>(RECEIPT_ANCHOR, 'search_read', {
    domain: [['module', '=', 'pmo'], ['model', '=', 'account.payment'], ['res_id', 'in', candidateIds]],
    fields: ['res_id', 'name'], limit: 21,
  });
  if (anchors.length > 20) throw ambiguous();
  const anchoredByAnotherReceipt = new Set(anchors.filter((anchor) => {
    const otherKey = anchor.name.startsWith('ip_') ? anchor.name.replace(/^ip_/, 'ip:').replaceAll('_', '-') : '';
    return anchor.name !== name && REVENUE_KEY_RE.test(otherKey);
  }).map((anchor) => Number(anchor.res_id)));
  const links = (row: (typeof candidates)[number]) => Array.isArray(row.reconciled_invoice_ids)
    ? row.reconciled_invoice_ids.map((id) => Number(Array.isArray(id) ? id[0] : id)) : [];
  const hasSignedAnchor = (row: (typeof candidates)[number]) => row[RECEIPT_MEMO_FIELD] === 'pmo:' + key;
  const belongsToAnotherReceipt = (row: (typeof candidates)[number]) => {
    const memo = row[RECEIPT_MEMO_FIELD];
    return anchoredByAnotherReceipt.has(row.id)
      || (typeof memo === 'string' && memo.startsWith('pmo:ip:') && !hasSignedAnchor(row));
  };
  const relevant = candidates.filter((row) => !belongsToAnotherReceipt(row)
    && (links(row).length === 0 || links(row).includes(composite.invoiceId) || hasSignedAnchor(row)));
  if (relevant.length > 1) throw ambiguous();
  const row = relevant[0];
  if (!row) return null;
  const rowLinks = links(row);
  const linked = rowLinks.includes(composite.invoiceId);
  // An unlinked row is attributable only by the exact secondary trace; a similar payment is held as ambiguity.
  if (!linked && (rowLinks.length > 0 || !hasSignedAnchor(row))) throw ambiguous();
  return { externalRecordId: odooExternalRef('account.payment', row.id) };
}
