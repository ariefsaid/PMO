// #1508 Round 7.1 (AC-OSP-002, AC-OSP-003, AC-OSP-006): a real PMO transfer and a real project issue through the SHIPPED adapter-dispatch handler,
// against the LOCAL database (real grants, triggers, RPCs, a real sign-in) AND the Odoo 20 dev bed (nothing faked), each replayed once.
// Proved: one picking per anchor, one analytic line per move, mirror confirmed, document Posted by the keeper, the project's ledger moved by
// exactly -quantity x cost with no line a journal booked, a real-time category included. Cleanup runs in `finally`.
// Gated on its dependencies, never on CI: without them the suite is ignored. Run (odoo lock outermost, then the db lock):
//   scripts/with-odoo-lock.sh scripts/with-db-lock.sh bash -c 'supabase db reset && set -a && . ./.env.odoo.local && set +a && \
//     eval "$(supabase status -o env | grep -E "^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=")" && \
//     PMO_LOCAL_URL=$API_URL PMO_LOCAL_ANON_KEY=$ANON_KEY PMO_LOCAL_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
//     ODOO_BED_URL=http://127.0.0.1:${ODOO_PORT:-8069} ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY \
//     deno test --allow-all --config supabase/functions/adapter-dispatch/deno.json supabase/functions/adapter-dispatch/odooStockIntegrated.bed.test.ts'
import { afterAll, beforeAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';

const LOCAL_URL = Deno.env.get('PMO_LOCAL_URL');
const ANON = Deno.env.get('PMO_LOCAL_ANON_KEY');
const SERVICE = Deno.env.get('PMO_LOCAL_SERVICE_ROLE_KEY');
const BED_URL = Deno.env.get('ODOO_BED_URL');
const BED_DB = Deno.env.get('ODOO_BED_DB');
const BED_KEY = Deno.env.get('ODOO_BED_KEY');
const READY = Boolean(LOCAL_URL && ANON && SERVICE && BED_URL && BED_DB && BED_KEY);
if (READY) {
  Deno.env.set('SUPABASE_URL', LOCAL_URL!);
  Deno.env.set('SUPABASE_ANON_KEY', ANON!);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE!);
  // The bed is plain http on localhost: the ERP host guard admits only listed origins, and only on a local stack.
  Deno.env.set('ERPNEXT_ALLOW_LOCAL_BENCH', '1');
  Deno.env.set('ERPNEXT_LOCAL_BENCH_ORIGINS', new URL(BED_URL!).origin);
}

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
if (READY) await import('./index.ts');

const ORG = '00000000-0000-0000-0000-000000000001';
const KEEPER = '00000000-0000-0000-0000-0000000000a4';
const ID = (n: number) => `15081000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WH_SRC = ID(1), WH_DST = ID(2), ITEM_PER = ID(11), ITEM_RT = ID(12), BOQ = ID(31);
// Odoo keeps a picking forever and anchors it to the document id, so each run uses documents of its own.
const DOC_XFER = crypto.randomUUID(), DOC_ISSUE = crypto.randomUUID();
const SECRET_REF = 'served-odoo-1508-bed';
const COMPANY = 1;

async function psql(sql: string): Promise<string> {
  // The SQL goes in on stdin: the bed's key is in it, and a command line is visible to every process.
  const child = new Deno.Command('docker', {
    args: ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    stdin: 'piped', stdout: 'piped', stderr: 'piped',
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(sql));
  await writer.close();
  const out = await child.output();
  assert(out.success, `psql failed: ${new TextDecoder().decode(out.stderr)}`);
  return new TextDecoder().decode(out.stdout).trim();
}
const one = (sql: string) => psql(sql);

const DOCS = `'${DOC_XFER}','${DOC_ISSUE}'`;
const cleanup = () => psql(`
  set session_replication_role = replica;
  delete from public.stock_erp_mirror where org_id='${ORG}' and stock_document_id in (${DOCS});
  delete from public.external_command_outbox where org_id='${ORG}' and domain='inventory' and pmo_record_id in (${DOCS});
  delete from public.stock_ledger where document_id in (${DOCS});
  delete from public.stock_balances where item_id in ('${ITEM_PER}','${ITEM_RT}');
  delete from public.stock_document_lines where document_id in (${DOCS});
  delete from public.stock_documents where id in (${DOCS});
  delete from public.boq_items where id='${BOQ}';
  delete from public.external_refs where org_id='${ORG}' and domain in ('stock_items','stock_warehouses') and pmo_record_id in ('${ITEM_PER}','${ITEM_RT}','${WH_SRC}','${WH_DST}');
  delete from public.external_project_bindings where org_id='${ORG}' and external_tier='odoo';
  delete from public.external_master_records where org_id='${ORG}' and external_tier='odoo' and kind='analytic_account';
  delete from public.stock_warehouse_keepers where warehouse_id in ('${WH_SRC}','${WH_DST}');
  delete from public.stock_warehouses where id in ('${WH_SRC}','${WH_DST}');
  delete from public.stock_items where id in ('${ITEM_PER}','${ITEM_RT}');
  delete from public.external_domain_ownership where org_id='${ORG}' and domain='inventory';
  delete from public.external_org_bindings where org_id='${ORG}' and external_tier='odoo';
  delete from vault.secrets where name='${SECRET_REF}';`);

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${LOCAL_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON!, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!dev' }),
  });
  const body = await res.json() as { access_token?: string };
  assert(body.access_token, `sign-in failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function post(jwt: string, docId: string) {
  const revision = Number(await one(`select revision from public.stock_documents where id='${docId}'`));
  const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
    method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'inventory', operation: 'create', idempotencyKey: crypto.randomUUID(), record: { id: docId, revision, erp_doc_kind: 'stock-document' } }),
  }));
  return { status: res.status, body: JSON.parse(await res.text()) as { externalRecordId?: string; message?: string; error?: string } };
}

