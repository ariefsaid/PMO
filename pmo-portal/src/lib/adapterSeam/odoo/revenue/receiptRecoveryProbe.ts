/** Bounded recovery for customer receipts whose create response and immediate stock anchor were lost. */
import { AdapterError } from '../../contract.ts';
import type { OdooCall } from '../client.ts';
import { odooExternalRef } from '../purchase/anchors.ts';
import { externalIdentifier, ODOO_REVENUE_ANCHORS } from './anchors.ts';

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
  const candidates = await call<Array<{ id: number; reconciled_invoice_ids?: unknown; [field: string]: unknown }>>('account.payment', 'search_read', {
    domain: [['payment_type', '=', 'inbound'], ['partner_type', '=', 'customer'], ['partner_id', '=', composite.partnerId],
      ['amount', '=', composite.amount], ['date', '=', composite.date],
      ['create_date', '>=', composite.createdAfter], ['create_date', '<=', composite.createdBefore ?? '9999-12-31 23:59:59'],
      ['state', '!=', 'canceled']], fields: ['id', RECEIPT_MEMO_FIELD, 'reconciled_invoice_ids'], limit: 3,
  });
  if (candidates.length > 1) throw ambiguous();
  if (!candidates.length) return null;
  const row = candidates[0];
  const linked = Array.isArray(row.reconciled_invoice_ids) && row.reconciled_invoice_ids.some((id) => Number(id) === composite.invoiceId);
  // Before posting, Odoo has not created receivable lines yet. The exact secondary trace on a unique draft is the only
  // safe way to finish the create-to-anchor gap; a similar unlinked payment is held as ambiguity.
  if (!linked && row[RECEIPT_MEMO_FIELD] !== 'pmo:' + key) throw ambiguous();
  return { externalRecordId: odooExternalRef('account.payment', row.id) };
}
