/**
 * register-oauth-client.test.mjs — the one-time admin setup that registers the PMO CLI's public
 * OAuth client (issue #728). Runs against a FAKE GoTrue admin API; the real registration is
 * exercised end-to-end by pmo-portal/e2e/AC-CLI-001-cli-oauth-login.spec.ts.
 *
 * Run:  node --test scripts/register-oauth-client.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { loopbackRedirectUris } from './pmo.mjs';
import { clientPayload, parseRegisterArgs, register } from './register-oauth-client.mjs';

async function fakeAdmin(existing = []) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    requests.push({ method: req.method, path: req.url, headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url.startsWith('/auth/v1/admin/oauth/clients')) {
      return res.end(JSON.stringify({ clients: existing }));
    }
    if (req.method === 'POST' && req.url === '/auth/v1/admin/oauth/clients') {
      const p = JSON.parse(body);
      res.statusCode = 201;
      return res.end(JSON.stringify({ client_id: 'new-client', client_type: 'public', ...p }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

test('AC-CLI-008: the CLI client is registered PUBLIC (no secret) with exactly the loopback redirect URIs', () => {
  const p = clientPayload('PMO CLI');
  assert.equal(p.client_name, 'PMO CLI');
  assert.equal(p.token_endpoint_auth_method, 'none');
  assert.deepEqual(p.redirect_uris, loopbackRedirectUris());
  assert.deepEqual(p.grant_types, ['authorization_code', 'refresh_token']);
});

test('AC-CLI-008: register creates the client with the service-role key and prints no secret', async () => {
  const fake = await fakeAdmin();
  try {
    const out = await register({ supabaseUrl: fake.url, serviceRoleKey: 'svc', name: 'PMO CLI' });
    assert.deepEqual(out, { created: true, client_id: 'new-client', client_name: 'PMO CLI', redirect_uris: loopbackRedirectUris() });
    const post = fake.requests.find((r) => r.method === 'POST');
    assert.equal(post.headers.authorization, 'Bearer svc');
  } finally {
    await fake.close();
  }
});

test('AC-CLI-008: register is idempotent — an existing client of the same name is reported, not duplicated', async () => {
  const fake = await fakeAdmin([
    {
      client_id: 'old-client',
      client_name: 'PMO CLI',
      client_type: 'public',
      token_endpoint_auth_method: 'none',
      redirect_uris: [...loopbackRedirectUris()].reverse(),
    },
  ]);
  try {
    const out = await register({ supabaseUrl: fake.url, serviceRoleKey: 'svc', name: 'PMO CLI' });
    assert.equal(out.created, false);
    assert.equal(out.client_id, 'old-client');
    assert.equal(fake.requests.filter((r) => r.method === 'POST').length, 0);
  } finally {
    await fake.close();
  }
});

test('AC-CLI-008: a non-local Supabase URL is refused unless --hosted is passed (the owner-gated step)', async () => {
  await assert.rejects(
    register({ supabaseUrl: 'https://project.example.test', serviceRoleKey: 'svc', name: 'PMO CLI' }),
    /--hosted/,
  );
});

test('AC-CLI-008: an existing same-name client that is not the public loopback client is refused, not reused', async () => {
  const good = {
    client_id: 'old-client',
    client_name: 'PMO CLI',
    client_type: 'public',
    token_endpoint_auth_method: 'none',
    redirect_uris: loopbackRedirectUris(),
  };
  for (const [label, bad] of [
    ['confidential', { ...good, client_type: 'confidential', token_endpoint_auth_method: 'client_secret_basic' }],
    ['secret auth method', { ...good, token_endpoint_auth_method: 'client_secret_post' }],
    ['extra redirect', { ...good, redirect_uris: [...loopbackRedirectUris(), 'https://elsewhere.example.test/cb'] }],
    ['missing redirect', { ...good, redirect_uris: loopbackRedirectUris().slice(1) }],
  ]) {
    const fake = await fakeAdmin([bad]);
    try {
      await assert.rejects(register({ supabaseUrl: fake.url, serviceRoleKey: 'svc', name: 'PMO CLI' }), /PMO CLI/, label);
      assert.equal(fake.requests.filter((r) => r.method === 'POST').length, 0, label);
    } finally {
      await fake.close();
    }
  }
});

test('AC-CLI-008: --name needs a value; --hosted is a flag', () => {
  assert.deepEqual(parseRegisterArgs([]), { name: 'PMO CLI', hosted: false });
  assert.deepEqual(parseRegisterArgs(['--name', 'PMO CLI (staging)', '--hosted']), { name: 'PMO CLI (staging)', hosted: true });
  assert.throws(() => parseRegisterArgs(['--name']), /--name/);
  assert.throws(() => parseRegisterArgs(['--name', '--hosted']), /--name/);
  assert.throws(() => parseRegisterArgs(['--name', '']), /--name/);
  assert.throws(() => parseRegisterArgs(['--bogus']), /--bogus/);
});
