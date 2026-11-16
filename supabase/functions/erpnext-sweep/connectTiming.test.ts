import "../_shared/testing/publicErpDns.ts";

/**
 * #2149 Part A [Deno] — the connect run (8) and its sends (8b) spend the invocation's one deadline budget like every
 * other ERP try of the sweep: neither starts unless a full minimum try still fits, and their ERP client is the sweep's
 * budget transport, so an ERPNext that never answers during connect cannot carry the invocation past the function's
 * wall-clock cap. The organisation's lock is still released and the cycle still returns (the job summary is written
 * after it). A try the budget cut is our own stop: it is not counted against the run or the send.
 *
 * Drives the shipped handlers: `runErpSweepCycle` (index.ts), `advanceConnectRuns` (connectRun.ts) and
 * `drainConnectSends` (connectSends.ts); Supabase and the ERP are mocked over fetch.
 *
 * Verify: deno test -A --config supabase/functions/erpnext-sweep/deno.json supabase/functions/erpnext-sweep/connectTiming.test.ts
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { advanceConnectRuns } from './connectRun.ts';
import { drainConnectSends } from './connectSends.ts';
import { SWEEP_MIN_TRY_MS, SWEEP_OUTCOME_WRITE_MARGIN_MS, type OrgBinding, type SweepBudget } from './sweepShared.ts';
import { SWEEP_INVOCATION_DEADLINE_MS } from './sweepCadence.ts';
import { ERP_REQUEST_TIMEOUT_MS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle, STATEMENT_SWEEP_WALL_CLOCK_CAP_MS } = await import('./index.ts');
const env = installEdgeEnv();
afterAll(() => env.restore());

const ORG = 'org-a';
const ERP = 'erp.example.com';
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const LAST_TRY_START_MS = SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - SWEEP_MIN_TRY_MS;

interface Timer { ms: number; fire: () => void; cancelled: boolean }

/** The invocation's clock and the budget's timers, both fake. */
function fakeTime(startMs: number) {
  const clock = { now: startMs };
  const timers: Timer[] = [];
  const budget: SweepBudget = {
    deadlineAtMs: SWEEP_INVOCATION_DEADLINE_MS,
    nowMs: () => clock.now,
    setTimer: (fire, ms) => {
      const t = { ms, fire, cancelled: false };
      timers.push(t);
      return () => { t.cancelled = true; };
    },
  };
  return { clock, timers, budget };
}

/**
 * An ERPNext that never answers. If the budget armed a timer for this try, the fake clock runs to it and it fires
 * (the cut). Otherwise the try waits the client's own whole attempt: the clock runs 120 s and the request fails.
 */
function silentErp(t: ReturnType<typeof fakeTime>): MockRoute {
  return {
    label: 'silent-erp', host: ERP,
    response: (c: FetchCall) => new Promise<Response>((_resolve, reject) => {
      c.signal.addEventListener('abort', () => reject(c.signal.reason));
      const armed = t.timers.find((x) => !x.cancelled);
      if (armed) {
        t.clock.now += armed.ms;
        armed.fire();
      } else {
        t.clock.now += ERP_REQUEST_TIMEOUT_MS;
        reject(new TypeError('the client gave up on this attempt'));
      }
    }),
  };
}

