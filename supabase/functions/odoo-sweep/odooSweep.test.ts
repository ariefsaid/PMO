/**
 * AC-ODC-025 — one org's Odoo sweep (`_shared/odooSweep.ts`; tested here, its first consumer, because CI runs `_shared`
 * tests under an import map without the edge test kit). Supabase is mocked over fetch with an in-memory cursor store
 * that only the RPCs write; Odoo is the in-memory fake.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { countResponse, installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { ODOO_SWEEP_TICK_MAX_CALLS, sweepOdooOrg } from '../_shared/odooSweep.ts';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';
import type { ConnectionRecord } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectionState.ts';

const env = installEdgeEnv();
// The pacer can only slow a client down, so tests skip its waits by firing timers at once.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout;
afterAll(() => { env.restore(); globalThis.setTimeout = realSetTimeout; });

const ORG = '0d000000-0000-4000-8000-000000000004';
const ODOO = 'odoo.example.test';
const KEY = 'stored-odoo-key';
const FRESH = new Date().toISOString();
const BINDING_ID = '0b000000-0000-4000-8000-000000000001';
const binding = (over: Record<string, unknown> = {}) => ({
  id: BINDING_ID, site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
  config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: FRESH, missing: [], models: {} } }, ...over,
});

/** What the org's `procurement` switch answers: a literal boolean, or a response that cannot be read (an RPC error, a rejected
 *  fetch, a null or a non-boolean body). A function answers per call, so one harness can model a switch that changes between ticks. */
type FeatureAnswer = boolean | null | 'error' | 'reject' | 'malformed';
interface Opts { pmoProjects?: Array<Record<string, unknown>>; pmoCompanies?: Array<Record<string, unknown>>; run?: Record<string, unknown> | null; accepted?: boolean; runError?: boolean; binding?: Record<string, unknown>; lock?: { held: boolean }; applyError?: boolean; reconcileError?: boolean; employed?: boolean; revenueEmployed?: boolean; failPurchaseDomain?: string; failRevenueDomain?: string; purchaseModels?: string[]; revenueModels?: string[]; rejectAfter?: number; version?: number | null; procurement?: FeatureAnswer | (() => FeatureAnswer); purchaseCursors?: Record<string, string>; recoveryCandidate?: Record<string, unknown>; recoveryCandidates?: Array<Record<string, unknown>>; prepare?: (f: FakeOdoo) => void; claimed?: Array<Record<string, unknown>>; sendOutbox?: Array<Record<string, unknown>>; ledgerLines?: number; failLedgerApply?: boolean; unswitched?: boolean; failCompanyYearRead?: boolean }

