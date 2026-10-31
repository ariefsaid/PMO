// AC-PHO-020/021 (#1532 S3): the SHIPPED erpnext-sweep handler emits one job_run per tick; a tick that
// cannot do its work is failed (never ok); no bound org is skipped (owner ruling, ADR-0094).
let served: ((req: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (h: (req: Request) => Promise<Response>) => unknown }).serve = (h) => {
  served = h;
  return { finished: Promise.resolve() };
};
const { summarizeErpSweep } = await import('./index.ts');

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const SECRET = 'synthetic-sweep-secret';
const tick = () => new Request('http://x', { method: 'POST', headers: { Authorization: `Bearer ${SECRET}` }, body: '{}' });

async function run(env: Record<string, string>, req: Request): Promise<{ res: Response; events: Record<string, any>[] }> {
  const events: Record<string, any>[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((_u: unknown, init: RequestInit) => {
    events.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  const keys = ['ERPNEXT_SWEEP_SECRET', 'POSTHOG_PROJECT_KEY', ...Object.keys(env)];
  const prior = keys.map((k) => [k, Deno.env.get(k)] as const);
  Deno.env.set('POSTHOG_PROJECT_KEY', 'phc_t');
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  try {
    return { res: await served!(req), events };
  } finally {
    globalThis.fetch = origFetch;
    for (const [k, v] of prior) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
}

Deno.test('AC-PHO-021 real handler: missing configuration emits one failed job_run MISCONFIGURED, not ok', async () => {
  const { res, events } = await run({ ERPNEXT_SWEEP_SECRET: SECRET }, tick());
  assertEquals(res.status, 500);
  assertEquals(events.length, 1);
  assertEquals(events[0].event, 'job_run');
  assertEquals(events[0].properties.job, 'erpnext-sweep');
  assertEquals(events[0].properties.status, 'failed');
  assertEquals(events[0].properties.error_code, 'MISCONFIGURED');
});

Deno.test('AC-PHO-020 real handler: a 401 (wrong secret) is not a run and emits nothing', async () => {
  const bad = new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}' });
  const { res, events } = await run({ ERPNEXT_SWEEP_SECRET: SECRET }, bad);
  assertEquals(res.status, 401);
  assertEquals(events.length, 0);
});

Deno.test('summarizeErpSweep: sums reconciled/applied, counts errors and orgs with errors', () => {
  const body = {
    ok: true, orgs: 3,
    perOrg: [
      { reconcile: { reconciled: 2, errors: [{ id: 'a', error: 'x' }] }, sweep: { applied: 4 }, errors: [] },
      { reconcile: null, errors: ['sweep:boom'] },
      { reconcile: { reconciled: 1, errors: [] }, sweep: { applied: 0 }, errors: [] },
    ],
  };
  assertEquals(summarizeErpSweep(body), {
    items: 7, orgCount: 3, extra: { recovered: 3, reconcile_errors: 1, org_error_count: 1 },
  });
});

Deno.test('summarizeErpSweep: zero bound orgs is skipped (standalone is legitimate), never failed', () => {
  assertEquals(summarizeErpSweep({ ok: true, orgs: 0, perOrg: [] }), {
    items: 0, orgCount: 0, skipped: true, extra: { recovered: 0, reconcile_errors: 0, org_error_count: 0 },
  });
});

Deno.test('summarizeErpSweep: a non-tick body (maintenance request) is not a run', () => {
  assertEquals(summarizeErpSweep({ ok: true, repaired: 3 }), null);
  assertEquals(summarizeErpSweep(null), null);
});
