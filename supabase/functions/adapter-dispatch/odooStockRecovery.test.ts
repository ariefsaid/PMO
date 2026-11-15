// #1508 (AC-OSP-004): the sweep settles what a keeper started. It quarantines a stale committing stock row, holds a quarantined row whose
// anchor is absent (no Odoo write, the reason on the document), finalizes a committed row to Posted, and never picks a failed or held row.
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { createFakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';
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

interface World { row: Record<string, unknown>; claim?: Record<string, unknown> | null; quarantine?: Record<string, unknown> | null }

async function sweep(state: string, world: World) {
  const fake = createFakeOdoo({ key: 'odoo-test-key' });
  const odooModelMethods: string[] = [];
  const unexpected: FetchCall[] = [];
  const rpcs: string[] = [];
  const mirror: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  const routes: MockRoute[] = [
    supabaseSelect('external_org_bindings', () => objectResponse({ id: 'b0', site_url: `https://${HOST}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { database: 'db1', odoo_company_id: 7 } })),
    supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
    { label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox', response: () => objectResponse(world.row) },
    supabaseRpc('claim_outbox_for_commit', () => { rpcs.push('claim'); return jsonResponse(world.claim ?? { id: null }); }),
    supabaseRpc('quarantine_committing', () => { rpcs.push('quarantine'); return jsonResponse(world.quarantine ?? { id: null }); }),
    supabaseRpc('mark_outbox_held', () => { rpcs.push('held'); return jsonResponse(1); }),
    supabaseRpc('record_outbox_ref', () => { rpcs.push('ref'); return jsonResponse(1); }),
    supabaseRpc('confirm_outbox', () => { rpcs.push('confirm'); return jsonResponse(1); }),
    supabaseRpc('write_stock_erp_mirror', (c) => { rpcs.push('mirror'); mirror.push(c.bodyJson as Record<string, unknown>); return jsonResponse(null); }),
    { label: 'document', method: 'PATCH', pathname: '/rest/v1/stock_documents', response: (c) => { rpcs.push('posted'); patches.push(c.bodyJson as Record<string, unknown>); return jsonResponse([{ id: DOC }]); } },
    { label: 'odoo', host: HOST, response: (c) => {
      const [, model, method] = c.url.pathname.match(/\/json\/2\/([^/]+)\/([^/]+)$/) ?? [];
      odooModelMethods.push(`${model}/${method}`);
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
