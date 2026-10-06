function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ORG_A = '62900000-0000-0000-0000-000000000001';
const ORG_B = '62900000-0000-0000-0000-000000000002';
const ERROR_CODE = 'AC629_SHARED';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.test('AC-629-001: shipped handler scopes cooldown, delivery marking, and event stamps by org', async () => {
  const env = {
    SUPABASE_URL: 'https://pmo-629-test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
    TELEGRAM_NOTIFY_SECRET: 'synthetic-dispatch-secret',
    TELEGRAM_COOLDOWN_SECONDS: '900',
    TELEGRAM_BOT_TOKEN: 'synthetic-telegram-token',
    TELEGRAM_CHAT_ID: 'synthetic-chat',
    HEARTBEAT_URL: '',
    LIVENESS_INTERVAL_HOURS: '24',
  };
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);

  const priorFetch = globalThis.fetch;
  const now = Date.now();
  const eventAt = new Date(now - 60_000).toISOString();
  const lastSentAt = new Date(now - 120_000).toISOString();
  const requests: { url: URL; method: string; body: unknown }[] = [];
  const telegramBodies: Record<string, unknown>[] = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: globalThis.RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input));
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const rawBody = init?.body ?? (request ? await request.clone().text() : undefined);
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    requests.push({ url, method, body });

    if (url.hostname === 'api.telegram.org' && method === 'POST') {
      telegramBodies.push(body as Record<string, unknown>);
      return jsonResponse({ ok: true, result: { message_id: 1 } });
    }

    if (url.origin !== env.SUPABASE_URL || !url.pathname.startsWith('/rest/v1/')) {
      throw new Error(`Unexpected fetch URL: ${url.href}`);
    }

    const table = url.pathname.slice('/rest/v1/'.length);
    if (method === 'GET' && table === 'error_events') {
      return jsonResponse([
        { id: 'a-event', error_code: ERROR_CODE, fn: 'agent-dispatch', context_id: null, org_id: ORG_A, created_at: eventAt },
        { id: 'b-event', error_code: ERROR_CODE, fn: 'agent-dispatch', context_id: null, org_id: ORG_B, created_at: eventAt },
      ]);
    }
    if (method === 'GET' && table === 'alert_send_log') {
      return jsonResponse([{
        org_id: ORG_A,
        error_code: ERROR_CODE,
        last_sent_at: lastSentAt,
        delivered_at: lastSentAt,
      }]);
    }
    if (method === 'GET' && table === 'ops_job_heartbeats') {
      return jsonResponse({
        last_run_at: lastSentAt,
        last_outbound_at: lastSentAt,
      });
    }
    if (method === 'POST' && table === 'alert_send_log') return jsonResponse(body);
    if (method === 'PATCH' && (table === 'alert_send_log' || table === 'error_events')) return jsonResponse([]);
    if (method === 'POST' && table === 'ops_job_heartbeats') return jsonResponse([]);

    throw new Error(`Unexpected fetch URL: ${url.href}`);
  };

  try {
    const { handleTelegramNotifyRequest } = await import('./index.ts');
    const response = await handleTelegramNotifyRequest(new Request('https://edge.test/telegram-notify', {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-dispatch-secret' },
    }));
    assertEquals(response.status, 200);
    assertEquals(telegramBodies.length, 1);

    const logRead = requests.find((request) =>
      request.method === 'GET' && request.url.pathname.endsWith('/alert_send_log')
    );
    assertEquals(logRead?.url.searchParams.get('error_code'), `in.(${ERROR_CODE})`);

    const ahead = requests.find((request) =>
      request.method === 'POST' && request.url.pathname.endsWith('/alert_send_log')
    );
    const aheadBody = ahead?.body as Record<string, unknown> | undefined;
    assert(typeof aheadBody?.last_sent_at === 'string', 'write-ahead must include last_sent_at');
    assertEquals(ahead?.body, {
      org_id: ORG_B,
      error_code: ERROR_CODE,
      last_sent_at: aheadBody.last_sent_at,
      delivered_at: null,
    });
    assertEquals(ahead?.url.searchParams.get('on_conflict'), 'org_id,error_code');

    const deliveredB = requests.find((request) =>
      request.method === 'PATCH' && request.url.pathname.endsWith('/alert_send_log')
    );
    assertEquals(deliveredB?.url.searchParams.get('error_code'), `eq.${ERROR_CODE}`);
    assertEquals(deliveredB?.url.searchParams.get('org_id'), `eq.${ORG_B}`);

    const eventStamps = requests.filter((request) =>
      request.method === 'PATCH' && request.url.pathname.endsWith('/error_events')
    );
    assertEquals(eventStamps.length, 2);
    assertEquals(eventStamps.map(({ url }) => [url.searchParams.get('id'), url.searchParams.get('org_id')]), [
      ['in.(a-event)', `eq.${ORG_A}`],
      ['in.(b-event)', `eq.${ORG_B}`],
    ]);
    assertEquals(requests.some(({ url }) =>
      url.pathname.endsWith('/error_events') && url.searchParams.has('error_code')
    ), false);
  } finally {
    globalThis.fetch = priorFetch;
    for (const key of Object.keys(env)) Deno.env.delete(key);
  }
});
