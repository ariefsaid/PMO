/**
 * #2699: the read path for price-bearing tables. While the organisation hides prices from requesters, the request screens read the
 * masked views (`<table>_masked`, migrations 1216-1217), which return unit prices and amounts as NULL for a requester. While it does not,
 * they read the tables exactly as before. The flag is set once per session by `PriceVisibilitySync`.
 */
let hidePricesActive: boolean | null = null;
let pricesHidden = true;
let callerResolved = false;
const listeners = new Set<() => void>();

export const MASKABLE_TABLES = [
  'procurements', 'procurement_items', 'procurement_invoices', 'purchase_orders', 'purchase_requests', 'payments',
  'purchase_order_lines', 'po_variation_lines', 'stock_document_lines', 'stock_ledger', 'stock_balances', 'equipment_plan_lines',
] as const;
export type MaskableTable = typeof MASKABLE_TABLES[number];

export function setHidePricesActive(active: boolean | null): void {
  if (hidePricesActive === active) return;
  hidePricesActive = active;
  if (active === null) callerResolved = false;
  listeners.forEach((l) => l());
}
/** True only when the organisation hides prices AND the database says this person may not see them. */
export function setPricesHidden(hidden: boolean, resolved = true): void {
  if (pricesHidden === hidden && callerResolved === resolved) return;
  pricesHidden = hidden;
  callerResolved = resolved;
  listeners.forEach((l) => l());
}
export const arePricesHidden = (): boolean => pricesHidden;
export const getPriceVisibility = (): boolean | null => hidePricesActive;
export const isHidePricesActive = (): boolean => hidePricesActive !== false;
export const subscribeHidePrices = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Wait before constructing a selection whose columns depend on the caller's price permission. */
export function waitForPriceVisibility(signal?: AbortSignal | null, includeCaller = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { unsubscribe(); signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(signal?.reason); };
    const check = () => {
      if (hidePricesActive !== null && (!includeCaller || callerResolved)) { finish(); resolve(); }
    };
    const unsubscribe = subscribeHidePrices(check);
    if (signal?.aborted) abort();
    else { signal?.addEventListener('abort', abort, { once: true }); check(); }
  });
}

/** The table to read for a price-bearing screen: its masked view while the setting is on, else the table itself. */
export function priceSource<T extends MaskableTable>(table: T): T | `${T}_masked` {
  return isHidePricesActive() ? (`${table}_masked` as `${T}_masked`) : table;
}

/** Embed name for a PostgREST select: `alias:view(cols)` while masked, `table(cols)` otherwise. */
export function priceEmbed(table: MaskableTable, cols: string, alias: string = table): string {
  return isHidePricesActive() ? `${alias}:${table}_masked(${cols})` : alias === table ? `${table}(${cols})` : `${alias}:${table}(${cols})`;
}

const EMBED = new RegExp(`(^|[\\s,:])(${MASKABLE_TABLES.join('|')})((?:![\\w]+)*)\\(`, 'g');

/** Rewrites the price-bearing embeds of a PostgREST select to their masked views while the setting is on; unchanged otherwise.
 *  `a:purchase_orders(*)` -> `a:purchase_orders_masked(*)`; `purchase_orders!inner(amount)` ->
 *  `purchase_orders:purchase_orders_masked!inner(amount)`. */
export function maskSelection(selection: string): string {
  if (!isHidePricesActive()) return selection;
  return selection.replace(/procurement_open_commitment(?![\w])/g, 'procurement_open_commitment_masked').replace(EMBED, (_m, pre: string, table: string, hints: string) => (pre === ':' ? `:${table}_masked${hints}(` : `${pre}${table}:${table}_masked${hints}(`));
}

export const MASKABLE_FUNCTIONS = ['project_committed_spend', 'procurement_open_commitments'] as const;
export type MaskableFunction = typeof MASKABLE_FUNCTIONS[number];

/** The function to call for a derived amount: its masked twin while the setting is on, the original otherwise. The originals are never
 *  changed, so money and approval logic in the database keeps reading real values. */
export function priceFn<T extends MaskableFunction>(name: T): T | `${T}_masked` {
  return isHidePricesActive() ? (`${name}_masked` as `${T}_masked`) : name;
}
