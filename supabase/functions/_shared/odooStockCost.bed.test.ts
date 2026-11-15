/**
 * #2282 plan Task 1 (stop gate, AC-IMC-001/004): every Odoo field name the issued-material cost kind relies on exists on the bed.
 * The names live in one place (pmo-portal/src/lib/adapterSeam/odoo/ledger/stockCostFeed.ts); this file proves them against Odoo 20
 * itself with `fields_get`, which writes nothing. A missing field stops the slice: report it, never rename around it here.
 *
 * Gated on the dependency, never on CI: without the bed's settings these tests are ignored, as the other bed tests are.
 *
 * The data cases (Tasks 1, 2 and 14) issue stock through the shipped writer seam and read what Odoo wrote; Task 14 also runs the shipped
 * `runLedgerPass` against the local database. They need the bed context file (scripts/odoo-bed/make-context.mjs) as the first argument and
 * `docker` for the one fixture the service role cannot write (stock_documents, stock_erp_mirror). Every Odoo record is synthetic and
 * deactivated in `finally`; the picking-type switches are restored.
 *
 * Run (fields and Odoo behaviour, no database):
 *   scripts/with-odoo-lock.sh deno test --config supabase/functions/odoo-sweep/deno.json --allow-env --allow-net --allow-read supabase/functions/_shared/odooStockCost.bed.test.ts
 * Run (everything, as Task 14 does):
 *   scripts/with-odoo-lock.sh scripts/with-db-lock.sh deno test --config supabase/functions/odoo-sweep/deno.json --allow-env --allow-net --allow-read --allow-run=docker \
 *     supabase/functions/_shared/odooStockCost.bed.test.ts -- ~/.pmo-odoo-bed-context.json
 */
// deno-lint-ignore no-import-prefix
import { assert, assertEquals } from 'jsr:@std/assert@1.0.0';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { completeStockPicking, sendStockPicking } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/picking.ts';
import {
  CATEGORY_EXPENSE_FIELDS, JOURNAL_ENTRY_OF_MOVE, PICKING_ENTRY, PICKING_FIELDS, PRODUCT_EXPENSE_FIELDS, STOCK_COST_LINE_FIELDS, stockCostDomain,
} from '../../../pmo-portal/src/lib/adapterSeam/odoo/ledger/stockCostFeed.ts';
import { runLedgerPass } from './odooLedgerFeed.ts';
import { readOdooBedContext } from './testing/odooBedContext.ts';

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
    assert(JOURNAL_ENTRY_OF_MOVE in move, `stock.move.${JOURNAL_ENTRY_OF_MOVE} must exist`);
    assertEquals(move[JOURNAL_ENTRY_OF_MOVE].relation, 'account.move');
    assert('move_id' in await fieldsOf('account.move.line'), 'account.move.line.move_id must exist');
  },
});

// ───────────────────────── Tasks 1, 2 and 14: Odoo behaviour and the whole pass, on the real bed ─────────────────────────

const CTX = readOdooBedContext();
const j = (x: unknown) => JSON.stringify(x);
/** Facts the research document records: printed so a run's output is the evidence. */
const fact = (label: string, value: unknown) => console.log(`FACT ${label}: ${j(value)}`);

type Valuation = 'periodic' | 'real_time';
interface Issued {
  odoo: OdooCall; stamp: string; companyId: number; projectId: number; analyticAccountId: number; productId: number; productName: string;
  pickingId: number; pickingName: string; moveId: number; typeId: number; src: number; dest: number; anchor: string;
  /** Issue `qty` more of the product to the project through the shipped seam; returns the picking id. */
  issue: (qty: number) => Promise<number>;
  cleanup: () => Promise<void>;
}

const ids = (v: unknown): number => (Array.isArray(v) ? Number(v[0]) : Number(v));
const LINE_FIELDS = ['id', 'name', 'category', 'move_line_id', 'account_id', 'general_account_id', 'product_id', 'unit_amount', 'amount', 'date', 'company_id', 'write_date'];

