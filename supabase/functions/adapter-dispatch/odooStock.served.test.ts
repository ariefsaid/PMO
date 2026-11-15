// #1508 Round 6.2 (AC-OSP-004, AC-OSP-006, AC-OSP-007): the SHIPPED handler (`./index.ts`) against the LOCAL database with its real
// grants, triggers and RPCs (real PostgREST and GoTrue; the JWT is a real sign-in). Only Odoo is fake. A mock cannot accept what the
// 0869 guard refuses, so who may post, what is written and what is posted are the database's answers here.
//
// Run (one lock hold; the wrapper hands the local keys in, nothing is read from a file):
//   scripts/with-db-lock.sh bash -c 'supabase db reset && eval "$(supabase status -o env | grep -E "^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=")" && \
//     PMO_LOCAL_URL=$API_URL PMO_LOCAL_ANON_KEY=$ANON_KEY PMO_LOCAL_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
//     deno test --allow-all --config supabase/functions/adapter-dispatch/deno.json supabase/functions/adapter-dispatch/odooStock.served.test.ts'
import { afterAll, beforeAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';

const LOCAL_URL = Deno.env.get('PMO_LOCAL_URL');
const ANON = Deno.env.get('PMO_LOCAL_ANON_KEY');
const SERVICE = Deno.env.get('PMO_LOCAL_SERVICE_ROLE_KEY');
// Gated on the dependency (the local stack), never on CI, like the bed tests: without the three variables the suite is ignored.
const LOCAL = Boolean(LOCAL_URL && ANON && SERVICE);
if (LOCAL) {
  Deno.env.set('SUPABASE_URL', LOCAL_URL!);
  Deno.env.set('SUPABASE_ANON_KEY', ANON!);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE!);
}

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
if (LOCAL) await import('./index.ts');

