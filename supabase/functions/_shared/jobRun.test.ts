import { assertEquals } from 'jsr:@std/assert@1';
import { withJobRun } from './jobRun.ts';

// deno-lint-ignore no-explicit-any
type Sent = Record<string, any>;

function capture(opts: { reject?: boolean } = {}) {
  const sent: Sent[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = ((_u: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return opts.reject ? Promise.reject(new Error('down')) : Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = orig; } };
}
const req = (method = 'POST') => new Request('http://x', { method });
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function withKey(fn: (c: ReturnType<typeof capture>) => Promise<void>, opts: { reject?: boolean } = {}) {
  Deno.env.set('POSTHOG_PROJECT_KEY', 'phc_t');
  const c = capture(opts);
  try { await fn(c); } finally { c.restore(); Deno.env.delete('POSTHOG_PROJECT_KEY'); }
}

Deno.test('AC-PHO-020 success emits exactly one job_run ok with items and duration', () => withKey(async (c) => {
  const h = withJobRun('clickup-sweep', () => jsonRes({ ok: true, applied: 4 }), {
    summarize: (b) => ({ items: (b as { applied: number }).applied, orgCount: 2 }),
  });
  assertEquals((await h(req())).status, 200);
  assertEquals(c.sent.length, 1);
  assertEquals(c.sent[0].event, 'job_run');
  assertEquals(c.sent[0].properties.job, 'clickup-sweep');
  assertEquals(c.sent[0].properties.status, 'ok');
  assertEquals(c.sent[0].properties.items_processed, 4);
  assertEquals(c.sent[0].properties.org_count, 2);
  assertEquals(typeof c.sent[0].properties.duration_ms, 'number');
}));

Deno.test('AC-PHO-020 a throw emits failed, then rethrows (so reportEdgeError still sees it)', () => withKey(async (c) => {
  const h = withJobRun('agent-dispatch', () => { throw new Error('x'); });
  let thrown: unknown;
  try { await h(req()); } catch (e) { thrown = e; }
  assertEquals((thrown as Error).message, 'x');
  assertEquals(c.sent.length, 1);
  assertEquals(c.sent[0].properties.status, 'failed');
  assertEquals(c.sent[0].properties.error_code, 'UNHANDLED_EXCEPTION');
}));

Deno.test('AC-PHO-021 summarize failedCode turns a 200 into failed (a job that skips all work must not look healthy)', () => withKey(async (c) => {
  const h = withJobRun('telegram-notify', () => jsonRes({ ok: true, skipped: 'secrets-unset' }), {
    summarize: () => ({ items: 0, failedCode: 'SECRETS_UNSET' }),
  });
  await h(req());
  assertEquals(c.sent[0].properties.status, 'failed');
  assertEquals(c.sent[0].properties.error_code, 'SECRETS_UNSET');
}));

Deno.test('owner ruling: summarize skipped (no ERP-bound org) is status skipped, never failed', () => withKey(async (c) => {
  const h = withJobRun('erpnext-sweep', () => jsonRes({ ok: true, orgs: 0 }), {
    summarize: () => ({ items: 0, orgCount: 0, skipped: true }),
  });
  await h(req());
  assertEquals(c.sent.length, 1);
  assertEquals(c.sent[0].properties.status, 'skipped');
  assertEquals(c.sent[0].properties.org_count, 0);
  assertEquals(c.sent[0].properties.error_code, undefined);
}));

Deno.test('summarize extra counts ride on the event', () => withKey(async (c) => {
  const h = withJobRun('erpnext-sweep', () => jsonRes({}), {
    summarize: () => ({ items: 5, extra: { recovered: 3, reconcile_errors: 1, org_error_count: 1 } }),
  });
  await h(req());
  assertEquals(c.sent[0].properties.recovered, 3);
  assertEquals(c.sent[0].properties.reconcile_errors, 1);
  assertEquals(c.sent[0].properties.org_error_count, 1);
}));

Deno.test('summarize null (maintenance request) emits nothing', () => withKey(async (c) => {
  const h = withJobRun('erpnext-sweep', () => jsonRes({ ok: true }), { summarize: () => null });
  await h(req());
  assertEquals(c.sent.length, 0);
}));

Deno.test('non-2xx maps to failed with the body error code; unknown shapes get HTTP_<status>', () => withKey(async (c) => {
  await withJobRun('clickup-sweep', () => jsonRes({ error: 'MISCONFIGURED' }, 500))(req());
  await withJobRun('clickup-sweep', () => jsonRes({ error: 'some free text with spaces' }, 502))(req());
  await withJobRun('clickup-sweep', () => new Response('boom', { status: 503 }))(req());
  assertEquals(c.sent.map((s) => [s.properties.status, s.properties.error_code]), [
    ['failed', 'MISCONFIGURED'], ['failed', 'HTTP_502'], ['failed', 'HTTP_503'],
  ]);
}));

Deno.test('401 and OPTIONS emit nothing (a wrong secret is not a run)', () => withKey(async (c) => {
  await withJobRun('clickup-sweep', () => jsonRes({ error: 'UNAUTHORIZED' }, 401))(req());
  await withJobRun('clickup-sweep', () => new Response('ok'))(req('OPTIONS'));
  assertEquals(c.sent.length, 0);
}));

Deno.test('NFR-PHO-REL-001 PostHog down does not change the response or the rethrow', () => withKey(async (c) => {
  const res = await withJobRun('clickup-sweep', () => jsonRes({ ok: true, applied: 1 }))(req());
  assertEquals(res.status, 200);
  assertEquals((await res.json()).applied, 1);
  assertEquals(c.sent.length, 1); // it did try
  let thrown: unknown;
  try { await withJobRun('clickup-sweep', () => { throw new Error('y'); })(req()); } catch (e) { thrown = e; }
  assertEquals((thrown as Error).message, 'y');
}, { reject: true }));

Deno.test('no key => no fetch, response unchanged', async () => {
  Deno.env.delete('POSTHOG_PROJECT_KEY');
  const c = capture();
  try {
    assertEquals((await withJobRun('clickup-sweep', () => jsonRes({ ok: true }))(req())).status, 200);
    assertEquals(c.sent.length, 0);
  } finally { c.restore(); }
});