/** A synthetic project and product, `qty` units issued to it through the shipped seam under the given valuation (the research §10 matrix). */
async function issuedScenario(valuation: Valuation, qty: number, anchor = `stock:${crypto.randomUUID()}`): Promise<Issued> {
  assert(BED !== null, 'Odoo dev bed settings are required.');
  const odoo = bindCall({ baseUrl: BED!.baseUrl, database: BED!.database, apiKey: BED!.apiKey, fetchImpl: fetch });
  const stamp = `IMC-${valuation}-${Date.now()}`;
  const undo: Array<() => Promise<unknown>> = [];
  const made: Array<[string, number]> = [];
  const [company] = await odoo<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
  const [type] = await odoo<Array<{ id: number; analytic_costs: boolean; default_location_src_id: [number, string]; default_location_dest_id: [number, string] }>>(
    'stock.picking.type', 'search_read',
    { domain: [['company_id', '=', company.id], ['code', '=', 'outgoing']], fields: ['id', 'analytic_costs', 'default_location_src_id', 'default_location_dest_id'], limit: 1 });
  undo.push(() => odoo('stock.picking.type', 'write', { ids: [type.id], vals: { analytic_costs: type.analytic_costs } }));
  await odoo('stock.picking.type', 'write', { ids: [type.id], vals: { analytic_costs: true } });
  let src = type.default_location_src_id[0], dest = type.default_location_dest_id[0];
  // A product with no category has no expense account (D6): the whole stock-cost kind would hold at its line, so the synthetic product
  // always has one. The base category is the bed's own periodic one that names an expense account.
  const [base] = await odoo<Array<{ id: number }>>('product.category', 'search_read', {
    domain: [['complete_name', 'in', ['Goods', 'Expenses']], ['property_valuation', '=', 'periodic'], ['property_account_expense_categ_id', '!=', false]], fields: ['id'], order: 'id desc', limit: 1 });
  assert(base, 'the bed has a periodic product category with an expense account');
  const productVals: Record<string, unknown> = { name: `${stamp} Item`, is_storable: true, standard_price: 120, categ_id: base.id };
  try {
    if (valuation === 'real_time') {
      const code = async (c: string) => (await odoo<Array<{ id: number }>>('account.account', 'search_read', { domain: [['code', '=', c], ['company_ids', 'in', [company.id]]], fields: ['id'], limit: 1 }))[0]?.id;
      const [journal] = await odoo<Array<{ id: number }>>('account.journal', 'search_read', { domain: [['name', '=', 'Inventory Valuation'], ['company_id', '=', company.id]], fields: ['id'], limit: 1 });
      const [inventory, cogs, interim] = [await code('11300180'), await code('51000010'), await code('29000000')];
      assert(journal && inventory && cogs && interim, 'the bed has the Inventory Valuation journal and its stock accounts');
      const [categ] = await odoo<number[]>('product.category', 'create', { vals_list: [{
        name: `${stamp} Category`, property_valuation: 'real_time', property_cost_method: 'standard', property_stock_journal: journal.id,
        property_stock_valuation_account_id: inventory, property_account_expense_categ_id: cogs, property_account_income_categ_id: interim } ] });
      made.push(['product.category', categ]);
      productVals.categ_id = categ;
      const [parent] = await odoo<Array<{ id: number }>>('stock.location', 'search_read', { domain: [['usage', '=', 'internal'], ['company_id', 'in', [company.id, false]]], fields: ['id'], limit: 1 });
      [src] = await odoo<number[]>('stock.location', 'create', { vals_list: [{ name: `${stamp} Stock`, location_id: parent.id, usage: 'internal', company_id: company.id }] });
      [dest] = await odoo<number[]>('stock.location', 'create', { vals_list: [{ name: `${stamp} Dest`, usage: 'customer', company_id: company.id, valuation_account_id: cogs }] });
      made.push(['stock.location', src], ['stock.location', dest]);
    }
    const [projectId] = await odoo<number[]>('project.project', 'create', { vals_list: [{ name: `${stamp} Project`, company_id: company.id }] });
    made.push(['project.project', projectId]);
    const [proj] = await odoo<Array<{ account_id: [number, string] }>>('project.project', 'read', { ids: [projectId], fields: ['account_id'] });
    const [productId] = await odoo<number[]>('product.product', 'create', { vals_list: [productVals] });
    made.push(['product.product', productId]);
    const issue = async (n: number, key = `stock:${crypto.randomUUID()}`): Promise<number> => {
      const params = { anchorKey: key, companyId: company.id, pickingTypeId: type.id, projectId, origin: stamp, lines: [{ productId, quantity: n }], src, dest };
      const sent = await sendStockPicking(odoo, params);
      assertEquals(sent.outcome, 'sent');
      const done = await completeStockPicking(odoo, (sent as { pickingId: number }).pickingId, params.lines);
      assertEquals(done.outcome, 'validated');
      return (sent as { pickingId: number }).pickingId;
    };
    const pickingId = await issue(qty, anchor);
    const [pick] = await odoo<Array<{ name: string; move_ids: number[] }>>('stock.picking', 'read', { ids: [pickingId], fields: ['name', 'move_ids'] });
    return {
      odoo, stamp, companyId: company.id, projectId, analyticAccountId: proj.account_id[0], productId, productName: `${stamp} Item`, pickingId, pickingName: pick.name,
      moveId: pick.move_ids[0], typeId: type.id, src, dest, anchor, issue,
      cleanup: async () => {
        for (const u of undo.reverse()) await u().catch(() => {});
        // Deleting a category empties its products' category, which would hold the feed at their lines: move them to the base category first.
        await odoo('product.product', 'write', { ids: [made.find(([m]) => m === 'product.product')![1]], vals: { categ_id: base.id } }).catch(() => {});
        for (const [model, id] of made.reverse()) {
          if (model === 'product.category') await odoo(model, 'unlink', { ids: [id] }).catch(() => {});
          else await odoo(model, 'write', { ids: [id], vals: { active: false } }).catch(() => {});
        }
      },
    };
  } catch (err) {
    for (const u of undo.reverse()) await u().catch(() => {});
    for (const [model, id] of made.reverse()) await odoo(model, 'write', { ids: [id], vals: { active: false } }).catch(() => {});
    throw err;
  }
}