const ORG = '00000000-0000-0000-0000-000000000001';
const KEEPER = '00000000-0000-0000-0000-0000000000a4';   // seed Engineer, keeps the source warehouse below
const STRANGER = '00000000-0000-0000-0000-0000000000c1'; // seed Engineer, keeps nothing
const KEEPER_EMAIL = 'engineer@acme.test';
const STRANGER_EMAIL = 'tse-021-eng@acme.test';
const PASSWORD = 'Passw0rd!dev';
const ODOO_HOST = 'odoo.served.test';
const ODOO_KEY = 'served-key';
const COMPANY = 1;
const ID = (n: number) => `15080000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WH_SRC = ID(1), WH_DST = ID(2), WH_BAD = ID(3), ITEM = ID(11), DOC_OK = ID(21), DOC_STRANGER = ID(22), DOC_FOREIGN = ID(23);
const SECRET_REF = 'served-odoo-1508';

async function psql(sql: string): Promise<string> {
  const out = await new Deno.Command('docker', {
    args: ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    stdout: 'piped', stderr: 'piped',
  }).output();
  assert(out.success, `psql failed: ${new TextDecoder().decode(out.stderr)}`);
  return new TextDecoder().decode(out.stdout).trim();
}

const cleanup = () => psql(`
  set session_replication_role = replica;
  delete from public.stock_erp_mirror where org_id='${ORG}' and stock_document_id in ('${DOC_OK}','${DOC_STRANGER}','${DOC_FOREIGN}');
  delete from public.external_command_outbox where org_id='${ORG}' and domain='inventory' and pmo_record_id in ('${DOC_OK}','${DOC_STRANGER}','${DOC_FOREIGN}');
  delete from public.stock_ledger where document_id in ('${DOC_OK}','${DOC_STRANGER}','${DOC_FOREIGN}');
  delete from public.stock_balances where item_id='${ITEM}';
  delete from public.stock_document_lines where document_id in ('${DOC_OK}','${DOC_STRANGER}','${DOC_FOREIGN}');
  delete from public.stock_documents where id in ('${DOC_OK}','${DOC_STRANGER}','${DOC_FOREIGN}');
  delete from public.external_refs where org_id='${ORG}' and domain in ('stock_items','stock_warehouses') and pmo_record_id in ('${ITEM}','${WH_SRC}','${WH_DST}','${WH_BAD}');
  delete from public.stock_warehouse_keepers where warehouse_id in ('${WH_SRC}','${WH_DST}','${WH_BAD}');
  delete from public.stock_warehouses where id in ('${WH_SRC}','${WH_DST}','${WH_BAD}');
  delete from public.stock_items where id='${ITEM}';
  delete from public.external_domain_ownership where org_id='${ORG}' and domain='inventory';
  delete from public.external_org_bindings where org_id='${ORG}' and external_tier='odoo';
  delete from vault.secrets where name='${SECRET_REF}';`);

const stockUnit = '(select id from public.stock_units where org_id=\'' + ORG + '\' order by code limit 1)';

async function seed() {
  await cleanup();
  await psql(`
    select vault.create_secret('${ODOO_KEY}', '${SECRET_REF}');
    insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at)
      values ('${ORG}','odoo','https://${ODOO_HOST}','${SECRET_REF}','active','{"database":"db1","odoo_company_id":${COMPANY},"stock_transfer_operation_type_id":5}',now());
    insert into public.stock_units (org_id, code, name, whole_only) select '${ORG}','srv','Served unit',false where not exists (select 1 from public.stock_units where org_id='${ORG}');
    insert into public.stock_items (id, org_id, code, name, unit_id) values ('${ITEM}','${ORG}','SRV-1','Served item',${stockUnit});
    insert into public.stock_warehouses (id, org_id, code, name, kind) values
      ('${WH_SRC}','${ORG}','SRV-A','Served A','site'),('${WH_DST}','${ORG}','SRV-B','Served B','site'),('${WH_BAD}','${ORG}','SRV-C','Served C','site');
    insert into public.stock_warehouse_keepers (org_id, warehouse_id, user_id) values ('${ORG}','${WH_SRC}','${KEEPER}'),('${ORG}','${WH_BAD}','${KEEPER}');
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
      ('${ORG}','stock_items','${ITEM}','odoo','101'),('${ORG}','stock_warehouses','${WH_SRC}','odoo','10'),
      ('${ORG}','stock_warehouses','${WH_DST}','odoo','20'),('${ORG}','stock_warehouses','${WH_BAD}','odoo','30');
    insert into public.stock_documents (id, org_id, number, kind, warehouse_id, to_warehouse_id, occurred_on, created_by) values
      ('${DOC_OK}','${ORG}','SRV-T1','transfer','${WH_SRC}','${WH_DST}',current_date,'${KEEPER}'),
      ('${DOC_STRANGER}','${ORG}','SRV-T2','transfer','${WH_SRC}','${WH_DST}',current_date,'${KEEPER}'),
      ('${DOC_FOREIGN}','${ORG}','SRV-T3','transfer','${WH_BAD}','${WH_DST}',current_date,'${KEEPER}');
    insert into public.stock_document_lines (org_id, document_id, line_no, item_id, quantity)
      select '${ORG}', d, 1, '${ITEM}', 4 from unnest(array['${DOC_OK}','${DOC_STRANGER}','${DOC_FOREIGN}']::uuid[]) d;
    set session_replication_role = replica;   -- the seed org already holds Drafts, which the employment guard refuses
    insert into public.external_domain_ownership (org_id, external_tier, domain) values ('${ORG}','odoo','inventory');`);
}

function seedOdoo(odoo: FakeOdoo) {
  odoo.seed('res.company', [{ id: COMPANY, name: 'Main Co', currency_id: [5, 'IDR'] }, { id: 2, name: 'Other Co', currency_id: [5, 'IDR'] }]);
  odoo.seed('stock.picking.type', [{ id: 5, name: 'Internal', code: 'internal', company_id: [COMPANY, 'Main Co'], default_location_dest_id: [20, 'B'] }]);
  odoo.seed('stock.location', [
    { id: 10, complete_name: 'A/Stock', usage: 'internal', company_id: [COMPANY, 'Main Co'], active: true },
    { id: 20, complete_name: 'B/Stock', usage: 'internal', company_id: [COMPANY, 'Main Co'], active: true },
    { id: 30, complete_name: 'C/Stock', usage: 'internal', company_id: [2, 'Other Co'], active: true },
    { id: 40, complete_name: 'D/Stock', usage: 'internal', company_id: [COMPANY, 'Main Co'], active: true },
  ]);
  odoo.seed('product.product', [{ id: 101, name: 'Served item', is_storable: true, company_id: [COMPANY, 'Main Co'], active: true }]);
}

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${LOCAL_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON!, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json() as { access_token?: string };
  assert(body.access_token, `sign-in for ${email} failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

/** Odoo is the fake; everything else (PostgREST, GoTrue, JWKS) is the real local stack. */
async function dispatch(jwt: string, odoo: FakeOdoo, docId: string, revision: number) {
  const realFetch = globalThis.fetch;
  const realResolveDns = Deno.resolveDns;
  Deno.resolveDns = (async () => ['203.0.113.10']) as unknown as typeof Deno.resolveDns;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.host !== ODOO_HOST) return realFetch(request);
    const answer = await odoo.fetch(request.url, { method: request.method, headers: { Authorization: String(request.headers.get('authorization')) }, body: await request.text() });
    // Odoo books a value on every validated move; the fake does not, so the read-back carries what valuation would (as the stock bed fixture does).
    if (!url.pathname.endsWith('/stock.move/read') || !answer.ok) return answer;
    const moves = await answer.json() as Array<Record<string, unknown>>;
    return new Response(JSON.stringify(moves.map((m) => ({ ...m, value: -10 * Number(m.quantity ?? 0) }))), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'inventory', operation: 'create', idempotencyKey: crypto.randomUUID(), record: { id: docId, revision, erp_doc_kind: 'stock-document' } }),
    }));
    return { status: res.status, body: JSON.parse(await res.text()) as Record<string, unknown> };
  } finally {
    globalThis.fetch = realFetch;
    Deno.resolveDns = realResolveDns;
  }
}

