/**
 * [Deno] The sweep's money-write adapter must refuse an ERP site whose hostname does not resolve to a
 * public address. Drives the SHIPPED `buildMoneyWriteDepsLive` (the deps every sweep money write is
 * dispatched with) through the real `dispatchMoneyWrite`, with a stubbed resolver and a stubbed
 * `globalThis.fetch`. The recovery probe is replaced by a conclusive "nothing there" so the flow reaches
 * the POST site, which is the call this suite pins (the probe client has its own guard).
 *
 * Verify: cd supabase/functions/erpnext-sweep && deno test sweepDestinationGuard.test.ts --config deno.json --allow-env --allow-net --allow-read
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
const INVOICE = '00000000-0000-4000-8000-0000000000cc';
const KEY = '5f7d2b1e-0c3a-4a9e-9f10-2b6c8d4e1a77';
const ERP_HOST = 'erp.example.test';

const org = {
  orgId: ORG, siteUrl: `https://${ERP_HOST}`, secretRef: 'unused-cache-supplies-the-pair',
  company: 'PMO Smoke Co', config: {}, ownedDomains: ['revenue'], versionMajor: 15,
};
const cache = () => new Map([[ORG, Promise.resolve({ apiKey: 'k', apiSecret: 's' })]]);

const command: AdapterCommand = {
  domain: 'revenue',
  operation: 'create',
  record: { id: INVOICE, erp_doc_kind: 'sales-invoice', customer: 'Customer A', items: [{ item_code: 'ITEM-1', qty: 1, rate: 100 }] } as never,
  idempotencyKey: KEY,
};

const pendingRow = {
  id: 'outbox-1', domain: 'revenue', pmo_record_id: INVOICE, idempotency_key: KEY,
  state: 'pending', external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null,
};

/** The stored ERP binding the adapter factory reads: the site URL is what the destination check is run against. */
const bindingRow = { site_url: org.siteUrl, version_major: 15, activated_at: '2026-01-01T00:00:00Z', config: { company: 'PMO Smoke Co' } };

/** A service client whose outbox holds ONE pending row; records every table write and every RPC. */
function fakeServiceClient() {
  const writes: string[] = [];
  const rpcs: string[] = [];
  const client = {
    from: (table: string) => {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({
          data: table === 'external_command_outbox' ? pendingRow
            : table === 'external_org_bindings' ? bindingRow
            : null,
          error: null,
        }),
        update: (patch: Record<string, unknown>) => { writes.push(`${table}.update:${String(patch.state ?? '')}`); return b; },
        insert: () => { writes.push(`${table}.insert`); return b; },
        upsert: () => { writes.push(`${table}.upsert`); return b; },
        // A fenced write-back that lands reports the one row it touched.
        then: (resolve: (v: unknown) => void) => resolve({ data: [{ id: pendingRow.id }], error: null }),
      };
      return b;
    },
    rpc: async (fn: string) => {
      rpcs.push(fn);
      if (fn === 'claim_outbox_for_commit') return { data: { ...pendingRow, state: 'committing', claim_generation: 1 }, error: null };
      return { data: 1, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, writes, rpcs };
}

async function withNetwork<T>(
  dns: string,
  run: (erpRequests: string[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalResolveDns = Deno.resolveDns;
  const erpRequests: string[] = [];
  Deno.resolveDns = ((_host: string, recordType: string) =>
    recordType === 'A' ? Promise.resolve([dns]) : Promise.reject(new Deno.errors.NotFound('no record'))) as typeof Deno.resolveDns;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === ERP_HOST) erpRequests.push(url.pathname);
    return Promise.resolve(new Response(JSON.stringify({ exc_type: 'ValidationError' }), { status: 417 }));
  }) as typeof fetch;
  try {
    return await run(erpRequests);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.resolveDns = originalResolveDns;
  }
}

async function drive(client: SupabaseClient): Promise<unknown> {
  const deps = await buildMoneyWriteDepsLive(client, org, { command, actorUserId: null, outboxRecordId: INVOICE, persistPayload: false }, cache());
  // Conclusive "no document yet" so the flow reaches the adapter (the probe client is guarded separately).
  deps.money.probeByRemarksKey = async () => null;
  try {
    await dispatchMoneyWrite(deps);
    return null;
  } catch (error) {
    return error;
  }
}

Deno.test('sweep refuses ERP writes to a non-public destination', async () => {
  const { client, writes, rpcs } = fakeServiceClient();
  await withNetwork('10.0.0.5', async (erpRequests) => {
    const error = await drive(client);
    assert((error as { code?: string } | null)?.code === 'destination_not_permitted', `expected the destination refusal, got: ${String(error)}`);
    assert(erpRequests.length === 0, `no request may reach the ERP host, saw: ${erpRequests.join(', ')}`);
  });
  assert(rpcs.includes('claim_outbox_for_commit'), 'the write was attempted (claimed) before the destination was refused');
  // Left in flight and reclaimable: nothing marked failed/committed, no mirror or ref, no confirm.
  assert(writes.length === 0, `no outbox or mirror write may follow a refused destination, saw: ${writes.join(', ')}`);
  assert(!rpcs.includes('confirm_outbox') && !rpcs.includes('record_outbox_ref') && !rpcs.includes('mark_outbox_held'),
    `the row must not be confirmed, referenced or held, saw: ${rpcs.join(', ')}`);
});

Deno.test('sweep reaches the ERP host when the destination is public (control)', async () => {
  const { client } = fakeServiceClient();
  await withNetwork('203.0.113.10', async (erpRequests) => {
    await drive(client);
    assert(erpRequests.length > 0, 'a public destination must reach the ERP host, or the refusal test above proves nothing');
  });
});
