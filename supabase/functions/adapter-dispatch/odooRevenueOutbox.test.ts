// #1506 O3 C2 (FR-OCI-001, PD-4, DD-OCI-1, ADR-0058 C-1, NFR-OCI-001): a tier-odoo revenue command goes through the SAME money outbox as the
// ERPNext tier. The Odoo tier's deps are the shipped module's: the anchor key follows the PMO record (`si:` / `ip:`), a record id that is not a
// UUID cannot reach Odoo, both revenue anchors are composite hold-on-doubt so a recovery that finds nothing is HELD and never reissued, and a
// connection that cannot be used is refused before any outbox row. Odoo and Supabase are mocked over fetch.
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { resolveOdooMoneyOutboxDeps } from './odooMoneyOutbox.ts';
import { odooRevenueAnchorKey } from './odooRevenueOutbox.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';

const env = installEdgeEnv();
globalThis.addEventListener('unload', () => env.restore());

const ORG = '0d000000-0000-4000-8000-000000000006';
const REC = '123e4567-e89b-12d3-a456-426614174000';
const KEY = 'cccccccc-cccc-4ccc-8ccc-0000000015ff';
const objectResponse = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const BINDING = { id: 'b0000000-0000-4000-8000-000000000001', site_url: 'https://odoo.example.test', secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { database: 'db1', odoo_company_id: 1 } };

function setup(kind: string, over: { id?: string; binding?: Record<string, unknown> | null; operation?: string } = {}) {
  const routes: MockRoute[] = [
    supabaseSelect('external_org_bindings', () => over.binding === null ? new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }) : objectResponse({ ...BINDING, ...over.binding })),
    supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
  ];
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ctx = {
    orgId: ORG, serviceClient: sc, userId: 'u-1', faultGate: {}, erpAuth: {},
    command: { domain: 'revenue', operation: over.operation ?? 'create', idempotencyKey: KEY, record: { id: over.id ?? REC, erp_doc_kind: kind, customerId: 'c-1' } },
  } as unknown as AdapterSelectContext;
  return { routes, ctx };
}

describe('PD-4 the revenue anchor key follows the PMO record, never the per-click key', () => {
  it('derives one key per kind', () => {
    assertEquals(odooRevenueAnchorKey('sales-invoice', { id: REC }), `si:${REC}`);
    assertEquals(odooRevenueAnchorKey('incoming-payment', { id: REC }), `ip:${REC}`);
  });
  it('a record id that is not a UUID is refused', () => {
    for (const id of ['inv-1', '', undefined, `${REC}x`, "1' or '1'='1"]) {
      let thrown: unknown;
      try { odooRevenueAnchorKey('sales-invoice', { id }); } catch (error) { thrown = error; }
      assert(thrown instanceof Error && (thrown as { code?: string }).code === 'commit-rejected', String(id));
    }
  });
});

describe('FR-OCI-001 / ADR-0058 the Odoo revenue deps are the shared money outbox, held on doubt', () => {
  for (const kind of ['sales-invoice', 'incoming-payment']) {
    it(`NFR-OCI-001 a ${kind} is never reissued on an inconclusive recovery (composite hold-on-doubt, C-1)`, async () => {
      const t = setup(kind);
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        assertEquals(deps.reissueOnInconclusiveAbsence, false);
        assertEquals(typeof deps.payloadDigest, 'string');
        // until the adapter's recovery arrives a probe holds the row: an unconfirmed outcome is never reported as success
        await assertRejects(() => deps.probeByRemarksKey('revenue', KEY), Error, 'odoo-revenue-recovery-unavailable');
      });
    });
  }

  it('a revenue kind Odoo does not push (or none) is refused before any outbox row', async () => {
    for (const kind of ['credit-note', 'sales-order', 'undefined']) {
      const t = setup(kind);
      await withFetchMock(t.routes, async () => {
        await assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx), Error, 'is not wired');
      });
    }
  });

  it('a delete is refused: Odoo documents are not deleted through the seam', async () => {
    const t = setup('sales-invoice', { operation: 'delete' });
    await withFetchMock(t.routes, async () => { await assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx), Error, 'does not support delete'); });
  });

  it('a record id that is not a UUID is refused before the connection is even read', async () => {
    const t = setup('incoming-payment', { id: 'rcpt-1' });
    await withFetchMock(t.routes, async ({ calls }) => {
      await assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx), Error, 'revenue-record-id-invalid');
      assertEquals(calls.length, 0);
    });
  });

  it('a connection that cannot be used is refused (config-rejected), not guessed', async () => {
    for (const binding of [null, { activated_at: null }] as const) {
      const t = setup('sales-invoice', { binding });
      await withFetchMock(t.routes, async () => { await assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx), Error, 'The Odoo connection is not usable'); });
    }
  });
});
