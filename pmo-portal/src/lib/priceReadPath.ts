/**
 * #2699: the read path for price-bearing tables. While the organisation hides prices from requesters, the request screens read the
 * masked views (`<table>_masked`, migrations 1216-1217), which return unit prices and amounts as NULL for a requester. While it does not,
 * they read the tables exactly as before. The flag is set once per session by `PriceVisibilitySync`.
 */
let hidePricesActive = false;
let pricesHidden = false;
const listeners = new Set<() => void>();

export type MaskableTable =
  | 'procurements' | 'procurement_items' | 'procurement_invoices' | 'purchase_orders' | 'purchase_requests' | 'payments'
  | 'purchase_order_lines' | 'po_variation_lines' | 'stock_document_lines' | 'stock_ledger' | 'stock_balances';

export function setHidePricesActive(active: boolean): void {
  if (hidePricesActive === active) return;
  hidePricesActive = active;
  listeners.forEach((l) => l());
}
/** True only when the organisation hides prices AND the database says this person may not see them. */
export function setPricesHidden(hidden: boolean): void {
  if (pricesHidden === hidden) return;
  pricesHidden = hidden;
  listeners.forEach((l) => l());
}
export const arePricesHidden = (): boolean => pricesHidden;
export const isHidePricesActive = (): boolean => hidePricesActive;
export const subscribeHidePrices = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The table to read for a price-bearing screen: its masked view while the setting is on, else the table itself. */
export function priceSource<T extends MaskableTable>(table: T): T | `${T}_masked` {
  return hidePricesActive ? (`${table}_masked` as `${T}_masked`) : table;
}

/** Embed name for a PostgREST select: `alias:view(cols)` while masked, `table(cols)` otherwise. */
export function priceEmbed(table: MaskableTable, cols: string, alias: string = table): string {
  return hidePricesActive ? `${alias}:${table}_masked(${cols})` : alias === table ? `${table}(${cols})` : `${alias}:${table}(${cols})`;
}

const MASKABLE: readonly MaskableTable[] = [
  'procurements', 'procurement_items', 'procurement_invoices', 'purchase_orders', 'purchase_requests', 'payments',
  'purchase_order_lines', 'po_variation_lines', 'stock_document_lines', 'stock_ledger', 'stock_balances',
];
const EMBED = new RegExp(`(^|[\\s,:])(${MASKABLE.join('|')})\\(`, 'g');

/** Rewrites the price-bearing embeds of a PostgREST select to their masked views while the setting is on; unchanged otherwise.
 *  `a:purchase_orders(*)` -> `a:purchase_orders_masked(*)`; `purchase_orders(amount)` -> `purchase_orders:purchase_orders_masked(amount)`. */
export function maskSelection(selection: string): string {
  if (!hidePricesActive) return selection;
  return selection.replace(EMBED, (_m, pre: string, table: string) => (pre === ':' ? `:${table}_masked(` : `${pre}${table}:${table}_masked(`));
}