function harness(o: Opts = {}) {
  const fake = createFakeOdoo({ key: KEY });
  fake.seed('res.company', [{ id: 1, name: 'Main Co', currency_id: [12, 'IDR'] }]);
  fake.seed('product.product', [{ id: 1, name: 'Semen', default_code: 'S1', company_id: false }]);
  fake.seed('account.account', [{ id: 1, name: 'Payable', code: '2100', account_type: 'liability_payable', company_ids: [1] }]);
  if (o.ledgerLines) {
    fake.seed('account.move.line', Array.from({ length: o.ledgerLines }, (_, i) => ({ id: i + 1, move_id: [i + 1, `BILL/${i + 1}`], move_name: `BILL/${i + 1}`, journal_id: [3, 'Bills'], partner_id: false, company_id: [1, 'Main'], currency_id: [12, 'IDR'], account_id: [1, '2100 Payable'], date: '2026-06-15', parent_state: 'posted', debit: 10, credit: 0, balance: 10, amount_currency: 10, analytic_distribution: { '101': 100 }, write_date: '2026-11-02 10:00:00' })));
  }
  o.prepare?.(fake);
  const documentModels = [...(o.purchaseModels ?? []), ...(o.revenueModels ?? []), ...(o.ledgerLines ? ['account.move.line'] : [])];
  if (documentModels.length && !o.binding) o.binding = binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: FRESH, missing: [], models: {}, later: Object.fromEntries(documentModels.map((m) => [m, true])) }, ...(o.ledgerLines && !o.unswitched ? { ledger_basis_at: '2026-11-05T00:00:00Z' } : {}) } });
  const cursors = new Map<string, string>(Object.entries(o.purchaseCursors ?? {}));
  const staged = new Map<string, Array<{ externalId: string }>>();
  const lock = o.lock ?? { held: false };
  let odooCalls = 0;
  const sendOutbox = o.sendOutbox ?? [];
  const sf = (c: FetchCall, k: string) => c.url.searchParams.get(k)?.replace(/^eq\./, '');
  const sbody = (c: FetchCall) => c.bodyJson as Record<string, unknown>;
  // S8-T4: the accepted-send pass. Listed first so its row-level reads win over the generic empty answers below.
  const sendRoutes: MockRoute[] = [
    supabaseRpc('enqueue_new_item_sends', () => jsonResponse(0)),
    supabaseRpc('claim_connect_sends', (c) => jsonResponse((o.claimed ?? []).slice(0, Number(sbody(c).p_limit)))),
    supabaseRpc('connect_send_existing_link', () => jsonResponse(null)),
    supabaseRpc('record_connect_send_result', () => jsonResponse(null)),
    supabaseRpc('record_connect_send_held', () => jsonResponse(null)),
    supabaseRpc('record_connect_send_failure', () => jsonResponse(false)),
    ...(o.claimed ? [
      supabaseSelect('companies', (c) => (c.url.searchParams.has('id') ? one({ id: sf(c, 'id'), name: `PT ${sf(c, 'id')}`, type: 'Vendor', erp_tax_id: null }) : jsonResponse([]))),
      supabaseSelect('profiles', () => one({ id: 'admin-1' })),
    ] : []),
    supabaseSelect('external_command_outbox', (c) => {
      const row = sendOutbox.find((x) => x.idempotency_key === sf(c, 'idempotency_key'));
      if (row) return one(row);
      const id = sf(c, 'id');
      const match = (o.recoveryCandidates ?? (o.recoveryCandidate ? [o.recoveryCandidate] : [])).find((candidate) => candidate.id === id);
      return match ? one(match) : none();
    }),
    { label: 'outbox-insert', method: 'POST', pathname: '/rest/v1/external_command_outbox', response: (c: FetchCall) => {
      const b = sbody(c);
      const row = { id: `ob-${sendOutbox.length + 1}`, domain: b.domain, pmo_record_id: b.pmo_record_id, idempotency_key: b.idempotency_key, state: 'pending', external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null };
      sendOutbox.push(row);
      return one(row);
    } },
    { label: 'outbox-update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox', response: (c: FetchCall) => {
      const row = sendOutbox.find((x) => x.id === sf(c, 'id'))!;
      Object.assign(row, c.bodyJson);
      return jsonResponse([{ id: row.id }]);
    } },
    supabaseRpc('claim_outbox_for_commit', (c) => { const row = sendOutbox.find((x) => x.id === sbody(c).p_id)!; Object.assign(row, { state: 'committing', claim_generation: Number(row.claim_generation) + 1 }); return jsonResponse(row); }),
    supabaseRpc('quarantine_committing', (c) => { const row = sendOutbox.find((x) => x.id === sbody(c).p_id)!; if (row.state === 'committing') row.state = 'quarantined'; return jsonResponse(row); }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('confirm_outbox', (c) => { sendOutbox.find((x) => x.id === sbody(c).p_id)!.state = 'confirmed'; return jsonResponse(1); }),
    supabaseRpc('mark_outbox_held', (c) => { sendOutbox.find((x) => x.id === sbody(c).p_id)!.state = 'held'; return jsonResponse(1); }),
  ];
  // #1507 S3: the ledger feed's own reads and writes, listed before the generic empty answers below.
  const ledger = { applied: 0, snapshots: 0, mirror: [] as Array<{ id: string; project: string | null; account: string; fiscal_year: string; debit: string; credit: string }> };
  const ledgerRoutes: MockRoute[] = o.ledgerLines ? [
    { label: 'watermark-rewind', method: 'DELETE', pathname: '/rest/v1/external_sync_watermarks', response: () => { cursors.delete('ledger:odoo'); return new Response(null, { status: 204 }); } },
    { label: 'watermark-fingerprint', method: 'POST', pathname: '/rest/v1/external_sync_watermarks', response: (c) => { const b = c.bodyJson as { domain: string; watermark_cursor: string }; cursors.set(b.domain, b.watermark_cursor); return new Response(null, { status: 201 }); } },
    supabaseSelect('external_master_records', (c) => jsonResponse(c.url.searchParams.get('id') ? [] : [{ id: 'm1', external_id: '1', code: '2100' }])),
    supabaseSelect('external_project_bindings', (c) => jsonResponse(c.url.searchParams.get('id') ? [] : [{ id: 'b1', project_id: '00000000-0000-4000-8000-0000000000a1', external_container_id: '101' }])),
    supabaseSelect('erp_gl_entry_mirror', (c) => jsonResponse(c.url.searchParams.get('id') ? [] : ledger.mirror.map((r) => ({ ...r, cost_center: null })))),
    supabaseRpc('apply_odoo_ledger_page', (c) => {
      if (o.failLedgerApply) return jsonResponse({ code: 'P0001', message: 'x' }, { status: 400 });
      const b = c.bodyJson as { p_rows: Array<{ erp_name: string; project: string | null; account: string; fiscal_year: string; debit: string; credit: string }>; p_cursor: string };
      ledger.applied += b.p_rows.length;
      ledger.mirror.push(...b.p_rows.map((r) => ({ id: r.erp_name, project: r.project, account: r.account, fiscal_year: r.fiscal_year, debit: r.debit, credit: r.credit })));
      cursors.set('ledger:odoo', b.p_cursor);
      return jsonResponse(b.p_rows.length);
    }),
    supabaseRpc('mark_odoo_ledger_census_seen', () => jsonResponse(null)),
    supabaseRpc('finish_odoo_ledger_census', () => jsonResponse(0)),
    supabaseRpc('replace_erp_snapshot', () => { ledger.snapshots++; return jsonResponse(null); }),
  ] : [];
  const routes: MockRoute[] = [
    ...ledgerRoutes,
    ...sendRoutes,
    supabaseRpc('claim_erp_sweep_lock', () => { const ok = !lock.held; lock.held = true; return jsonResponse(ok); }),
    supabaseRpc('release_erp_sweep_lock', () => { lock.held = false; return jsonResponse(true); }),
    // #1783 item 4: the org's procurement entitlement at pass start (0534's service-only twin). Defaults on so every case
    // that predates the hold keeps the purchase feed it was written for.
    supabaseRpc('service_feature_enabled', () => {
      const answer = typeof o.procurement === 'function' ? o.procurement() : o.procurement === undefined ? true : o.procurement;
      if (answer === 'reject') throw new TypeError('store unreachable');
      if (answer === 'error') return jsonResponse({ code: 'XX000', message: 'x' }, { status: 500 });
      if (answer === 'malformed') return jsonResponse('yes');
      return jsonResponse(answer);
    }),
    supabaseSelect('external_org_bindings', () => jsonResponse([o.binding ?? binding()])),
    supabaseRpc('outbox_reconcile_candidates', () => jsonResponse(o.recoveryCandidates ?? (o.recoveryCandidate ? [o.recoveryCandidate] : []))),
    supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
    supabaseSelect('external_sync_watermarks', (c) => {
      const v = cursors.get(c.url.searchParams.get('domain')!.replace(/^eq\./, ''));
      return jsonResponse(v === undefined ? [] : [{ watermark_cursor: v }]);
    }),
    supabaseRpc('apply_odoo_master_page', (c) => {
      if (o.applyError) return jsonResponse({ code: 'P0001', message: 'x' }, { status: 400 });
      const b = c.bodyJson as { p_kind: string; p_rows: unknown[]; p_cursor: string };
      cursors.set(`master:${b.p_kind}`, b.p_cursor);
      return jsonResponse(b.p_rows.length);
    }),
    // FR-OPP-080: purchase documents are mirrored only for an org that employed procurement under Odoo.
    supabaseSelect('external_domain_ownership', (c) => {
      const domain = c.url.searchParams.get('domain')?.replace(/^eq\./, '');
      const employed = domain === 'revenue' ? o.revenueEmployed : o.employed;
      return jsonResponse(employed ? [{ id: `own-${domain}` }] : []);
    }),
    supabaseRpc('apply_odoo_purchase_page', (c) => { const b = c.bodyJson as { p_domain: string; p_cursor: string; p_rows: unknown[] }; if (b.p_domain === o.failPurchaseDomain) return jsonResponse({ code: '22023', message: 'x' }, { status: 400 }); cursors.set(`purchase:${b.p_domain}`, b.p_cursor); return jsonResponse(b.p_rows.length); }),
    supabaseRpc('mark_odoo_purchase_census_seen', () => jsonResponse(null)),
    supabaseRpc('finish_odoo_purchase_census', (c) => { const b = c.bodyJson as { p_domain: string; p_cursor: string }; cursors.set(`purchase:${b.p_domain}`, b.p_cursor); return jsonResponse(null); }),
    supabaseRpc('apply_odoo_revenue_page', (c) => { const b = c.bodyJson as { p_domain: string; p_cursor: string; p_rows: unknown[] }; if (b.p_domain === o.failRevenueDomain) return jsonResponse({ code: '22023', message: 'x' }, { status: 400 }); cursors.set(`revenue:${b.p_domain}`, b.p_cursor); return jsonResponse(b.p_rows.length); }),
    supabaseRpc('mark_odoo_revenue_census_seen', () => jsonResponse(null)),
    supabaseRpc('finish_odoo_revenue_census', (c) => { const b = c.bodyJson as { p_domain: string; p_cursor: string }; cursors.set(`revenue:${b.p_domain}`, b.p_cursor); return jsonResponse(0); }),
    supabaseRpc('mark_odoo_census_seen', () => jsonResponse(null)),
    supabaseRpc('finish_odoo_census', (c) => { const b = c.bodyJson as { p_kind: string; p_cursor: string }; cursors.set(`master:${b.p_kind}`, b.p_cursor); return jsonResponse(0); }),
    supabaseRpc('merge_external_org_binding_config', () => jsonResponse(null)),
    supabaseRpc('log_audit', () => jsonResponse(null)),
    // S6: the setup run's pass and the partner feed read these; by default there is no run and the party kind was never accepted.
    supabaseSelect('erp_connect_runs', () => (o.runError ? jsonResponse({ code: 'XX000', message: 'x' }, { status: 500 }) : o.run ? one(o.run) : none())),
    supabaseSelect('erp_connect_census', () => (o.accepted ? one({ accepted_at: '2026-11-01T00:00:00Z' }) : none())),
    supabaseSelect('external_master_records', () => jsonResponse([])),
    supabaseSelect('external_refs', () => jsonResponse([])),
    supabaseSelect('companies', (c) => jsonResponse(c.url.searchParams.has('erp_tax_id') || c.url.searchParams.has('name') ? [] : (o.pmoCompanies ?? []))),
    supabaseSelect('projects', () => jsonResponse(o.pmoProjects ?? [])),
    ...['profiles', 'procurement_items'].map((t) => supabaseSelect(t, () => jsonResponse([]))),
    { label: 'categories-in-use', method: 'HEAD', pathname: '/rest/v1/budget_line_items', response: () => countResponse(0) },
    supabaseSelect('erp_connect_staged', (c) => jsonResponse((staged.get(c.url.searchParams.get('kind')!.replace(/^eq\./, '')) ?? []).map((row) => ({ external_id: row.externalId, row })))),
    supabaseRpc('stage_connect_master_page', (c) => {
      const b = c.bodyJson as { p_kind: string; p_rows: Array<{ externalId: string }> };
      staged.set(b.p_kind, [...(staged.get(b.p_kind) ?? []), ...b.p_rows]);
      return jsonResponse(null);
    }),
    supabaseRpc('replace_connect_proposals', () => jsonResponse(null)),
    supabaseRpc('fail_connect_run', () => jsonResponse('staging')),
    supabaseRpc('apply_connect_outcome', () => jsonResponse(null)),
    supabaseRpc('reconcile_odoo_links', () => (o.reconcileError ? jsonResponse({ code: 'XX000', message: 'x' }, { status: 500 }) : jsonResponse(0))),
    ...(o.failCompanyYearRead ? [{ label: 'odoo-company-year', host: ODOO, pathname: '/json/2/res.company/read', match: (c: FetchCall) => String(c.bodyText).includes('fiscalyear_last_month'), response: () => jsonResponse({ name: 'x' }, { status: 500 }) }] : []),
    { label: 'odoo-json2', host: ODOO, pathname: /^\/json\/2\//, response: (c: FetchCall) => {
      odooCalls++;
      const key = o.rejectAfter !== undefined && odooCalls > o.rejectAfter ? 'revoked' : (c.headers.get('authorization') ?? '');
      return fake.fetch(c.url.toString(), { method: 'POST', headers: { Authorization: key.startsWith('bearer') ? key : `bearer ${key}` }, body: c.bodyText });
    } },
    { label: 'odoo-version', host: ODOO, pathname: '/web/webclient/version_info', response: () => (o.version === null ? new Response('no', { status: 404 }) : jsonResponse({ result: { server_version_info: [o.version ?? 20, 0] } })) },
  ];
  return { fake, cursors, lock, routes, sendOutbox, ledger };
}

