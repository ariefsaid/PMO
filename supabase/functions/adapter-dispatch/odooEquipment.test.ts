// #1511 F4 (AC-OFM-030/031, FR-OFM-030..033): a register or maintenance record saved in PMO reaches Odoo through the SHIPPED
// handler (`./index.ts`, fetch mocked) and the shipped outbox, with the fake Odoo behind the Odoo host. The create key follows the
// PMO record; a lost answer is adopted by its `ir.model.data` anchor (never created twice); an inconclusive create is HELD for a
// person; a register write from a role that may not keep the asset book is refused before any outbox row, and so is a maintenance
// record for an asset that is not linked to an Odoo asset of the matching kind.
// Every route is a FACT about the world the handler reads; `unexpected` names any read not mocked (add a route; never loosen an assertion).
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';
import { ASSET_MODELS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import { ADAPTER_REGISTRY, selectAdapterFactory } from './dispatchAdapters.ts';
import { resolveOdooEquipmentAdapter } from './odooEquipment.ts';

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
// The Odoo client's pacer and the outbox's backoff only slow things down; fire their timers at once.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout;
addEventListener('unload', () => { env.restore(); globalThis.setTimeout = realSetTimeout; });

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const CALLER = '66666666-6666-4666-8666-666666666666';
const ASSET_ID = '15110000-0000-4000-8000-000000000001';
const REQUEST_ID = '15110000-0000-4000-8000-000000000002';
const VEHICLE_ASSET_ID = '15110000-0000-4000-8000-000000000003';
// A register CREATE reserves a NEW asset id (the recorder refuses one the book already holds), so the create fixtures mint fresh ones.
const FRESH_VEHICLE_ASSET_ID = '15110000-0000-4000-8000-000000000011';
const FRESH_ITEM_ASSET_ID = '15110000-0000-4000-8000-000000000012';
const SERVICE_ID = '15110000-0000-4000-8000-000000000013';
const ODOO_HOST = 'odoo.example.test';
const KEY = 'odoo-test-key';
const CLIENT_KEY = 'cccccccc-cccc-4ccc-8ccc-000000000051';
const FRESH_KEY = 'cccccccc-cccc-4ccc-8ccc-000000000052';
const DONE_UPDATE_KEY = 'cccccccc-cccc-4ccc-8ccc-000000000053';

const objectResponse = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const nullObjectResponse = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const param = (call: FetchCall, key: string): string | null => {
  const raw = call.url.searchParams.get(key);
  return raw?.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : raw;
};
const body = (c: FetchCall) => c.bodyJson as Record<string, unknown>;

/** The capability snapshot an org that employs the register holds (F2's discovery shape). */
const assetsSnapshot = (over: Record<string, { create?: boolean }> = {}) => Object.fromEntries(
  Object.keys(ASSET_MODELS).map((model) => [model, { exists: true, read: true, create: over[model]?.create ?? true, write: true, unlink: true, fields_missing: [] }]),
);

interface Asset { id: string; org_id: string; code: string; name: string; external_ref: string | null }
/** One mirrored row of the org's Odoo directory: a register row, a maintenance row (with the asset it hangs off), or a picker. */
interface MirrorRow { kind: string; external_id: string; parent_external_id?: string }
interface State {
  fake: FakeOdoo;
  outbox: Map<string, Record<string, unknown>>;
  assets: Asset[];
  mirrorRows: MirrorRow[];
  mirror: Array<{ fn: string; args: Record<string, unknown> }>;
  role: string;
  /** The step whose ANSWER is lost after Odoo committed it (the transport died on the way back). */
  loseNext?: 'create' | 'anchor';
}
/** The pickers an org's directory mirror already holds: every Odoo id a body NAMES must be one of these (never a client-taken id). */
const PICKERS: MirrorRow[] = [
  { kind: 'vehicle_model', external_id: '3' },
  { kind: 'maintenance_stage', external_id: '1' },
  { kind: 'maintenance_stage', external_id: '4' },
  { kind: 'service_type', external_id: '2' },
  { kind: 'partner', external_id: '5' },
];
const newState = (): State => ({
  fake: createFakeOdoo({ key: KEY }),
  outbox: new Map(),
  assets: [
    { id: ASSET_ID, org_id: ORG_ID, code: 'EXC-001', name: 'Excavator 20t', external_ref: 'equipment:42' },
    { id: VEHICLE_ASSET_ID, org_id: ORG_ID, code: 'B 1234 XY', name: 'Hilux', external_ref: 'vehicle:7' },
  ],
  mirrorRows: [...PICKERS],
  mirror: [],
  role: 'Engineer',
});
interface World { odooBinding?: Record<string, unknown> | null; assets?: (st: State) => Record<string, unknown> }

function routes(unexpected: FetchCall[], st: State, world: World): MockRoute[] {
  const rowOf = (id: string) => [...st.outbox.values()].find((r) => r.id === id)!;
  return [
    supabaseSelect('profiles', (call) => call.url.searchParams.has('role') ? jsonResponse([{ id: CALLER }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', (call) => jsonResponse((call.bodyJson as { p_tier: string }).p_tier === 'odoo')),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: st.role, active: true })),
    supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
    supabaseSelect('external_org_bindings', (call) => param(call, 'external_tier') === 'odoo'
      ? (world.odooBinding === null ? nullObjectResponse() : objectResponse({
          id: 'b0000000-0000-4000-8000-000000000001', site_url: `https://${ODOO_HOST}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
          config: { database: 'db1', odoo_company_id: 1, capabilities: { later: {}, models: {}, assets: assetsSnapshot() } }, ...world.odooBinding,
        }))
      : nullObjectResponse()),
    supabaseSelect('external_refs', () => nullObjectResponse()),
    // The PMO link: the asset a maintenance record hangs off, or the asset a register update edits.
    supabaseSelect('equipment_assets', (call) => {
      const wanted = param(call, 'id');
      const asset = st.assets.find((a) => a.id === wanted);
      if (!asset) return nullObjectResponse();
      const answer = world.assets ? world.assets(st) : asset;
      return objectResponse(answer);
    }),
    // A register update must name a mirror row of the matching kind in this org; a maintenance update must hang off the asset the
    // command names (the row's own Odoo parent), so the answer carries the parent the directory mirror holds.
    supabaseSelect('external_master_records', (call) => {
      const id = param(call, 'external_id');
      const kind = param(call, 'kind');
      const row = st.mirrorRows.find((r) => r.external_id === id && r.kind === kind);
      return row ? objectResponse({ id: 'mirror-1', parent_external_id: row.parent_external_id ?? null }) : nullObjectResponse();
    }),
    { label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      const row = st.outbox.get(`${param(call, 'pmo_record_id')}|${param(call, 'idempotency_key')}`);
      return row ? objectResponse(row) : nullObjectResponse();
    } },
    { label: 'outbox insert', method: 'POST', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      const b = body(call);
      const row = { id: `outbox-${st.outbox.size + 1}`, domain: b.domain, pmo_record_id: b.pmo_record_id, idempotency_key: b.idempotency_key, state: 'pending',
        external_record_id: null, canonical: null, claim_generation: 0, payload_digest: b.payload_digest ?? null, payload: b.payload ?? null };
      st.outbox.set(`${String(b.pmo_record_id)}|${String(b.idempotency_key)}`, row);
      return objectResponse(row);
    } },
    { label: 'outbox update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      const row = rowOf(param(call, 'id')!);
      Object.assign(row, call.bodyJson);
      return jsonResponse([{ id: row.id }]);
    } },
    supabaseRpc('claim_outbox_for_commit', (call) => { const row = rowOf(body(call).p_id as string); Object.assign(row, { state: 'committing', claim_generation: Number(row.claim_generation) + 1 }); return jsonResponse(row); }),
    supabaseRpc('quarantine_committing', (call) => { const row = rowOf(body(call).p_id as string); if (row.state === 'committing') row.state = 'quarantined'; return jsonResponse(row); }),
    supabaseRpc('mark_outbox_held', (call) => { rowOf(body(call).p_id as string).state = 'held'; return jsonResponse(1); }),
    supabaseRpc('confirm_outbox', (call) => { rowOf(body(call).p_id as string).state = 'confirmed'; return jsonResponse(1); }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('finalize_outbox', (call) => { const row = rowOf(body(call).p_id as string); Object.assign(row, { state: 'confirmed', external_record_id: body(call).p_external_record_id ?? row.external_record_id }); return jsonResponse(1); }),
    // The read model: the register row (or the PMO asset a register create reserves).
    supabaseRpc('apply_odoo_master_rows', (call) => { st.mirror.push({ fn: 'apply_odoo_master_rows', args: body(call) }); return jsonResponse(1); }),
    supabaseRpc('record_odoo_asset_created', (call) => { st.mirror.push({ fn: 'record_odoo_asset_created', args: body(call) }); return jsonResponse(1); }),
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    { label: 'odoo', host: ODOO_HOST, pathname: /^\/json\/2\//, response: async (call) => {
      const answer = st.fake.fetch(call.url.toString(), { method: 'POST', headers: { Authorization: `bearer ${KEY}` }, body: call.bodyText });
      // The step committed in Odoo; its ANSWER was lost on the way back (the transport died, not the write).
      const step = call.url.pathname.endsWith('/ir.model.data/create') ? 'anchor' : call.url.pathname.endsWith('/create') ? 'create' : null;
      if (step !== null && st.loseNext === step) { st.loseNext = undefined; await answer; throw new TypeError('error sending request: connection reset'); }
      return answer;
    } },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

async function dispatch(command: Record<string, unknown>, st: State, world: World = {}) {
  const unexpected: FetchCall[] = [];
  const logged: string[] = [];
  const realError = console.error, realLog = console.log, realWarn = console.warn;
  const sink = (...args: unknown[]) => { logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  console.error = sink; console.log = sink; console.warn = sink;
  try {
    const result = await withFetchMock(routes(unexpected, st, world), async ({ calls }) => {
      const jwt = await auth.mintJwt({ sub: CALLER });
      const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
        method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(command),
      }));
      return { status: res.status, text: await res.text(), calls };
    });
    return { ...result, unexpected, logged };
  } finally { console.error = realError; console.log = realLog; console.warn = realWarn; }
}

const odooRequests = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ODOO_HOST);
const outboxInserts = (calls: FetchCall[]) => calls.filter((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/external_command_outbox');

const vehicleCreate = (over: Record<string, unknown> = {}) => ({
  domain: 'equipment', operation: 'create', idempotencyKey: CLIENT_KEY,
  record: { id: FRESH_VEHICLE_ASSET_ID, erp_doc_kind: 'register-vehicle', license_plate: 'B 1234 XY', model_id: '3', vin: 'MR0XX', acquisition_date: '2025-02-01', default_unit: 'hours', ...over },
});
const equipmentCreate = (over: Record<string, unknown> = {}) => ({
  domain: 'equipment', operation: 'create', idempotencyKey: CLIENT_KEY,
  record: { id: FRESH_ITEM_ASSET_ID, erp_doc_kind: 'register-equipment', name: 'Excavator 20t', serial_no: 'EXC-001', model: 'PC200', location: 'Site A', default_unit: 'days', ...over },
});
const serviceCreate = (over: Record<string, unknown> = {}) => ({
  domain: 'equipment', operation: 'create', idempotencyKey: CLIENT_KEY,
  record: { id: SERVICE_ID, erp_doc_kind: 'vehicle-service', asset_id: VEHICLE_ASSET_ID, service_type_id: '2', date: '2026-11-01', state: 'done', amount: 150000, odometer: 15000, vendor_id: '5', notes: 'Oil', ...over },
});
const requestCreate = (over: Record<string, unknown> = {}) => ({
  domain: 'equipment', operation: 'create', idempotencyKey: CLIENT_KEY,
  record: { id: REQUEST_ID, erp_doc_kind: 'maintenance-request', asset_id: ASSET_ID, subject: 'Hydraulic leak', type: 'corrective', stage_id: '1', schedule_date: '2026-11-10T08:00:00+07:00', duration_hours: 2.5, notes: 'Leak', ...over },
});
const requestUpdate = (over: Record<string, unknown> = {}, idempotencyKey = FRESH_KEY) => ({
  domain: 'equipment', operation: 'update', idempotencyKey,
  record: { id: REQUEST_ID, erp_doc_kind: 'maintenance-request', asset_id: ASSET_ID, external_id: 'maintenance.request:11', stage_id: '4', schedule_date: '2026-11-10T08:00:00+07:00', duration_hours: 3, ...over },
});
const vehicleUpdate = (over: Record<string, unknown> = {}) => ({
  domain: 'equipment', operation: 'update', idempotencyKey: FRESH_KEY,
  record: { id: VEHICLE_ASSET_ID, erp_doc_kind: 'register-vehicle', external_id: 'fleet.vehicle:7', active: false, ...over },
});

describe('AC-OFM-031 the register keeps its own role; maintenance is every active role', () => {
  it('an Engineer sending a vehicle create is refused before any outbox row or Odoo request', async () => {
    const st = newState();
    st.role = 'Engineer';
    const r = await dispatch(vehicleCreate(), st);
    assertEquals(r.unexpected, []);
    assertEquals([r.status, JSON.parse(r.text).message], [422, 'register-role']);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
    assertEquals(st.fake.rows('fleet.vehicle').length, 0);
  });

  it('a Project Manager sending a vehicle create is accepted, and the create key follows the PMO record', async () => {
    const st = newState();
    st.role = 'Project Manager';
    const r = await dispatch(vehicleCreate(), st);
    assertEquals(r.unexpected, []);
    assertEquals(r.status, 200, r.text);
    assertEquals(st.fake.rows('fleet.vehicle').length, 1);
    assertEquals(outboxInserts(r.calls).map((c) => [body(c).domain, body(c).pmo_record_id, body(c).idempotency_key, body(c).external_tier]), [['equipment', FRESH_VEHICLE_ASSET_ID, `equipment:${FRESH_VEHICLE_ASSET_ID}`, 'odoo']]);
  });

  it('an Engineer sending a maintenance request for a linked asset is accepted and mirrors the request', async () => {
    const st = newState();
    st.role = 'Engineer';
    const r = await dispatch(requestCreate(), st);
    assertEquals(r.unexpected, []);
    assertEquals(r.status, 200, r.text);
    const [row] = st.fake.rows('maintenance.request');
    // #2174: Odoo 20 derives the duration from the window PMO sends, so the 2.5 h the form asked for survives the round trip.
    assertEquals([row.name, row.equipment_id, row.maintenance_type, row.stage_id, row.schedule_date, row.schedule_end, row.duration], ['Hydraulic leak', 42, 'corrective', 1, '2026-11-10 01:00:00', '2026-11-10 03:30:00', 2.5]);
    assertEquals(outboxInserts(r.calls).map((c) => body(c).idempotency_key), [`equipment:${REQUEST_ID}`]);
    const mirror = st.mirror.filter((m) => m.fn === 'apply_odoo_master_rows');
    assertEquals(mirror.length, 1);
    assertEquals([mirror[0].args.p_kind, (mirror[0].args.p_rows as Array<Record<string, unknown>>)[0].pmo_id], ['maintenance_request', REQUEST_ID]);
    assertEquals((mirror[0].args.p_rows as Array<Record<string, unknown>>)[0].external_id, String(row.id));
  });
});

describe('AC-OFM-033 a write is refused before any outbox row when its target cannot carry it', () => {
  it('a maintenance request for an asset that is not linked to an Odoo asset is refused', async () => {
    const st = newState();
    st.assets[0] = { ...st.assets[0], external_ref: null };
    const r = await dispatch(requestCreate(), st);
    assertEquals(r.unexpected, []);
    assertEquals([r.status, JSON.parse(r.text).message], [422, 'equipment-not-linked']);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
  });

  it('a maintenance request for a VEHICLE-linked asset is refused: a vehicle takes a service log', async () => {
    const st = newState();
    const r = await dispatch(requestCreate({ asset_id: VEHICLE_ASSET_ID }), st);
    assertEquals(r.unexpected, []);
    assertEquals([r.status, JSON.parse(r.text).message], [422, 'equipment-kind-mismatch']);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
  });

  it('an asset of another org is refused before the outbox, never written into this org\'s register', async () => {
    const st = newState();
    const r = await dispatch(requestCreate(), st, { assets: (s) => ({ ...s.assets[0], org_id: OTHER_ORG }) });
    assertEquals(r.unexpected, []);
    assertNotEquals(r.status, 200);
    assertEquals(JSON.parse(r.text).error, 'cross-org-link-rejected');
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
  });

  it('a register create whose PMO asset id the book already holds is refused before the outbox and before any Odoo create', async () => {
    const st = newState();
    st.role = 'Project Manager';
    // The id is this org's linked equipment asset: the recorder would raise at finalize, leaving an orphan Odoo record behind.
    const r = await dispatch(equipmentCreate({ id: ASSET_ID }), st);
    assertEquals(r.unexpected, []);
    assertEquals([r.status, JSON.parse(r.text).message], [422, 'record-id-invalid']);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length, st.fake.rows('maintenance.equipment').length], [0, 0, 0]);
  });

  it('a register create whose PMO asset id belongs to ANOTHER org is refused too: the id is the recorder\'s identity', async () => {
    const st = newState();
    st.role = 'Project Manager';
    st.assets.push({ id: FRESH_ITEM_ASSET_ID, org_id: OTHER_ORG, code: 'OTH-1', name: 'Another org\'s asset', external_ref: null });
    const r = await dispatch(equipmentCreate(), st);
    assertEquals(r.unexpected, []);
    assertEquals([r.status, JSON.parse(r.text).message], [422, 'record-id-invalid']);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
  });
});

describe('an Odoo id the client names must be a row this org already mirrors', () => {
  it('a vehicle create naming a model this org does not mirror is refused before the outbox', async () => {
    const st = newState();
    st.role = 'Project Manager';
    const r = await dispatch(vehicleCreate({ model_id: '999' }), st);
    assertEquals(r.unexpected, []);
    assertEquals([r.status, JSON.parse(r.text).message], [422, 'vehicle-model-invalid']);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
  });

  it('a maintenance request naming a stage this org does not mirror is refused before the outbox', async () => {
    const st = newState();
    st.role = 'Engineer';
    const r = await dispatch(requestCreate({ stage_id: '9' }), st);
    assertEquals(r.unexpected, []);
    assertEquals([r.status, JSON.parse(r.text).message], [422, 'stage-invalid']);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
  });

  it('a service log naming a service type this org does not mirror is refused before the outbox', async () => {
    const st = newState();
    st.role = 'Engineer';
    const r = await dispatch(serviceCreate({ service_type_id: '77' }), st);
    assertEquals(r.unexpected, []);
    assertEquals([r.status, JSON.parse(r.text).message], [422, 'service-type-invalid']);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
  });

  it('a service log naming a vendor this org does not mirror is refused before the outbox', async () => {
    const st = newState();
    st.role = 'Engineer';
    const r = await dispatch(serviceCreate({ vendor_id: '88' }), st);
    assertEquals(r.unexpected, []);
    assertEquals([r.status, JSON.parse(r.text).message], [422, 'vendor-invalid']);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
  });

  it('a service log whose type and vendor ARE mirrored is accepted and sends the linked Odoo vehicle', async () => {
    const st = newState();
    st.role = 'Engineer';
    const r = await dispatch(serviceCreate(), st);
    assertEquals(r.unexpected, []);
    assertEquals(r.status, 200, r.text);
    const [row] = st.fake.rows('fleet.vehicle.log.services');
    assertEquals([row.vehicle_id, row.service_type_id, row.vendor_id, row.state, row.amount], [7, 2, 5, 'done', 150000]);
    const mirror = st.mirror.filter((m) => m.fn === 'apply_odoo_master_rows');
    assertEquals([mirror.length, (mirror[0].args.p_rows as Array<Record<string, unknown>>)[0].pmo_id], [1, SERVICE_ID]);
  });
});

describe('AC-OFM-030 one PMO record, one Odoo record', () => {
  it('a lost answer is adopted by its anchor on the same command: exactly one request, mirrored once', async () => {
    const st = newState();
    st.role = 'Engineer';
    // Odoo created the request AND its anchor; the answer never reached PMO.
    st.loseNext = 'anchor';
    const first = await dispatch(requestCreate(), st);
    assertNotEquals(first.status, 200);
    assertEquals(st.fake.rows('maintenance.request').length, 1);
    assertEquals(st.fake.rows('ir.model.data').length, 1);
    const second = await dispatch(requestCreate(), st);
    assertEquals(second.unexpected, []);
    assertEquals(second.status, 200, second.text);
    assertEquals(st.fake.rows('maintenance.request').length, 1, 'the second attempt adopts the anchored request, it does not create one');
    const mirror = st.mirror.filter((m) => m.fn === 'apply_odoo_master_rows');
    assertEquals(mirror.length, 1);
    assertEquals((mirror[0].args.p_rows as Array<Record<string, unknown>>)[0].external_id, String(st.fake.rows('maintenance.request')[0].id));
  });

  it('a create whose anchor was removed in Odoo is HELD for a person: nothing is created again', async () => {
    const st = newState();
    st.role = 'Engineer';
    st.loseNext = 'anchor';
    await dispatch(requestCreate(), st);
    // A person deleted the stock identifier in Odoo (the record itself is still there).
    const call = bindCall({ baseUrl: `https://${ODOO_HOST}`, apiKey: KEY, database: 'db1', fetchImpl: st.fake.fetch });
    const anchors = st.fake.rows('ir.model.data');
    await call('ir.model.data', 'unlink', { ids: anchors.map((a) => a.id) });
    // The outbox row is past its quarantine window: the recovery path owns it now.
    st.outbox.set(`${REQUEST_ID}|equipment:${REQUEST_ID}`, {
      id: 'outbox-1', domain: 'equipment', pmo_record_id: REQUEST_ID, idempotency_key: `equipment:${REQUEST_ID}`,
      state: 'quarantined', external_record_id: null, canonical: null, claim_generation: 1, payload_digest: null,
    });
    const r = await dispatch(requestCreate(), st);
    assertEquals(r.unexpected, []);
    assertNotEquals(r.status, 200, r.text);
    assertEquals(st.fake.rows('maintenance.request').length, 1, 'no second request');
    assertEquals(st.outbox.get(`${REQUEST_ID}|equipment:${REQUEST_ID}`)!.state, 'held');
  });

  it('an update is a plain field write and is sent again after a lost answer', async () => {
    const st = newState();
    st.role = 'Project Manager';
    st.fake.seed('fleet.vehicle', [{ id: 7, name: 'Vehicle/B 1234 XY', license_plate: 'B 1234 XY', model_id: [3, 'Hilux'], active: true, company_id: 1 }]);
    st.mirrorRows.push({ kind: 'vehicle', external_id: '7' });
    st.outbox.set(`${VEHICLE_ASSET_ID}|${FRESH_KEY}`, {
      id: 'outbox-9', domain: 'equipment', pmo_record_id: VEHICLE_ASSET_ID, idempotency_key: FRESH_KEY,
      state: 'quarantined', external_record_id: null, canonical: null, claim_generation: 1, payload_digest: null,
    });
    const r = await dispatch(vehicleUpdate(), st);
    assertEquals(r.unexpected, []);
    assertEquals(r.status, 200, r.text);
    assertEquals(st.fake.rows('fleet.vehicle').length, 1);
    assertEquals(st.fake.rows('fleet.vehicle')[0].active, false);
    assert(st.fake.calls.some((c) => c.model === 'fleet.vehicle' && c.method === 'write'), 'the update was sent');
  });

  // #2174: Odoo 20 closes a request on `state = done` (maintenance.py), not by moving it to a `done` stage — a stage change
  // alone closes nothing. The update below is the same command shape the form sends, with the done state beside the stage.
  it('a maintenance update writes the stage and, when marked done, the Odoo 20 state that closes the request', async () => {
    const st = newState();
    st.role = 'Engineer';
    st.fake.seed('maintenance.request', [{ id: 11, name: 'Hydraulic leak', equipment_id: [42, 'Excavator 20t'], stage_id: [1, 'New Request'], maintenance_type: 'corrective', state: 'normal', company_id: 1 }]);
    st.fake.seed('maintenance.stage', [{ id: 4, name: 'Repaired', sequence: 30 }]);
    // The request PMO does not mirror yet: refused before any write.
    const refused = await dispatch(requestUpdate(), st);
    assertEquals([refused.status, JSON.parse(refused.text).message], [422, 'equipment-not-linked']);
    assertEquals(st.fake.rows('maintenance.request')[0].stage_id, [1, 'New Request']);
    // The mirror row PMO holds for request 11 hangs off Odoo equipment 42 — the asset the command names.
    st.mirrorRows.push({ kind: 'maintenance_request', external_id: '11', parent_external_id: '42' });
    const staged = await dispatch(requestUpdate(), st);
    assertEquals(staged.unexpected, []);
    assertEquals(staged.status, 200, staged.text);
    assertEquals(st.fake.rows('maintenance.request')[0].stage_id, 4);
    assertEquals(st.fake.rows('maintenance.request')[0].close_date ?? false, false, 'a stage change alone closes nothing in Odoo 20');
    const r = await dispatch(requestUpdate({ state: 'done' }, DONE_UPDATE_KEY), st);
    assertEquals(r.unexpected, []);
    assertEquals(r.status, 200, r.text);
    assertEquals(st.fake.rows('maintenance.request')[0].state, 'done');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(String(st.fake.rows('maintenance.request')[0].close_date)), 'Odoo set the close date on state done');
  });

  it('a maintenance update is refused when the request it edits hangs off a DIFFERENT asset than the one the command names', async () => {
    const st = newState();
    st.role = 'Engineer';
    st.fake.seed('maintenance.request', [{ id: 11, name: 'Hydraulic leak', equipment_id: [42, 'Excavator 20t'], stage_id: [1, 'New Request'], maintenance_type: 'corrective', state: 'normal', company_id: 1 }]);
    st.fake.seed('maintenance.stage', [{ id: 4, name: 'Repaired', sequence: 30 }]);
    // PMO mirrors request 11 under equipment 43; the command says asset ASSET_ID (Odoo equipment 42). Nothing ties the two, so nothing
    // proves this edit is aimed at the record the PMO row describes: refused before the outbox row and before any Odoo write.
    st.mirrorRows.push({ kind: 'maintenance_request', external_id: '11', parent_external_id: '43' });
    const r = await dispatch(requestUpdate(), st);
    assertEquals(r.unexpected, []);
    assertEquals([r.status, JSON.parse(r.text).message], [422, 'equipment-not-linked']);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
    assertEquals(st.fake.rows('maintenance.request')[0].stage_id, [1, 'New Request'], 'the request was not written');
  });

  it('one dispatch resolves the Odoo connection ONCE: the adapter factory and the outbox deps read the same answer', async () => {
    const st = newState();
    st.role = 'Project Manager';
    const r = await dispatch(equipmentCreate(), st);
    assertEquals(r.unexpected, []);
    assertEquals(r.status, 200, r.text);
    const bindings = r.calls.filter((c) => c.url.pathname === '/rest/v1/external_org_bindings');
    assertEquals(bindings.length, 1, 'the connection was resolved twice in one dispatch');
  });

  it('a register create by a Project Manager reserves the PMO asset through the recorder', async () => {
    const st = newState();
    st.role = 'Project Manager';
    const r = await dispatch(equipmentCreate(), st);
    assertEquals(r.unexpected, []);
    assertEquals(r.status, 200, r.text);
    const [recorder] = st.mirror.filter((m) => m.fn === 'record_odoo_asset_created');
    assertEquals([recorder.args.p_kind, recorder.args.p_asset_id, recorder.args.p_default_unit], ['equipment', FRESH_ITEM_ASSET_ID, 'days']);
    assertEquals((recorder.args.p_row as Record<string, unknown>).code, 'EXC-001');
  });
});

describe('the connection decides before any outbox row', () => {
  it('an unusable Odoo connection refuses: 4xx, no outbox row, no Odoo request', async () => {
    const st = newState();
    st.role = 'Project Manager';
    const r = await dispatch(vehicleCreate(), st, { odooBinding: { status: 'disabled' } });
    assert(r.status >= 400 && r.status < 500, `${r.status} ${r.text}`);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length, st.fake.rows('fleet.vehicle').length], [0, 0, 0]);
  });

  it('a snapshot that lacks create on maintenance.request refuses, naming the model', async () => {
    const st = newState();
    st.role = 'Engineer';
    const r = await dispatch(requestCreate(), st, {
      odooBinding: { config: { database: 'db1', odoo_company_id: 1, capabilities: { later: {}, models: {}, assets: assetsSnapshot({ 'maintenance.request': { create: false } }) } } },
    });
    assertEquals(r.unexpected, []);
    assertEquals(r.status, 422);
    assert(JSON.parse(r.text).message.includes('maintenance.request:create'), r.text);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
  });
});

describe('adapter selection', () => {
  it('an org that employs equipment in Odoo gets the equipment factory; ERPNext and ClickUp are unchanged', () => {
    assertEquals(selectAdapterFactory('odoo', 'equipment'), resolveOdooEquipmentAdapter);
    assertEquals(selectAdapterFactory('erpnext', 'equipment'), undefined);
    assertEquals(selectAdapterFactory('erpnext', 'procurement'), ADAPTER_REGISTRY.procurement);
    assertEquals(selectAdapterFactory(undefined, 'companies'), ADAPTER_REGISTRY.companies);
  });
});
