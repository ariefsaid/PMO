/**
 * [Deno] A quarantined procurement create whose recovery probe finds nothing is reissued as a NEW ERP document. Before
 * that reissue the sweep asks the org's CURRENT purchase rules again (`procurement_create_refusal`, the question the
 * outbox claim asks of pending and failed rows): a rule turned on after the command was queued holds the row for an
 * operator with a named reason, and nothing reaches ERP. Drives the SHIPPED `buildMoneyWriteDepsLive` through the real
 * `dispatchMoneyWrite`, with a stubbed service client and a stubbed `globalThis.fetch`.
 *
 * Verify: cd supabase/functions/erpnext-sweep && deno test queuedProcurementReissue.test.ts --config deno.json --allow-env --allow-net --allow-read
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { buildMoneyWriteDepsLive } = await import('./index.ts');
import { dispatchMoneyWrite } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ORDER = '00000000-0000-4000-8000-0000000000cc';
const PURCHASE = '00000000-0000-4000-8000-0000000000dd';
const ACTOR = '00000000-0000-4000-8000-0000000000ee';
const KEY = '7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ERP_HOST = 'erp.example.test';

const org = {
  orgId: ORG, siteUrl: `https://${ERP_HOST}`, secretRef: 'unused-cache-supplies-the-pair',
  company: 'PMO Smoke Co', config: {}, ownedDomains: ['procurement'], versionMajor: 15,
};
const cache = () => new Map([[ORG, Promise.resolve({ apiKey: 'k', apiSecret: 's' })]]);

const command: AdapterCommand = {
  domain: 'procurement',
  operation: 'create',
  record: { id: ORDER, erp_doc_kind: 'purchase-order', procurementId: PURCHASE, supplier: 'Supplier A', items: [{ item_code: 'ITEM-1', qty: 1, rate: 100 }] } as never,
  idempotencyKey: KEY,
};

/** Past its quarantine window: the claim wins, the probe runs, and a miss would reissue. */
const quarantinedRow = {
  id: 'outbox-1', domain: 'procurement', pmo_record_id: ORDER, idempotency_key: KEY,
  state: 'quarantined', external_record_id: null, canonical: null, claim_generation: 3, payload_digest: null,
};
const bindingRow = { site_url: org.siteUrl, version_major: 15, activated_at: '2026-01-01T00:00:00Z', config: { company: 'PMO Smoke Co' } };

/** The service client: one quarantined row; the purchase rule answers `refusal`; records RPCs and their args. */
function fakeServiceClient(refusal: string | null) {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    from: (table: string) => {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b, eq: () => b, in: () => b, is: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => ({
          data: table === 'external_command_outbox' ? quarantinedRow
            : table === 'external_org_bindings' ? bindingRow
            : table === 'procurements' ? { id: PURCHASE, org_id: ORG }
            : null,
          error: null,
        }),
        update: () => b, insert: () => b, upsert: () => b,
        then: (resolve: (v: unknown) => void) => resolve({ data: [{ id: quarantinedRow.id }], error: null }),
      };
      return b;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === 'claim_outbox_for_commit') return { data: { ...quarantinedRow, state: 'committing', claim_generation: 4 }, error: null };
      if (fn === 'domain_owned_by_tier') return { data: true, error: null };
      if (fn === 'actor_authorization_state') return { data: { role: 'Finance', active: true }, error: null };
      if (fn === 'procurement_create_refusal') return { data: refusal, error: null };
      return { data: 1, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, rpcs };
}

async function drive(client: SupabaseClient): Promise<{ error: unknown; erpRequests: string[] }> {
  const originalFetch = globalThis.fetch;
  const originalResolveDns = Deno.resolveDns;
  const erpRequests: string[] = [];
  Deno.resolveDns = ((_h: string, t: string) => t === 'A' ? Promise.resolve(['203.0.113.10']) : Promise.reject(new Deno.errors.NotFound('no record'))) as typeof Deno.resolveDns;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (input instanceof Request ? input.method : init?.method) ?? 'GET';
    if (url.hostname === ERP_HOST) erpRequests.push(`${method} ${url.pathname}`);
    return Promise.resolve(new Response(JSON.stringify({ exc_type: 'ValidationError' }), { status: 417 }));
  }) as typeof fetch;
  try {
    const deps = await buildMoneyWriteDepsLive(client, org, { command, actorUserId: ACTOR, outboxRecordId: ORDER, persistPayload: false }, cache());
    // The recovery probe finds nothing, so the next step would mint a new ERP document.
    deps.money.probeByRemarksKey = async () => null;
    try {
      await dispatchMoneyWrite(deps);
      return { error: null, erpRequests };
    } catch (error) {
      return { error, erpRequests };
    }
  } finally {
    globalThis.fetch = originalFetch;
    Deno.resolveDns = originalResolveDns;
  }
}

Deno.test('a quarantined order reissue is held when the org now requires an approval before an order', async () => {
  const { client, rpcs } = fakeServiceClient('gate_approval_before_order');
  const { error, erpRequests } = await drive(client);
  assert((error as { code?: string } | null)?.code === 'command-held', `expected the row to be held, got: ${String(error)}`);
  assert(erpRequests.length === 0, `nothing may reach ERP, saw: ${erpRequests.join(', ')}`);
  const asked = rpcs.find((c) => c.fn === 'procurement_create_refusal');
  assert(asked !== undefined, 'the purchase rules were asked before the reissue');
  assert(asked!.args.p_org_id === ORG && asked!.args.p_procurement_id === PURCHASE && asked!.args.p_erp_doc_kind === 'purchase-order'
    && asked!.args.p_actor_user_id === ACTOR, `the question names this org, purchase, kind and recorded actor: ${JSON.stringify(asked!.args)}`);
  const held = rpcs.find((c) => c.fn === 'mark_outbox_held');
  assert(held !== undefined && String(held.args.p_reason).includes('purchase rule refused: gate_approval_before_order'),
    `the hold carries the named reason: ${JSON.stringify(held?.args)}`);
});

Deno.test('control: a reissue the purchase rules allow goes on to ERP', async () => {
  const { client, rpcs } = fakeServiceClient(null);
  const { erpRequests } = await drive(client);
  assert(rpcs.some((c) => c.fn === 'procurement_create_refusal'), 'the purchase rules were asked');
  assert(!rpcs.some((c) => c.fn === 'mark_outbox_held'), 'an allowed reissue is not held');
  assert(erpRequests.length > 0, `an allowed reissue reaches ERP, or the refusal test above proves nothing (saw ${erpRequests.length})`);
});