const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const client = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function sweep(o: Opts = {}, opts?: Parameters<typeof sweepOdooOrg>[2]) {
  const h = harness(o);
  return await withFetchMock(h.routes, async ({ calls }) => ({ result: await sweepOdooOrg(client(), ORG, opts), calls, ...h }));
}
const odoo = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ODOO);
const stored = (calls: FetchCall[]) => (rpcCall(calls, 'merge_external_org_binding_config').at(-1)?.bodyJson as { p_patch: { connection: ConnectionRecord; capabilities?: unknown } } | undefined)?.p_patch;
/** The JSON-2 request's model, method and search domain. The sweep shares `account.move` and `account.payment` between the
 *  purchase and revenue feeds, so a domain leaf — not a blanket model count — is what tells the feeds apart. */
const odooRequests = (calls: FetchCall[]) => odoo(calls).map((c) => {
  const [, model = '', method = ''] = /^\/json\/2\/([^/]+)\/([^/]+)$/.exec(c.url.pathname) ?? [];
  return { model, method, domain: ((c.bodyJson as { domain?: unknown[] } | undefined)?.domain ?? []) as unknown[] };
});
const hasLeaf = (domain: unknown[], [field, op, value]: [string, string, unknown]) =>
  domain.some((t) => Array.isArray(t) && t[0] === field && t[1] === op && t[2] === value);
/** Reads that only a purchase pass can make, per domain: `purchase.order` is purchase-only, while the shared models are told
 *  apart by the filter the feed asks for (`in_invoice` bills, `outbound` supplier payments). `account.move.line` is the bill
 *  page's enrichment read and no revenue pass reads it. */
const purchaseDomainReads = (calls: FetchCall[]) => {
  const requests = odooRequests(calls);
  return {
    'purchase-order': requests.filter((r) => r.model.startsWith('purchase.order')),
    receipt: requests.filter((r) => r.model === 'stock.picking'),
    bill: requests.filter((r) => r.model === 'account.move.line' || (r.model === 'account.move' && hasLeaf(r.domain, ['move_type', '=', 'in_invoice']))),
    payment: requests.filter((r) => r.model === 'account.payment' && hasLeaf(r.domain, ['payment_type', '=', 'outbound'])),
  };
};
const purchaseReads = (calls: FetchCall[]) => Object.values(purchaseDomainReads(calls)).flat();
const appliedPurchasePages = (calls: FetchCall[]) => rpcCall(calls, 'apply_odoo_purchase_page').map((c) => c.bodyJson as { p_org_id: string; p_domain: string; p_rows: Array<{ external_id: string }> });
/** The committed purchase cursors, sorted by key, so a snapshot can be compared across a tick rather than to itself. */
const cursorSnapshot = (cursors: Map<string, string>) =>
  [...cursors.entries()].filter(([k]) => k.startsWith('purchase:')).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

describe('odooSweep — AC-ODC-025 single flight and refusals', () => {
  it('AC-ODC-025 a held lock → lock-held, no Odoo call and no release of someone else\'s lock', async () => {
    const r = await sweep({ lock: { held: true } });
    assertEquals(r.result, { skipped: 'lock-held' });
    assertEquals(odoo(r.calls).length, 0);
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 0);
  });

  for (const [label, b, refusal] of [
    ['disconnected', binding({ status: 'disconnected' }), 'inactive'],
    ['not activated', binding({ activated_at: null }), 'inactive'],
  ] as const) {
    it(`AC-ODC-025 a ${label} binding → ${refusal}, no Odoo call, lock released`, async () => {
      const r = await sweep({ binding: b });
      assertEquals(r.result, { skipped: refusal });
      assertEquals(odoo(r.calls).length, 0);
      assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
    });
  }

  it('AC-ODC-025 the kill switch off → kill-switch, no Odoo call', async () => {
    Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'false');
    try {
      const r = await sweep();
      assertEquals(r.result, { skipped: 'kill-switch' });
      assertEquals(odoo(r.calls).length, 0);
    } finally { Deno.env.delete('EXTERNAL_CONNECT_ENABLED'); }
  });

  it('AC-ODC-025 two overlapping sweeps for one org → one runs, the other no-ops', async () => {
    const h = harness();
    const [a, b] = await withFetchMock(h.routes, () => Promise.all([sweepOdooOrg(client(), ORG), sweepOdooOrg(client(), ORG)]));
    assertEquals([a, b].filter((x) => 'skipped' in x && x.skipped === 'lock-held').length, 1);
    assertEquals([a, b].filter((x) => 'ok' in x).length, 1);
  });
});

describe('odooSweep — AC-ODC-025 budget and outcomes', () => {
  it('AC-ODC-025 a big catalogue stops at the per-tick call budget with progress saved', async () => {
    const r = await sweep({ prepare: (f) => f.seed('product.product', Array.from({ length: 15_000 }, (_, i) => ({ id: i + 10, name: `P${i}`, company_id: false }))) });
    assert(odoo(r.calls).length <= ODOO_SWEEP_TICK_MAX_CALLS, `${odoo(r.calls).length} Odoo calls`);
    assertEquals('ok' in r.result && r.result.calls, ODOO_SWEEP_TICK_MAX_CALLS);
    assert(JSON.parse(r.cursors.get('master:product')!).scan.after_id > 0);
  });

  it('AC-ODC-025 a kind with a backlog larger than the tick leaves budget for every kind after it', async () => {
    const r = await sweep({ prepare: (f) => f.seed('product.product', Array.from({ length: 15_000 }, (_, i) => ({ id: i + 10, name: `P${i}`, company_id: false }))) });
    for (const kind of ['warehouse', 'location', 'partner']) assert(r.cursors.get(`master:${kind}`), `${kind} got no budget`);
  });

  it('AC-OPP-093 the journal directory is swept with its type, so Finance can pick a bank or cash book', async () => {
    const r = await sweep({ prepare: (f) => f.seed('account.journal', [{ id: 5, name: 'Bank Utama', code: 'BNK1', type: 'bank', company_id: [1, 'Main Co'] }]) });
    assert(r.cursors.has('master:journal'), 'the journal kind has a cursor');
    const rows = rpcCall(r.calls, 'apply_odoo_master_page').flatMap((c) => {
      const b = c.bodyJson as { p_kind: string; p_rows: Array<{ external_id: string; attrs: { type: string } }> };
      return b.p_kind === 'journal' ? b.p_rows : [];
    });
    assertEquals(rows.map((x) => [x.external_id, x.attrs.type]), [['5', 'bank']]);
  });

  it('AC-ODC-025 a spent time budget makes no Odoo call', async () => {
    const r = await sweep({}, { timeBudgetMs: 0 });
    assertEquals(odoo(r.calls).length, 0);
  });

  it('AC-ODC-021 cursors are written only by the page and census RPCs, never by a table write', async () => {
    const r = await sweep();
    assertEquals(r.calls.filter((c) => c.url.pathname === '/rest/v1/external_sync_watermarks' && c.method !== 'GET').length, 0);
    assert(r.cursors.has('master:product') && r.cursors.has('master:account'));
    const apply = rpcCall(r.calls, 'apply_odoo_master_page').map((c) => c.bodyJson as { p_org_id: string });
    assert(apply.every((b) => b.p_org_id === ORG));
  });

  it('AC-ODC-025 a clean run stores a healthy connection with what discovery last found missing', async () => {
    const r = await sweep({ binding: binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: FRESH, missing: ['l10n_id:ppn'], models: {} } } }) });
    assertEquals(stored(r.calls)?.connection.state, 'degraded');
    assertEquals(stored(r.calls)?.connection.missing, ['l10n_id:ppn']);
    assertEquals(stored(r.calls)?.capabilities, undefined);
    const clean = await sweep();
    assertEquals(stored(clean.calls)?.connection.state, 'healthy');
  });

  it('AC-ODC-025 capabilities older than a day are discovered again and stored', async () => {
    const r = await sweep({ binding: binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: '2026-01-01T00:00:00Z', missing: [], models: {} } } }) });
    assert(r.fake.calls.some((c) => c.method === 'fields_get'));
    assert(stored(r.calls)?.capabilities);
  });

  it('FR-ODC-021 a stale snapshot whose version probe fails falls back to the stored version, and with none is a failure', async () => {
    const old = { observed_at: '2026-01-01T00:00:00Z', missing: [], models: {} };
    const kept = await sweep({ version: null, binding: binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: { ...old, version_major: 20 } } }) });
    assertEquals((stored(kept.calls)?.capabilities as { version_major: number }).version_major, 20);
    const none = await sweep({ version: null, binding: binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: old } }) });
    assertEquals('ok' in none.result && none.result.failed, 'unreachable');
    assertEquals(stored(none.calls)?.capabilities, undefined);
  });

  it('AC-ODC-025 a 401 mid-sweep → credential-rejected, and no Odoo call after it', async () => {
    const r = await sweep({ rejectAfter: 2 });
    assertEquals('ok' in r.result && r.result.failed, 'key-rejected');
    assertEquals(stored(r.calls)?.connection.state, 'credential-rejected');
    assertEquals(stored(r.calls)?.connection.error_class, 'key-rejected');
    assertEquals(odoo(r.calls).length, 3);
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });

  it('AC-ODC-025 the lock is released when a store write throws, and the error surfaces', async () => {
    const h = harness({ applyError: true });
    await withFetchMock(h.routes, async ({ calls }) => {
      await assertRejects(() => sweepOdooOrg(client(), ORG), Error, 'apply_odoo_master_page failed');
      assertEquals(rpcCall(calls, 'release_erp_sweep_lock').length, 1);
      assertEquals(h.lock.held, false);
    });
  });

  it('a kind whose model discovery found missing is skipped, never read and never a rejected key', async () => {
    const r = await sweep({ binding: binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: FRESH, missing: ['stock.warehouse'], models: {
      'stock.warehouse': { exists: false, read: false, create: false, write: false, unlink: false, fields_missing: [] },
      'stock.location': { exists: true, read: false, create: false, write: false, unlink: false, fields_missing: [] },
    } } } }) });
    assertEquals(r.fake.calls.filter((c) => c.model.startsWith('stock.')).length, 0);
    assertEquals(stored(r.calls)?.connection.state, 'degraded');
  });

  it('reads only the activated company and shared rows', async () => {
    const r = await sweep({ prepare: (f) => f.seed('product.product', [{ id: 2, name: 'Other', company_id: [2, 'Other Co'] }]) });
    const rows = rpcCall(r.calls, 'apply_odoo_master_page').flatMap((c) => (c.bodyJson as { p_kind: string; p_rows: { external_id: string }[] }).p_kind === 'product' ? (c.bodyJson as { p_rows: { external_id: string }[] }).p_rows : []);
    assertEquals([...new Set(rows.map((x) => x.external_id))], ['1']);
  });
});