const analyticLines = (s: Issued) => s.odoo<Array<Record<string, any>>>('account.analytic.line', 'search_read', { domain: [['account_id', '=', s.analyticAccountId]], fields: LINE_FIELDS, order: 'id asc' });

/** Return `qty` of the issue through Odoo's own return action (Odoo 20 has no return wizard model): a draft return picking, its quantity set, validated. */
async function returnIssue(s: Issued, qty: number): Promise<{ id: number; name: string; returnId: number | false; typeId: number }> {
  const act = await s.odoo<{ res_id: number }>('stock.picking', 'action_return', { ids: [s.pickingId] });
  const [rp] = await s.odoo<Array<{ name: string; return_id: [number, string] | false; picking_type_id: [number, string]; move_ids: number[] }>>(
    'stock.picking', 'read', { ids: [act.res_id], fields: ['name', 'return_id', 'picking_type_id', 'move_ids'] });
  await s.odoo('stock.move', 'write', { ids: rp.move_ids, vals: { product_uom_qty: qty } });
  await s.odoo('stock.picking', 'action_confirm', { ids: [act.res_id] });
  await s.odoo('stock.move', 'write', { ids: rp.move_ids, vals: { quantity: qty, picked: true } });
  assertEquals(await s.odoo<boolean>('stock.picking', 'button_validate', { ids: [act.res_id] }), true);
  return { id: act.res_id, name: rp.name, returnId: rp.return_id === false ? false : rp.return_id[0], typeId: rp.picking_type_id[0] };
}

/** Switch a picking type's project-cost flag for the length of `fn`, restored whatever happens. */
async function withAnalyticCosts<T>(odoo: OdooCall, typeId: number, on: boolean, fn: () => Promise<T>): Promise<T> {
  const [t] = await odoo<Array<{ analytic_costs: boolean }>>('stock.picking.type', 'read', { ids: [typeId], fields: ['analytic_costs'] });
  await odoo('stock.picking.type', 'write', { ids: [typeId], vals: { analytic_costs: on } });
  try { return await fn(); } finally { await odoo('stock.picking.type', 'write', { ids: [typeId], vals: { analytic_costs: t.analytic_costs } }); }
}

