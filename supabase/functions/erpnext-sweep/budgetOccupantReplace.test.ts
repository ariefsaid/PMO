/**
 * AC-ECA-031 (FR-ECA-041, PD-ECA-12) — a replace of an unowned ERP Budget that the SWEEP finishes (outbox recovery after
 * a foreground retry lost its response) spends the recorded consent, so `budget.occupant_replaced` is written and the
 * consent no longer reads "unused". Drives the SHIPPED `buildMoneyWriteDepsLive` + `dispatchMoneyWrite` of `./index.ts`
 * with `globalThis.fetch` mocked; the consent is read by the real adapter (service role, never from the payload).
 *
 * Verify: cd supabase/functions/erpnext-sweep && deno test budgetOccupantReplace.test.ts --config deno.json --allow-env --allow-net --allow-read
 */
import "../_shared/testing/publicErpDns.ts";
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { buildMoneyWriteDepsLive, dispatchMoneyWrite } = await import('./index.ts');
import { budgetAccountIdentity, budgetAccountPushKey } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

const ORG = '00000000-0000-4000-8000-0000000000aa';
const VERSION = '0b3e3333-0000-4000-8000-000000000001';
const PROJECT = '0b3e3333-0000-4000-8000-000000000002';
const ACTOR = '0b3e3333-0000-4000-8000-000000000003';
const CONSENT = '0b3e3333-0000-4000-8000-0000000000c1';
const FY = '2026';
const ACTIVATED = '2026-01-01T00:00:00.000Z';
const ACCOUNT = '5100 - Salary - Co';
const DESK = 'DESK-BUDGET';
const HOST = 'erp.sweep.test';
Deno.env.set('SWEEP_BENCH_KEY', 'test-key');
Deno.env.set('SWEEP_BENCH_SECRET', 'test-secret');
const ORG_BINDING = {
  orgId: ORG, siteUrl: `https://${HOST}`, secretRef: 'sweep-bench', company: 'Co',
  config: { company: 'Co', project_map: { [PROJECT]: 'ERP-PROJ-1' } }, ownedDomains: ['budget'], versionMajor: 16,
};
const identity = budgetAccountIdentity(VERSION, FY, ACCOUNT);
const command: AdapterCommand = {
  domain: 'budget', operation: 'create', idempotencyKey: budgetAccountPushKey(identity, ACTIVATED),
  record: {
    id: VERSION, erp_doc_kind: 'budget', projectId: PROJECT, fiscal_year: FY, outbox_identity: identity,
    erp_account: ACCOUNT, budget_intent: 'ensure', budget_predecessor: null, activated_at: ACTIVATED,
    project_start_date: '2026-02-01', project_end_date: '2026-11-30',
    line_items: [{ category: 'Labor', budgeted_amount: '90000.00', fiscal_year: FY }],
  } as never,
};
const pendingRow = {
  id: 'outbox-1', domain: 'budget', pmo_record_id: identity, idempotency_key: command.idempotencyKey,
  state: 'pending', external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null,
};
const DESK_DOC = {
  name: DESK, docstatus: 1, amended_from: null, owner: 'accountant@client.test', company: 'Co', project: 'ERP-PROJ-1',
  account: ACCOUNT, from_fiscal_year: FY, to_fiscal_year: FY, budget_amount: 50000000,
};

/** A service client holding one pending outbox row and (optionally) the consent naming DESK-BUDGET. */
function world(consents: Array<{ id: string; project_id: string }>) {
  const spent: Array<Record<string, unknown>> = [];
  const client = {
    from: (table: string) => {
      const eq: Record<string, unknown> = {};
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b, is: () => b, gte: () => b, in: () => b, order: () => b, limit: () => b,
        eq: (k: string, v: unknown) => { eq[k] = v; return b; },
        update: () => b, insert: () => b, upsert: () => b,
        maybeSingle: async () => {
          if (table === 'external_command_outbox') return { data: pendingRow, error: null };
          if (table === 'external_org_bindings') {
            return { data: { site_url: ORG_BINDING.siteUrl, version_major: 16, activated_at: '2026-01-01T00:00:00Z', config: ORG_BINDING.config }, error: null };
          }
          if (table === 'budget_occupant_consents') {
            return { data: consents.find((c) => c.project_id === eq.project_id) ?? null, error: null };
          }
          if (table === 'projects') return { data: { id: PROJECT, org_id: ORG }, error: null };
          return { data: null, error: null };
        },
        then: (resolve: (v: unknown) => void) => resolve({
          data: table === 'budget_category_account_map' ? [{ category: 'Labor', erp_account: ACCOUNT }] : [{ id: pendingRow.id }], error: null,
        }),
      };
      return b;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'consume_budget_occupant_consent') spent.push(args);
      if (fn === 'claim_outbox_for_commit') return { data: { ...pendingRow, state: 'committing', claim_generation: 1 }, error: null };
      return { data: 1, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, spent };
}

async function sweepPush(consents: Array<{ id: string; project_id: string }>) {
  const { client, spent } = world(consents);
  const writes: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') writes.push(`${method} ${url.pathname}`);
    const json = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
    if (url.pathname.includes('Fiscal')) return json([{ name: FY, year_start_date: '2026-01-01', year_end_date: '2026-12-31' }]);
    if (url.pathname === '/api/resource/Budget' && method === 'GET') return json([DESK_DOC]);
    return json({ ...DESK_DOC, name: url.pathname.split('/').pop() === 'Budget' ? 'BUDGET-2' : decodeURIComponent(url.pathname.split('/').pop() ?? ''), docstatus: 1 });
  }) as typeof fetch;
  try {
    const cache = new Map([[ORG, Promise.resolve({ apiKey: 'k', apiSecret: 's' })]]);
    let error: unknown = null;
    try {
      const deps = await buildMoneyWriteDepsLive(client, ORG_BINDING as never, { command, actorUserId: ACTOR, outboxRecordId: identity, persistPayload: true }, cache);
      deps.money.probeByRemarksKey = async () => null;
      await dispatchMoneyWrite(deps);
    } catch (e) { error = e; }
    return { spent, writes, error };
  } finally { globalThis.fetch = originalFetch; }
}

Deno.test('AC-ECA-031 a replace the sweep finishes spends the consent, recording the outbox row’s actor', async () => {
  const { spent, writes, error } = await sweepPush([{ id: CONSENT, project_id: PROJECT }]);
  assert(error === null, `the sweep push should land, got: ${String(error)}`);
  assert(writes.some((w) => w.includes(`/Budget/${DESK}`)), `the occupant was replaced through the push path, saw: ${writes.join(', ')}`);
  assert(spent.length === 1 && spent[0].p_id === CONSENT && spent[0].p_org_id === ORG && spent[0].p_actor_id === ACTOR,
    `the consent is spent once for the row's actor, saw: ${JSON.stringify(spent)}`);
});

Deno.test('AC-ECA-031 a sweep push with no consent for this project is refused and spends nothing', async () => {
  const { spent, writes, error } = await sweepPush([{ id: CONSENT, project_id: 'other-project' }]);
  assert((error as { code?: string } | null)?.code === 'budget-unowned-live-occupant', `expected the unowned-occupant refusal, got: ${String(error)}`);
  assert(writes.length === 0 && spent.length === 0, `no ERP write and no spend, saw: ${writes.join(', ')} / ${JSON.stringify(spent)}`);
});
