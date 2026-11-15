/**
 * #2282 D6: which GL account an issued-material cost lands on, and so which budget category (budget_category_account_map). The analytic
 * line's own account when it has one; else the product's expense account, else its category's. An account the directory has not mirrored,
 * or no account at all, holds the page (the GL feed's AccountHold rule): a cost is never stored where no category can find it.
 * One `product.product` read per page, and one `product.category` read only when a product falls back to its category.
 */
import type { OdooCall } from '../client.ts';
import type { DirectoryRow } from '../kinds.ts';
import { CATEGORY_EXPENSE_FIELDS, m2o, PRODUCT_EXPENSE_FIELDS, type StockCostAttrs } from './stockCostFeed.ts';

/** `products`: the names of the products no account could be found for (at most MAX_HELD_PRODUCTS, each cut to 120 characters). */
export const MAX_HELD_PRODUCTS = 20;
export class StockCostAccountHold extends Error {
  constructor(readonly held: number, readonly products: readonly string[] = []) { super('issued material cost on an account the directory has not mirrored'); }
}

const m2oId = (v: unknown): string | null => m2o(v) ?? null;

/** analytic line id → account code for every row of the page, or a StockCostAccountHold naming how many rows could not be placed. */
export async function resolveStockCostAccounts(call: OdooCall, rows: readonly DirectoryRow[], codes: ReadonlyMap<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let held = 0;
  const needProduct: DirectoryRow[] = [];
  const heldProducts = new Set<string>();
  for (const r of rows) {
    const general = (r.attrs as unknown as StockCostAttrs).general_account_id;
    if (general === null) { needProduct.push(r); continue; }
    const code = codes.get(general);
    if (code) out.set(r.external_id, code); else held++;
  }
  if (needProduct.length > 0) {
    const productIds = [...new Set(needProduct.map((r) => Number((r.attrs as unknown as StockCostAttrs).product_id)))];
    const products = await call<Array<Record<string, unknown>>>('product.product', 'read', { ids: productIds, fields: PRODUCT_EXPENSE_FIELDS, context: { active_test: false } });
    const productExpense = new Map<string, string | null>();
    const productCategory = new Map<string, string | null>();
    const productName = new Map<string, string>();
    for (const p of products) {
      if (typeof p.name === 'string' && p.name !== '') productName.set(String(p.id), p.name.slice(0, 120));
      productExpense.set(String(p.id), m2oId(p.property_account_expense_id));
      productCategory.set(String(p.id), m2oId(p.categ_id));
    }
    const categoryIds = [...new Set(needProduct.flatMap((r) => {
      const pid = (r.attrs as unknown as StockCostAttrs).product_id;
      const cat = productCategory.get(pid);
      return productExpense.get(pid) ? [] : cat ? [Number(cat)] : [];
    }))];
    const categoryExpense = new Map<string, string | null>();
    if (categoryIds.length > 0) {
      const cats = await call<Array<Record<string, unknown>>>('product.category', 'read', { ids: categoryIds, fields: CATEGORY_EXPENSE_FIELDS });
      for (const c of cats) categoryExpense.set(String(c.id), m2oId(c.property_account_expense_categ_id));
    }
    for (const r of needProduct) {
      const pid = (r.attrs as unknown as StockCostAttrs).product_id;
      const account = productExpense.get(pid) ?? categoryExpense.get(productCategory.get(pid) ?? '') ?? null;
      const code = account ? codes.get(account) : undefined;
      if (code) out.set(r.external_id, code); else { held++; heldProducts.add(productName.get(pid) ?? `product ${pid}`); }
    }
  }
  if (held > 0) throw new StockCostAccountHold(held, [...heldProducts].slice(0, MAX_HELD_PRODUCTS));
  return out;
}
