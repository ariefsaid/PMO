const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const REVENUE_KEY_RE = new RegExp(`^(?:si|ip):${uuid}$`, 'i');
export type RevenueKind = 'sales-invoice' | 'incoming-payment';

/**
 * The one table of revenue anchors (C0 verdict, SD-6/SD-7): a stock external identifier per document, written right
 * after create and closed by a composite probe that holds on doubt. No business field (reference, number, origin) is an
 * anchor; the payment memo is a secondary trace only.
 */
export const ODOO_REVENUE_ANCHORS = {
  'sales-invoice': { model: 'ir.model.data', primary: 'external-identifier', mutable: false, probe: 'composite-hold-on-doubt', secondary: null },
  'incoming-payment': { model: 'ir.model.data', primary: 'external-identifier', mutable: false, probe: 'composite-hold-on-doubt', secondary: { model: 'account.payment', field: 'memo' } },
} as const;

function valid(key: string): string {
  if (!REVENUE_KEY_RE.test(key)) throw new Error('Invalid revenue key');
  return key;
}
export function externalIdentifier(key: string): { module: string; name: string } {
  return { module: 'pmo', name: valid(key).replace(/[^a-zA-Z0-9_]/g, '_') };
}
export function anchorMemo(key: string): string {
  return `pmo:${valid(key)}`;
}

/** Recover a PMO revenue key from the stock external identifier name, or null for an unrelated or malformed name. */
export function keyFromExternalIdentifier(name: string): string | null {
  const match = /^(si|ip)_([0-9a-f]{8})_([0-9a-f]{4})_([0-9a-f]{4})_([0-9a-f]{4})_([0-9a-f]{12})$/i.exec(name);
  if (!match) return null;
  const key = `${match[1]}:${match[2]}-${match[3]}-${match[4]}-${match[5]}-${match[6]}`;
  return REVENUE_KEY_RE.test(key) ? key : null;
}
