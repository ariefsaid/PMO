// #1508 (AC-OSP-004, AC-OSP-006, AC-OSP-007): a connected stock post goes through the SHIPPED handler (`./index.ts`, fetch mocked) and the
// shared money outbox. The command names only the document and the viewed revision; the org, actor, company and key are the server's.
// Who may post is the 0869 outbox guard's decision (proved in pgTAP): here the guard's refusals are mocked at the insert, and the route
// must classify them (STK_NOT_KEEPER / STK_ACTOR 403, any other STK_ 422 naming the rule), leave no row, and never reach Odoo.
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import {
  createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock,
  type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import { dispatchMoneyWrite, type DispatchMoneyWriteDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { createFakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';
import type { Adapter } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { resolveOdooStockMoneyOutboxDeps, recordStockHold, recordStockRefusal } from './odooStock.ts';
import { plainHoldReason } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/holdReason.ts';
import { inventoryWriter } from './readModel/inventory.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);
let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const KEEPER_ID = '22222222-2222-4222-8222-222222222222';
const STRANGER_ID = '33333333-3333-4333-8333-333333333333';
const DOC_ID = '123e4567-e89b-12d3-a456-426614174000';
const ODOO_HOST = 'odoo.example.test';
const COMPANY = 7;

const objectResponse = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const nullObjectResponse = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const refusal = (message: string, code: string) => jsonResponse({ code, message, details: null, hint: null }, { status: 400 });

const postCommand = (record: Record<string, unknown> = {}) => ({
  domain: 'inventory', operation: 'create', idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001508',
  record: { id: DOC_ID, revision: 3, erp_doc_kind: 'stock-document', ...record },
});

interface World { role?: string; insert?: (call: FetchCall) => Response; owns?: boolean }

function routes(unexpected: FetchCall[], caller: string, world: World): MockRoute[] {
  return [
    supabaseSelect('profiles', (call) => call.url.searchParams.has('role') ? jsonResponse([{ id: caller }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', (call) => jsonResponse(world.owns !== false && (call.bodyJson as { p_tier: string }).p_tier === 'odoo')),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: world.role ?? 'Engineer', active: true })),
    supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
    supabaseSelect('external_org_bindings', () => objectResponse({
      id: 'b0000000-0000-4000-8000-000000000001', site_url: `https://${ODOO_HOST}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
      config: { database: 'db1', odoo_company_id: COMPANY },
    })),
    { label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox', response: () => nullObjectResponse() },
    { label: 'outbox insert', method: 'POST', pathname: '/rest/v1/external_command_outbox', response: (call) => (world.insert ?? (() => refusal('STK_BACKDATE: x', 'P0001')))(call) },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

async function dispatch(command: Record<string, unknown>, caller: string, world: World = {}) {
  const unexpected: FetchCall[] = [];
  const result = await withFetchMock(routes(unexpected, caller, world), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: caller });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(command),
    }));
    return { status: res.status, body: JSON.parse(await res.text()) as { error?: string; message?: string }, calls };
  });
  return { ...result, unexpected };
}
const outboxWrites = (calls: FetchCall[]) => calls.filter((c) => c.method !== 'GET' && c.url.pathname.includes('external_command_outbox'));
const odooCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ODOO_HOST);

describe('AC-OSP-006 the post command: document id and viewed revision only', () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ['no revision', { revision: undefined }],
    ['a fractional revision', { revision: 1.5 }],
    ['a text revision', { revision: '3' }],
    ['a non-uuid id', { id: 'SD-0001' }],
    ['another document kind', { erp_doc_kind: 'sales-invoice' }],
  ];
  for (const [name, record] of bad) {
    it(`${name} is refused 422 before any write`, async () => {
      const r = await dispatch(postCommand(record), KEEPER_ID);
      assertEquals(r.status, 422, JSON.stringify(r.body));
      assertEquals(r.body.error, 'commit-rejected');
      assertEquals(outboxWrites(r.calls), [], 'no outbox row');
      assertEquals(odooCalls(r.calls), [], 'no Odoo request');
      assertEquals(r.unexpected.map((c) => c.url.pathname), []);
    });
  }

  it('another operation is refused 422 before any write', async () => {
    const r = await dispatch({ ...postCommand(), operation: 'update' }, KEEPER_ID);
    assertEquals(r.status, 422, JSON.stringify(r.body));
    assertEquals(outboxWrites(r.calls), []);
  });

  it('the server derives key, company, actor and payload; nothing else of the body reaches the outbox row', async () => {
    let inserted: Record<string, unknown> = {};
    const r = await dispatch(
      postCommand({ odooCompanyId: 999, org_id: 'forged', warehouse_id: 'forged', quantity: 1e9, actor_user_id: STRANGER_ID, key: 'x' }),
      KEEPER_ID,
      { insert: (call) => { inserted = call.bodyJson as Record<string, unknown>; return refusal('STK_BACKDATE: a stock movement cannot be dated in the future', 'P0001'); } },
    );
    assertEquals(r.unexpected.map((c) => c.url.pathname), []);
    assertEquals(inserted.org_id, ORG_ID);
    assertEquals(inserted.domain, 'inventory');
    assertEquals(inserted.idempotency_key, `stock:${DOC_ID}`, 'the key follows the document, not the client key');
    assertEquals(inserted.pmo_record_id, DOC_ID);
    assertEquals(inserted.actor_user_id, KEEPER_ID, 'the actor is the verified JWT subject');
    assertEquals(inserted.operation, 'create');
    assertEquals(inserted.payload, { stockDocumentId: DOC_ID, documentRevision: 3, odooCompanyId: COMPANY, erp_doc_kind: 'stock-document' });
    assertEquals(inserted.payload_digest, undefined, 'no digest: a retry after an edit carries a new revision under the same key');
  });
});

describe('AC-OSP-006 the 0869 guard decides who posts; the route classifies its refusals', () => {
  it('a non-keeper is refused 403 naming the rule: no outbox row, no Odoo request, the DB guard is what refused', async () => {
    const r = await dispatch(postCommand(), STRANGER_ID, { role: 'Engineer', insert: () => refusal('STK_NOT_KEEPER: you do not keep this warehouse', 'P0001') });
    assertEquals(r.status, 403, JSON.stringify(r.body));
    assert(r.body.message?.includes('STK_NOT_KEEPER'), r.body.message);
    assertEquals(outboxWrites(r.calls).map((c) => c.method), ['POST'], 'the one insert attempt is the guard\'s refusal, so no row exists');
    assertEquals(r.calls.filter((c) => c.url.pathname.includes('/rpc/claim_outbox_for_commit')), [], 'nothing was claimed');
    assertEquals(odooCalls(r.calls), [], 'no Odoo request, not even a read');
    assertEquals(r.unexpected.map((c) => c.url.pathname), []);
  });

  it('an actor who is not an active member is refused 403 (STK_ACTOR)', async () => {
    const r = await dispatch(postCommand(), KEEPER_ID, { insert: () => refusal('STK_ACTOR: actor is not an active organisation member', '42501') });
    assertEquals(r.status, 403, JSON.stringify(r.body));
    assert(r.body.message?.includes('STK_ACTOR'));
    assertEquals(odooCalls(r.calls), []);
  });

  for (const rule of ['STK_BACKDATE', 'STK_COMPANY', 'STK_COMMAND', 'STK_ARCHIVED', 'STK_OWNERSHIP', 'STK_NOT_FOUND']) {
    it(`${rule} is refused 422 and names the rule`, async () => {
      const r = await dispatch(postCommand(), KEEPER_ID, { insert: () => refusal(`${rule}: the guard said no`, 'P0001') });
      assertEquals(r.status, 422, JSON.stringify(r.body));
      assertEquals(r.body.error, 'stock-command-refused');
      assert(r.body.message?.includes(rule), r.body.message);
      assertEquals(odooCalls(r.calls), []);
    });
  }

  it('an org that does not employ inventory under Odoo is refused 403 before any outbox work', async () => {
    const r = await dispatch(postCommand(), KEEPER_ID, { owns: false });
    assertEquals(r.status, 403, JSON.stringify(r.body));
    assertEquals(outboxWrites(r.calls), []);
    assertEquals(odooCalls(r.calls), []);
  });
});

// ── the outbox deps and the hold, below the route ───────────────────────────────────────────────────────────────
const sc = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ctxFor = (client: ReturnType<typeof sc>): AdapterSelectContext => ({
  orgId: ORG_ID, serviceClient: client, userId: KEEPER_ID, faultGate: {}, erpAuth: {}, command: postCommand(),
} as unknown as AdapterSelectContext);
const bindingRoutes = (): MockRoute[] => [
  supabaseSelect('external_org_bindings', () => objectResponse({
    id: 'b0000000-0000-4000-8000-000000000001', site_url: `https://${ODOO_HOST}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
    config: { database: 'db1', odoo_company_id: COMPANY },
  })),
  supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
];

describe('AC-OSP-004 a quarantined stock row whose anchor is absent is held, never reissued', () => {
  it('the deps never reissue on an inconclusive absence', async () => {
    await withFetchMock(bindingRoutes(), async () => {
      const deps = await resolveOdooStockMoneyOutboxDeps(ctxFor(sc()));
      assertEquals(deps.reissueOnInconclusiveAbsence, false);
      assertEquals(deps.payloadDigest, undefined);
    });
  });

  it('W1 dispatching the quarantined row: the probe finds no anchor, the adapter is never called, the row is held', async () => {
    const odoo = createFakeOdoo({ key: 'odoo-test-key' });
    const held: Array<Record<string, unknown>> = [];
    const row = { id: 'outbox-1', domain: 'inventory', pmo_record_id: DOC_ID, idempotency_key: `stock:${DOC_ID}`, state: 'quarantined',
      external_record_id: null, canonical: null, claim_generation: 2, payload_digest: null };
    let committed = false;
    const adapter = { tier: 'odoo', capabilityMap: new Set(['inventory']), commit: () => { committed = true; return Promise.reject(new Error('sent')); } } as unknown as Adapter;
    await withFetchMock([
      ...bindingRoutes(),
      { label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox', response: () => objectResponse(row) },
      supabaseRpc('claim_outbox_for_commit', () => jsonResponse({ ...row, state: 'committing' })),
      supabaseRpc('mark_outbox_held', (call) => { held.push(call.bodyJson as Record<string, unknown>); return jsonResponse(1); }),
      { label: 'odoo', host: ODOO_HOST, response: (call) => {
        const [, model, method] = call.url.pathname.match(/\/json\/2\/([^/]+)\/([^/]+)$/) ?? [];
        return odoo.fetch(`https://${ODOO_HOST}/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: String(call.headers.get('authorization')) }, body: call.bodyText });
      } },
    ], async () => {
      const ctx = ctxFor(sc());
      const money = await resolveOdooStockMoneyOutboxDeps(ctx);
      const deps = { adapter, command: ctx.command, money, writeReadModel: () => Promise.resolve(), recordExternalRef: () => Promise.resolve() } as unknown as DispatchMoneyWriteDeps;
      let thrown: unknown;
      try { await dispatchMoneyWrite(deps); } catch (err) { thrown = err; }
      assertEquals((thrown as AppError | undefined)?.code, 'command-held');
      assertEquals(committed, false, 'no reissue: the adapter is not asked to send again');
      assertEquals(held.length, 1);
      assertEquals(odoo.rows('stock.picking'), [], 'nothing was written to Odoo');
    });
  });
});

describe('AC-OSP-007 a hold writes its reason on the document evidence at the generation it was held under', () => {
  const held = (detail: Record<string, unknown>, message = 'money command held for operator resolution') =>
    Object.assign(new AppError(message, 'command-held'), { heldOutboxId: 'outbox-1', heldClaimGeneration: 4, ...detail });
  const payloadRow = () => objectResponse({ payload: { odooCompanyId: COMPANY } });
  const capture = async (failure: AppError, command = { domain: 'inventory', record: { id: DOC_ID } }) => {
    let mirror: Record<string, unknown> | undefined;
    await withFetchMock([
      supabaseSelect('external_command_outbox', payloadRow),
      supabaseRpc('write_stock_erp_mirror', (call) => { mirror = call.bodyJson as Record<string, unknown>; return jsonResponse(null); }),
    ], async () => { await recordStockHold(sc(), ORG_ID, command, failure); });
    return mirror;
  };

  it('the mirror receives state held, the sentence made from the typed cause, the transfer and the held generation', async () => {
    const mirror = await capture(held({ heldCause: 'quantity-differs', heldPickingId: 7, heldReference: 'WH/INT/00012' }));
    assertEquals(mirror?.p_state, 'held');
    assertEquals(mirror?.p_generation, 4);
    assertEquals(mirror?.p_company_id, COMPANY);
    assertEquals(mirror?.p_document_id, DOC_ID);
    assertEquals(mirror?.p_exception, plainHoldReason('quantity-differs', 'WH/INT/00012'));
    assertEquals([mirror?.p_external_model, mirror?.p_external_id, mirror?.p_external_reference], ['stock.picking', '7', 'WH/INT/00012']);
  });

  it('the sentence follows the cause, never the message text: a reworded message changes nothing', async () => {
    const a = await capture(held({ heldCause: 'cancelled', heldPickingId: 7, heldReference: 'WH/INT/1' }, 'one wording'));
    const b = await capture(held({ heldCause: 'cancelled', heldPickingId: 7, heldReference: 'WH/INT/1' }, 'another wording entirely'));
    assertEquals(a?.p_exception, b?.p_exception);
    assertEquals(a?.p_exception, plainHoldReason('cancelled', 'WH/INT/1'));
  });

  it('a hold with no transfer known names none, and a cause that is not a stock cause says a manual check is needed', async () => {
    const none = await capture(held({ heldCause: 'no-transfer-found' }));
    assertEquals(none?.p_exception, plainHoldReason('no-transfer-found'));
    assertEquals([none?.p_external_model, none?.p_external_id, none?.p_external_reference], [null, null, null]);
    const odd = await capture(held({ heldCause: 'a-cause-from-the-future' }));
    assertEquals(odd?.p_exception, plainHoldReason('not-checked'));
  });

  it('a replayed dispatch on a row that is already held never rewrites the stored cause', async () => {
    await withFetchMock([], async ({ calls }) => {
      await recordStockHold(sc(), ORG_ID, { domain: 'inventory', record: { id: DOC_ID } }, held({ heldCause: 'already-held' }));
      assertEquals(calls, []);
    });
  });

  it('a hold on another domain, or an error that is not a hold, writes nothing', async () => {
    await withFetchMock([], async ({ calls }) => {
      await recordStockHold(sc(), ORG_ID, { domain: 'revenue', record: { id: DOC_ID } }, held({ heldCause: 'cancelled' }));
      await recordStockHold(sc(), ORG_ID, { domain: 'inventory', record: { id: DOC_ID } }, new AppError('boom', 'external-unreachable'));
      assertEquals(calls, []);
    });
  });
});

describe('AC-OSP-007 a refusal before anything reached Odoo is written on the document so the Draft says why', () => {
  const refused = (reason: unknown = 'analytic-costs-disabled', subject?: string) => Object.assign(new AppError('Project costs are off', 'commit-rejected'), reason === undefined ? {} : { refusalReason: reason }, subject ? { refusalSubject: subject } : {});
  const run = async (failure: AppError, row: Record<string, unknown>, domain = 'inventory') => {
    let mirror: Record<string, unknown> | undefined;
    await withFetchMock([
      supabaseSelect('external_command_outbox', () => objectResponse({ id: 'outbox-1', claim_generation: 5, state: 'failed', payload: { odooCompanyId: COMPANY }, ...row })),
      supabaseRpc('write_stock_erp_mirror', (call) => { mirror = call.bodyJson as Record<string, unknown>; return jsonResponse(null); }),
    ], async () => { await recordStockRefusal(sc(), ORG_ID, { domain, record: { id: DOC_ID } }, failure); });
    return mirror;
  };

  it('the mirror receives state failed with the reason code, at the failed row\'s generation', async () => {
    const mirror = await run(refused(), {});
    assertEquals([mirror?.p_state, mirror?.p_exception, mirror?.p_generation, mirror?.p_external_id], ['failed', 'analytic-costs-disabled', 5, null]);
  });

  it('a refusal that names a record keeps its id after the reason, for the page to name it', async () => {
    const mirror = await run(refused('foreign-company', 'wh-9'), {});
    assertEquals(mirror?.p_exception, 'foreign-company wh-9');
  });

  it('nothing is written for a refusal without a reason, another domain, or a row that is not failed', async () => {
    assertEquals(await run(refused(null), {}), undefined);
    assertEquals(await run(refused(), {}, 'revenue'), undefined);
    assertEquals(await run(refused(), { state: 'committing' }), undefined);
    assertEquals(await run(new AppError('x', 'external-unreachable'), {}), undefined);
  });
});

describe('AC-OSP-007 finalize: the mirror is confirmed first, then the Draft is posted by the stored actor; a replay converges', () => {
  const canonical = { id: DOC_ID, kind: 'transfer', companyId: COMPANY, state: 'confirmed', externalModel: 'stock.picking', externalId: '77',
    completedQuantity: 11, completedValue: 0, currency: 'IDR', sourceWrittenAt: '2026-11-15T01:00:00Z', exception: null };
  const command = { domain: 'inventory', operation: 'create', record: { id: DOC_ID } } as never;
  const outboxRow = (over: Record<string, unknown> = {}) => ({ claim_generation: 3, actor_user_id: KEEPER_ID, state: 'committed', payload: { odooCompanyId: COMPANY }, ...over });

  async function finalize(row: Record<string, unknown> | null, flipped: unknown[] = [{ id: DOC_ID }], mirrorError?: string, canon: Record<string, unknown> = canonical) {
    const order: string[] = [];
    let patch: Record<string, unknown> = {};
    let mirror: Record<string, unknown> = {};
    let thrown: AppError | undefined;
    await withFetchMock([
      supabaseSelect('external_command_outbox', () => row ? objectResponse(row) : nullObjectResponse()),
      supabaseRpc('write_stock_erp_mirror', (call) => {
        order.push('mirror'); mirror = call.bodyJson as Record<string, unknown>;
        return mirrorError ? refusal(mirrorError, 'P0001') : jsonResponse(null);
      }),
      { label: 'document', method: 'PATCH', pathname: '/rest/v1/stock_documents', response: (call) => { order.push('document'); patch = call.bodyJson as Record<string, unknown>; return jsonResponse(flipped); } },
    ], async () => {
      try { await inventoryWriter.upsert({ serviceClient: sc() as never, orgId: ORG_ID }, canon as never, command); } catch (err) { thrown = err as AppError; }
    });
    return { order, patch, mirror, thrown };
  }

  it('writes the evidence at the row\'s claim generation, then posts the Draft with the stored actor', async () => {
    const r = await finalize(outboxRow());
    assertEquals(r.thrown, undefined);
    assertEquals(r.order, ['mirror', 'document']);
    assertEquals([r.mirror.p_generation, r.mirror.p_company_id, r.mirror.p_state, r.mirror.p_external_id], [3, COMPANY, 'confirmed', '77']);
    assertEquals([r.patch.status, r.patch.posted_by], ['Posted', KEEPER_ID], 'posted by the actor stored on the row, never the finalizing caller');
  });

  it('a replay (the document already Posted: 0 rows) converges without error', async () => {
    assertEquals((await finalize(outboxRow({ state: 'confirmed' }), [])).thrown, undefined);
  });

  it('a row that is not committed or confirmed is refused before any write', async () => {
    for (const row of [null, outboxRow({ state: 'committing' }), outboxRow({ state: 'quarantined' })]) {
      const r = await finalize(row);
      assertEquals(r.thrown?.code, 'commit-rejected');
      assertEquals(r.order, []);
    }
  });

  it('evidence that is not confirmed is never mirrored as a posting', async () => {
    const r = await finalize(outboxRow(), [{ id: DOC_ID }], undefined, { ...canonical, state: 'held' });
    assertEquals(r.thrown?.code, 'commit-rejected');
    assertEquals(r.order, []);
  });

  it('a STK_MIRROR refusal is classified 422 and the document is not posted', async () => {
    const r = await finalize(outboxRow(), [{ id: DOC_ID }], 'STK_MIRROR_FENCE: no command at this generation');
    assertEquals(r.thrown?.code, 'stock-command-refused');
    assertEquals(r.order, ['mirror']);
  });
});

describe('AC-OSP-006 retry after an edit: a failed command is refreshed to the viewed revision and the pressing actor', () => {
  const failedRow = (payload: Record<string, unknown>, actor: string) => ({
    id: 'outbox-1', domain: 'inventory', pmo_record_id: DOC_ID, idempotency_key: `stock:${DOC_ID}`, state: 'failed',
    external_record_id: null, canonical: null, claim_generation: 1, payload_digest: null, payload, actor_user_id: actor,
  });
  async function read(row: Record<string, unknown>, replay = false, updates: Array<Record<string, unknown>> = []) {
    await withFetchMock([
      ...bindingRoutes(),
      { label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox', response: () => objectResponse(row) },
      { label: 'outbox refresh', method: 'PATCH', pathname: '/rest/v1/external_command_outbox', response: (call) => { updates.push(call.bodyJson as Record<string, unknown>); return jsonResponse([]); } },
    ], async () => {
      const ctx = { ...ctxFor(sc()), ...(replay ? { replay: true } : {}) } as AdapterSelectContext;
      const deps = await resolveOdooStockMoneyOutboxDeps(ctx);
      await deps.readOutbox('inventory', DOC_ID, `stock:${DOC_ID}`);
    });
    return updates;
  }
  const stored = { stockDocumentId: DOC_ID, documentRevision: 2, odooCompanyId: COMPANY, erp_doc_kind: 'stock-document' };

  it('a new revision or another keeper updates only the revision and the actor', async () => {
    const [update, ...rest] = await read(failedRow(stored, STRANGER_ID));
    assertEquals(rest, []);
    assertEquals(update, { payload: { ...stored, documentRevision: 3 }, actor_user_id: KEEPER_ID });
  });

  it('the same revision and actor is left alone', async () => {
    assertEquals(await read(failedRow({ ...stored, documentRevision: 3 }, KEEPER_ID)), []);
  });

  it('a recovery (the sweep) never refreshes: it writes nothing and refuses the row', async () => {
    const updates: Array<Record<string, unknown>> = [];
    await assertRejects(() => read(failedRow(stored, STRANGER_ID), true, updates), AppError);
    assertEquals(updates, []);
  });

  for (const state of ['failed', 'held']) {
    it(`a recovery that reads the row as ${state} refuses it: only a person's Post retries`, async () => {
      await assertRejects(() => read({ ...failedRow(stored, KEEPER_ID), state }, true), AppError);
      assertEquals(await read({ ...failedRow({ ...stored, documentRevision: 3 }, KEEPER_ID), state }, false), []);   // a person's Post still reads it
    });
  }
});
