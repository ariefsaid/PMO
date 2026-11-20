/**
 * AC-ECX-040 (#1599 ECX-5) — the shipped sweep keeps the ERP one fiscal year ahead.
 * Uses immutable intent identity, fenced outbox reservation and single-POST guarantee.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import {
  installEdgeEnv,
  jsonResponse,
  type MockRoute,
  rpcCall,
  supabaseRpc,
  withFetchMock,
  type FetchCall,
} from '../_shared/testing/edgeTestKit.ts';
import {
  fakeFiscalYearErp,
  type FakeYear,
} from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fakeFiscalYearErp.ts';

// importing the sweep entry point would start its HTTP server; stub Deno.serve as in other sweep suites
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle, ensureOrgFiscalYearLive, utcDay, reconcileOrgOutbox } = await import('./index.ts');
const env = installEdgeEnv();
afterAll(() => env.restore());

const HOST = 'erp.example.com';
const COMPANY = 'ECX Probe Co';
const DEC_1 = Date.parse('2026-12-01T09:00:00Z');

function world(
  seed: FakeYear[],
  opts: {
    denyCreate?: boolean;
    denyRead?: boolean;
    initialConfig?: Record<string, unknown>;
    initialIntents?: Array<Record<string, unknown>>;
    initialOutbox?: Array<Record<string, unknown>>;
  } = {},
) {
  const fake = fakeFiscalYearErp(seed, { companies: [COMPANY, 'Other Co'], host: HOST });
  if (opts.denyCreate) fake.denyCreate();
  if (opts.denyRead) fake.denyRead();
  const settled: string[] = [];
  let company = COMPANY;
  const binding = {
    config: {
      company: COMPANY,
      default_payable_account: 'Creditors - ECX',
      ...(opts.initialConfig ?? {}),
    } as Record<string, unknown>,
  };

  const intents: Array<Record<string, unknown>> = [...(opts.initialIntents ?? [])];
  const outbox: Array<Record<string, unknown>> = [...(opts.initialOutbox ?? [])];
  let outboxGen = outbox.length;
  let intentSeq = intents.length;

  const routes: MockRoute[] = [
    {
      label: 'intents-rest',
      pathname: '/rest/v1/erp_fiscal_year_intents',
      response: (call: FetchCall) => {
        if (call.method === 'GET') return jsonResponse(intents);
        return jsonResponse([]);
      },
    },
    {
      label: 'outbox-rest',
      pathname: '/rest/v1/external_command_outbox',
      response: (call: FetchCall) => {
        const accept = call.headers.get('accept') ?? '';
        if (call.method === 'POST') {
          outboxGen++;
          const body = (call.bodyJson ?? {}) as Record<string, unknown>;
          const row = {
            id: `00000000-0000-0000-0000-00000000020${outboxGen}`,
            claim_generation: outboxGen,
            state: 'pending',
            domain: 'fiscal_year_setup',
            external_record_id: null,
            canonical: null,
            last_error: null,
            payload_digest: null,
            ...body,
          };
          outbox.push(row);
          return accept.includes('vnd.pgrst.object+json') ? jsonResponse(row) : jsonResponse([row]);
        }
        if (call.method === 'PATCH') {
          const patch = (call.bodyJson ?? {}) as Record<string, unknown>;
          const id = call.url.searchParams.get('id')?.replace(/^eq\./, '');
          const row = outbox.find((r) => !id || r.id === id) ?? outbox[outbox.length - 1];
          if (row) {
            Object.assign(row, patch);
            return accept.includes('vnd.pgrst.object+json') ? jsonResponse(row) : jsonResponse([row]);
          }
          return jsonResponse([]);
        }
        if (call.method === 'GET') {
          const key = call.url.searchParams.get('idempotency_key')?.replace(/^eq\./, '');
          const pmoId = call.url.searchParams.get('pmo_record_id')?.replace(/^eq\./, '');
          const filtered = outbox.filter((r) => {
            if (key && r.idempotency_key !== key) return false;
            if (pmoId && r.pmo_record_id !== pmoId) return false;
            return true;
          });
          if (accept.includes('vnd.pgrst.object+json')) {
            return filtered[0] ? jsonResponse(filtered[0]) : jsonResponse(null, { status: 406 });
          }
          return jsonResponse(filtered);
        }
        return jsonResponse([]);
      },
    },
    supabaseRpc('claim_outbox_for_commit', (call: FetchCall) => {
      const body = call.bodyJson as { p_id: string };
      const row = outbox.find((r) => r.id === body.p_id);
      if (!row) return jsonResponse(null);
      row.state = 'committing';
      row.claim_generation = ((row.claim_generation as number) || 0) + 1;
      return jsonResponse(row);
    }),
    supabaseRpc('mark_outbox_committed', (call: FetchCall) => {
      const body = call.bodyJson as { p_id: string };
      const row = outbox.find((r) => r.id === body.p_id) ?? outbox[outbox.length - 1];
      if (row) row.state = 'committed';
      return jsonResponse(1);
    }),
    supabaseRpc('mark_outbox_held', (call: FetchCall) => {
      const body = call.bodyJson as { p_id: string };
      const row = outbox.find((r) => r.id === body.p_id) ?? outbox[outbox.length - 1];
      if (row) row.state = 'held';
      return jsonResponse(1);
    }),
    supabaseRpc('confirm_outbox', (call: FetchCall) => {
      const body = call.bodyJson as { p_id: string };
      const row = outbox.find((r) => r.id === body.p_id) ?? outbox[outbox.length - 1];
      if (row) row.state = 'confirmed';
      return jsonResponse(1);
    }),
    supabaseRpc('quarantine_committing', (call: FetchCall) => {
      const body = call.bodyJson as { p_id: string };
      const row = outbox.find((r) => r.id === body.p_id);
      if (row && row.state === 'committing') {
        row.state = 'quarantined';
        return jsonResponse(row);
      }
      return jsonResponse(null);
    }),
    supabaseRpc('prepare_fiscal_year_intent', () => {
      intentSeq++;
      const intentId = `00000000-0000-0000-0000-00000000010${intentSeq}`;
      intents.push({
        id: intentId,
        org_id: 'org-a',
        binding_id: 'binding-a',
        company,
        post_started_at: null,
      });
      return jsonResponse(intentId);
    }),
    supabaseRpc('begin_fiscal_year_post', (call: FetchCall) => {
      const body = call.bodyJson as { p_intent_id?: string };
      const intent = intents.find((i) => !body?.p_intent_id || i.id === body.p_intent_id) ?? intents[intents.length - 1];
      if (intent) intent.post_started_at = new Date().toISOString();
      return jsonResponse(true);
    }),
    supabaseRpc('record_fiscal_year_observation', (call: FetchCall) => {
      const body = call.bodyJson as { p_status: Record<string, unknown> };
      binding.config = { ...binding.config, fiscal_year: body.p_status };
      return jsonResponse(null);
    }),
    supabaseRpc('record_fiscal_year_status', (call: FetchCall) => {
      const body = call.bodyJson as { p_status: Record<string, unknown> };
      binding.config = { ...binding.config, fiscal_year: body.p_status };
      return jsonResponse(true);
    }),
    supabaseRpc('merge_external_org_binding_config', (call: FetchCall) => {
      const body = call.bodyJson as { p_patch: Record<string, unknown> };
      binding.config = { ...binding.config, ...body.p_patch };
      return jsonResponse(null);
    }),
    {
      label: 'erp-fiscal-year',
      host: HOST,
      pathname: /^\/api\/resource\/Fiscal%20Year/,
      response: (call: FetchCall) =>
        fake.fetchImpl(call.url.toString(), {
          method: call.method,
          ...(call.bodyText ? { body: call.bodyText } : {}),
        }),
    } satisfies MockRoute,
  ];

  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const client = {
    fetchImpl: (...a: Parameters<typeof fetch>) => fetch(...a),
    apiKey: 'k',
    apiSecret: 's',
    baseUrl: `https://${HOST}`,
    maxRetries: 0,
  };
  const org = () => ({
    orgId: 'org-a',
    bindingId: 'binding-a',
    siteUrl: `https://${HOST}`,
    secretRef: 'r',
    company,
    config: structuredClone(binding.config),
    versionMajor: 15,
    activatedAt: '2026-01-01T00:00:00Z',
    ownedDomains: [],
    lastFullSweepAt: null,
  });

  const tick = (nowMs: number, cadence: 'full' | 'money-only' = 'full') =>
    runErpSweepCycle(
      {
        listEmployingOrgs: () => Promise.resolve([org()]),
        reconcileOrgOutbox: () => Promise.resolve({ errors: [] } as never),
        sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
        feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0 } as never),
        refreshOrgAccounting: () => Promise.resolve({}),
        ensureOrgFiscalYear: (o, mode) => ensureOrgFiscalYearLive(sc, o, () => Promise.resolve(client), utcDay(nowMs), mode),
        markFullSweepDone: () => {
          settled.push('done');
          return Promise.resolve();
        },
        deferFullSweep: (_o, dueInSeconds) => {
          settled.push(`deferred:${dueInSeconds}`);
          return Promise.resolve();
        },
      },
      undefined,
      cadence,
    );

  return {
    fake,
    binding,
    routes,
    tick,
    settled,
    rebind: (next: string) => {
      company = next;
      binding.config = { ...binding.config, company: next };
    },
  };
}

const CAL_2026: FakeYear = { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] };

describe('AC-ECX-040 the sweep keeps the ERP one fiscal year ahead', () => {
  it('AC-ECX-040 given the year ends within 45 days and no next year exists, two sweeps leave exactly one next fiscal year', async () => {
    const w = world([CAL_2026]);
    await withFetchMock(w.routes, async ({ calls }) => {
      const first = await w.tick(DEC_1);
      assertEquals(first.perOrg[0].errors, []);
      // the next day's run looks the year up again and writes nothing
      const second = await w.tick(DEC_1 + 86_400_000);
      assertEquals(second.perOrg[0].errors, []);
      assertEquals(
        w.fake.years().filter((y) => y.start === '2027-01-01').map((y) => [y.name, y.end, y.companies]),
        [['2027', '2027-12-31', [COMPANY]]],
      );
      assertEquals(w.fake.writes().length, 1);
      const statusWrites = rpcCall(calls, 'record_fiscal_year_status').length + rpcCall(calls, 'record_fiscal_year_observation').length;
      assertEquals(statusWrites, 2);
    });
    assertEquals(w.binding.config.fiscal_year, {
      state: 'ready',
      checked_on: '2026-12-02',
      company: COMPANY,
      current: '2026',
      next: '2027',
    });
    // ECX-4 and sibling config preservation
    assertEquals(w.binding.config.default_payable_account, 'Creditors - ECX');
  });

  it('AC-ECX-040 a second sweep on the same day makes no ERP call', async () => {
    const w = world([CAL_2026]);
    await withFetchMock(w.routes, async ({ calls }) => {
      await w.tick(DEC_1);
      const before = calls.length;
      await w.tick(DEC_1 + 3_600_000);
      assertEquals(calls.length, before);
    });
  });

  it('AC-ECX-040 an existing global next year is used: nothing is created', async () => {
    const w = world([CAL_2026, { name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [] }]);
    await withFetchMock(w.routes, async () => {
      assertEquals((await w.tick(DEC_1)).perOrg[0].errors, []);
    });
    assertEquals(w.fake.writes(), []);
    assertEquals(w.binding.config.fiscal_year, {
      state: 'ready',
      checked_on: '2026-12-01',
      company: COMPANY,
      current: '2026',
      next: '2027',
    });
  });

  it('AC-ECX-040 a permission refusal is stored as an Operator task, not as a sweep error and not skipped', async () => {
    const w = world([CAL_2026], { denyCreate: true });
    await withFetchMock(w.routes, async () => {
      assertEquals((await w.tick(DEC_1)).perOrg[0].errors, []);
    });
    assertEquals(w.binding.config.fiscal_year, {
      state: 'needs-operator',
      checked_on: '2026-12-01',
      company: COMPANY,
      reason: 'missing-role',
    });
    assertEquals(w.fake.years().map((y) => y.name), ['2026']);
  });

  it("AC-ECX-040 a refusal is stored in the ERP's plain words, with no markup", async () => {
    const w = world([
      { ...CAL_2026, companies: [COMPANY] },
      { name: 'Other 2027', start: '2027-01-01', end: '2027-12-31', companies: ['Other Co'] },
    ]);
    await withFetchMock(w.routes, async () => {
      await w.tick(DEC_1);
    });
    const status = w.binding.config.fiscal_year as { state: string; message: string };
    assertEquals(status.state, 'refused');
    assert(/already set in Fiscal Year Other 2027/.test(status.message), status.message);
    assert(!/[<>]/.test(status.message));
  });

  it('AC-ECX-040 an unreachable ERP stores nothing and is reported, so a later tick retries', async () => {
    const w = world([CAL_2026]);
    w.fake.failNextWrite('transport');
    await withFetchMock(w.routes, async () => {
      const r = await w.tick(DEC_1);
      assertEquals(r.perOrg[0].errors.length, 1);
      assert(r.perOrg[0].errors[0].startsWith('fiscal-year:'));
      // the next hourly run tries again and succeeds
      assertEquals((await w.tick(DEC_1 + 3_600_000)).perOrg[0].errors, []);
    });
    assertEquals((w.binding.config.fiscal_year as { state: string }).state, 'ready');
  });

  it('AC-ECX-040 a fiscal-year error never marks the hourly run failed: the run is stamped done, not retried every few minutes', async () => {
    const w = world([CAL_2026]);
    w.fake.failNextWrite('transport');
    await withFetchMock(w.routes, async () => {
      const r = await w.tick(DEC_1);
      assert(r.perOrg[0].errors[0].startsWith('fiscal-year:'));
    });
    assertEquals(w.settled, ['done']);
  });

  it('AC-ECX-040 a 403 on the lookup is stored as the Operator task, the run is not failed, and it is not retried until the next day', async () => {
    const w = world([CAL_2026], { denyRead: true });
    await withFetchMock(w.routes, async ({ calls }) => {
      assertEquals((await w.tick(DEC_1)).perOrg[0].errors, []);
      const before = calls.length;
      assertEquals((await w.tick(DEC_1 + 3_600_000)).perOrg[0].errors, []);
      assertEquals(calls.length, before);
      await w.tick(DEC_1 + 86_400_000);
      assert(calls.length > before, 'the next daily pass checks again');
    });
    assertEquals(w.binding.config.fiscal_year, {
      state: 'needs-operator',
      checked_on: '2026-12-02',
      company: COMPANY,
      reason: 'missing-role',
    });
    assertEquals(w.settled, ['done', 'done', 'done']);
  });

  it('AC-ECX-040 an ERP refusal is stored and not retried the same day; the run is not failed', async () => {
    const w = world([
      { ...CAL_2026, companies: [COMPANY] },
      { name: 'ECX 2027 b', start: '2027-03-01', end: '2028-02-29', companies: [COMPANY] },
    ]);
    await withFetchMock(w.routes, async () => {
      assertEquals((await w.tick(DEC_1)).perOrg[0].errors, []);
      assertEquals((await w.tick(DEC_1 + 3_600_000)).perOrg[0].errors, []);
    });
    assertEquals(w.fake.writes().length, 1);
    const status = w.binding.config.fiscal_year as { state: string; message: string };
    assertEquals(status.state, 'refused');
    assert(/overlapping with ECX 2027 b/.test(status.message), status.message);
    assertEquals(w.settled, ['done', 'done']);
  });

  it('AC-ECX-040 more years than PMO decides on is stored as refused, not a failed run', async () => {
    const many: FakeYear[] = Array.from({ length: 50 }, (_, i) => ({
      name: `S${i}`,
      start: '2026-01-01',
      end: '2026-12-31',
      companies: [`C${i}`],
    }));
    const w = world(many);
    await withFetchMock(w.routes, async () => {
      assertEquals((await w.tick(DEC_1)).perOrg[0].errors, []);
    });
    assertEquals((w.binding.config.fiscal_year as { state: string }).state, 'refused');
    assertEquals(w.settled, ['done']);
  });

  it('AC-ECX-040 after the bound company changes, the new company is checked the same day', async () => {
    const w = world([CAL_2026], { denyCreate: true });
    await withFetchMock(w.routes, async () => {
      await w.tick(DEC_1);
      w.rebind('Other Co');
      assertEquals((await w.tick(DEC_1 + 3_600_000)).perOrg[0].errors, []);
    });
    assertEquals(w.binding.config.fiscal_year, {
      state: 'needs-operator',
      checked_on: '2026-12-01',
      company: 'Other Co',
      reason: 'missing-role',
    });
    assertEquals(
      w.fake.writes().map((x) => (x.companies as Array<{ company: string }>)[0].company),
      [COMPANY, 'Other Co'],
    );
  });

  it("AC-ECX-040 a disabled year on the next year's dates is stored as an Operator task naming it, never created around, not retried the same day", async () => {
    const w = world([
      CAL_2026,
      { name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [], disabled: true },
    ]);
    await withFetchMock(w.routes, async () => {
      assertEquals((await w.tick(DEC_1)).perOrg[0].errors, []);
      assertEquals((await w.tick(DEC_1 + 86_400_000)).perOrg[0].errors, []);
    });
    assertEquals(w.fake.writes(), []);
    assertEquals(w.binding.config.fiscal_year, {
      state: 'needs-operator',
      checked_on: '2026-12-02',
      company: COMPANY,
      reason: 'disabled-year',
      year: '2027',
    });
    assertEquals(w.fake.years().find((y) => y.name === '2027')?.disabled, true);
    assertEquals(w.settled, ['done', 'done']);
  });

  it('AC-ECX-040 a money-only tick does not run it', async () => {
    const w = world([CAL_2026]);
    await withFetchMock(w.routes, async ({ calls }) => {
      await w.tick(DEC_1, 'money-only');
      assertEquals(calls.length, 0);
    });
  });

  it('AC-ECX-040 fiscal outbox candidates skip generic reconcileOrgOutbox', async () => {
    let dispatched = false;
    const res = await reconcileOrgOutbox(
      () => Promise.resolve([{
        id: 'outbox-1',
        orgId: 'org-a',
        domain: 'fiscal_year_setup',
        pmoRecordId: 'intent-1',
        idempotencyKey: 'setup:fiscal-year:intent-1',
        state: 'pending',
        claimGeneration: 1,
        externalRecordId: null,
        canonical: null,
        payloadDigest: null,
      }]),
      { orgId: 'org-a', ownedDomains: ['fiscal_year_setup'] },
      () => ({} as never),
      (() => { dispatched = true; return Promise.resolve({} as never); }) as never,
    );
    assertEquals(res.reconciled, 0);
    assertEquals(res.errors, []);
    assertEquals(dispatched, false);
  });

  it('AC-ECX-040 daily marker cannot suppress committed/held recovery', async () => {
    const intentId = '00000000-0000-0000-0000-000000000101';
    const outboxId = '00000000-0000-0000-0000-000000000201';
    const w = world([CAL_2026], {
      initialConfig: {
        fiscal_year: {
          state: 'needs-operator',
          checked_on: '2026-12-01',
          company: COMPANY,
          reason: 'held',
          intentId,
        },
      },
      initialIntents: [
        {
          id: intentId,
          org_id: 'org-a',
          binding_id: '00000000-0000-0000-0000-000000000001',
          company: COMPANY,
          year_name: '2027',
          start_date: '2027-01-01',
          end_date: '2027-12-31',
          post_started_at: '2026-12-01T08:00:00Z',
          settled_at: null,
          created_at: '2026-12-01T08:00:00Z',
        },
      ],
      initialOutbox: [
        {
          id: outboxId,
          org_id: 'org-a',
          pmo_record_id: intentId,
          domain: 'fiscal_year_setup',
          state: 'held',
          claim_generation: 1,
        },
      ],
    });
    await withFetchMock(w.routes, async () => {
      const res = await w.tick(DEC_1);
      assertEquals(res.perOrg[0].errors, []);
    });
    assertEquals((w.binding.config.fiscal_year as { state: string }).state, 'needs-operator');
    assertEquals((w.binding.config.fiscal_year as { reason: string }).reason, 'held');
    assertEquals((w.binding.config.fiscal_year as { intentId: string }).intentId, intentId);
  });

  it('AC-ECX-040 unanswered ERP or no full try causes zero fiscal calls and stops remaining calls for that org', async () => {
    const w = world([CAL_2026]);
    await withFetchMock(w.routes, async ({ calls }) => {
      await w.tick(DEC_1);
      const before = calls.length;
      await runErpSweepCycle(
        {
          listEmployingOrgs: () => Promise.resolve([{
            orgId: 'org-a',
            bindingId: 'binding-a',
            siteUrl: `https://${HOST}`,
            secretRef: 'r',
            company: COMPANY,
            config: w.binding.config,
            versionMajor: 15,
            activatedAt: '2026-01-01T00:00:00Z',
            ownedDomains: [],
            lastFullSweepAt: null,
            erpUnanswered: true,
          }]),
          reconcileOrgOutbox: () => Promise.resolve({ errors: [] } as never),
          sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
          feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0 } as never),
          refreshOrgAccounting: () => Promise.resolve({}),
          ensureOrgFiscalYear: () => {
            throw new Error('should not be called when erpUnanswered');
          },
        },
        undefined,
        'full',
      );
      assertEquals(calls.length, before);
    });
  });
});