const RUN = { id: 'run-1', state: 'staging', cursor: {}, proposed_kinds: [], started_at: new Date().toISOString() };
const partnerRow = (id: number, over: Record<string, unknown> = {}) => ({ id, name: `Partner ${id}`, vat: false, ref: false, is_company: true, parent_id: false, supplier_rank: 1, customer_rank: 0, ...over });

describe('odooSweep — #1504 S6 the setup run and the partner feed', () => {
  it('FR-ECA-002 an open setup run of this connection is advanced in the same tick: Odoo parties are staged for it', async () => {
    const r = await sweep({ run: RUN, prepare: (f) => f.seed('res.partner', [partnerRow(5), partnerRow(6, { supplier_rank: 0, customer_rank: 1 })]) });
    assert('ok' in r.result);
    const read = r.calls.find((c) => c.url.pathname === '/rest/v1/erp_connect_runs')!;
    assertEquals([read.url.searchParams.get('org_id'), read.url.searchParams.get('external_tier'), read.url.searchParams.get('binding_id')], [`eq.${ORG}`, 'eq.odoo', `eq.${BINDING_ID}`]);
    const staged = rpcCall(r.calls, 'stage_connect_master_page').map((c) => c.bodyJson as { p_org_id: string; p_run_id: string; p_kind: string; p_rows: Array<{ externalId: string }> });
    assert(staged.every((b) => b.p_org_id === ORG && b.p_run_id === 'run-1'));
    assertEquals(staged.find((b) => b.p_kind === 'party')?.p_rows.map((x) => x.externalId), ['Vendor:5', 'Client:6']);
  });

  it('FR-ECA-010 once every kind is staged the next tick step proposes with the shared matcher, for tier odoo, against PMO\'s companies', async () => {
    const r = await sweep({ run: RUN, pmoCompanies: [{ id: 'c1', name: 'Partner 5', type: 'Vendor', erp_tax_id: null }], prepare: (f) => f.seed('res.partner', [partnerRow(5)]) });
    const writes = rpcCall(r.calls, 'replace_connect_proposals').map((c) => c.bodyJson as { p_org_id: string; p_tier: string; p_kind: string; p_rows: Array<Record<string, unknown>> });
    assertEquals(writes.map((w) => [w.p_org_id, w.p_tier, w.p_kind]), [[ORG, 'odoo', 'party']]);
    assertEquals(writes[0].p_rows.map((x) => [x.outcome, x.pmoIds, x.externalIds]), [['link', ['c1'], ['Vendor:5']]]);
    assertEquals(rpcCall(r.calls, 'fail_connect_run').length, 0);
  });

  it('AC-ODC-050 a PMO project links to the cost account carrying its PMO project number, not its client code', async () => {
    const DONE = { party: null, item: null, project: null, employee: null, account: null };
    const run = { ...RUN, state: 'proposing', cursor: DONE, proposed_kinds: ['party', 'item'] };
    const h = harness({ run, pmoProjects: [{ id: 'p1', name: 'Jembatan', pmo_project_number: 'PRJ-26-0001', code: 'CLIENT-9' }] });
    h.routes.unshift(supabaseSelect('erp_connect_staged', () => jsonResponse([{ external_id: '10', row: { kind: 'project', externalId: '10', code: 'PRJ-26-0001', name: 'PRJ-26-0001 Jembatan', active: true } }])));
    const r = await withFetchMock(h.routes, async ({ calls }) => (await sweepOdooOrg(client(), ORG), calls));
    const read = r.find((c) => c.url.pathname === '/rest/v1/projects')!;
    assert(read.url.searchParams.get('select')!.includes('pmo_project_number'));
    const write = rpcCall(r, 'replace_connect_proposals').map((c) => c.bodyJson as { p_kind: string; p_rows: Array<Record<string, unknown>> }).find((w) => w.p_kind === 'project')!;
    assertEquals(write.p_rows.map((x) => [x.outcome, x.pmoIds, x.externalIds, x.key]), [['link', ['p1'], ['10'], 'code']]);
  });

  it('with no open run the pass reads nothing more from Odoo and stages nothing', async () => {
    const quiet = await sweep();
    const running = await sweep({ run: RUN });
    assertEquals(rpcCall(quiet.calls, 'stage_connect_master_page').length, 0);
    assert(odoo(running.calls).length > odoo(quiet.calls).length);
  });

  it('FR-ECA-002 an Odoo key revoked mid-sweep still counts one failed tick against the open setup run (three end it)', async () => {
    const r = await sweep({ run: RUN, rejectAfter: 0 });
    assertEquals('ok' in r.result && r.result.failed, 'key-rejected');
    const fails = rpcCall(r.calls, 'fail_connect_run').map((c) => c.bodyJson as { p_org_id: string; p_run_id: string; p_fatal: boolean });
    assertEquals(fails.map((f) => [f.p_org_id, f.p_run_id, f.p_fatal]), [[ORG, 'run-1', false]]);
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });

  it('a failed tick with no open setup run counts nothing', async () => {
    const r = await sweep({ rejectAfter: 0 });
    assertEquals(rpcCall(r.calls, 'fail_connect_run').length, 0);
  });

  it('a setup run that cannot be read does not fail the tick: the connection state is still stored', async () => {
    const r = await sweep({ runError: true });
    assertEquals('ok' in r.result && r.result.failed, undefined);
    assertEquals(stored(r.calls)?.connection.state, 'healthy');
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });

  it('AC-ECA-005 a partner Odoo just changed is matched after the page is saved, once the party kind was accepted', async () => {
    const r = await sweep({ accepted: true, prepare: (f) => f.seed('res.partner', [partnerRow(9, { write_date: '2026-11-01 00:00:00' })]) });
    const apply = rpcCall(r.calls, 'apply_connect_outcome').map((c) => c.bodyJson);
    assertEquals(apply, [{ p_org_id: ORG, p_tier: 'odoo', p_outcome: 'bring-in', p_external_id: 'Vendor:9', p_pmo_id: null, p_kind: 'party', p_snapshot: { name: 'Partner 9', taxId: null, code: null, role: 'vendor' } }]);
    const pageSaved = r.calls.findIndex((c) => c.url.pathname === '/rest/v1/rpc/apply_odoo_master_page' && (c.bodyJson as { p_kind: string }).p_kind === 'partner');
    assert(pageSaved >= 0 && pageSaved < r.calls.findIndex((c) => c.url.pathname === '/rest/v1/rpc/apply_connect_outcome'));
  });

  it('before the first accept the sweep applies nothing', async () => {
    const r = await sweep({ prepare: (f) => f.seed('res.partner', [partnerRow(9, { write_date: '2026-11-01 00:00:00' })]) });
    assertEquals(rpcCall(r.calls, 'apply_connect_outcome').length, 0);
  });
});

