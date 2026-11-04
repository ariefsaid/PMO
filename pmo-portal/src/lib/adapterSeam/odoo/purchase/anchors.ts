const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const PURCHASE_KEY_RE = new RegExp(`^(?:po|bill|pay):${uuid}$|^gr:${uuid}:[a-f0-9]+$|^porev:${uuid}:[1-9][0-9]*$`, 'i');
export const ODOO_ANCHORS = {
  order: { model: 'ir.model.data', mutable: false },
  receipt: { model: 'ir.model.data', mutable: false },
  bill: { model: 'ir.model.data', mutable: false },
  payment: { model: 'account.payment', field: 'memo', mutable: true },
} as const;
export function anchorValue(key: string): string {
  if (!PURCHASE_KEY_RE.test(key)) throw new Error('Invalid purchase key');
  return `pmo:${key}`;
}
export function externalIdentifier(key: string): { module: string; name: string } {
  anchorValue(key);
  return { module: 'pmo', name: key.replace(/[^a-zA-Z0-9_]/g, '_') };
}

/**
 * Odoo numbers ids per model (`purchase.order` 1 and `stock.picking` 1 coexist) while `external_refs` is unique on (org, domain,
 * external_record_id) and every purchase kind shares domain `procurement`. So every purchase external ref is `<model>:<id>`.
 */
export function odooExternalRef(model: string, id: number | string): string {
  const n = Number(id);
  if (!/^[a-z_]+(\.[a-z_]+)+$/.test(model) || !Number.isInteger(n) || n <= 0) throw new Error('Invalid Odoo external ref');
  return `${model}:${n}`;
}
/** The reference a person's "Odoo payment number" stands for (held-payment resolution); the model name stays in this directory. */
export const odooPaymentRef = (id: number | string): string => odooExternalRef('account.payment', id);
/** The reference a person's "Odoo document number" stands for when a held customer invoice or receipt is resolved. */
export const odooRevenueDocumentRef = (kind: 'sales-invoice' | 'incoming-payment', id: number | string): string =>
  odooExternalRef(kind === 'sales-invoice' ? 'account.move' : 'account.payment', id);
/** The Odoo id inside a ref of that model, or null for any other model, a bare id or a malformed ref. */
export function parseOdooExternalRef(model: string, ref: unknown): number | null {
  if (typeof ref !== 'string' || !ref.startsWith(`${model}:`)) return null;
  const id = ref.slice(model.length + 1);
  return /^[1-9][0-9]*$/.test(id) ? Number(id) : null;
}

/**
 * The PMO key an order or bill identifier name was made from (`externalIdentifier` replaces every non-alphanumeric with `_`), or
 * null for any other name. Only keys whose name is lossless are recovered: the feed uses it to tell an anchored orphan from a
 * document Odoo users created.
 */
export function keyFromExternalIdentifier(name: string): string | null {
  const m = /^(po|bill)_([0-9a-f]{8})_([0-9a-f]{4})_([0-9a-f]{4})_([0-9a-f]{4})_([0-9a-f]{12})$/i.exec(name);
  if (!m) return null;
  const key = `${m[1]}:${m[2]}-${m[3]}-${m[4]}-${m[5]}-${m[6]}`;
  return PURCHASE_KEY_RE.test(key) ? key : null;
}