const one = (sql: string) => psql(sql);
const revisionOf = async (id: string) => Number(await one(`select revision from public.stock_documents where id='${id}'`));
const odooWrites = (o: FakeOdoo) => o.calls.filter((c) => !['search_read', 'read', 'search_count', 'fields_get', 'has_access'].includes(c.method));

describe({ name: 'AC-OSP-006 a connected stock post against the real database', ignore: !LOCAL }, () => {
  let keeperJwt = '';
  let strangerJwt = '';
  // One Odoo for the whole suite: ids are unique per org in a real one, and external_refs holds them unique.
  const odoo = createFakeOdoo({ key: ODOO_KEY });
  seedOdoo(odoo);
  beforeAll(async () => {
    await seed();
    keeperJwt = await signIn(KEEPER_EMAIL);
    strangerJwt = await signIn(STRANGER_EMAIL);
  });
  afterAll(async () => { await cleanup(); });

  it('the keeper\'s post is accepted: outbox confirmed, mirror confirmed, document Posted by the keeper, one picking', async () => {
    const r = await dispatch(keeperJwt, odoo, DOC_OK, await revisionOf(DOC_OK));
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(await one(`select state from public.external_command_outbox where pmo_record_id='${DOC_OK}'`), 'confirmed');
    assertEquals(await one(`select state from public.stock_erp_mirror where stock_document_id='${DOC_OK}'`), 'confirmed');
    assertEquals(await one(`select status||'/'||posted_by from public.stock_documents where id='${DOC_OK}'`), `Posted/${KEEPER}`);
    assertEquals(odoo.rows('stock.picking').length, 1);
  });

  it('AC-OSP-004 a non-keeper is refused 403: no outbox row, no Odoo call, the document stays a Draft', async () => {
    const before = odoo.calls.length;
    const r = await dispatch(strangerJwt, odoo, DOC_STRANGER, await revisionOf(DOC_STRANGER));
    assertEquals(r.status, 403, JSON.stringify(r.body));
    assertEquals(await one(`select count(*) from public.external_command_outbox where pmo_record_id='${DOC_STRANGER}'`), '0');
    assertEquals(odoo.calls.length, before, 'the guard decides before Odoo is touched');
    assertEquals(await one(`select status from public.stock_documents where id='${DOC_STRANGER}'`), 'Draft');
  });

  it('a warehouse mapped to a location of another Odoo company is refused: nothing written to Odoo, the document stays a Draft', async () => {
    const [written, pickings] = [odooWrites(odoo).length, odoo.rows('stock.picking').length];
    const r = await dispatch(keeperJwt, odoo, DOC_FOREIGN, await revisionOf(DOC_FOREIGN));
    assert(r.status >= 400, JSON.stringify(r.body));
    assertEquals(odooWrites(odoo).length, written, 'zero Odoo writes');
    assertEquals(odoo.rows('stock.picking').length, pickings);
    assertEquals(await one(`select status from public.stock_documents where id='${DOC_FOREIGN}'`), 'Draft');
    assertEquals(await one(`select state from public.external_command_outbox where pmo_record_id='${DOC_FOREIGN}'`), 'failed');
  });

  it('AC-OSP-007 a retry after the keeper repairs the mapping and edits the document refreshes the failed row and posts', async () => {
    await psql(`update public.external_refs set external_record_id='40' where org_id='${ORG}' and domain='stock_warehouses' and pmo_record_id='${WH_BAD}';
      update public.stock_documents set note='edited after the refusal' where id='${DOC_FOREIGN}';`);
    const revision = await revisionOf(DOC_FOREIGN);
    const r = await dispatch(keeperJwt, odoo, DOC_FOREIGN, revision);
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(await one(`select state||'/'||(payload->>'documentRevision') from public.external_command_outbox where pmo_record_id='${DOC_FOREIGN}'`), `confirmed/${revision}`);
    assertEquals(await one(`select status from public.stock_documents where id='${DOC_FOREIGN}'`), 'Posted');
    assertEquals(await one(`select count(*) from public.external_command_outbox where pmo_record_id='${DOC_FOREIGN}'`), '1', 'one command, refreshed in place');
  });
});