Deno.test({
  name: 'AC-IMC-001 an issue through the shipped seam books one picking_entry analytic line with no journal item, matched by the D2 domain and named by its picking',
  ignore: !BED,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const s = await issuedScenario('periodic', 2);
    try {
      const f = await fieldsOf('account.analytic.line');
      const toStock = Object.entries(f).filter(([, v]) => v.relation && /^stock\./.test(v.relation)).map(([k]) => k);
      fact('analytic line fields related to a stock model', toStock);
      assertEquals(toStock, [], 'D4: no picking or stock-move relation exists on the analytic line, so the picking name is the only link');
      const lines = await analyticLines(s);
      fact('analytic line after issuing 2 units @120 (periodic)', lines);
      assertEquals(lines.length, 1);
      const [l] = lines;
      assertEquals([l.category, l.move_line_id, l.name, l.unit_amount, l.amount], [PICKING_ENTRY, false, s.pickingName, 2, -240]);
      assertEquals([ids(l.company_id), ids(l.product_id), ids(l.account_id)], [s.companyId, s.productId, s.analyticAccountId]);
      fact('general_account_id under periodic', l.general_account_id);
      assertEquals(l.general_account_id, false, 'D6: under periodic the account is unset, so the product expense account is the fallback');
      const matched = await s.odoo<number[]>('account.analytic.line', 'search', { domain: [...stockCostDomain(s.companyId), ['account_id', '=', s.analyticAccountId]] });
      assertEquals(matched, [l.id], 'D2: the feed domain finds exactly this line');
      const [prod] = await s.odoo<Array<{ property_account_expense_id: unknown; categ_id: [number, string] }>>('product.product', 'read', { ids: [s.productId], fields: ['property_account_expense_id', 'categ_id'] });
      const [categ] = await s.odoo<Array<{ property_account_expense_categ_id: unknown }>>('product.category', 'read', { ids: [prod.categ_id[0]], fields: ['property_account_expense_categ_id'] });
      fact('product expense account / category expense account (the D6 fallback chain)', [prod.property_account_expense_id, categ.property_account_expense_categ_id]);
      assert(Array.isArray(categ.property_account_expense_categ_id) || Array.isArray(prod.property_account_expense_id), 'an expense account resolves for the synthetic product');
      const [pk] = await s.odoo<Array<{ name: string; return_id: unknown; company_id: unknown }>>('stock.picking', 'read', { ids: [s.pickingId], fields: ['name', 'return_id', 'company_id'] });
      assertEquals([pk.name, pk.return_id, ids(pk.company_id)], [s.pickingName, false, s.companyId], 'the picking is found by name within the company; an issue returns nothing');
    } finally { await s.cleanup(); }
  },
});

Deno.test({
  name: 'AC-IMC-004 Odoo: editing a done move, returning, and deleting the analytic line (what each does to the line the feed reads)',
  ignore: !BED,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const s = await issuedScenario('periodic', 2);
    try {
      const [before] = await analyticLines(s);
      // (a) edit the done move 2 -> 3
      await new Promise((r) => setTimeout(r, 1500));
      await s.odoo('stock.move', 'write', { ids: [s.moveId], vals: { quantity: 3 } });
      const [move] = await s.odoo<Array<{ quantity: number; state: string; value: number }>>('stock.move', 'read', { ids: [s.moveId], fields: ['quantity', 'state', 'value'] });
      const afterEdit = await analyticLines(s);
      fact('(a) done move edited 2 to 3: the move / the analytic line before and after', { move, before, after: afterEdit });
      assertEquals([move.state, move.quantity, move.value], ['done', 3, -360], 'the move itself is revalued');
      assertEquals(afterEdit.length, 1, 'no new analytic line is written');
      assertEquals([afterEdit[0].amount, afterEdit[0].unit_amount], [-240, 2], 'the existing analytic line keeps its amount and quantity');
      // (b) return 1 unit with the return type's project-cost flag off (the bed default), then on
      const ret = await returnIssue(s, 1);
      const [rtype] = await s.odoo<Array<{ analytic_costs: boolean; code: string }>>('stock.picking.type', 'read', { ids: [ret.typeId], fields: ['analytic_costs', 'code'] });
      const afterReturn = await analyticLines(s);
      fact('(b) return of 1: return picking / return_id / its operation type / analytic lines of the project', { ret, rtype, lines: afterReturn.map((l) => [l.name, l.unit_amount, l.amount]) });
      assertEquals([ret.returnId, rtype.code], [s.pickingId, 'incoming'], 'the return picking names the original in return_id and runs on the receipt type');
      assertEquals(rtype.analytic_costs, false, 'the receipt type books no project cost by default');
      assertEquals(afterReturn.length, 1, 'so a default return writes no analytic line: the project keeps the issue cost');
      const withFlag = await withAnalyticCosts(s.odoo, ret.typeId, true, async () => {
        const second = await returnIssue(s, 1);
        return { second, lines: await s.odoo<Array<Record<string, any>>>('account.analytic.line', 'search_read', { domain: [['name', '=', second.name]], fields: LINE_FIELDS }) };
      });
      fact('(b) return of 1 with the receipt type flag ON: return_id and its analytic line', { returnId: withFlag.second.returnId, lines: withFlag.lines });
      assertEquals(withFlag.second.returnId, s.pickingId);
      assertEquals(withFlag.lines.length, 1);
      assertEquals([withFlag.lines[0].category, withFlag.lines[0].move_line_id, withFlag.lines[0].unit_amount, withFlag.lines[0].amount], [PICKING_ENTRY, false, 1, 120],
        'a return line is the opposite sign (a credit) and its quantity is positive');
      // (c) delete the analytic line
      const all = await analyticLines(s);
      await s.odoo('account.analytic.line', 'unlink', { ids: [all[0].id] });
      const left = await analyticLines(s);
      fact('(c) the original analytic line deleted through the API: lines left', left.map((l) => l.id));
      assertEquals(left.length, all.length - 1, 'a user can delete the analytic line');
    } finally { await s.cleanup(); }
  },
});

