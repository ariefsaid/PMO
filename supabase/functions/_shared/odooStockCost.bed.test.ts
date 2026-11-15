/**
 * #2282 plan Task 1 (stop gate, AC-IMC-001/004): every Odoo field name the issued-material cost kind relies on exists on the bed.
 * The names live in one place (pmo-portal/src/lib/adapterSeam/odoo/ledger/stockCostFeed.ts); this file proves them against Odoo 20
 * itself with `fields_get`, which writes nothing. A missing field stops the slice: report it, never rename around it here.
 *
 * Gated on the dependency, never on CI: without the bed's settings these tests are ignored, as the other bed tests are.
 *
 * Run:
 *   scripts/with-odoo-lock.sh deno test --allow-env --allow-net --allow-read supabase/functions/_shared/odooStockCost.bed.test.ts
 */
// deno-lint-ignore no-import-prefix
import { assert, assertEquals } from 'jsr:@std/assert@1.0.0';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import {
  CATEGORY_EXPENSE_FIELDS, JOURNAL_LINE_STOCK_MOVE, PICKING_ENTRY, PICKING_FIELDS, PRODUCT_EXPENSE_FIELDS, STOCK_COST_LINE_FIELDS,
} from '../../../pmo-portal/src/lib/adapterSeam/odoo/ledger/stockCostFeed.ts';

interface BedConfig { baseUrl: string; database: string; apiKey: string }

function readBedConfig(): BedConfig | null {
  let baseUrl = Deno.env.get('ODOO_BED_URL');
  let database = Deno.env.get('ODOO_BED_DB');
  let apiKey = Deno.env.get('ODOO_BED_KEY');
  if (!baseUrl || !database || !apiKey) {
    try {
      const content = Deno.readTextFileSync(new URL('../../../.env.odoo.local', import.meta.url));
      const vars: Record<string, string> = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        const idx = trimmed.indexOf('=');
        if (trimmed && !trimmed.startsWith('#') && idx > 0) vars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
      baseUrl = baseUrl ?? `http://127.0.0.1:${vars.ODOO_PORT || '8069'}`;
      database = database ?? vars.ODOO_DB;
      apiKey = apiKey ?? vars.ODOO_API_KEY;
    } catch {
      // Configuration file absent or unreadable
    }
  }
  return baseUrl && database && apiKey ? { baseUrl, database, apiKey } : null;
}

const BED = readBedConfig();

const odoo = () => {
  assert(BED !== null, 'Odoo dev bed settings (ODOO_BED_URL, ODOO_BED_DB, ODOO_BED_KEY or .env.odoo.local) are required.');
  return bindCall({ baseUrl: BED!.baseUrl, database: BED!.database, apiKey: BED!.apiKey, fetchImpl: fetch });
};

async function fieldsOf(model: string): Promise<Record<string, { type: string; relation?: string; selection?: Array<[string, string]> }>> {
  return await odoo()(model, 'fields_get', { attributes: ['type', 'relation', 'selection'] });
}

Deno.test({
  name: 'AC-IMC-001 the analytic line carries every field the stock-cost kind reads, with the expected types and relations',
  ignore: !BED,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const f = await fieldsOf('account.analytic.line');
    for (const name of STOCK_COST_LINE_FIELDS) assert(name in f, `account.analytic.line.${name} must exist`);
    assertEquals([f.move_line_id.relation, f.general_account_id.relation, f.product_id.relation, f.company_id.relation],
      ['account.move.line', 'account.account', 'product.product', 'res.company']);
    assert((f.category.selection ?? []).some(([v]) => v === PICKING_ENTRY), 'category must offer picking_entry');
  },
});

Deno.test({
  name: 'AC-IMC-004 the picking, product, category and journal item carry the fields the tie, the account fallback and the double-count check read',
  ignore: !BED,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const picking = await fieldsOf('stock.picking');
    for (const name of PICKING_FIELDS) assert(name in picking, `stock.picking.${name} must exist`);
    assertEquals(picking.return_id.relation, 'stock.picking');
    const product = await fieldsOf('product.product');
    for (const name of PRODUCT_EXPENSE_FIELDS) assert(name in product, `product.product.${name} must exist`);
    const category = await fieldsOf('product.category');
    for (const name of CATEGORY_EXPENSE_FIELDS) assert(name in category, `product.category.${name} must exist`);
    const move = await fieldsOf('stock.move');
    assert('picking_id' in move, 'stock.move.picking_id must exist');
    const journal = await fieldsOf('account.move.line');
    assert(JOURNAL_LINE_STOCK_MOVE in journal, `account.move.line.${JOURNAL_LINE_STOCK_MOVE} must exist`);
    assertEquals(journal[JOURNAL_LINE_STOCK_MOVE].relation, 'stock.move');
  },
});