describe({ name: 'AC-OSP-002 / AC-OSP-003 / AC-OSP-006 Round 7.1: integrated proof on the Odoo bed and the local database', ignore: !READY }, () => {
  const odoo: OdooCall = READY ? bindCall({ baseUrl: BED_URL!, database: BED_DB!, apiKey: BED_KEY!, fetchImpl: fetch }) : (undefined as unknown as OdooCall);
  const stamp = `INT-${Date.now()}`;
  const made = { products: [] as number[], warehouses: [] as number[] };
  let restoreType: { dest: number; analytic: boolean } | null = null;
  let jwt = '';
  let analyticAccountId = 0;
  let pPer = 0, pRt = 0;
  const anchorName = (doc: string) => `stock_${doc.replace(/[^a-zA-Z0-9]/g, '_')}`;

  beforeAll(async () => {
    await cleanup();
    const [w1] = await odoo<Array<{ lot_stock_id: [number, string]; int_type_id: [number, string] }>>('stock.warehouse', 'search_read', {
      domain: [['company_id', '=', COMPANY]], fields: ['lot_stock_id', 'int_type_id'], order: 'id asc', limit: 1,
    });
    const [w2] = await odoo<number[]>('stock.warehouse', 'create', { vals_list: [{ name: `${stamp} W2`, code: `Y${String(Date.now()).slice(-4)}`, company_id: COMPANY }] });
    made.warehouses.push(w2);
    const [w2r] = await odoo<Array<{ lot_stock_id: [number, string] }>>('stock.warehouse', 'read', { ids: [w2], fields: ['lot_stock_id'] });
    const [cPer] = await odoo<number[]>('product.category', 'create', { vals_list: [{ name: `${stamp} Periodic` }] });
    const [cRt] = await odoo<number[]>('product.category', 'create', { vals_list: [{
      name: `${stamp} RT`, property_valuation: 'real_time', property_cost_method: 'standard', property_stock_journal: 14,
      property_stock_valuation_account_id: 66, property_account_expense_categ_id: 152, property_account_income_categ_id: 140,
    }] });
    [pPer] = await odoo<number[]>('product.product', 'create', { vals_list: [{ name: `${stamp} P-per`, categ_id: cPer, company_id: COMPANY, is_storable: true, standard_price: 10 }] });
    [pRt] = await odoo<number[]>('product.product', 'create', { vals_list: [{ name: `${stamp} P-rt`, categ_id: cRt, company_id: COMPANY, is_storable: true, standard_price: 20 }] });
    made.products.push(pPer, pRt);
    const [project] = await odoo<number[]>('project.project', 'create', { vals_list: [{ name: `${stamp} Project`, company_id: COMPANY }] });
    const [pr] = await odoo<Array<{ account_id: [number, string] }>>('project.project', 'read', { ids: [project], fields: ['account_id'] });
    analyticAccountId = pr.account_id[0];
    // The issue's destination is the operation type's default: point it at a customer location that carries the COGS account (real-time books there).
    const [customer] = await odoo<number[]>('stock.location', 'create', { vals_list: [{ name: `${stamp} Customer`, usage: 'customer', company_id: COMPANY, valuation_account_id: 152 }] });
    const [type] = await odoo<Array<{ default_location_dest_id: [number, string]; analytic_costs: boolean }>>('stock.picking.type', 'read', { ids: [2], fields: ['default_location_dest_id', 'analytic_costs'] });
    restoreType = { dest: type.default_location_dest_id[0], analytic: type.analytic_costs };
    await odoo('stock.picking.type', 'write', { ids: [2], vals: { analytic_costs: true, default_location_dest_id: customer } });

    await psql(`
      select vault.create_secret('${BED_KEY}', '${SECRET_REF}');
      insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at)
        values ('${ORG}','odoo','${BED_URL}','${SECRET_REF}','active','{"database":"${BED_DB}","odoo_company_id":${COMPANY},"stock_operation_type_id":2,"stock_transfer_operation_type_id":${w1.int_type_id[0]}}',now());
      insert into public.stock_units (org_id, code, name, whole_only) select '${ORG}','srv','Served unit',false where not exists (select 1 from public.stock_units where org_id='${ORG}');
      insert into public.stock_items (id, org_id, code, name, unit_id) values
        ('${ITEM_PER}','${ORG}','INT-PER','Integrated periodic',(select id from public.stock_units where org_id='${ORG}' order by code limit 1)),
        ('${ITEM_RT}','${ORG}','INT-RT','Integrated real-time',(select id from public.stock_units where org_id='${ORG}' order by code limit 1));
      insert into public.stock_warehouses (id, org_id, code, name, kind) values ('${WH_SRC}','${ORG}','INT-A','Int A','site'),('${WH_DST}','${ORG}','INT-B','Int B','site');
      insert into public.stock_warehouse_keepers (org_id, warehouse_id, user_id) values ('${ORG}','${WH_SRC}','${KEEPER}');
      insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
        ('${ORG}','stock_items','${ITEM_PER}','odoo','${pPer}'),('${ORG}','stock_items','${ITEM_RT}','odoo','${pRt}'),
        ('${ORG}','stock_warehouses','${WH_SRC}','odoo','${w1.lot_stock_id[0]}'),('${ORG}','stock_warehouses','${WH_DST}','odoo','${w2r.lot_stock_id[0]}');
      insert into public.external_master_records (org_id, external_tier, kind, external_id, name, active, source_write_date) values ('${ORG}','odoo','analytic_account','${analyticAccountId}','${stamp} Project',true,'2026-11-15');
      insert into public.external_project_bindings (org_id, project_id, external_tier, external_container_id)
        select '${ORG}', (select id from public.projects where org_id='${ORG}' order by created_at limit 1), 'odoo', '${analyticAccountId}';
      insert into public.boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate)
        select '${BOQ}', '${ORG}', (select id from public.projects where org_id='${ORG}' order by created_at limit 1), 'INT-W', 'Integrated work item', 'u', 50, 1000;
      insert into public.stock_documents (id, org_id, number, kind, warehouse_id, to_warehouse_id, project_id, occurred_on, created_by) values
        ('${DOC_XFER}','${ORG}','INT-T1','transfer','${WH_SRC}','${WH_DST}',null,current_date,'${KEEPER}'),
        ('${DOC_ISSUE}','${ORG}','INT-I1','issue','${WH_SRC}',null,(select id from public.projects where org_id='${ORG}' order by created_at limit 1),current_date,'${KEEPER}');
      insert into public.stock_document_lines (org_id, document_id, line_no, item_id, quantity) values
        ('${ORG}','${DOC_XFER}',1,'${ITEM_PER}',3),('${ORG}','${DOC_XFER}',2,'${ITEM_RT}',2),
        ('${ORG}','${DOC_ISSUE}',1,'${ITEM_PER}',4),('${ORG}','${DOC_ISSUE}',2,'${ITEM_RT}',1);
      update public.stock_document_lines set boq_item_id='${BOQ}' where document_id='${DOC_ISSUE}';
      set session_replication_role = replica;   -- the seed org already holds Drafts, which the employment guard refuses
      insert into public.external_domain_ownership (org_id, external_tier, domain) values ('${ORG}','odoo','inventory');`);
    jwt = await signIn('engineer@acme.test');
  });

  afterAll(async () => {
    if (restoreType) await odoo('stock.picking.type', 'write', { ids: [2], vals: { analytic_costs: restoreType.analytic, default_location_dest_id: restoreType.dest } }).catch(() => {});
    for (const id of made.products) await odoo('product.product', 'write', { ids: [id], vals: { active: false } }).catch(() => {});
    for (const id of made.warehouses) await odoo('stock.warehouse', 'write', { ids: [id], vals: { active: false } }).catch(() => {});
    await cleanup();
  });

  const anchored = async (doc: string) => {
    const rows = await odoo<Array<{ res_id: number }>>('ir.model.data', 'search_read', { domain: [['module', '=', 'pmo'], ['name', '=', anchorName(doc)], ['model', '=', 'stock.picking']], fields: ['res_id'] });
    return rows.map((r) => r.res_id);
  };
  const movesOf = async (pickingId: number) => {
    const [p] = await odoo<Array<{ name: string; state: string; move_ids: number[] }>>('stock.picking', 'read', { ids: [pickingId], fields: ['name', 'state', 'move_ids'] });
    const moves = await odoo<Array<{ product_id: [number, string]; state: string; quantity: number; value: number; is_valued: boolean }>>('stock.move', 'read', { ids: p.move_ids, fields: ['product_id', 'state', 'quantity', 'value', 'is_valued'] });
    return { picking: p, moves };
  };
  const projectLines = () => odoo<Array<{ name: string; category: string; product_id: [number, string]; amount: number }>>('account.analytic.line', 'search_read', {
    domain: [['account_id', '=', analyticAccountId]], fields: ['name', 'category', 'product_id', 'amount'], order: 'id asc',
  });
  const documentState = (doc: string) => one(`select d.status||'/'||coalesce(d.posted_by::text,'')||'/'||(select state from public.external_command_outbox o where o.pmo_record_id=d.id::text)||'/'||(select state from public.stock_erp_mirror m where m.stock_document_id=d.id) from public.stock_documents d where d.id='${doc}'`);

  it('a PMO transfer, a periodic and a real-time item: one picking, two moves, not valued; replayed once it stays one', async () => {
    const first = await post(jwt, DOC_XFER);
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const anchors = await anchored(DOC_XFER);
    assertEquals(anchors.length, 1, 'exactly one picking per anchor');
    const { picking, moves } = await movesOf(anchors[0]);
    assertEquals(picking.state, 'done');
    assertEquals(moves.map((m) => [m.product_id[0], m.quantity, m.state, m.value, m.is_valued]).sort(), [[pPer, 3, 'done', 0, false], [pRt, 2, 'done', 0, false]].sort());
    assertEquals(await documentState(DOC_XFER), `Posted/${KEEPER}/confirmed/confirmed`);
    assertEquals(await one(`select completed_quantity||'/'||completed_value from public.stock_erp_mirror where stock_document_id='${DOC_XFER}'`), '5/0', 'quantity moved, no value change');
    assertEquals((await projectLines()).length, 0, 'a transfer books nothing to a project');

    const replay = await post(jwt, DOC_XFER);
    assertEquals(replay.status, 200, JSON.stringify(replay.body));
    assertEquals(replay.body.externalRecordId, first.body.externalRecordId);
    assertEquals(await anchored(DOC_XFER), anchors, 'a replay leaves the one picking');
    assertEquals((await movesOf(anchors[0])).moves.length, 2, 'and its two moves (a second load would double them)');
  });

  it('a PMO project issue, a periodic and a real-time item: one picking, one cost line per move, the project moved by -quantity x cost and nothing a journal booked; replayed once it stays so', async () => {
    const first = await post(jwt, DOC_ISSUE);
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const anchors = await anchored(DOC_ISSUE);
    assertEquals(anchors.length, 1, 'exactly one picking per anchor');
    const { picking, moves } = await movesOf(anchors[0]);
    assertEquals(picking.state, 'done');
    assertEquals(moves.map((m) => [m.product_id[0], m.quantity, m.value, m.is_valued]).sort(), [[pPer, 4, -40, true], [pRt, 1, -20, true]].sort());
    let lines = await projectLines();
    assertEquals(lines.length, moves.length, 'one analytic line per move');
    assert(lines.every((l) => l.category === 'picking_entry' && l.name === picking.name), 'every line is the picking entry; no journal booked one');
    assertEquals(lines.reduce((sum, l) => sum + l.amount, 0), -(4 * 10 + 1 * 20), 'the project ledger moved by -quantity x cost');
    assertEquals(await documentState(DOC_ISSUE), `Posted/${KEEPER}/confirmed/confirmed`);
    assertEquals(await one(`select completed_quantity||'/'||completed_value from public.stock_erp_mirror where stock_document_id='${DOC_ISSUE}'`), '5/-60');

    const replay = await post(jwt, DOC_ISSUE);
    assertEquals(replay.status, 200, JSON.stringify(replay.body));
    assertEquals(replay.body.externalRecordId, first.body.externalRecordId);
    assertEquals(await anchored(DOC_ISSUE), anchors);
    lines = await projectLines();
    assertEquals([lines.length, lines.reduce((sum, l) => sum + l.amount, 0)], [2, -60], 'a replay adds no cost line');
    assertEquals((await movesOf(anchors[0])).moves.length, 2);
  });
});
