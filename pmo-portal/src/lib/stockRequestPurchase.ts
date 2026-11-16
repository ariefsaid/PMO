/** Stock → "Request purchase": the shortfall rule, the pre-filled new-purchase link, and the explicit origin the form returns to. */

/** Units to buy to reach the reorder level (2 decimals, rounded up), else the set order quantity, else null. */
export function restockQuantity(level: string, onHand: string, orderQuantity?: string | null): string | null {
  const gap = Math.ceil((Number(level) - Number(onHand)) * 100 - 1e-9) / 100;
  if (Number.isFinite(gap) && gap > 0) return String(gap);
  const oq = Number(orderQuantity);
  return orderQuantity && Number.isFinite(oq) && oq > 0 ? String(oq) : null;
}

export function buildRestockUrl(a: { itemCode: string; itemName: string; unitCode: string; quantity: string | null; projectId: string | null; from: string }): string {
  const p = new URLSearchParams();
  if (a.projectId) p.set('project', a.projectId);
  p.set('have', 'need');
  p.set('from', a.from);
  p.set('title', `${a.itemCode} - ${a.itemName}`);
  p.set('lineName', a.unitCode ? `${a.itemName} (${a.unitCode})` : a.itemName);
  if (a.quantity) p.set('lineQty', a.quantity);
  return `/procurement/new?${p.toString()}`;
}

/** An in-app path only: never an external or protocol-relative target. */
export function readOrigin(search: string): string | null {
  const from = new URLSearchParams(search).get('from');
  return from && from.startsWith('/') && !from.startsWith('//') && !from.includes('\\') ? from : null;
}

export function readRestockLine(search: string): { name: string; quantity: number } | null {
  const p = new URLSearchParams(search);
  const name = p.get('lineName')?.trim();
  const quantity = Number(p.get('lineQty'));
  return name && Number.isFinite(quantity) && quantity > 0 ? { name, quantity } : null;
}
