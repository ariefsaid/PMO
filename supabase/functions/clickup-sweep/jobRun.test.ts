// AC-PHO-020 (#1532 S3): the SHIPPED clickup-sweep handler emits one job_run per tick.
let served: ((req: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (h: (req: Request) => Promise<Response>) => unknown }).serve = (h) => {
  served = h;
  return { finished: Promise.resolve() };
};
const { summarizeClickupSweep } = await import('./index.ts');

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const SECRET = 'synthetic-sweep-secret';

async function run(env: Record<string, string>): Promise<{ res: Response; events: Record<string, any>[] }> {
  const events: Record<string, any>[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((_u: unknown, init: RequestInit) => {
    events.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  const keys = ['POSTHOG_PROJECT_KEY', ...Object.keys(env)];
  const prior = keys.map((k) => [k, Deno.env.get(k)] as const);
  Deno.env.set('POSTHOG_PROJECT_KEY', 'phc_t');
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  try {
    const req = new Request('http://x', { method: 'POST', headers: { Authorization: `Bearer ${SECRET}` }, body: '{}' });
    return { res: await served!(req), events };
  } finally {
    globalThis.fetch = origFetch;
    for (const [k, v] of prior) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
}

Deno.test('AC-PHO-020 real handler: missing configuration emits one failed job_run MISCONFIGURED', async () => {
  Deno.env.delete('SUPABASE_URL');
  const { res, events } = await run({ CLICKUP_SWEEP_SECRET: SECRET });
  Deno.env.delete('CLICKUP_SWEEP_SECRET');
  assertEquals(res.status, 500);
  assertEquals(events.length, 1);
  assertEquals(events[0].properties.job, 'clickup-sweep');
  assertEquals(events[0].properties.status, 'failed');
  assertEquals(events[0].properties.error_code, 'MISCONFIGURED');
});

Deno.test('summarizeClickupSweep: ok with applied and org count', () => {
  assertEquals(summarizeClickupSweep({ ok: true, orgs: 2, applied: 5, failures: [] }), { items: 5, orgCount: 2 });
});

Deno.test('summarizeClickupSweep: an org failure fails the run', () => {
  assertEquals(
    summarizeClickupSweep({ ok: true, orgs: 2, applied: 1, failures: [{ orgId: 'o', error: 'x' }] }),
    { items: 1, orgCount: 2, failedCode: 'ORG_SWEEP_FAILED' },
  );
});

Deno.test('summarizeClickupSweep: no ClickUp-bound org is skipped, not failed', () => {
  assertEquals(summarizeClickupSweep({ ok: true, orgs: 0, applied: 0, failures: [] }), { items: 0, orgCount: 0, skipped: true });
});
