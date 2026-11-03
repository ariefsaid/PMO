/**
 * "Did Odoo already commit this customer invoice?" (AC-OCI-011, FR-OCI-011/012, primer bucket 2), pure over an `OdooCall`. The anchor is a
 * stock external identifier (`ir.model.data`, module `pmo`, name from the key; C0 verdict, SD-6) written right after the create. The lookup is
 * an EQUALITY on a key `externalIdentifier` has already validated as an invoice key, so no LIKE metacharacter reaches a query and one key can
 * never match another.
 *
 * The identifier is a second write, so a crash between the create and it leaves an invoice without one. The composite looks for that invoice
 * (our client, inside a bounded window) and runs only in a RECOVERY. It never adopts: an accountant raises customer invoices in Odoo all the
 * time, so an unanchored look-alike may be theirs, and posting it would book someone else's invoice as PMO's. ANY unanchored invoice of the
 * client in the window is doubt and throws (the row is held; a person resolves it), as the vendor bill does (#1505 P5, OQ-OCI-14). Nothing in
 * the window is null, which the outbox turns into a hold in a recovery, never a reissue (`reissueOnInconclusiveAbsence` is false).
 */
import { AdapterError } from '../../contract.ts';
import type { OdooCall } from '../client.ts';
import { odooExternalRef } from '../purchase/anchors.ts';
import { externalIdentifier } from './anchors.ts';

const MODEL = 'account.move';
const INVOICE_KEY_RE = /^si:/;

/** The client, and the window the first attempt could have created the invoice in (bounded above too: an invoice made long after cannot be ours). */
export interface InvoiceComposite { partnerId: number; createdAfter: string; createdBefore?: string }
export type InvoiceProbeHit = { externalRecordId: string } | null;

const ambiguous = () => new AdapterError('commit-rejected', 'ambiguous-anchor');

export async function probeInvoiceByAnchor(call: OdooCall, key: string, composite?: InvoiceComposite): Promise<InvoiceProbeHit> {
  if (!INVOICE_KEY_RE.test(key)) throw new AdapterError('commit-rejected', 'invalid-invoice-key');
  const { module, name } = externalIdentifier(key);   // throws for anything that is not a PMO revenue key
  const rows = await call<Array<{ res_id: number }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', module], ['name', '=', name], ['model', '=', MODEL]], fields: ['res_id'], limit: 2,
  });
  if (rows.length > 1) throw ambiguous();
  if (rows.length === 1) return { externalRecordId: odooExternalRef(MODEL, rows[0].res_id) };
  if (!composite) return null;
  // 21 rows is more than any honest window holds; every unanchored one is doubt.
  const candidates = await call<Array<{ id: number }>>(MODEL, 'search_read', {
    domain: [['move_type', '=', 'out_invoice'], ['partner_id', '=', composite.partnerId], ['state', '!=', 'cancel'], ['create_date', '>=', composite.createdAfter],
      ...(composite.createdBefore ? [['create_date', '<=', composite.createdBefore]] : [])],
    fields: ['id'], limit: 21, context: { active_test: false },
  });
  if (candidates.length === 0) return null;
  const anchored = await call<Array<{ res_id: number }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', 'pmo'], ['model', '=', MODEL], ['res_id', 'in', candidates.map((c) => c.id)]], fields: ['res_id'], limit: 21,
  });
  const taken = new Set(anchored.map((a) => a.res_id));
  if (candidates.every((c) => taken.has(c.id))) return null;   // each belongs to its own PMO command
  throw ambiguous();
}
