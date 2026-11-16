/** Stock → "Request purchase": the shortfall rule, the pre-filled new-purchase link, and the explicit origin the form returns to. */

/** Units to buy to reach the reorder level (2 decimals, rounded up), else the set order quantity, else null. */
export function restockQuantity(level: string, onHand: string, orderQuantity?: string | null): string | null {
  const gap = Math.ceil((Number(level) - Number(onHand)) * 100 - 1e-9) / 100;
  if (Number.isFinite(gap) && gap > 0) return String(gap);
  const oq = Number(orderQuantity);
  return orderQuantity && Number.isFinite(oq) && oq > 0 ? String(oq) : null;
}

export function buildRestockUrl(a: { itemCode: string; itemName: string; unitCode: string; quantity: string | null; unitValue?: string | null; projectId: string | null; from: string }): string {
  const p = new URLSearchParams();
  if (a.projectId) p.set('project', a.projectId);
  p.set('have', 'need');
  p.set('from', a.from);
  p.set('title', `${a.itemCode} - ${a.itemName}`);
  p.set('lineName', a.unitCode ? `${a.itemName} (${a.unitCode})` : a.itemName);
  if (a.quantity) p.set('lineQty', a.quantity);
  // The store's current average unit value; absent when unknown (never 0).
  if (a.unitValue && Number(a.unitValue) > 0) p.set('lineRate', a.unitValue);
  return `/procurement/new?${p.toString()}`;
}

/** An in-app path only: never an external or protocol-relative target. */
export function readOrigin(search: string): string | null {
  const from = new URLSearchParams(search).get('from');
  return from && from.startsWith('/') && !from.startsWith('//') && !from.includes('\\') ? from : null;
}

export function readRestockLine(search: string): { name: string; quantity: number; rate: number | null } | null {
  const p = new URLSearchParams(search);
  const name = p.get('lineName')?.trim();
  const quantity = Number(p.get('lineQty'));
  const rate = Number(p.get('lineRate'));
  return name && Number.isFinite(quantity) && quantity > 0 ? { name, quantity, rate: p.get('lineRate') && Number.isFinite(rate) && rate > 0 ? rate : null } : null;
}

export type FormOrigin = { kind: 'stock' | 'project' | 'procurement'; path: string };

/** The one place the purchase form learns where it was opened from: Stock (explicit `from`), else the project, else the Purchases list. */
export function resolveFormOrigin(search: string): FormOrigin {
  const from = readOrigin(search);
  if (from) return { kind: from.startsWith('/stock') ? 'stock' : from.startsWith('/projects') ? 'project' : 'procurement', path: from };
  const projectId = new URLSearchParams(search).get('project');
  return projectId
    ? { kind: 'project', path: `/projects/${encodeURIComponent(projectId)}/procurement` }
    : { kind: 'procurement', path: '/procurement' };
}