describe('odooSweep — #1505 P7 purchase passes (FR-OPP-080)', () => {
  const bill = { id: 1, name: 'BILL/2026/1', state: 'posted', move_type: 'in_invoice', partner_id: [41, 'V'], company_id: [1, 'Main'], invoice_date: '2026-10-30', invoice_date_due: false, ref: 'INV-1', amount_total: 98, amount_untaxed: 100, amount_residual: 98, write_date: '2026-11-01 10:00:00' };
  const seedBill = (f: FakeOdoo) => { f.seed('account.move', [bill]); f.seed('account.move.line', [{ id: 1, move_id: [1, 'b'], balance: 100, tax_line_id: false, analytic_distribution: false }]); };
  const purchasePages = (calls: FetchCall[]) => rpcCall(calls, 'apply_odoo_purchase_page').map((c) => c.bodyJson as { p_org_id: string; p_domain: string; p_rows: unknown[] });

  it('AC-OPP-074 an org that employed procurement mirrors its vendor bills after the directory, in the same tick', async () => {
    const r = await sweep({ employed: true, purchaseModels: ['account.move'], prepare: seedBill });
    assertEquals(purchasePages(r.calls).map((p) => [p.p_org_id, p.p_domain, p.p_rows.length]), [[ORG, 'bill', 1]]);
    const lastDirectory = r.calls.map((c) => c.url.pathname).lastIndexOf('/rest/v1/rpc/apply_odoo_master_page');
    assert(lastDirectory >= 0 && lastDirectory < r.calls.findIndex((c) => c.url.pathname === '/rest/v1/rpc/apply_odoo_purchase_page'));
    assert(r.cursors.get('purchase:bill'));
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });

  it('FR-OPP-080 an org that has not employed procurement under Odoo reads no purchase document', async () => {
    const r = await sweep({ employed: false, purchaseModels: ['account.move'], prepare: seedBill });
    assertEquals(purchasePages(r.calls).length, 0);
    assertEquals(odoo(r.calls).filter((c) => (c.bodyText ?? '').includes('in_invoice')).length, 0);
  });

  it('FR-OPP-080 a purchase model discovery did not find present and readable is skipped, never a failed tick', async () => {
    const r = await sweep({ employed: true, purchaseModels: ['purchase.order'], prepare: seedBill });
    assertEquals(purchasePages(r.calls).map((p) => p.p_domain), ['purchase-order']);
    assertEquals('ok' in r.result && r.result.failed, undefined);
  });

  it('FR-OPP-080 a disconnected or kill-switched org makes no purchase read (the resolver refuses first)', async () => {
    const r = await sweep({ employed: true, purchaseModels: ['account.move'], binding: binding({ status: 'disconnected' }), prepare: seedBill });
    assertEquals(purchasePages(r.calls).length, 0);
    assertEquals(odoo(r.calls).length, 0);
  });

  it('AC-OPP-074 purchase cursors are written only by the purchase apply and census RPCs', async () => {
    const r = await sweep({ employed: true, purchaseModels: ['account.move'], prepare: seedBill });
    const writes = r.calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD' && c.url.pathname.startsWith('/rest/v1/') && !c.url.pathname.startsWith('/rest/v1/rpc/'));
    assertEquals(writes.length, 0);
  });

  it('a small tick still reaches the purchase passes: the directory leaves their share of the budget', async () => {
    const r = await sweep({ employed: true, purchaseModels: ['account.move', 'purchase.order'], prepare: (f) => { seedBill(f); f.seed('res.partner', Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `P${i}`, write_date: '2026-11-01 00:00:00' }))); } }, { maxCalls: 14 });
    assert(purchasePages(r.calls).length >= 1, 'the bill pass ran although the directory had a backlog');
  });

  it('AC-OPP-074 a purchase domain the database refuses keeps its cursor and does not starve the domains after it or the tick', async () => {
    const r = await sweep({ employed: true, purchaseModels: ['purchase.order', 'account.move'], failPurchaseDomain: 'purchase-order',
      prepare: (f) => { seedBill(f); f.seed('purchase.order', [{ id: 1, name: 'P1', state: 'purchase', partner_id: [41, 'V'], company_id: [1, 'Main'], date_order: '2026-10-30 08:00:00', amount_total: 1, amount_untaxed: 1, write_date: '2026-11-01 10:00:00' }]); } });
    assertEquals(purchasePages(r.calls).map((p) => p.p_domain).sort(), ['bill', 'purchase-order']);
    assertEquals(r.cursors.get('purchase:purchase-order'), undefined);
    assert(r.cursors.get('purchase:bill'));
    assertEquals('ok' in r.result && r.result.failed, undefined);
    assertEquals(stored(r.calls)?.connection.state, 'healthy');
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });
});

describe('odooSweep — #1506 C6 revenue passes', () => {
  it('AC-OCI-074 revenue feeds run after the directory and publish actual invoice progress', async () => {
    const r = await sweep({ revenueEmployed: true, revenueModels: ['account.move'], prepare: (fake) => fake.seed('account.move', [{
      id: 91, name: 'INV/2026/00091', move_type: 'out_invoice', state: 'posted', partner_id: [41, 'Client A'], company_id: [1, 'Main'],
      invoice_date: '2026-11-01', invoice_date_due: '2026-12-01', ref: 'PO-91', currency_id: [1, 'IDR'],
      amount_total: 1110, amount_untaxed: 1000, amount_tax: 110, amount_residual: 710, write_date: '2026-11-02 10:00:00',
    }]) });
    const pages = rpcCall(r.calls, 'apply_odoo_revenue_page').map((call) => call.bodyJson as { p_org_id: string; p_domain: string; p_rows: Array<{ external_id: string; attrs: { residual: string } }> });
    const directory = r.calls.findIndex((call) => call.url.pathname === '/rest/v1/rpc/apply_odoo_master_page');
    const revenue = r.calls.findIndex((call) => call.url.pathname === '/rest/v1/rpc/apply_odoo_revenue_page');
    const recovery = r.calls.findIndex((call) => call.url.pathname === '/rest/v1/rpc/outbox_reconcile_candidates');
    assert(recovery >= 0 && recovery < directory, 'outbox recovery is part of the sweep tick before the bounded inbound walk');
    assert(directory >= 0 && directory < revenue, 'revenue feed follows the directory mappings');
    const invoicePages = pages.filter((page) => page.p_domain === 'sales-invoice');
    assertEquals(invoicePages.map((page) => [page.p_org_id, page.p_domain, page.p_rows.map((row) => [row.external_id, row.attrs.residual])]), [[ORG, 'sales-invoice', [['91', '710.00']]]]);
    assert(pages.some((page) => page.p_domain === 'credit-note'), 'the credit-note cursor is advanced in the same tick');
    assert(r.cursors.get('revenue:sales-invoice'), 'the page apply committed a visible revenue cursor');
    assertEquals('ok' in r.result && r.result.outbox_reconciled, 0, 'the tick reports the outbox recovery pass');
    assert('ok' in r.result && r.result.calls > 0, 'the tick reports real work rather than a stale zero');
  });

  it('AC-OPP-062 procurement recovery reports a dispatched candidate in the sweep tick and shares one candidate read with revenue', async () => {
    const recoveryCandidate = {
      id: 'recovery-1', org_id: ORG, domain: 'procurement', pmo_record_id: '123e4567-e89b-12d3-a456-426614174000',
      idempotency_key: 'recovery-key', external_tier: 'odoo', operation: 'create', state: 'failed',
      external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null,
      payload: { erp_doc_kind: 'purchase-order', procurementId: 'purchase-1' }, actor_user_id: null, updated_at: FRESH,
    };
    const r = await sweep({
      employed: true, purchaseModels: ['purchase.order'], revenueEmployed: true, revenueModels: ['account.move'], recoveryCandidate,
    });
    const candidateReads = rpcCall(r.calls, 'outbox_reconcile_candidates');
    const directory = r.calls.findIndex((call) => call.url.pathname === '/rest/v1/rpc/apply_odoo_master_page');
    const recovery = r.calls.findIndex((call) => call.url.pathname === '/rest/v1/rpc/outbox_reconcile_candidates');

    assertEquals(candidateReads.length, 1, 'revenue and procurement share one candidate query per tick');
    assert(recovery >= 0 && recovery < directory, 'outbox recovery runs before the bounded inbound walk');
    assert('ok' in r.result);
    assertEquals(r.result.outbox_procurement_reconciled, 0);
    assertEquals(r.result.outbox_procurement_skipped, 0);
    assertEquals(r.result.outbox_procurement_budget_exhausted, false);
    assertEquals(r.result.outbox_procurement_errors, [{ id: 'recovery-1', error: 'commit-rejected' }]);
  });

  it('AC-OPP-062 gives procurement payment recovery its reserved slot before revenue recovery', async () => {
    const paymentId = '123e4567-e89b-12d3-a456-426614174001';
    const revenueId = '123e4567-e89b-12d3-a456-426614174002';
    const recoveryCandidates = [
      {
        id: revenueId, org_id: ORG, domain: 'revenue', pmo_record_id: 'invoice-1', idempotency_key: 'invoice-key',
        external_tier: 'odoo', operation: 'create', state: 'failed', external_record_id: null, canonical: null,
        claim_generation: 0, payload_digest: null, payload: { erp_doc_kind: 'sales-invoice', verb: 'submit' },
        actor_user_id: null, updated_at: FRESH,
      },
      {
        id: paymentId, org_id: ORG, domain: 'procurement', pmo_record_id: 'payment-1', idempotency_key: 'payment-key',
        external_tier: 'odoo', operation: 'create', state: 'failed', external_record_id: null, canonical: null,
        claim_generation: 0, payload_digest: null, payload: { erp_doc_kind: 'payment' }, actor_user_id: null, updated_at: FRESH,
      },
    ];
    const r = await sweep({ employed: true, purchaseModels: ['purchase.order'], revenueEmployed: true, revenueModels: ['account.move'], recoveryCandidates });
    const recoveryReads = r.calls.filter((call) => call.url.pathname === '/rest/v1/external_command_outbox' && call.url.searchParams.has('id'))
      .map((call) => call.url.searchParams.get('id')?.replace(/^eq\./, ''));

    assertEquals(recoveryReads.slice(0, 2), [paymentId, revenueId]);
  });
});

