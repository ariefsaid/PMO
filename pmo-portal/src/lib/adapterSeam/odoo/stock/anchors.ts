/**
 * Odoo stock posting external identifiers and references (AC-OSP-002, AC-OSP-004, #1508).
 *
 * Reuses the anchor contract in `pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts`.
 */
import { externalIdentifier, odooExternalRef, parseOdooExternalRef } from '../purchase/anchors.ts';

export { odooExternalRef, parseOdooExternalRef };

export function stockExternalIdentifier(stockDocumentId: string): { module: string; name: string; xmlId: string } {
  const key = stockDocumentId.startsWith('stock:') ? stockDocumentId : `stock:${stockDocumentId}`;
  const ident = externalIdentifier(key);
  return { ...ident, xmlId: `${ident.module}.${ident.name}` };
}
