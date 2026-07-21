// AC-CUA-040/041 [Deno unit] — clickup-webhook/index.ts `handleClickUpWebhook`: the HMAC trust
// boundary + the verify->200->enqueue contract (OD-INT-11, 2026-07-20 fix). Proves, against the REAL
// captured fixtures (supabase/functions/_shared/testing/fixtures/clickup-webhook/):
//   - the handler NEVER reads a `task` object off the payload (there isn't one on a real delivery);
//   - a tampered body fails signature verification and is rejected BEFORE any parsing (enqueue never
//     called — no side effect on a bad signature);
//   - a verified event enqueues and returns 200 WITHOUT performing a re-GET inline (this file makes no
//     `fetch` call to ClickUp at all — `globalThis.fetch` is left untouched/unmocked throughout this
//     suite, proving the re-GET genuinely never happens on the request path).
//
// Deno-native test (plain assertions, no network dependency). `enqueue` is an injected mock — the gate
// + parse + enqueue routing is what's under test here. The pure archive/tombstone/adopt apply logic is
// unit-proven under webhookApply.test.ts (Vitest); the worker's re-GET+apply+bind-resolution flow is
// unit-proven under clickup-webhook-worker/index.test.ts.
//
// Verify: cd supabase/functions/clickup-webhook && deno test index.test.ts

import { readFileSync, readdirSync } from 'node:fs';

// Stub Deno.serve BEFORE the dynamic import of index.ts (top-level `if (import.meta.main) Deno.serve(...)`
// — import.meta.main is false under `deno test`, so this stub is actually unnecessary today, but kept
// as a defensive belt-and-braces guard mirroring erpnext-webhook/index.test.ts's stance, in case that
// guard is ever weakened).
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { handleClickUpWebhook } = await import('./index.ts');
type ClickUpWebhookHandlerDeps = Parameters<typeof handleClickUpWebhook>[1];

const SECRET = 'test-clickup-webhook-secret';
Deno.env.set('CLICKUP_WEBHOOK_SECRET', SECRET);

const FIXTURES_DIR = new URL('../_shared/testing/fixtures/clickup-webhook/', import.meta.url);

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function loadFixturePayload(fileName: string): unknown {
  const raw = JSON.parse(readFileSync(new URL(fileName, FIXTURES_DIR), 'utf8')) as { payload: unknown };
  return raw.payload;
}

const FIXTURE_FILES = readdirSync(FIXTURES_DIR)
  .filter((f) => /^\d+-.*\.json$/.test(f))
  .sort();

/** Compute the valid X-Signature for a body (hex HMAC-SHA256, keyed by SECRET) — mirrors signature.ts. */
async function sign(body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function req(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signature !== null) headers['X-Signature'] = signature;
  headers['Content-Length'] = String(body.length);
  return new Request('https://clickup-webhook.test', { method: 'POST', headers, body });
}

function deps(): ClickUpWebhookHandlerDeps & { enqueued: unknown[] } {
  const enqueued: unknown[] = [];
  const enqueue: ClickUpWebhookHandlerDeps['enqueue'] = async (payload) => {
    enqueued.push(payload);
  };
  return { enqueue, enqueued };
}

// ── Fixture-driven: every one of the 7 REAL captured deliveries enqueues cleanly, and the fixture
//    itself proves the bug (no `task`/`date_updated`/`list_id` ever crosses the boundary). ──────────
for (const fileName of FIXTURE_FILES) {
  Deno.test(`OD-INT-11: fixture ${fileName} enqueues WITHOUT the handler ever reading a task object off the payload`, async () => {
    const payload = loadFixturePayload(fileName) as Record<string, unknown>;
    assert(payload.task === undefined, `fixture ${fileName} unexpectedly carries a task object`);
    assert(payload.date_updated === undefined, `fixture ${fileName} unexpectedly carries date_updated`);
    assert(payload.list_id === undefined, `fixture ${fileName} unexpectedly carries list_id`);

    const body = JSON.stringify(payload);
    const sig = await sign(body);
    const d = deps();
    const res = await handleClickUpWebhook(req(body, sig), d);

    assert(res.status === 200, `expected 200 for ${fileName}, got ${res.status}`);
    assert(d.enqueued.length === 1, `expected exactly one enqueue for ${fileName}`);
    const queued = d.enqueued[0] as { event: string; task_id: string; history_items: unknown[] };
    assert(queued.event === payload.event, `enqueued event mismatch for ${fileName}`);
    assert(queued.task_id === payload.task_id, `enqueued task_id mismatch for ${fileName}`);
    assert(Array.isArray(queued.history_items), `enqueued history_items must be an array for ${fileName}`);
  });
}

Deno.test('replay protection: enqueue receives a SHA-256 digest of the raw body and duplicate insert is acknowledged', async () => {
  const payload = loadFixturePayload('00-taskCreated.json');
  const body = JSON.stringify(payload);
  const sig = await sign(body);
  let digest = '';
  const d: ClickUpWebhookHandlerDeps = {
    enqueue: async (_payload, rawBodySha256) => {
      digest = rawBodySha256;
      const duplicate = new Error('duplicate') as Error & { code: string };
      duplicate.code = '23505';
      throw duplicate;
    },
  };
  const res = await handleClickUpWebhook(req(body, sig), d);
  assert(res.status === 200, `duplicate delivery must still be acknowledged, got ${res.status}`);
  assert(/^[0-9a-f]{64}$/.test(digest), 'queue key must be a SHA-256 hex digest');
});