describe('odooSweep — #1783 item 4 the procurement switch holds the purchase feed at pass start', () => {
  const WRITE = '2026-11-01 10:00:00';
  const CURSOR = '{"w":"2026-11-01 10:00:00","id":0,"scan":null}';
  const ALL_PURCHASE_MODELS = ['purchase.order', 'stock.picking', 'account.move', 'account.payment'];
  const ALL_REVENUE_MODELS = ['account.move', 'account.payment'];
  const order = { id: 1, name: 'PO00001', state: 'purchase', partner_id: [41, 'Vendor'], company_id: [1, 'Main'], date_order: '2026-10-30 08:00:00', amount_total: 100, amount_untaxed: 100, write_date: WRITE };
  const receipt = { id: 1, name: 'WH/IN/00001', state: 'assigned', partner_id: [41, 'Vendor'], company_id: [1, 'Main'], picking_type_code: 'incoming', write_date: WRITE };
  const bill = { id: 1, name: 'BILL/2026/1', state: 'posted', move_type: 'in_invoice', partner_id: [41, 'V'], company_id: [1, 'Main'], invoice_date: '2026-10-30', invoice_date_due: false, ref: 'INV-1', amount_total: 98, amount_untaxed: 100, amount_residual: 98, write_date: WRITE };
  const payment = { id: 1, name: 'PAY/2026/1', state: 'paid', payment_type: 'outbound', partner_type: 'supplier', partner_id: [41, 'V'], company_id: [1, 'Main'], amount: 98, date: '2026-10-31', write_date: WRITE };
  const invoice = { id: 91, name: 'INV/2026/00091', move_type: 'out_invoice', state: 'posted', partner_id: [41, 'Client A'], company_id: [1, 'Main'], invoice_date: '2026-11-01', invoice_date_due: '2026-12-01', ref: 'PO-91', currency_id: [1, 'IDR'], amount_total: 1110, amount_untaxed: 1000, amount_tax: 110, amount_residual: 710, write_date: '2026-11-02 10:00:00' };
  const seedEverything = (f: FakeOdoo) => {
    f.seed('purchase.order', [order]);
    f.seed('stock.picking', [receipt]);
    f.seed('account.move', [bill, invoice]);
    f.seed('account.payment', [payment]);
  };
  const everything = (over: Opts = {}) => ({ employed: true, purchaseModels: ALL_PURCHASE_MODELS, revenueEmployed: true, revenueModels: ALL_REVENUE_MODELS, prepare: seedEverything, ...over });

  it('AC-OPP-062 reports when procurement recovery is unavailable because the org does not employ its feed', async () => {
    const r = await sweep({ employed: false, purchaseModels: ['purchase.order'] });
    assertEquals('ok' in r.result && r.result.outbox_procurement_errors, [
      { id: 'procurement', error: 'procurement-feed-not-employed' },
    ]);
  });

  it('AC-OPP-062 reports when procurement is not employed so recovery is not silently omitted', async () => {
    const r = await sweep(everything({ employed: false }));
    assert('ok' in r.result);
    assertEquals(r.result.outbox_procurement_errors, [{ id: 'procurement', error: 'procurement-feed-not-employed' }]);
  });

  it('AC-1783-04A procurement off holds every purchase domain while the directory and revenue feeds still run', async () => {
    const r = await sweep(everything({ procurement: false, purchaseCursors: { 'purchase:bill': CURSOR } }));
    assertEquals('ok' in r.result && r.result.purchase_hold, 'feature-off:procurement');
    // the switch is read once for this org, and only for this key
    assertEquals(rpcCall(r.calls, 'service_feature_enabled').map((c) => c.bodyJson), [{ p_org_id: ORG, p_key: 'procurement' }]);
    // no purchase read reaches Odoo — asserted per domain, so a shared model cannot hide a purchase read behind revenue's
    const reads = purchaseDomainReads(r.calls);
    for (const domain of ['purchase-order', 'receipt', 'bill', 'payment'] as const) {
      assertEquals(reads[domain].map((x) => `${x.model}.${x.method}`), [], domain);
    }
    // no purchase page, census or cursor move
    assertEquals(['apply_odoo_purchase_page', 'mark_odoo_purchase_census_seen', 'finish_odoo_purchase_census'].map((fn) => rpcCall(r.calls, fn).length), [0, 0, 0]);
    assertEquals(r.cursors.get('purchase:bill'), CURSOR);
    assertEquals([...r.cursors.keys()].filter((k) => k.startsWith('purchase:')), ['purchase:bill']);
    // ownership is untouched and never even consulted for procurement while the switch is off
    assertEquals(r.calls.filter((c) => c.url.pathname === '/rest/v1/external_domain_ownership' && c.method !== 'GET').length, 0);
    assertEquals(r.calls.filter((c) => c.url.pathname === '/rest/v1/external_domain_ownership' && c.url.searchParams.get('domain') === 'eq.procurement').length, 0);
    // unrelated feeds are unaffected: the directory pages and the revenue pages still apply
    assert(rpcCall(r.calls, 'apply_odoo_master_page').length > 0, 'the directory still sweeps');
    assertEquals(rpcCall(r.calls, 'apply_odoo_revenue_page').map((c) => (c.bodyJson as { p_domain: string }).p_domain).includes('sales-invoice'), true);
    assertEquals(stored(r.calls)?.connection.state, 'healthy');
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });

  /** An open setup run of this connection plus an Odoo party, so the after-sweep step has real work to advance. */
  const withSetupRun = (f: FakeOdoo) => { seedEverything(f); f.seed('res.partner', [partnerRow(5)]); };

  for (const [label, answer] of [
    ['an RPC error', 'error'],
    ['a rejected fetch', 'reject'],
    ['a null answer', null],
    ['a non-boolean answer', 'malformed'],
  ] as const) {
    it(`AC-1783-04B a procurement switch that cannot be read (${label}) holds purchase only, never the whole org`, async () => {
      const r = await sweep(everything({ procurement: answer, purchaseCursors: { 'purchase:bill': CURSOR }, run: RUN, prepare: withSetupRun }));
      assertEquals('ok' in r.result && r.result.purchase_hold, 'feature-switch-unreadable:procurement', label);
      // the hold is real, not just a return code: no purchase-derived call and the cursor is untouched
      assertEquals(purchaseReads(r.calls).length, 0, label);
      assertEquals(rpcCall(r.calls, 'apply_odoo_purchase_page').length, 0, label);
      assertEquals(rpcCall(r.calls, 'mark_odoo_purchase_census_seen').length, 0, label);
      assertEquals(rpcCall(r.calls, 'finish_odoo_purchase_census').length, 0, label);
      assertEquals(r.cursors.get('purchase:bill'), CURSOR, label);
      // the unrelated feeds, the setup step and the probe still run
      assert(rpcCall(r.calls, 'apply_odoo_master_page').length > 0, `${label}: directory`);
      assert(rpcCall(r.calls, 'apply_odoo_revenue_page').length > 0, `${label}: revenue`);
      assertEquals(stored(r.calls)?.connection.state, 'healthy', `${label}: probe`);
      assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1, label);
      assertEquals('ok' in r.result && r.result.failed, undefined, label);
      // the real after-sweep step advances the open run, not merely a comment: this tick pages the Odoo party into the run's
      // staging table, and the run then reaches its next step (proposing the party kind). A regression that skipped the setup
      // step on an unreadable entitlement would stall the run here and go red.
      const staged = rpcCall(r.calls, 'stage_connect_master_page').map((c) => c.bodyJson as { p_org_id: string; p_run_id: string; p_kind: string; p_rows: Array<{ externalId: string }> });
      assertEquals(staged.filter((b) => b.p_kind === 'party').map((b) => [b.p_org_id, b.p_run_id, b.p_rows.map((x) => x.externalId)]), [[ORG, 'run-1', ['Vendor:5']]], `${label}: setup staging step`);
      const proposed = rpcCall(r.calls, 'replace_connect_proposals').map((c) => c.bodyJson as { p_org_id: string; p_run_id: string; p_kind: string });
      assertEquals(proposed.map((b) => [b.p_org_id, b.p_run_id, b.p_kind]), [[ORG, 'run-1', 'party']], `${label}: setup propose step`);
    });
  }

  it('AC-1783-04C a held purchase feed resumes from the same cursor once the switch is back on', async () => {
    let on = false;
    const h = harness(everything({ procurement: () => on, purchaseCursors: { 'purchase:bill': CURSOR } }));
    const r = await withFetchMock(h.routes, async ({ calls }) => {
      const held = await sweepOdooOrg(client(), ORG);
      const heldCalls = calls.length;
      on = true;
      const resumed = await sweepOdooOrg(client(), ORG);
      return { held, resumed, calls, heldCalls, resumedCalls: calls.slice(heldCalls) };
    });
    // the held tick does no purchase work at all
    assertEquals('ok' in r.held && r.held.purchase_hold, 'feature-off:procurement');
    assertEquals(purchaseReads(r.calls.slice(0, r.heldCalls)).length, 0);
    assertEquals(rpcCall(r.calls.slice(0, r.heldCalls), 'apply_odoo_purchase_page').length, 0);
    // the resumed tick continues from the stored cursor (its overlap start), not from a fresh scan
    const billRead = odooRequests(r.resumedCalls).find((x) => x.model === 'account.move' && hasLeaf(x.domain, ['move_type', '=', 'in_invoice']));
    assert(!!billRead, 'the resumed tick reads vendor bills');
    assertEquals(hasLeaf(billRead!.domain, ['write_date', '>', '2026-11-01 09:50:00']), true, 'the page resumes at the stored cursor minus the overlap');
    const billPages = appliedPurchasePages(r.resumedCalls).filter((p) => p.p_domain === 'bill');
    assertEquals(billPages.map((p) => p.p_rows.map((x) => x.external_id)), [['1']]);
    // the page and the census committed the same cursor the feed will resume from
    const finished = rpcCall(r.resumedCalls, 'finish_odoo_purchase_census').filter((c) => (c.bodyJson as { p_domain: string }).p_domain === 'bill');
    assertEquals(finished.length, 1);
    assertEquals(h.cursors.get('purchase:bill'), (finished[0].bodyJson as { p_cursor: string }).p_cursor);
    assert(h.cursors.get('purchase:bill')!.includes('census_done_at'), 'the census finished on the resumed page');
    // resuming neither re-employs the domain nor disconnects the binding
    assertEquals(rpcCall(r.calls, 'admin_change_domain_ownership').length, 0);
    assertEquals(r.calls.filter((c) => c.url.pathname === '/rest/v1/external_org_bindings' && c.method !== 'GET').length, 0);
    assertEquals(stored(r.resumedCalls)?.connection.state, 'healthy');
  });

  it('AC-1783-04D entitlement on but the domain not employed, or the binding disconnected, keeps purchase absent', async () => {
    const notEmployed = await sweep(everything({ employed: false, procurement: true }));
    assertEquals('ok' in notEmployed.result && notEmployed.result.purchase_hold, undefined);
    assertEquals(purchaseReads(notEmployed.calls).length, 0);
    assertEquals(rpcCall(notEmployed.calls, 'apply_odoo_purchase_page').length, 0);
    assert(rpcCall(notEmployed.calls, 'apply_odoo_master_page').length > 0, 'the directory still runs');

    const disconnected = await sweep(everything({ procurement: true, binding: binding({ status: 'disconnected' }) }));
    assertEquals(disconnected.result, { skipped: 'inactive' });
    assertEquals(odoo(disconnected.calls).length, 0, 'a disconnected binding makes no external call at all');
    assertEquals(rpcCall(disconnected.calls, 'apply_odoo_purchase_page').length, 0);
    assertEquals(rpcCall(disconnected.calls, 'service_feature_enabled').length, 0, 'the resolver refuses before the switch is read');
  });

  it('AC-1783-04D entitlement on, employed and all four models readable → all four purchase domains run', async () => {
    const r = await sweep(everything({ procurement: true }));
    assertEquals('ok' in r.result && r.result.purchase_hold, undefined);
    assertEquals(appliedPurchasePages(r.calls).map((p) => p.p_domain).sort(), ['bill', 'payment', 'purchase-order', 'receipt']);
    const reads = purchaseDomainReads(r.calls);
    for (const domain of ['purchase-order', 'receipt', 'bill', 'payment'] as const) {
      assert(reads[domain].length > 0, `${domain} was read from Odoo`);
      assert(r.cursors.get(`purchase:${domain}`), `${domain} committed its cursor`);
    }
  });

  it('AC-1783-04E a switch that turns off during an admitted purchase page lets that page and census finish, and the next tick holds', async () => {
    // The switch reads true at pass start, then flips to false WHILE the first tick is serving its first admitted purchase
    // page read: a live mid-pass change, not merely a different answer to the next tick's lookup.
    let switchOn = true;
    let lookups = 0;
    const flip = { model: '', method: '', at: -1, lookupsAt: -1 };
    const h = harness(everything({ procurement: () => { lookups += 1; return switchOn; } }));
    const served = h.fake.fetch;
    let recorded: FetchCall[] = [];
    h.fake.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const [, model = '', method = ''] = /^\/json\/2\/([^/]+)\/([^/]+)$/.exec(new URL(String(url)).pathname) ?? [];
      const domain = (JSON.parse(String(init?.body ?? '{}')) as { domain?: unknown[] }).domain ?? [];
      const purchaseRead = method === 'search_read' && (
        model.startsWith('purchase.order') || model === 'stock.picking' ||
        (model === 'account.move' && hasLeaf(domain, ['move_type', '=', 'in_invoice'])) ||
        (model === 'account.payment' && hasLeaf(domain, ['payment_type', '=', 'outbound'])));
      if (switchOn && purchaseRead) {
        switchOn = false;
        // `recorded` already holds this in-flight call, so its index is `at - 1`
        Object.assign(flip, { model, method, at: recorded.length, lookupsAt: lookups });
      }
      return await served(url, init);
    }) as typeof fetch;
    const r = await withFetchMock(h.routes, async ({ calls }) => {
      recorded = calls;
      const first = await sweepOdooOrg(client(), ORG);
      // Snapshot the committed purchase cursors between the two ticks: taken after the second tick it would compare a map
      // to itself, so a held tick that moved a cursor could never fail the assertion.
      const firstSnapshot = cursorSnapshot(h.cursors);
      const firstCalls = calls.length;
      const second = await sweepOdooOrg(client(), ORG);
      return { first, second, firstCalls, firstTick: calls.slice(0, firstCalls), secondTick: calls.slice(firstCalls), firstSnapshot, secondSnapshot: cursorSnapshot(h.cursors), flip: { ...flip } };
    });
    // the flip landed on an in-flight purchase page read, inside the first tick and after the one pass-start lookup
    assert(r.flip.at > 0, 'the switch never flipped during an admitted purchase page read');
    assert(r.flip.at - 1 < r.firstCalls, `${r.flip.model}.${r.flip.method} flipped outside the first tick`);
    assertEquals(purchaseReads([r.firstTick[r.flip.at - 1]]).length, 1, 'the switch flipped while an admitted purchase page read was in flight');
    assertEquals(r.flip.lookupsAt, 1, 'the flip came after the pass-start lookup');
    assertEquals(rpcCall(r.firstTick, 'service_feature_enabled').length, 1);
    // every domain the pass-start lookup admitted finishes after the flip: no mid-pass refusal, no half-applied page
    const afterFlip = r.firstTick.slice(r.flip.at);
    assertEquals(appliedPurchasePages(afterFlip).map((p) => p.p_domain).sort(), ['bill', 'payment', 'purchase-order', 'receipt']);
    assertEquals(rpcCall(afterFlip, 'finish_odoo_purchase_census').map((c) => (c.bodyJson as { p_domain: string }).p_domain).sort(), ['bill', 'payment', 'purchase-order', 'receipt']);
    assertEquals('ok' in r.first && r.first.purchase_hold, undefined);
    // the switch now answers off: the next tick holds purchase and leaves the cursors exactly where the admitted pass left them
    assertEquals(r.secondSnapshot.map(([k]) => k).sort(), ['purchase:bill', 'purchase:payment', 'purchase:purchase-order', 'purchase:receipt']);
    assertEquals('ok' in r.second && r.second.purchase_hold, 'feature-off:procurement');
    assertEquals(purchaseReads(r.secondTick).length, 0);
    assertEquals(rpcCall(r.secondTick, 'apply_odoo_purchase_page').length, 0);
    assertEquals(r.secondSnapshot, r.firstSnapshot);
  });
});

