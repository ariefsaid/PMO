// #1508 (AC-OSP-004): the sweep settles what a keeper started. It quarantines a stale committing stock row, holds a quarantined row whose
// anchor is absent (no Odoo write, the reason on the document), finalizes a committed row to Posted, and never picks a failed or held row.
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { createFakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { completeStockPicking, sendStockPicking } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/picking.ts';
import { stockBed, type StockBed } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/stockFixtures.ts';
import { reconcileOdooOutboxCandidates, type OdooOutboxRecoveryCandidate } from '../_shared/odooOutboxRecovery.ts';
import { ODOO_STOCK_RECOVERY_CALL_RESERVATION, isStockCommand, reconcileOdooStockOutbox } from './odooStockRecovery.ts';

const env = installEdgeEnv();
addEventListener('unload', () => env.restore());

const ORG = '11111111-1111-4111-8111-111111111111';
const DOC = '123e4567-e89b-12d3-a456-426614174000';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const HOST = 'odoo.example.test';
const KEY = `stock:${DOC}`;
const payload = { stockDocumentId: DOC, documentRevision: 3, odooCompanyId: 7, erp_doc_kind: 'stock-document' };
const objectResponse = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });

const dbRow = (state: string, over: Record<string, unknown> = {}) => ({
  id: 'outbox-1', domain: 'inventory', pmo_record_id: DOC, idempotency_key: KEY, state, external_record_id: null, canonical: null, claim_generation: 2,
  payload_digest: null, external_tier: 'odoo', operation: 'create', payload, actor_user_id: ACTOR, last_error: null, ...over,
});
const candidate = (state: string, over: Partial<OdooOutboxRecoveryCandidate> = {}): OdooOutboxRecoveryCandidate => ({
  row: { id: 'outbox-1', domain: 'inventory', pmoRecordId: DOC, idempotencyKey: KEY, state: state as never, externalRecordId: null, canonical: null, claimGeneration: 2, payloadDigest: null },
  externalTier: 'odoo', operation: 'create', payload, updatedAt: '2026-11-15T00:00:00Z', ...over,
});

describe('AC-OSP-004 the stock pass picks only what a keeper started and a person has not stopped', () => {
  for (const state of ['failed', 'held', 'confirmed']) {
    it(`never picks a ${state} stock row`, async () => {
      let built = 0;
      const r = await reconcileOdooOutboxCandidates([candidate(state)], isStockCommand, ODOO_STOCK_RECOVERY_CALL_RESERVATION, { orgId: ORG, owns: true },
        () => { built++; return {} as never; }, () => Promise.resolve({}));
      assertEquals([built, r.reconciled, r.errors], [0, 0, []]);
    });
  }
  for (const state of ['pending', 'committing', 'quarantined', 'committed']) {
    it(`picks a ${state} stock row`, () => assert(isStockCommand(candidate(state))));
  }
  it('picks no other domain, tier, operation or document kind', () => {
    assert(!isStockCommand(candidate('committing', { externalTier: 'erpnext' })));
    assert(!isStockCommand(candidate('committing', { operation: 'update' })));
    assert(!isStockCommand(candidate('committing', { payload: { ...payload, erp_doc_kind: 'sales-invoice' } })));
    assert(!isStockCommand({ ...candidate('committing'), row: { ...candidate('committing').row, domain: 'revenue' } }));
  });
});

interface World { row: Record<string, unknown>; claim?: Record<string, unknown> | null; quarantine?: Record<string, unknown> | null; bed?: StockBed; intentReads?: boolean }

