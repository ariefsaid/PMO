// Run: node --test landing/functions/api/apply.test.ts  (Node 22.18+)
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApply, type Env } from './apply.ts';

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