describe('odooSweep — #1504 S7 link reconciliation (AC-ODC-054)', () => {
  it('a clean tick reconciles this org\'s project links once, after the directory pages are saved', async () => {
    const r = await sweep();
    const calls = rpcCall(r.calls, 'reconcile_odoo_links');
    assertEquals(calls.map((c) => c.bodyJson), [{ p_org_id: ORG }]);
    const lastPage = r.calls.map((c) => c.url.pathname === '/rest/v1/rpc/apply_odoo_master_page').lastIndexOf(true);
    assert(lastPage >= 0 && lastPage < r.calls.indexOf(calls[0]));
  });

  it('a tick that cannot reach Odoo still reconciles from the mirror it already holds', async () => {
    const r = await sweep({ rejectAfter: 0 });
    assertEquals('ok' in r.result && r.result.failed, 'key-rejected');
    assertEquals(rpcCall(r.calls, 'reconcile_odoo_links').length, 1);
  });

  it('a setup step whose store read fails does not skip the reconciliation after it', async () => {
    const r = await sweep({ runError: true });
    assertEquals(rpcCall(r.calls, 'reconcile_odoo_links').length, 1);
  });

  it('a reconcile that fails does not fail the tick: the connection state is still stored and the lock released', async () => {
    const r = await sweep({ reconcileError: true });
    assertEquals('ok' in r.result && r.result.failed, undefined);
    assertEquals(stored(r.calls)?.connection.state, 'healthy');
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });
});

