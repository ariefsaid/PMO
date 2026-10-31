// AC-PHO-020 (#1532 S3): the SHIPPED clickup-webhook-worker handler emits one job_run per tick.
import { assertEquals } from 'jsr:@std/assert@1';
const { jobHandler, summarizeWebhookWorker } = await import('./index.ts');

Deno.test('AC-PHO-020 real handler: missing configuration emits one failed job_run MISCONFIGURED', async () => {
  const events: Record<string, any>[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((_u: unknown, init: RequestInit) => {
    events.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  Deno.env.set('POSTHOG_PROJECT_KEY', 'phc_t');
  Deno.env.set('CLICKUP_WEBHOOK_WORKER_SECRET', 'synthetic-worker-secret');
  Deno.env.delete('SUPABASE_URL');
  try {
    const res = await jobHandler(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer synthetic-worker-secret' } }));
    assertEquals(res.status, 500);
    assertEquals(events.length, 1);
    assertEquals(events[0].properties.job, 'clickup-webhook-worker');
    assertEquals(events[0].properties.status, 'failed');
    assertEquals(events[0].properties.error_code, 'MISCONFIGURED');
  } finally {
    globalThis.fetch = origFetch;
    Deno.env.delete('POSTHOG_PROJECT_KEY');
    Deno.env.delete('CLICKUP_WEBHOOK_WORKER_SECRET');
  }
});

Deno.test('summarizeWebhookWorker: processed rows are ok; failed rows fail the run', () => {
  assertEquals(summarizeWebhookWorker({ ok: true, claimed: 3, processed: 3, failed: 0 }), { items: 3 });
  assertEquals(summarizeWebhookWorker({ ok: true, claimed: 3, processed: 2, failed: 1 }), { items: 2, failedCode: 'ROWS_FAILED' });
});
