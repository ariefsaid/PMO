// AC-PHO-020 (#1532 S3): the SHIPPED agent-dispatch handler emits one job_run per tick.
import { assertEquals } from 'jsr:@std/assert@1';
let served: ((req: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (h: (req: Request) => Promise<Response>) => unknown }).serve = (h) => {
  served = h;
  return { finished: Promise.resolve() };
};
const { summarizeAgentDispatch } = await import('./index.ts');

const SECRET = 'synthetic-dispatch-secret';

async function run(env: Record<string, string>): Promise<{ res: Response; events: Record<string, any>[] }> {
  const events: Record<string, any>[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((_u: unknown, init: RequestInit) => {
    events.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  const all = { POSTHOG_PROJECT_KEY: 'phc_t', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role', AGENT_DISPATCH_SECRET: SECRET, ...env };
  const keys = [...Object.keys(all), 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'OPENROUTER_API_KEY', 'AGENT_AUTOMATIONS'];
  const prior = keys.map((k) => [k, Deno.env.get(k)] as const);
  for (const k of keys) Deno.env.delete(k);
  for (const [k, v] of Object.entries(all)) Deno.env.set(k, v);
  try {
    const req = new Request('http://x', { method: 'POST', headers: { Authorization: `Bearer ${SECRET}` } });
    const res = await served!(req);
    // the handler's own error report also posts an $exception; this test is about job_run
    return { res, events: events.filter((e) => e.event === 'job_run') };
  } finally {
    globalThis.fetch = origFetch;
    for (const [k, v] of prior) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
}

Deno.test('AC-PHO-020 real handler: missing configuration emits one failed job_run MISCONFIGURED', async () => {
  const { res, events } = await run({});
  assertEquals(res.status, 500);
  assertEquals(events.length, 1);
  assertEquals(events[0].properties.job, 'agent-dispatch');
  assertEquals(events[0].properties.status, 'failed');
  assertEquals(events[0].properties.error_code, 'MISCONFIGURED');
});

Deno.test('AC-PHO-020 real handler: the flag-off no-op tick is a run reported as skipped, not ok', async () => {
  const { res, events } = await run({ AGENT_AUTOMATIONS: 'false' });
  assertEquals(res.status, 200);
  assertEquals(events.length, 1);
  assertEquals(events[0].properties.status, 'skipped');
});

Deno.test('summarizeAgentDispatch: a normal tick is ok with no count (the tick returns none); flag-off is skipped', () => {
  assertEquals(summarizeAgentDispatch({ ok: true }), { items: 0 });
  assertEquals(summarizeAgentDispatch({ ok: true, skipped: 'flag off' }), { items: 0, skipped: true });
});

Deno.test('AC-PHO-020 real handler: a wrong secret is not a run', async () => {
  Deno.env.set('AGENT_DISPATCH_SECRET', SECRET);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role');
  Deno.env.set('POSTHOG_PROJECT_KEY', 'phc_t');
  const events: unknown[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((_u: unknown, init: RequestInit) => { events.push(init.body); return Promise.resolve(new Response('{}')); }) as typeof fetch;
  try {
    const res = await served!(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer wrong' } }));
    assertEquals(res.status, 401);
    assertEquals(events.length, 0);
  } finally {
    globalThis.fetch = origFetch;
    for (const k of ['AGENT_DISPATCH_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'POSTHOG_PROJECT_KEY']) Deno.env.delete(k);
  }
});