describe('odooSweep — #1504 S8-T4 accepted sends run after the passes', () => {
  const party = (n: number) => ({ id: `prop-${n}`, kind: 'party', pmo_ids: [`c-${n}`], decided_by: 'admin-1', snapshot: {} });
  const claims = (calls: FetchCall[]) => rpcCall(calls, 'claim_connect_sends').map((c) => c.bodyJson as { p_org_id: string; p_tier: string; p_limit: number });

  it('AC-ECA-010 an accepted vendor is created in Odoo and recorded only through the result RPC; the queue is asked first', async () => {
    const r = await sweep({ claimed: [party(1)] });
    assertEquals(r.fake.rows('res.partner').map((p) => p.ref), ['pmo:c-1']);
    assertEquals(rpcCall(r.calls, 'record_connect_send_result').map((c) => [(c.bodyJson as { p_id: string }).p_id, (c.bodyJson as { p_rejection: unknown }).p_rejection]), [['prop-1', null]]);
    const names = r.calls.filter((c) => c.url.pathname.startsWith('/rest/v1/rpc/')).map((c) => c.url.pathname.split('/').pop());
    assert(names.indexOf('enqueue_new_item_sends') >= 0 && names.indexOf('enqueue_new_item_sends') < names.indexOf('claim_connect_sends'), names.join());
    const claim = claims(r.calls)[0];
    assertEquals([claim.p_org_id, claim.p_tier, claim.p_limit > 0 && claim.p_limit <= 10], [ORG, 'odoo', true]);
  });

  it('a tick whose budget only fits some sends claims only that many (three Odoo calls each) and reads no more than its cap', async () => {
    const r = await sweep({ claimed: [1, 2, 3, 4, 5, 6].map(party) }, { maxCalls: 60 });
    const sentRows = r.fake.rows('res.partner').length;
    const limit = claims(r.calls)[0].p_limit;
    assert(limit > 0 && limit <= 10, String(limit));
    assert(odoo(r.calls).length <= 60, `${odoo(r.calls).length} Odoo calls`);
    assert(sentRows <= limit && sentRows > 0);
  });

  it('what the sends did not use is given back: a tick with nothing to send spends the same calls as before sends existed', async () => {
    const without = await sweep({});
    assert('ok' in without.result);
    const r = await sweep({ claimed: [] });
    assertEquals('ok' in r.result && r.result.calls, 'ok' in without.result && without.result.calls);
  });

  it('the sends run when the directory pass failed, and never fail the tick', async () => {
    const r = await sweep({ claimed: [party(1)], rejectAfter: 0 });
    assertEquals('ok' in r.result && r.result.failed, 'key-rejected');
    assertEquals(claims(r.calls).length, 1);
    assertEquals(rpcCall(r.calls, 'record_connect_send_result').length, 0);   // the key is gone: the row waits, it is not rejected
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });

  it('a send pass that cannot read its claim does not fail the tick', async () => {
    const h = harness({ claimed: [party(1)] });
    const routes = h.routes.map((rt) => (rt.label === 'rpc:claim_connect_sends' || String(rt.pathname).endsWith('claim_connect_sends') ? { ...rt, response: () => jsonResponse({ code: 'XX000', message: 'x' }, { status: 500 }) } : rt));
    const r = await withFetchMock(routes, async ({ calls }) => ({ result: await sweepOdooOrg(client(), ORG), calls }));
    assertEquals('ok' in r.result && r.result.failed, undefined);
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });
});

describe('odooSweep — #1507 S3 ledger feed', () => {
  it('AC-ODA-001 an org that reads its ledger mirrors lines after the directory, refreshes actuals once, and reports counts only', async () => {
    const r = await sweep({ ledgerLines: 3 });
    const applyAt = r.calls.findIndex((call) => call.url.pathname === '/rest/v1/rpc/apply_odoo_ledger_page');
    const directory = r.calls.findIndex((call) => call.url.pathname === '/rest/v1/rpc/apply_odoo_master_page');
    assert(directory >= 0 && directory < applyAt, 'the ledger feed follows the directory it maps through');
    assertEquals(r.ledger.applied, 3);
    assertEquals(r.ledger.snapshots, 1);
    assertEquals('ok' in r.result && r.result.ledger, { rows: 3, caughtUp: true, skipped: 0 });
    assert(r.cursors.get('ledger:odoo'));
  });

  it('FR-ODA-001 an org whose snapshot did not find account.move.line readable reads no ledger line', async () => {
    const r = await sweep({ ledgerLines: 3, binding: binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: FRESH, missing: [], models: {}, later: {} } } }) });
    assertEquals(odooRequests(r.calls).filter((q) => q.model === 'account.move.line').length, 0);
    assertEquals([r.ledger.applied, 'ok' in r.result && r.result.ledger], [0, undefined]);
  });

  it('NFR-ODA-003 a 30,000-line backlog stays inside the tick budget, saves its cursor and leaves the directory kinds their share', async () => {
    const r = await sweep({ ledgerLines: 30_000 });
    assert(odoo(r.calls).length <= ODOO_SWEEP_TICK_MAX_CALLS, `${odoo(r.calls).length} Odoo calls`);
    for (const kind of ['warehouse', 'location', 'partner']) assert(r.cursors.get(`master:${kind}`), `${kind} got no budget`);
    assert('ok' in r.result && r.result.ledger && !r.result.ledger.caughtUp, 'the backlog is reported as not caught up');
    assert(r.cursors.get('ledger:odoo'), 'the cursor sits at the last applied page');
  });

  it('a ledger page the database refuses keeps the cursor, never fails the tick, and the setup step still runs', async () => {
    const r = await sweep({ ledgerLines: 3, failLedgerApply: true });
    assertEquals(r.cursors.get('ledger:odoo'), undefined);
    assertEquals('ok' in r.result && r.result.failed, undefined);
    assertEquals('ok' in r.result && r.result.ledger, undefined);
  });

  it('AC-ODA-003 an org nobody has switched to Odoo gets its lines mirrored and no actuals snapshot', async () => {
    const r = await sweep({ ledgerLines: 3, unswitched: true });
    assertEquals([r.ledger.applied, r.ledger.snapshots], [3, 0]);
    assertEquals('ok' in r.result && r.result.ledger, { rows: 3, caughtUp: true, skipped: 0 });
  });

  it('a company year end that cannot be read fails only the ledger pass: the tick is not failed and daily re-discovery still runs', async () => {
    const stale = binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: '2026-01-01T00:00:00Z', missing: [], models: {}, later: { 'account.move.line': true } } } });
    const r = await sweep({ ledgerLines: 3, failCompanyYearRead: true, binding: stale });
    assertEquals('ok' in r.result && r.result.failed, undefined);
    assertEquals('ok' in r.result && r.result.ledger, { rows: 0, caughtUp: false, skipped: 0, failed: 'server-error' });
    assertEquals(r.ledger.applied, 0);
    assert(r.fake.calls.some((c) => c.method === 'fields_get'), 're-discovery ran');
  });
});