function supabaseRoutes(): MockRoute[] {
  // the send rides the outbox: a stateful row, so the send reaches its ERP try
  const outbox: Array<Record<string, unknown>> = [];
  const eq = (c: FetchCall, k: string) => c.url.searchParams.get(k)?.replace(/^eq\./, '');
  return [
    supabaseSelect('external_command_outbox', (c) => {
      const row = outbox.find((x) => x.idempotency_key === eq(c, 'idempotency_key'));
      return row ? one(row) : new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
    { label: 'outbox-insert', method: 'POST', pathname: '/rest/v1/external_command_outbox', response: (c: FetchCall) => {
      const b = c.bodyJson as Record<string, unknown>;
      const row = { id: `ob-${outbox.length + 1}`, domain: b.domain, pmo_record_id: b.pmo_record_id, idempotency_key: b.idempotency_key, state: 'pending', external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null };
      outbox.push(row);
      return one(row);
    } },
    { label: 'outbox-update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox', response: (c: FetchCall) => {
      const row = outbox.find((x) => x.id === eq(c, 'id'))!;
      Object.assign(row, c.bodyJson);
      return jsonResponse([{ id: row.id }]);
    } },
    supabaseRpc('claim_outbox_for_commit', (c) => {
      const row = outbox.find((x) => x.id === (c.bodyJson as { p_id: string }).p_id)!;
      Object.assign(row, { state: 'committing', claim_generation: Number(row.claim_generation) + 1 });
      return jsonResponse(row);
    }),
    supabaseSelect('external_org_bindings', () => one({ site_url: `https://${ERP}`, secret_ref: 'ref', status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { company: 'Example Co' } })),
    supabaseRpc('read_vault_secret', () => jsonResponse('key:secret')),
    supabaseSelect('erp_connect_runs', () => one({ id: 'run-a', state: 'staging', cursor: {}, proposed_kinds: [], started_at: new Date().toISOString() })),
    supabaseRpc('fail_connect_run', () => jsonResponse('staging')),
    supabaseRpc('stage_connect_master_page', () => jsonResponse(null)),
    supabaseRpc('enqueue_new_item_sends', () => jsonResponse(0)),
    supabaseRpc('claim_connect_sends', () => jsonResponse([{ id: 'send-1', kind: 'party', pmo_ids: ['c-1'], decided_by: 'admin-1', snapshot: {}, org_id: ORG, external_tier: 'erpnext', state: 'sending', outcome: 'send' }])),
    supabaseRpc('connect_send_existing_link', () => jsonResponse(null)),
    supabaseSelect('companies', () => one({ id: 'c-1', name: 'Example Vendor', type: 'Vendor', erp_tax_id: null })),
    supabaseSelect('profiles', () => one({ id: 'admin-1' })),
    supabaseRpc('record_connect_send_failure', () => jsonResponse(false)),
    supabaseRpc('record_connect_send_result', () => jsonResponse(null)),
    supabaseRpc('record_connect_send_held', () => jsonResponse(null)),
  ];
}

const binding = (budget?: SweepBudget): OrgBinding => ({
  orgId: ORG, bindingId: 'binding-a', siteUrl: `https://${ERP}`, secretRef: 'ref', company: 'Example Co', config: {}, versionMajor: 16,
  ownedDomains: [], lastFullSweepAt: null, ...(budget ? { sweepBudget: budget } : {}),
} as OrgBinding);

const serviceClient = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

describe('#2149 the connect run and its sends spend the invocation budget', () => {
  it('an ERPNext that never answers during connect leaves the invocation inside its cap; the lock is released and the cycle returns', async () => {
    const t = fakeTime(100_000); // the connect run starts late in the invocation, after other organisations' work
    const sc = serviceClient();
    const log: string[] = [];
    const result = await withFetchMock([...supabaseRoutes(), silentErp(t)], async ({ calls }) => {
      const cycle = await runErpSweepCycle({
        listEmployingOrgs: () => Promise.resolve([binding()]),
        nowMs: () => t.clock.now,
        invocationDeadlineAtMs: SWEEP_INVOCATION_DEADLINE_MS,
        claimStatementLock: () => Promise.resolve(true),
        releaseStatementLock: () => { log.push(`release@${t.clock.now}`); return Promise.resolve(); },
        reconcileOrgOutbox: () => Promise.resolve({ errors: [] } as never),
        // the sweep's own budget, with the test's fake timers
        advanceConnectRun: (o) => { o.sweepBudget = { ...o.sweepBudget!, setTimer: t.budget.setTimer }; log.push('connect'); return advanceConnectRuns(sc, o); },
        drainConnectSends: (o) => { log.push(`sends@${t.clock.now}`); return drainConnectSends(sc, o); },
        sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
        feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0 } as never),
        refreshOrgAccounting: () => Promise.resolve({}),
      }, undefined, 'money-only');
      return { cycle, calls };
    });
    assert(t.clock.now <= SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS, `the connect try ended by the deadline minus the outcome margin: ${t.clock.now}`);
    assert(t.clock.now < STATEMENT_SWEEP_WALL_CLOCK_CAP_MS, 'inside the wall-clock cap');
    assertEquals(log.filter((l) => l.startsWith('sends')), [], 'no send starts once no full try fits');
    assertEquals(log.at(-1), `release@${t.clock.now}`, 'the lock is released');
    assertEquals(result.cycle.perOrg.length, 1, 'the cycle returns its per-organisation report');
    assertEquals(rpcCall(result.calls, 'fail_connect_run').length, 0, 'the budget\'s own cut is not counted against the run');
  });

  it('neither connect step starts once a full minimum try no longer fits', async () => {
    const t = fakeTime(LAST_TRY_START_MS + 1);
    const started: string[] = [];
    await runErpSweepCycle({
      listEmployingOrgs: () => Promise.resolve([binding()]),
      nowMs: () => t.clock.now,
      invocationDeadlineAtMs: SWEEP_INVOCATION_DEADLINE_MS,
      reconcileOrgOutbox: () => Promise.resolve({ errors: [] } as never),
      advanceConnectRun: () => { started.push('connect'); return Promise.resolve({}); },
      drainConnectSends: () => { started.push('sends'); return Promise.resolve({}); },
      sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
      feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0 } as never),
      refreshOrgAccounting: () => Promise.resolve({}),
    }, undefined, 'money-only');
    assertEquals(started, []);
    t.clock.now = LAST_TRY_START_MS; // exactly one minimum try fits: both may start
    await runErpSweepCycle({
      listEmployingOrgs: () => Promise.resolve([binding()]),
      nowMs: () => t.clock.now,
      invocationDeadlineAtMs: SWEEP_INVOCATION_DEADLINE_MS,
      reconcileOrgOutbox: () => Promise.resolve({ errors: [] } as never),
      advanceConnectRun: () => { started.push('connect'); return Promise.resolve({}); },
      drainConnectSends: () => { started.push('sends'); return Promise.resolve({}); },
      sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
      feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0 } as never),
      refreshOrgAccounting: () => Promise.resolve({}),
    }, undefined, 'money-only');
    assertEquals(started, ['connect', 'sends']);
  });

  it('a connect run\'s ERP try gets the time left minus the outcome margin; the cut is not counted against the run and does not mark the organisation silent', async () => {
    const t = fakeTime(100_000);
    const org = binding(t.budget);
    const { result, calls } = await withFetchMock([...supabaseRoutes(), silentErp(t)], async ({ calls }) => ({ result: await advanceConnectRuns(serviceClient(), org), calls }));
    assertEquals(t.timers.map((x) => x.ms), [SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - 100_000]);
    assertEquals(result, { state: 'more' });
    assertEquals(rpcCall(calls, 'fail_connect_run').length, 0);
    assertEquals(org.erpUnanswered, undefined);
  });

  it('a connect run\'s try the ERP never answers (the client\'s own deadline) is counted and marks the organisation silent', async () => {
    const t = fakeTime(0); // the full cap is left: the client's own deadline is the whole bound, no budget timer
    const org = binding(t.budget);
    const { calls } = await withFetchMock([...supabaseRoutes(), silentErp(t)], async ({ calls }) => ({ result: await advanceConnectRuns(serviceClient(), org), calls }));
    assertEquals(t.timers.length, 0);
    assertEquals(rpcCall(calls, 'fail_connect_run').length, 1);
    assertEquals(org.erpUnanswered, true);
  });

  it('a send\'s ERP try gets the time left minus the outcome margin; the cut leaves the send waiting, not counted', async () => {
    const t = fakeTime(100_000);
    const org = binding(t.budget);
    const { result, calls } = await withFetchMock([...supabaseRoutes(), silentErp(t)], async ({ calls }) => ({ result: await drainConnectSends(serviceClient(), org), calls }));
    assert(t.timers.length >= 1 && t.timers[0]!.ms === SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - 100_000, `the send's try is budgeted: ${JSON.stringify(t.timers.map((x) => x.ms))}`);
    assertEquals(result.pending, 1);
    assertEquals(rpcCall(calls, 'record_connect_send_failure').length, 0);
    assert(t.clock.now <= SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS, `ended inside the budget: ${t.clock.now}`);
  });
});
