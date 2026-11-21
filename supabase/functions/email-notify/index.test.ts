import { handleEmailNotifyRequest } from './index.ts';
import { renderEmail } from './templates.ts';

function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }

const SUPA = 'https://pmo-2711-test.supabase.co';
const SECRET = 'synthetic-tick-secret';

function setEnv(env: Record<string, string | null>) {
  for (const [k, v] of Object.entries(env)) { if (v === null) Deno.env.delete(k); else Deno.env.set(k, v); }
}
const BASE_ENV = {
  SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', EMAIL_NOTIFY_SECRET: SECRET,
  RESEND_API_KEY: 'synthetic-resend-key', EMAIL_FROM: 'PMO <noreply@example.test>',
};
const req = (auth: string | null = `Bearer ${SECRET}`) =>
  new Request('https://fn.test/email-notify', { method: 'POST', headers: auth ? { Authorization: auth } : {} });
const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { url: URL; method: string; headers: Headers; body: any };
async function withMocks(
  rows: unknown[], resendStatus: number,
  run: (calls: Call[]) => Promise<void>,
) {
  const prior = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = input instanceof Request ? input : undefined;
    const url = new URL(r?.url ?? String(input));
    const headers = new Headers(init?.headers ?? r?.headers);
    const raw = init?.body ?? (r ? await r.clone().text() : undefined);
    const body = typeof raw === 'string' && raw ? JSON.parse(raw) : undefined;
    calls.push({ url, method: (init?.method ?? r?.method ?? 'GET').toUpperCase(), headers, body });
    if (url.hostname === 'api.resend.com') return j({ id: 'x' }, resendStatus);
    if (url.pathname === '/rest/v1/rpc/claim_email_outbox') return j(rows);
    if (url.pathname === '/rest/v1/rpc/complete_email_outbox') return new Response(null, { status: 204 });
    throw new Error(`Unexpected fetch ${url.href}`);
  };
  try { await run(calls); } finally { globalThis.fetch = prior; }
}

const ROW = { id: 'out-1', to_email: 'a@example.test', event_key: 'approval_request', locale: 'en', title: 'Timesheet awaiting your approval', body: 'Week of 1 Jan', attempts: 1 };

Deno.test('AC-EML-008: shipped handler sends once per row with the idempotency key and marks it sent', async () => {
  setEnv(BASE_ENV);
  await withMocks([ROW], 200, async (calls) => {
    const res = await handleEmailNotifyRequest(req());
    assertEquals(res.status, 200);
    const sends = calls.filter((c) => c.url.hostname === 'api.resend.com');
    assertEquals(sends.length, 1);
    assertEquals(sends[0].headers.get('Idempotency-Key'), 'out-1');
    assertEquals(sends[0].headers.get('Authorization'), 'Bearer synthetic-resend-key');
    assertEquals(sends[0].body.to, ['a@example.test']);
    assertEquals(sends[0].body.subject, ROW.title);
    const done = calls.find((c) => c.url.pathname.endsWith('complete_email_outbox'));
    assertEquals(done?.body, { p_id: 'out-1', p_ok: true, p_error: null, p_permanent: false });
  });
});

Deno.test('AC-EML-009: a 5xx is reported as a retryable failure; a 4xx as permanent', async () => {
  setEnv(BASE_ENV);
  await withMocks([ROW], 503, async (calls) => {
    await handleEmailNotifyRequest(req());
    const done = calls.find((c) => c.url.pathname.endsWith('complete_email_outbox'));
    assertEquals(done?.body, { p_id: 'out-1', p_ok: false, p_error: 'resend 503', p_permanent: false });
  });
  await withMocks([ROW], 422, async (calls) => {
    await handleEmailNotifyRequest(req());
    const done = calls.find((c) => c.url.pathname.endsWith('complete_email_outbox'));
    assertEquals(done?.body, { p_id: 'out-1', p_ok: false, p_error: 'resend 422', p_permanent: true });
  });
});