async function sweep(state: string, world: World) {
  const fake = world.bed?.fake ?? createFakeOdoo({ key: 'odoo-test-key' });
  const odooModelMethods: string[] = [];
  const unexpected: FetchCall[] = [];
  const rpcs: string[] = [];
  const mirror: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  let current = world.row;   // the outbox row as the database would hold it as the fenced writes land
  const routes: MockRoute[] = [
    supabaseSelect('external_org_bindings', () => objectResponse({ id: 'b0', site_url: `https://${HOST}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { database: 'db1', odoo_company_id: 7, stock_transfer_operation_type_id: 5 } })),
    supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
    { label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox', response: () => objectResponse(current) },
    supabaseRpc('claim_outbox_for_commit', () => { rpcs.push('claim'); if (world.claim) current = world.claim; return jsonResponse(world.claim ?? { id: null }); }),
    supabaseRpc('quarantine_committing', () => { rpcs.push('quarantine'); return jsonResponse(world.quarantine ?? { id: null }); }),
    supabaseRpc('mark_outbox_held', () => { rpcs.push('held'); return jsonResponse(1); }),
    supabaseRpc('record_outbox_ref', () => { rpcs.push('ref'); return jsonResponse(1); }),
    supabaseRpc('confirm_outbox', () => { rpcs.push('confirm'); return jsonResponse(1); }),
    supabaseRpc('write_stock_erp_mirror', (c) => { rpcs.push('mirror'); mirror.push(c.bodyJson as Record<string, unknown>); return jsonResponse(null); }),
    { label: 'outbox committed', method: 'PATCH', pathname: '/rest/v1/external_command_outbox', response: () => { rpcs.push('committed'); current = { ...current, state: 'committed' }; return jsonResponse([{ id: 'outbox-1' }]); } },
    ...(world.intentReads ? [
      supabaseSelect('stock_documents', () => objectResponse({ id: DOC, org_id: ORG, kind: 'transfer', number: 'TR-0001', warehouse_id: 'w-a', to_warehouse_id: 'w-b', project_id: null,
        stock_document_lines: [{ item_id: 'i-1', line_no: 1, quantity: 8 }, { item_id: 'i-2', line_no: 2, quantity: 3 }] })),
      supabaseSelect('external_refs', (c) => {
        const id = String(c.url.searchParams.get('pmo_record_id')).replace(/^eq\./, '');
        const ref = ({ 'w-a': '10', 'w-b': '20', 'i-1': '101', 'i-2': '102' } as Record<string, string>)[id];
        return ref ? objectResponse({ external_record_id: ref }) : new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    ] : []),
    { label: 'document', method: 'PATCH', pathname: '/rest/v1/stock_documents', response: (c) => { rpcs.push('posted'); patches.push(c.bodyJson as Record<string, unknown>); return jsonResponse([{ id: DOC }]); } },
    { label: 'odoo', host: HOST, response: (c) => {
      const [, model, method] = c.url.pathname.match(/\/json\/2\/([^/]+)\/([^/]+)$/) ?? [];
      odooModelMethods.push(`${model}/${method}`);
      if (world.bed) return world.bed.call(model, method, JSON.parse(c.bodyText ?? '{}')).then((out) => jsonResponse(out), (err) => jsonResponse({ message: String(err) }, { status: 500 }));
      return fake.fetch(`https://${HOST}/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: String(c.headers.get('authorization')) }, body: c.bodyText });
    } },
    { label: 'unexpected', response: (c) => { unexpected.push(c); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await withFetchMock(routes, () => reconcileOdooStockOutbox(sc, ORG, { owns: true, candidates: [candidate(state)] }));
  return { result, rpcs, mirror, patches, odooModelMethods, unexpected, fake };
}
const WRITE = /\/(load|create|write|button_validate|action_post)$/;

describe('AC-OSP-004 the sweep settles stock commands through the shared fenced dispatcher', () => {
  it('quarantines a stale committing stock row and does not touch Odoo until the window passes', async () => {
    const r = await sweep('committing', { row: dbRow('committing'), quarantine: dbRow('quarantined', { claim_generation: 3 }) });
    assertEquals(r.rpcs.includes('quarantine'), true);
    assertEquals(r.rpcs.includes('claim'), true, 'the quarantined row is then offered to a claim; the window decides');
    assertEquals(r.odooModelMethods.filter((m) => WRITE.test(`/${m}`)), [], 'no Odoo write');
    assertEquals(r.result.errors.map((e) => e.error), ['external system unreachable — try again'], 'a closed window is a retry, not a hold');
    assertEquals(r.rpcs.includes('held'), false);
    assertEquals(r.unexpected.map((c) => c.url.pathname), []);
  });

  it('holds a quarantined row whose anchor is absent: no Odoo write, no reissue, the reason on the document', async () => {
    const r = await sweep('quarantined', { row: dbRow('quarantined'), claim: dbRow('committing', { claim_generation: 3 }) });
    assertEquals(r.odooModelMethods, ['ir.model.data/search_read'], 'the anchor lookup is the only Odoo call');
    assertEquals(r.rpcs.filter((x) => x === 'held' || x === 'mirror'), ['held', 'mirror']);
    assertEquals([r.mirror[0].p_state, r.mirror[0].p_generation], ['held', 3]);
    assertEquals(r.result.reconciled, 0);
    assertEquals(r.result.errors.length, 1);
    assertEquals(r.unexpected.map((c) => c.url.pathname), []);
  });

  it('finalizes a committed row: the evidence mirror, then Posted by the stored actor, then confirm', async () => {
    const canonical = { id: DOC, kind: 'transfer', companyId: 7, state: 'confirmed', externalModel: 'stock.picking', externalId: '77',
      completedQuantity: 11, completedValue: 0, currency: 'IDR', sourceWrittenAt: '2026-11-15T01:00:00Z', exception: null };
    const r = await sweep('committed', { row: dbRow('committed', { external_record_id: 'stock.picking:77', canonical }) });
    assertEquals(r.rpcs.filter((x) => ['ref', 'mirror', 'posted', 'confirm'].includes(x)), ['ref', 'mirror', 'posted', 'confirm']);
    assertEquals(r.patches[0].posted_by, ACTOR);
    assertEquals(r.odooModelMethods, [], 'finalize makes no Odoo call');
    assertEquals(r.result, { reconciled: 1, errors: [] });
    assertEquals(r.unexpected.map((c) => c.url.pathname), []);
  });
});

describe('AC-OSP-004 the sweep adopts an anchored, done picking once the quarantine window has passed', () => {
  it('committing -> quarantined -> window passes -> anchor present and done: mirror confirmed, Posted by the stored actor, command confirmed, no load sent', async () => {
    const bed = stockBed();
    bed.fake.seed('res.company', [{ id: 7, name: 'Co 7', currency_id: [5, 'IDR'] }]);
    bed.fake.seed('stock.picking.type', [{ id: 5, name: 'Internal', code: 'internal', company_id: [7, 'Co 7'] }]);
    bed.fake.seed('stock.location', [10, 20].map((id) => ({ id, complete_name: `WH/${id}`, usage: 'internal', company_id: [7, 'Co 7'], active: true })));
    bed.fake.seed('product.product', [101, 102].map((id) => ({ id, name: `P${id}`, default_code: `P${id}`, is_storable: true, company_id: [7, 'Co 7'], active: true })));
    // The first attempt reached Odoo (the keeper's connection dropped): an anchored picking, validated, whose answer never came back.
    const lines = [{ productId: 101, quantity: 8 }, { productId: 102, quantity: 3 }];
    const setup = bindCall({ baseUrl: `https://${HOST}`, apiKey: 'k', database: 'db1', companyId: 7, fetchImpl: bed.fake.fetch });
    const sent = await sendStockPicking(setup, { anchorKey: KEY, companyId: 7, pickingTypeId: 5, lines, src: 10, dest: 20 });
    assertEquals(sent.outcome, 'sent');
    if (sent.outcome === 'sent') assertEquals((await completeStockPicking(setup, sent.pickingId, lines)).outcome, 'validated');
    bed.seen.length = 0;

    // Sweep 1: a stale committing row is quarantined; the window has not passed, so nothing is claimed and Odoo is not touched.
    const first = await sweep('committing', { row: dbRow('committing'), quarantine: dbRow('quarantined', { claim_generation: 3 }), bed, intentReads: true });
    assertEquals(first.rpcs.includes('held'), false);
    assertEquals(first.odooModelMethods, []);
    // Sweep 2, window passed: the claim wins and the probe finds the anchor.
    const r = await sweep('quarantined', { row: dbRow('quarantined', { claim_generation: 3 }), claim: dbRow('committing', { claim_generation: 4 }), bed, intentReads: true });
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}`), []);
    assertEquals(r.odooModelMethods.includes('stock.picking/load'), false, 'no load: the anchored picking is adopted, never sent again');
    assertEquals(r.odooModelMethods.filter((m) => /\/(write|button_validate|create|load)$/.test(`/${m}`)), [], 'a done picking needs no Odoo write');
    assertEquals(r.rpcs.filter((x) => ['committed', 'ref', 'mirror', 'posted', 'confirm'].includes(x)), ['committed', 'ref', 'mirror', 'posted', 'confirm']);
    assertEquals([r.mirror[0].p_state, r.mirror[0].p_generation, r.mirror[0].p_external_id], ['confirmed', 4, String((sent as { pickingId: number }).pickingId)]);
    assertEquals(r.patches[0].posted_by, ACTOR);
    assertEquals(r.result, { reconciled: 1, errors: [] });
  });
});