Deno.test('AC-CUA-040/041: an ABSENT X-Signature ⇒ 401 with NO side effect (enqueue never called)', async () => {
  const payload = loadFixturePayload('00-taskCreated.json');
  const body = JSON.stringify(payload);
  const d = deps();
  const res = await handleClickUpWebhook(req(body, null), d);
  assert(res.status === 401, `expected 401, got ${res.status}`);
  assert(d.enqueued.length === 0, 'enqueue must NOT be called on a signature-less request');
  const responseBody = (await res.json()) as { error?: string };
  assert(responseBody.error === 'UNAUTHORIZED', `expected UNAUTHORIZED, got ${responseBody.error}`);
});

Deno.test('AC-CUA-040/041: a TAMPERED body (valid secret, body changed after signing) is rejected BEFORE any parsing', async () => {
  const payload = loadFixturePayload('00-taskCreated.json') as Record<string, unknown>;
  const body = JSON.stringify(payload);
  const validSig = await sign(body);
  const tamperedBody = JSON.stringify({ ...payload, task_id: 'sneaky-different-task' });
  const d = deps();
  const res = await handleClickUpWebhook(req(tamperedBody, validSig), d);
  assert(res.status === 401, `expected 401 for a tampered body, got ${res.status}`);
  assert(d.enqueued.length === 0, 'enqueue must NOT be called for a tampered body — rejected before parse');
});

Deno.test('AC-CUA-040/041: a bogus/invalid signature ⇒ 401 with NO side effect', async () => {
  const payload = loadFixturePayload('00-taskCreated.json');
  const body = JSON.stringify(payload);
  const d = deps();
  const res = await handleClickUpWebhook(req(body, 'not-a-real-hmac-digest'), d);
  assert(res.status === 401, `expected 401, got ${res.status}`);
  assert(d.enqueued.length === 0, 'enqueue must NOT be called on an invalid signature');
});

Deno.test('the handler returns 200 WITHOUT performing a re-GET inline (globalThis.fetch is never invoked by this file)', async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCalled = true;
    return originalFetch(...args);
  }) as typeof fetch;
  try {
    const payload = loadFixturePayload('02-taskUpdated.json');
    const body = JSON.stringify(payload);
    const sig = await sign(body);
    const res = await handleClickUpWebhook(req(body, sig), deps());
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(fetchCalled === false, 'the ingress must NEVER call fetch (no inline re-GET) — enqueue only');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('a body that fails to parse as JSON ⇒ 400, no side effect', async () => {
  const sig = await sign('not-json{{{');
  const d = deps();
  const res = await handleClickUpWebhook(req('not-json{{{', sig), d);
  assert(res.status === 400, `expected 400, got ${res.status}`);
  assert(d.enqueued.length === 0, 'enqueue must NOT be called for invalid JSON');
});

Deno.test('a verified envelope missing task_id ⇒ 400, no side effect', async () => {
  const body = JSON.stringify({ event: 'taskCreated', history_items: [] });
  const sig = await sign(body);
  const d = deps();
  const res = await handleClickUpWebhook(req(body, sig), d);
  assert(res.status === 400, `expected 400, got ${res.status}`);
  assert(d.enqueued.length === 0, 'enqueue must NOT be called for a malformed envelope');
});

Deno.test('an oversized body (>256 KiB Content-Length) ⇒ 413 BEFORE any read/parse/enqueue', async () => {
  const huge = 'x'.repeat(262145);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Content-Length': '262145' };
  const bigReq = new Request('https://clickup-webhook.test', { method: 'POST', headers, body: huge });
  const d = deps();
  const res = await handleClickUpWebhook(bigReq, d);
  assert(res.status === 413, `expected 413, got ${res.status}`);
  assert(d.enqueued.length === 0, 'enqueue must NOT be called on an oversized body');
});

Deno.test('an enqueue failure ⇒ 500 GENERIC (never leaks the raw error detail)', async () => {
  const payload = loadFixturePayload('00-taskCreated.json');
  const body = JSON.stringify(payload);
  const sig = await sign(body);
  const failingDeps: ClickUpWebhookHandlerDeps = {
    enqueue: async () => {
      throw new Error('relation "clickup_webhook_inbox" constraint violation on column secret_col');
    },
  };
  const res = await handleClickUpWebhook(req(body, sig), failingDeps);
  assert(res.status === 500, `expected 500, got ${res.status}`);
  const responseBody = (await res.json()) as { error?: string; message?: string };
  assert(responseBody.error === 'ENQUEUE_FAILED', `expected ENQUEUE_FAILED, got ${responseBody.error}`);
  assert(!JSON.stringify(responseBody).includes('secret_col'), 'the raw error detail must NOT leak to the public surface');
});