Deno.test('AC-EML-010: with the sender secret absent nothing is claimed or sent and the call succeeds', async () => {
  setEnv({ ...BASE_ENV, RESEND_API_KEY: null });
  await withMocks([ROW], 200, async (calls) => {
    const res = await handleEmailNotifyRequest(req());
    assertEquals(res.status, 200);
    assertEquals((await res.json()).skipped, 'sender-not-configured');
    assertEquals(calls.length, 0);
  });
});

Deno.test('AC-EML-011: a wrong or missing bearer, or no configured secret, is refused', async () => {
  setEnv(BASE_ENV);
  await withMocks([ROW], 200, async (calls) => {
    assertEquals((await handleEmailNotifyRequest(req('Bearer wrong'))).status, 401);
    assertEquals((await handleEmailNotifyRequest(req(null))).status, 401);
    setEnv({ EMAIL_NOTIFY_SECRET: null });
    assertEquals((await handleEmailNotifyRequest(req('Bearer '))).status, 401);
    assertEquals(calls.length, 0);
  });
});

Deno.test('AC-EML-012: every event renders in both languages from the notification text, with no organisation name', () => {
  for (const ev of ['approval_request', 'billing_step', 'overdue_item', 'document_expiry']) {
    for (const loc of ['en', 'id']) {
      const m = renderEmail(ev, loc, 'T <b>', 'Body & more');
      assert(m.subject === 'T <b>', 'subject is the notification title');
      assert(m.text.includes('Body & more'), 'text carries the body');
      assert(m.html.includes('T &lt;b&gt;') && m.html.includes('Body &amp; more'), 'html escapes the parameters');
    }
  }
  assert(renderEmail('overdue_item', 'id', 't', null).text.includes('terlambat'), 'Bahasa Indonesia text');
  assert(renderEmail('overdue_item', 'en', 't', null).text.includes('overdue'), 'English text');
});

const REPORT_ROW = {
  id: 'out-r1', to_email: 'r@example.test', event_key: 'scheduled_report', locale: 'id', title: 'Daily progress',
  body: 'Daily progress\nRingkasan kemajuan\nAlpha Site: 1 laporan', attempts: 1,
};

Deno.test('AC-SCH-009: a scheduled-report row is sent once through the same path with the idempotency key', async () => {
  setEnv(BASE_ENV);
  await withMocks([REPORT_ROW], 200, async (calls) => {
    const res = await handleEmailNotifyRequest(req());
    assertEquals(res.status, 200);
    const sends = calls.filter((c) => c.url.hostname === 'api.resend.com');
    assertEquals(sends.length, 1);
    assertEquals(sends[0].headers.get('Idempotency-Key'), 'out-r1');
    assertEquals(sends[0].body.subject, 'Daily progress');
    assert(sends[0].body.text.includes('Alpha Site: 1 laporan'), 'the report body is the text part');
    assert(sends[0].body.text.includes('laporan terjadwal'), 'Bahasa Indonesia lead');
    assert(sends[0].body.html.includes('<br>'), 'html keeps the line breaks');
    const done = calls.find((c) => c.url.pathname.endsWith('complete_email_outbox'));
    assertEquals(done?.body, { p_id: 'out-r1', p_ok: true, p_error: null, p_permanent: false });
  });
});

Deno.test('AC-SCH-009: the scheduled_report template renders in both languages and escapes the parameters', () => {
  const en = renderEmail('scheduled_report', 'en', 'Name <x>', 'Line one\nLine & two');
  assert(en.text.includes('scheduled report') && en.text.includes('Line & two'), 'English text');
  assert(en.html.includes('Name &lt;x&gt;') && en.html.includes('Line one<br>Line &amp; two'), 'html escapes and breaks lines');
  assert(renderEmail('scheduled_report', 'id', 't', null).text.includes('laporan terjadwal'), 'Bahasa Indonesia text');
  assert(!/pmo-|acme|org /i.test(en.text.replace(/PMO/g, '')), 'no organisation name in the template');
});
