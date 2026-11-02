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