// ───────── Task 14: whole pass, once, end to end ─────────

const DOCKER_DB = Deno.env.get('PMO_BED_DB_CONTAINER') ?? 'supabase_db_pmo-portal';
async function sql(text: string): Promise<string> {
  const p = new Deno.Command('docker', { args: ['exec', '-i', DOCKER_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], stdin: 'piped', stdout: 'piped', stderr: 'piped' }).spawn();
  const w = p.stdin.getWriter(); await w.write(new TextEncoder().encode(text)); await w.close();
  const out = await p.output();
  if (!out.success) throw new Error(`fixture sql failed: ${new TextDecoder().decode(out.stderr).slice(0, 500)}`);
  return new TextDecoder().decode(out.stdout).trim();
}
const cents = (n: number | string) => Math.round(Number(n) * 100);

async function ledgerCase(valuation: Valuation) {
  assert(CTX !== null && BED !== null, 'the bed context file (first argument) and the Odoo bed settings are required');
  const sc: SupabaseClient = createClient(CTX!.supabaseUrl, CTX!.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const must = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> => { const r = await p; if (r.error) throw new Error(r.error.message); return r.data as NonNullable<T>; };
  const odoo = bindCall({ baseUrl: CTX!.odooUrl, apiKey: CTX!.odooKey, database: CTX!.odooDatabase, fetchImpl: fetch });
  const [company] = await odoo<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
  const orgId = crypto.randomUUID(), docId = crypto.randomUUID(), lineId = crypto.randomUUID(), projectId = crypto.randomUUID(), userId = crypto.randomUUID();
  const itemId = crypto.randomUUID(), unitId = crypto.randomUUID(), whId = crypto.randomUUID();
  const stamp = `IMC14-${valuation}-${Date.now()}`;
  let s: Issued | null = null;
  try {
    // The issue goes first so the fixture can name Odoo's picking; the org's baseline pass below runs after it, then each step is compared with Odoo.
    s = await issuedScenario(valuation, 2, `stock:${docId}`);
    const sc_ = s;
    await must(sc.from('organizations').insert({ id: orgId, name: stamp }).select());
    await must(sc.from('external_org_bindings').insert({ org_id: orgId, external_tier: 'odoo', site_url: 'https://odoo.example.test', secret_ref: stamp, status: 'active',
      activated_at: new Date().toISOString(), config: { odoo_company_id: company.id, ledger_basis_at: new Date().toISOString() } }).select());
    await must(sc.from('projects').insert({ id: projectId, org_id: orgId, name: stamp }).select());
    await must(sc.from('external_project_bindings').insert({ org_id: orgId, project_id: projectId, external_tier: 'odoo', external_container_id: String(sc_.analyticAccountId) }).select());
    const accounts = await odoo<Array<{ id: number; code: string; name: string; write_date: string }>>('account.account', 'search_read', {
      domain: [['company_ids', 'in', [company.id]]], fields: ['id', 'code', 'name', 'write_date'], limit: 10000, context: { allowed_company_ids: [company.id] } });
    await must(sc.from('external_master_records').insert(accounts.map((a) => ({ org_id: orgId, external_tier: 'odoo', kind: 'account', external_id: String(a.id), code: a.code, name: a.name, source_write_date: a.write_date }))).select());
    // Triggers off, as the pgTAP fixture does: the posting path is 0879's and is proven there; this test proves the ledger read.
    await sql(`begin; set local session_replication_role = replica;
      insert into auth.users (id, email) values ('${userId}', '${stamp}@example.com');
      insert into profiles (id, org_id, full_name, email, role, status) values ('${userId}', '${orgId}', 'IMC', '${stamp}@example.com', 'Admin', 'active');
      insert into stock_units (id, org_id, code, name, whole_only) values ('${unitId}', '${orgId}', 'u', 'Unit', true);
      insert into stock_items (id, org_id, code, name, unit_id) values ('${itemId}', '${orgId}', 'I', 'Item', '${unitId}');
      insert into stock_warehouses (id, org_id, code, name, kind) values ('${whId}', '${orgId}', 'W', 'Site', 'site');
      insert into external_domain_ownership (org_id, external_tier, domain, created_at) values ('${orgId}', 'odoo', 'inventory', now() - interval '30 days');
      insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values ('${orgId}', 'stock_items', '${itemId}', 'odoo', '${sc_.productId}');
      insert into stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, occurred_on, created_by, posted_by, posted_at)
        values ('${docId}', '${orgId}', 'I1', 'issue', 'Posted', '${whId}', '${projectId}', current_date, '${userId}', '${userId}', now());
      insert into stock_document_lines (id, org_id, document_id, line_no, item_id, quantity) values ('${lineId}', '${orgId}', '${docId}', 1, '${itemId}', 2);
      insert into stock_erp_mirror (org_id, stock_document_id, company_id, external_model, external_id, external_reference, state, completed_quantity, completed_value, source_written_at, fetched_at, command_generation)
        values ('${orgId}', '${docId}', ${company.id}, 'stock.picking', '${sc_.pickingId}', '${sc_.pickingName}', 'confirmed', 2, 240, now(), now(), 1);
      commit;`);

    // D8(c) reads a stock move's journal items through the entry the move names (stock.move.account_move_id): checked at the end so the rest of the case still runs.
    let d8c: { found: number[]; entry: number[] } | null = null;
    let remaining = 50000;
    const budget = { spend: () => --remaining > 0, left: () => remaining > 0 };
    // The pass clock stays real (the feed's cursor and its overlap follow it). The hourly checks are due again by clearing their last result;
    // the daily census is due by moving the clock a day on, once, at the end.
    const pass = async (aheadMs = 0) => {
      await sql(`delete from odoo_stock_cost_checks where org_id = '${orgId}'; delete from odoo_ledger_checks where org_id = '${orgId}';`);
      const result = await runLedgerPass(sc, orgId, odoo, company.id, budget, { now: () => new Date(Date.now() + aheadMs) });
      if (result.stalled && !result.stockCaughtUp) {
        // The pass reads every picking_entry line of the company, so a product left without a category or expense account by another bed file holds it.
        const names = await sql(`select detail->'products' from audit_events where org_id = '${orgId}' and action = 'integration.odoo.stock_cost_held' order by created_at desc limit 1;`);
        throw new Error(`the stock kind is held on ${result.held} line(s) of products with no category and no expense account: bed debris from another test, not this code. Products: ${names || 'none logged'}. Give them a category in the bed.`);
      }
      return result;
    };
    const projectNet = async () => {
      const rows = await must(sc.from('erp_actuals_snapshot').select('debit,credit,source_report').eq('org_id', orgId).eq('project_id', projectId));
      return { stock: rows.filter((r) => r.source_report === 'Odoo stock issue').reduce((n, r) => n + cents(r.debit) - cents(r.credit), 0),
               gl: rows.filter((r) => r.source_report !== 'Odoo stock issue').reduce((n, r) => n + cents(r.debit) - cents(r.credit), 0) };
    };
    /** This project's stored rows: the table also holds every other company line Odoo has, unattributed (D2). */
    const stored = async () => await must(sc.from('odoo_stock_cost_lines').select('analytic_line_id,tie_state,is_cancelled,double_count_risk,debit,credit,unit_amount,stock_document_line_id,account').eq('org_id', orgId).eq('analytic_account_id', String(sc_.analyticAccountId)).order('analytic_line_id'));
    /** Odoo's own sum of the project's analytic lines (cost = minus the amount), in cents. */
    const odooCost = async () => -(await analyticLines(sc_)).reduce((n, l) => n + cents(l.amount), 0);
    /** GL totals of the company: the whole-ledger check's oracle. */
    const glTotals = async () => await odoo<Array<Record<string, any>>>('account.move.line', 'formatted_read_group', { domain: [['company_id', '=', company.id], ['parent_state', '=', 'posted']], groupby: ['account_id'], aggregates: ['debit:sum', 'credit:sum'] });

    // 1. The first pass: the issue arrives once.
    const gl0 = await glTotals();
    const first = await pass();
    const net1 = await projectNet();
    const rows1 = await stored();
    fact(`[${valuation}] first pass`, { first, net1, rows1, odooCost: await odooCost(), glAccounts: gl0.length });
    assert(first.caughtUp && first.stockCaughtUp, 'both kinds reach the present');
    assertEquals(net1.stock, 24000, 'the project actual rose by exactly the analytic amount, 240.00');
    assertEquals(net1.stock, await odooCost(), 'and it equals Odoo');
    assertEquals(net1.gl, 0, 'the GL kind attributes nothing to the project (no journal item carries the project)');
    assertEquals(first.check, 'matches', 'the whole-ledger GL check reads matches');
    assertEquals(first.stockCheck, 'matches', 'the stock-cost check reads matches');
    assertEquals(rows1.length, 1);
    assertEquals([rows1[0].tie_state, rows1[0].stock_document_line_id, rows1[0].double_count_risk, rows1[0].is_cancelled], ['tied', lineId, false, false]);
    const checks = await must(sc.from('odoo_stock_cost_checks').select('status,double_counts').eq('org_id', orgId).order('checked_at', { ascending: false }).limit(1));
    assertEquals([checks[0].status, checks[0].double_counts], ['matches', 0], 'the no-double-count check is clean');
    if (valuation === 'real_time') {
      const deadLink = await odoo<number[]>('account.move.line', 'search', { domain: [['stock_move_id', '=', sc_.moveId]] });
      const [issueMove] = await odoo<Array<{ account_move_id: [number, string] | false }>>('stock.move', 'read', { ids: [sc_.moveId], fields: ['account_move_id'] });
      assert(issueMove.account_move_id, 'the issue move is linked to its stock journal entry');
      const journal = await odoo<Array<Record<string, any>>>('account.move.line', 'search_read', { domain: [['move_id', '=', issueMove.account_move_id[0]]], fields: ['stock_move_id', 'analytic_distribution', 'debit', 'credit', 'account_id'] });
      const found = await odoo<number[]>('account.move.line', 'search', { domain: [['move_id', 'in', [issueMove.account_move_id[0]]]] });
      fact('[real_time] journal items found through the dead account.move.line.stock_move_id / through the entry the stock move names', { deadLink, found, journal });
      d8c = { found, entry: journal.map((l) => Number(l.id)) };
      assertEquals(journal.length, 2, 'real_time posts a COGS / Inventory entry that the GL kind reads');
      assert(journal.every((l) => l.analytic_distribution === false), 'and neither item carries the project');
    }
    const [line] = await analyticLines(sc_);
    fact(`[${valuation}] general_account_id and the account the cost landed on`, { general: line.general_account_id, account: rows1[0].account });

    // 2. A repeat pass changes nothing.
    const again = await pass();
    assertEquals(await projectNet(), net1, 'a repeated pass leaves the actuals as they were');
    assertEquals(await stored(), rows1, 'and the stored rows');
    assertEquals([again.check, again.stockCheck], ['matches', 'matches']);

    // 2b. real_time only: tag the stock entry's cost item to the project by hand (the customised Odoo the check exists for). Both
    // sources would count it; the check must flag the analytic line, the actual must stay counted once, and untagging must clear it.
    if (valuation === 'real_time') {
      const [issueMove] = await odoo<Array<{ account_move_id: [number, string] }>>('stock.move', 'read', { ids: [sc_.moveId], fields: ['account_move_id'] });
      const [cost] = await odoo<Array<Record<string, any>>>('account.move.line', 'search_read', { domain: [['move_id', '=', issueMove.account_move_id[0]], ['debit', '>', 0]], fields: ['analytic_distribution'] });
      assert(cost, 'the entry has a cost item to tag');
      await odoo('account.move.line', 'write', { ids: [cost.id], vals: { analytic_distribution: { [String(sc_.analyticAccountId)]: 100 } } });
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const tagged = await pass();
        const flagged = await stored();
        const tagChecks = await must(sc.from('odoo_stock_cost_checks').select('status,double_counts').eq('org_id', orgId).order('checked_at', { ascending: false }).limit(1));
        fact('[real_time] after tagging the stock entry\'s item to the project', { tagged, rows: flagged.map((r) => [r.analytic_line_id, r.tie_state, r.double_count_risk]), net: await projectNet(), checks: tagChecks });
        assertEquals(tagged.stockCheck, 'differs', 'D8(c) flags the double count');
        assertEquals([tagChecks[0].status, tagChecks[0].double_counts], ['differs', 1]);
        assertEquals(flagged.map((r) => r.double_count_risk), [true], 'the analytic line is marked, not counted');
        const net = await projectNet();
        assertEquals(net.stock + net.gl, 24000, 'the project actual is still counted once (the ledger source carries it)');
      } finally {
        await odoo('account.move.line', 'write', { ids: [cost.id], vals: { analytic_distribution: false } });
        await new Promise((r) => setTimeout(r, 1500));
      }
      const cleared = await pass();
      assertEquals(cleared.stockCheck, 'matches', 'untagged, the check is clean again');
      assertEquals((await stored()).map((r) => r.double_count_risk), [false]);
      assertEquals(await projectNet(), net1, 'and the actuals are back where they were');
    }

    // 3. A correction in Odoo (done move 2 -> 3): the analytic line, the only source, is unchanged, so PMO is too (D5 differs on the bed).
    await new Promise((r) => setTimeout(r, 1500));
    await odoo('stock.move', 'write', { ids: [sc_.moveId], vals: { quantity: 3 } });
    const corrected = await pass();
    fact(`[${valuation}] after the 2 to 3 edit`, { odooCost: await odooCost(), pmo: await projectNet(), checks: [corrected.check, corrected.stockCheck] });
    assertEquals((await projectNet()).stock, await odooCost(), 'PMO still equals Odoo after the edit, once');
    assertEquals(corrected.stockCheck, 'matches');

    // 4. A return of 1: the default receipt type books no project cost; with the flag on the credit arrives and ties to the original line.
    const ret0 = await returnIssue(sc_, 1);
    await pass();
    assertEquals((await projectNet()).stock, await odooCost(), 'a default return changes neither Odoo nor PMO');
    const ret = await withAnalyticCosts(odoo, ret0.typeId, true, async () => await returnIssue(sc_, 1));
    const afterRet = await pass();
    const rows3 = await stored();
    fact(`[${valuation}] after a return with the project cost flag on`, { passResult: afterRet, odooLines: (await analyticLines(sc_)).map((l) => [l.id, l.name, l.amount, l.write_date]), odooCost: await odooCost(), pmo: await projectNet(), rows: rows3.map((r) => [r.analytic_line_id, r.tie_state, r.debit, r.credit, r.unit_amount]), checks: [afterRet.check, afterRet.stockCheck] });
    assertEquals((await projectNet()).stock, await odooCost(), 'the return credit follows, once');
    assertEquals((await projectNet()).stock, 12000);
    const retRow = rows3.find((r) => r.tie_state === 'return');
    assert(retRow, 'the return line ties as a return');
    assertEquals([retRow.stock_document_line_id, cents(retRow.credit), Number(retRow.unit_amount)], [lineId, 12000, 1], 'to the original line, with Odoo quantity 1 for the work item');
    assertEquals(ret.returnId, sc_.pickingId);
    assertEquals([afterRet.check, afterRet.stockCheck], ['matches', 'matches']);

    // 5. Deleting the issue's analytic line in Odoo: the daily census cancels the row and the actual follows.
    const all = await analyticLines(sc_);
    await odoo('account.analytic.line', 'unlink', { ids: [all[0].id] });
    const final = await pass(26 * 3_600_000);
    const rows4 = await stored();
    fact(`[${valuation}] after the deletion and a day`, { odooCost: await odooCost(), pmo: await projectNet(), rows: rows4.map((r) => [r.analytic_line_id, r.tie_state, r.is_cancelled]), checks: [final.check, final.stockCheck] });
    assertEquals((await projectNet()).stock, await odooCost(), 'PMO follows the deletion');
    assertEquals(rows4.find((r) => r.analytic_line_id === all[0].id)?.is_cancelled, true, 'the row is cancelled, not deleted');
    assertEquals(final.stockCheck, 'matches');
    if (d8c) assertEquals([...d8c.found].sort(), [...d8c.entry].sort(), 'D8(c): the relation the no-double-count check reads (stock.move.account_move_id, then the entry\'s items) finds the stock entry\'s journal items');
  } finally {
    // Every table of the org by its org_id column, triggers off (so nothing is left behind and no order matters), then the user.
    await sql(`begin; set local session_replication_role = replica;
      do $$ declare t text; begin
        for t in select c.table_name from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
                  where c.table_schema = 'public' and c.column_name = 'org_id' and x.table_type = 'BASE TABLE' loop
          execute format('delete from public.%I where org_id = %L', t, '${orgId}');
        end loop;
        delete from public.organizations where id = '${orgId}';
        delete from auth.users where id = '${userId}';
      end $$; commit;`).catch((e) => console.error('fixture cleanup failed', String(e).slice(0, 200)));
    if (s) await s.cleanup();
  }
}

for (const valuation of ['periodic', 'real_time'] as const) {
  Deno.test({
    name: `AC-IMC-002 / 004 / 005 the whole pass on the bed, ${valuation}: the issue arrives once, a repeat changes nothing, a correction, a return and a deletion follow Odoo, both checks match`,
    ignore: !BED || !CTX,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => await ledgerCase(valuation),
  });
}
