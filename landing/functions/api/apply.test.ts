// Run: node --test landing/functions/api/apply.test.ts  (Node 22.18+)
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApply, onRequest, type Env } from './apply.ts';

const NOW = 1_800_000_000_000;
const valid = {
  name: 'A. Tester',
  email: 'tester@example.com',
  company: 'Example Contractors',
  role: 'Operations director',
  phone: '',
  size: '21-50',
  business: 'construction',
  fix: 'Purchasing approvals',
  consent: true,
  website: '',
  started: NOW - 10_000,
};

const run = async (body: object) => {
  const store: Record<string, string> = {};
  const env: Env = { APPLICATIONS: { put: async (k, v) => void (store[k] = v) } };
  const res = await handleApply(new Request('https://x.test/api/apply', { method: 'POST', body: JSON.stringify(body) }), env, NOW);
  return { res, data: await res.json(), store };
};

test('valid input is stored and returns ok', async () => {
  const { res, data, store } = await run(valid);
  assert.equal(res.status, 200);
  assert.deepEqual(data, { ok: true });
  const [key] = Object.keys(store);
  assert.match(key, /^2027-01-15T\d{2}:\d{2}:\d{2}\.\d{3}Z-[0-9a-f]{8}$/);
  assert.equal(JSON.parse(store[key]).email, 'tester@example.com');
});

test('missing required fields get field-level errors and nothing is stored', async () => {
  const { res, data, store } = await run({ ...valid, name: '', company: ' ', role: '', consent: false });
  assert.equal(res.status, 422);
  assert.equal(data.ok, false);
  assert.deepEqual(Object.keys(data.fields).sort(), ['company', 'consent', 'name', 'role']);
  assert.equal(Object.keys(store).length, 0);
});

test('bad email is rejected', async () => {
  const { res, data } = await run({ ...valid, email: 'not-an-email' });
  assert.equal(res.status, 422);
  assert.ok(data.fields.email);
});

test('length caps and select values are enforced', async () => {
  const { data } = await run({ ...valid, name: 'x'.repeat(101), fix: 'y'.repeat(2001), size: '9999' });
  assert.deepEqual(Object.keys(data.fields).sort(), ['fix', 'name', 'size']);
});

test('honeypot is rejected silently', async () => {
  const { data, store } = await run({ ...valid, website: 'http://spam.test' });
  assert.deepEqual(data, { ok: true });
  assert.equal(Object.keys(store).length, 0);
});

test('too-fast submit is rejected silently', async () => {
  const { data, store } = await run({ ...valid, started: NOW - 500 });
  assert.deepEqual(data, { ok: true });
  assert.equal(Object.keys(store).length, 0);
});

test('malformed JSON returns an error', async () => {
  const env: Env = { APPLICATIONS: { put: async () => {} } };
  const res = await handleApply(new Request('https://x.test/api/apply', { method: 'POST', body: '{nope' }), env, NOW);
  assert.equal(res.status, 400);
});

test('KV write failure returns a generic retry response and never stores an application', async () => {
  let putCalls = 0;
  const stored: Record<string, string> = {};
  const env: Env = {
    APPLICATIONS: {
      put: async (key, value) => {
        putCalls += 1;
        if (putCalls === 1) throw new Error('KV unavailable');
        stored[key] = value;
      },
    },
  };
  const res = await handleApply(new Request('https://x.test/api/apply', { method: 'POST', body: JSON.stringify(valid) }), env, NOW);
  const data = await res.json();
  assert.equal(res.status, 500);
  assert.deepEqual(data, { ok: false, error: 'Could not save your application. Please try again.' });
  assert.equal(data.ok, false);
  assert.equal(putCalls, 1);
  assert.equal(Object.keys(stored).length, 0);
});

test('body larger than 20,000 characters returns 413 before storage', async () => {
  const body = JSON.stringify({ ...valid, fix: 'x'.repeat(20_001) });
  assert.ok(body.length > 20_000);
  let putCalls = 0;
  const env: Env = { APPLICATIONS: { put: async () => { putCalls += 1; } } };
  const res = await handleApply(new Request('https://x.test/api/apply', { method: 'POST', body }), env, NOW);
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { ok: false, error: 'Request too large.' });
  assert.equal(putCalls, 0);
});

test('array, string, and null JSON shapes return 400 without writes', async () => {
  let putCalls = 0;
  const env: Env = { APPLICATIONS: { put: async () => { putCalls += 1; } } };
  for (const body of ['[]', '"text"', 'null']) {
    const res = await handleApply(new Request('https://x.test/api/apply', { method: 'POST', body }), env, NOW);
    assert.equal(res.status, 400, `status for ${body}`);
    assert.deepEqual(await res.json(), { ok: false, error: 'Invalid request.' }, `body for ${body}`);
  }
  assert.equal(putCalls, 0);
});

test('fallback route rejects unsupported methods', async () => {
  const res = onRequest();
  assert.equal(res.status, 405);
  assert.deepEqual(await res.json(), { ok: false, error: 'Method not allowed.' });
});
