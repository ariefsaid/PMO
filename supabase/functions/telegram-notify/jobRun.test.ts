// AC-PHO-020 (#1532 S3): the SHIPPED telegram-notify handler emits one job_run per tick.
import { assertEquals } from 'jsr:@std/assert@1';
const { jobHandler, summarizeTelegramNotify } = await import('./index.ts');

Deno.test('AC-PHO-020 real handler: unset Telegram secrets emit one failed job_run SECRETS_UNSET, not ok', async () => {
  const events: Record<string, any>[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((_u: unknown, init: RequestInit) => {
    events.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  const env = {
    POSTHOG_PROJECT_KEY: 'phc_t', SUPABASE_URL: 'https://pmo-test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role', TELEGRAM_NOTIFY_SECRET: 'synthetic-notify-secret',
  };
  const keys = [...Object.keys(env), 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
  const prior = keys.map((k) => [k, Deno.env.get(k)] as const);
  for (const k of keys) Deno.env.delete(k);
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  try {
    const res = await jobHandler(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer synthetic-notify-secret' } }));
    assertEquals(res.status, 200);
    const runs = events.filter((e) => e.event === 'job_run');
    assertEquals(runs.length, 1);
    assertEquals(runs[0].properties.job, 'telegram-notify');
    assertEquals(runs[0].properties.status, 'failed');
    assertEquals(runs[0].properties.error_code, 'SECRETS_UNSET');
  } finally {
    globalThis.fetch = origFetch;
    for (const [k, v] of prior) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
});

Deno.test('summarizeTelegramNotify: sent is ok; send or stamp failures and unset secrets fail the run', () => {
  assertEquals(summarizeTelegramNotify({ ok: true, sent: 2, sendFailures: 0, stampFailures: 0 }), { items: 2 });
  assertEquals(summarizeTelegramNotify({ ok: true, sent: 1, sendFailures: 1, stampFailures: 0 }), { items: 1, failedCode: 'SEND_FAILED' });
  assertEquals(summarizeTelegramNotify({ ok: true, sent: 0, sendFailures: 0, stampFailures: 2 }), { items: 0, failedCode: 'SEND_FAILED' });
  assertEquals(summarizeTelegramNotify({ ok: true, sent: 0, skipped: 'secrets-unset' }), { items: 0, failedCode: 'SECRETS_UNSET' });
});
