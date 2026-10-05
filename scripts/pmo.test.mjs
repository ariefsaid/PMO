/**
 * pmo.test.mjs — unit tests for the PMO command-line client (scripts/pmo.mjs, issue #728).
 *
 * Run:  node --test scripts/pmo.test.mjs
 *
 * Everything runs against a FAKE Supabase served by node:http on an ephemeral port, and a temp
 * config dir — never the real ~/.config/pmo, never the shared local stack. The cross-stack proof
 * (real GoTrue OAuth server, real consent page, real RLS) is the Playwright journey
 * pmo-portal/e2e/AC-CLI-001-cli-oauth-login.spec.ts.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ALLOWED_RPCS,
  ALLOWED_TABLES,
  READ_ONLY_TABLES,
  COMMANDS,
  LOOPBACK_PORTS,
  buildAuthorizeUrl,
  buildQuery,
  challengeFor,
  createPkce,
  guardWritePayload,
  loopbackRedirectUris,
  readCredentials,
  run,
  writeCredentials,
} from './pmo.mjs';

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-cli-test-'));

/** A minimal fake of the three Supabase surfaces the CLI talks to: GoTrue OAuth, /user, PostgREST. */
async function fakeSupabase(overrides = {}) {
  const requests = [];
  const state = {
    authorizeChallenge: null,
    refreshCount: 0,
    issuedRefresh: 'refresh-1',
    accessValid: new Set(['access-1']),
    ...overrides.state,
  };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, body });
    const send = (status, json) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(json === undefined ? '' : JSON.stringify(json));
    };
    const handler = overrides.handler && overrides.handler({ req, res, url, body, send, state });
    if (handler) return;
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (url.pathname === '/auth/v1/oauth/token') {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'authorization_code') {
        const expected = state.authorizeChallenge;
        if (!expected || challengeFor(form.get('code_verifier') ?? '') !== expected || form.get('code') !== 'the-code') {
          return send(400, { error: 'invalid_grant' });
        }
        return send(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, token_type: 'bearer' });
      }
      if (form.get('grant_type') === 'refresh_token') {
        if (form.get('refresh_token') !== state.issuedRefresh) {
          return send(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        }
        state.refreshCount += 1;
        state.issuedRefresh = `refresh-${state.refreshCount + 1}`;
        const access = `access-${state.refreshCount + 1}`;
        state.accessValid.add(access);
        return send(200, { access_token: access, refresh_token: state.issuedRefresh, expires_in: 3600, token_type: 'bearer' });
      }
      return send(400, { error: 'unsupported_grant_type' });
    }
    if (url.pathname === '/auth/v1/user') {
      if (!state.accessValid.has(bearer)) return send(401, { code: 401, msg: 'invalid JWT' });
      return send(200, { id: 'user-1', email: 'owner@example.test' });
    }
    if (url.pathname === '/auth/v1/logout') {
      state.accessValid.delete(bearer);
      state.issuedRefresh = null;
      return send(204);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (!state.accessValid.has(bearer)) return send(401, { code: 'PGRST301', message: 'JWT expired' });
      if (url.pathname === '/rest/v1/profiles') return send(200, [{ full_name: 'Owner', role: 'Admin', status: 'active' }]);
      if (req.method === 'GET') return send(200, [{ id: 'row-1' }]);
      if (req.method === 'PATCH' && url.searchParams.get('id') === 'eq.missing') return send(200, []);
      if (url.pathname === '/rest/v1/project_milestones' && req.method === 'POST' && overrides.refuseWrite) {
        return send(403, { code: '42501', message: 'new row violates row-level security policy for table "project_milestones"' });
      }
      return send(req.method === 'POST' && !url.pathname.includes('/rpc/') ? 201 : 200, [JSON.parse(body || '{}')]);
    }
    return send(404, { error: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    state,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Capture a run() invocation's stdout/stderr and exit code. */
async function runCli(argv, { env = {}, configDir, openBrowser, ports, now, stdin } = {}) {
  let out = '';
  let err = '';
  const code = await run(argv, {
    env: { PMO_CONFIG_DIR: configDir, PMO_SUPABASE_KEY: 'test-publishable-key', ...env },
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    openBrowser: openBrowser ?? (() => {}),
    ports: ports ?? [0],
    now,
    stdin: stdin ?? (async function* () {})(),
  });
  let json = null;
  try {
    json = JSON.parse(out);
  } catch {
    /* not JSON */
  }
  let errJson = null;
  try {
    errJson = JSON.parse(err.trim().split('\n').pop());
  } catch {
    /* not JSON */
  }
  return { code, out, err, json, errJson };
}

/** Seed a signed-in credentials file for `supabaseUrl`. */
function seedCredentials(configDir, supabaseUrl, entry = {}) {
  writeCredentials(
    { PMO_CONFIG_DIR: configDir },
    supabaseUrl,
    {
      client_id: 'client-1',
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'user-1', email: 'owner@example.test' },
      ...entry,
    },
  );
}

/** GET the loopback URL with an explicit Host header (fetch cannot set one). */
function rawGet(url, host) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers: { host } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Drive a login: `openBrowser` plays the browser — it follows the consent redirect to the loopback. */
function browserThatRedirects({ fake, stateOverride, codeOverride, error }) {
  return async (authorizeUrl) => {
    const u = new URL(authorizeUrl);
    fake.state.authorizeChallenge = u.searchParams.get('code_challenge');
    const redirect = new URL(u.searchParams.get('redirect_uri'));
    if (error) redirect.searchParams.set('error', error);
    else redirect.searchParams.set('code', codeOverride ?? 'the-code');
    redirect.searchParams.set('state', stateOverride ?? u.searchParams.get('state'));
    const res = await fetch(redirect);
    await res.text();
  };
}

// ── AC-CLI-008: PKCE + state ─────────────────────────────────────────────────────────────────────

test('AC-CLI-008: PKCE uses S256 — the challenge is base64url(sha256(verifier)) and the verifier is high-entropy', () => {
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.equal(challenge, expected);
  assert.notEqual(createPkce().verifier, verifier, 'each login gets a fresh verifier');
});

test('AC-CLI-008: the authorize URL asks for a code with an S256 challenge, the state and the loopback redirect', () => {
  const url = new URL(
    buildAuthorizeUrl({
      supabaseUrl: 'http://127.0.0.1:54321',
      clientId: 'client-1',
      redirectUri: 'http://127.0.0.1:53917/callback',
      challenge: 'abc',
      state: 'st',
    }),
  );
  assert.equal(url.origin + url.pathname, 'http://127.0.0.1:54321/auth/v1/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'client-1');
  assert.equal(url.searchParams.get('code_challenge'), 'abc');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:53917/callback');
});

test('AC-CLI-008: the registered redirect URIs are loopback-only, on 127.0.0.1, one per fixed port', () => {
  const uris = loopbackRedirectUris();
  assert.equal(uris.length, LOOPBACK_PORTS.length);
  for (const [i, uri] of uris.entries()) {
    assert.equal(uri, `http://127.0.0.1:${LOOPBACK_PORTS[i]}/callback`);
  }
});

test('AC-CLI-008: login completes with PKCE, stores the session, and never prints a token', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    const r = await runCli(['login', '--url', fake.url, '--client-id', 'client-1'], {
      configDir,
      openBrowser: browserThatRedirects({ fake }),
    });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json, { signed_in: true, url: fake.url, user: { id: 'user-1', email: 'owner@example.test' } });
    assert.match(r.err, /\/auth\/v1\/oauth\/authorize\?/, 'the sign-in URL is printed for the user');
    assert.doesNotMatch(r.out + r.err, /access-1|refresh-1/, 'tokens are never printed');
    const saved = readCredentials({ PMO_CONFIG_DIR: configDir }, fake.url);
    assert.equal(saved.refresh_token, 'refresh-1');
    assert.equal(saved.client_id, 'client-1');
    const exchange = fake.requests.find((q) => q.path === '/auth/v1/oauth/token');
    const form = new URLSearchParams(exchange.body);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('client_id'), 'client-1');
    assert.equal(form.has('client_secret'), false, 'a public client sends no secret');
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-008: callbacks with the wrong state or the wrong Host are answered 400 and ignored — the real one still completes', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  const statuses = {};
  try {
    const r = await runCli(['login', '--url', fake.url, '--client-id', 'client-1'], {
      configDir,
      openBrowser: async (authorizeUrl) => {
        const u = new URL(authorizeUrl);
        const redirect = new URL(u.searchParams.get('redirect_uri'));
        const forged = new URL(redirect);
        forged.searchParams.set('code', 'forged-code');
        forged.searchParams.set('state', 'forged-state');
        statuses.forgedState = (await fetch(forged)).status;
        const wrongHost = new URL(redirect);
        wrongHost.searchParams.set('code', 'the-code');
        wrongHost.searchParams.set('state', u.searchParams.get('state'));
        statuses.wrongHost = await rawGet(wrongHost, 'attacker.example.test');
        statuses.localhostName = await rawGet(wrongHost, `localhost:${redirect.port}`);
        await browserThatRedirects({ fake })(authorizeUrl);
      },
    });
    assert.equal(statuses.forgedState, 400);
    assert.equal(statuses.wrongHost, 400);
    assert.equal(statuses.localhostName, 400, 'only the exact registered host is accepted');
    assert.equal(r.code, 0, r.err);
    const exchanges = fake.requests.filter((q) => q.path === '/auth/v1/oauth/token');
    assert.equal(exchanges.length, 1, 'only the genuine callback is exchanged');
    assert.equal(new URLSearchParams(exchanges[0].body).get('code'), 'the-code');
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-008: a denied consent ends the login with the error and stores nothing', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    const r = await runCli(['login', '--url', fake.url, '--client-id', 'client-1'], {
      configDir,
      openBrowser: browserThatRedirects({ fake, error: 'access_denied' }),
    });
    assert.equal(r.code, 1);
    assert.match(r.errJson.error.message, /access_denied/);
    assert.equal(readCredentials({ PMO_CONFIG_DIR: configDir }, fake.url), null);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-008: login times out when the browser never comes back', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    const r = await runCli(['login', '--url', fake.url, '--client-id', 'client-1', '--timeout', '0.2'], {
      configDir,
    });
    assert.equal(r.code, 1);
    assert.match(r.errJson.error.message, /timed out/i);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-008: --no-browser only prints the sign-in URL and never launches a browser', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  let launched = false;
  try {
    const r = await runCli(['login', '--url', fake.url, '--client-id', 'client-1', '--no-browser', '--timeout', '0.2'], {
      configDir,
      openBrowser: () => (launched = true),
    });
    assert.equal(r.code, 1);
    assert.equal(launched, false);
    assert.match(r.err, /\/auth\/v1\/oauth\/authorize\?/);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-008: login needs a client id and says where to get one', async () => {
  const configDir = tmpDir();
  try {
    const r = await runCli(['login', '--no-browser'], { configDir });
    assert.equal(r.code, 2);
    assert.match(r.errJson.error.message, /PMO_CLIENT_ID|--client-id/);
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-008: a remote Supabase URL must be https — tokens never cross the network in clear text', async () => {
  const configDir = tmpDir();
  try {
    const r = await runCli(['whoami', '--url', 'http://pmo.example.test'], { configDir });
    assert.equal(r.code, 2);
    assert.match(r.errJson.error.message, /https/);
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

// ── AC-CLI-011: credentials file permissions ─────────────────────────────────────────────────────

test('AC-CLI-011: credentials are written owner-only — file 0600 inside a 0700 dir, keyed by Supabase URL', () => {
  const root = tmpDir();
  const configDir = path.join(root, 'pmo');
  try {
    writeCredentials({ PMO_CONFIG_DIR: configDir }, 'http://a.test', { refresh_token: 'r-a' });
    writeCredentials({ PMO_CONFIG_DIR: configDir }, 'http://b.test', { refresh_token: 'r-b' });
    const file = path.join(configDir, 'credentials.json');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(configDir).mode & 0o777, 0o700);
    assert.equal(readCredentials({ PMO_CONFIG_DIR: configDir }, 'http://a.test').refresh_token, 'r-a');
    assert.equal(readCredentials({ PMO_CONFIG_DIR: configDir }, 'http://b.test').refresh_token, 'r-b');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-CLI-011: a pre-existing loose-permission file and dir are tightened on write', () => {
  const configDir = tmpDir();
  try {
    fs.chmodSync(configDir, 0o755);
    const file = path.join(configDir, 'credentials.json');
    fs.writeFileSync(file, '{}', { mode: 0o644 });
    writeCredentials({ PMO_CONFIG_DIR: configDir }, 'http://a.test', { refresh_token: 'r' });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(configDir).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

// ── AC-CLI-005: transparent refresh ──────────────────────────────────────────────────────────────

test('AC-CLI-005: an expired access token is refreshed before the call and the ROTATED refresh token is persisted', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url, { expires_at: Math.floor(Date.now() / 1000) - 10 });
    fake.state.accessValid.delete('access-1');
    const r = await runCli(['get', 'projects', '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json, [{ id: 'row-1' }]);
    const refresh = fake.requests.find((q) => q.path === '/auth/v1/oauth/token');
    assert.equal(new URLSearchParams(refresh.body).get('grant_type'), 'refresh_token');
    assert.equal(new URLSearchParams(refresh.body).get('client_id'), 'client-1');
    const saved = readCredentials({ PMO_CONFIG_DIR: configDir }, fake.url);
    assert.equal(saved.refresh_token, 'refresh-2', 'the rotated refresh token replaces the spent one');
    assert.equal(saved.access_token, 'access-2');
    assert.ok(saved.expires_at > Math.floor(Date.now() / 1000));
    const rest = fake.requests.find((q) => q.path === '/rest/v1/projects');
    assert.equal(rest.headers.authorization, 'Bearer access-2');
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-005: a token the server rejects mid-life (401) is refreshed once and the call retried', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    fake.state.accessValid.delete('access-1');
    const r = await runCli(['get', 'projects', '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    assert.equal(fake.state.refreshCount, 1);
    assert.equal(readCredentials({ PMO_CONFIG_DIR: configDir }, fake.url).refresh_token, 'refresh-2');
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-005: a refused refresh (revoked / banned) clears nothing silently — it says sign in again', async () => {
  const fake = await fakeSupabase({
    handler: ({ url, send }) => {
      if (url.pathname === '/auth/v1/oauth/token') {
        send(400, { code: 400, error_code: 'user_banned', msg: 'Invalid Refresh Token: User Banned' });
        return true;
      }
      return false;
    },
  });
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url, { expires_at: 0 });
    const r = await runCli(['get', 'projects', '--url', fake.url], { configDir });
    assert.equal(r.code, 1);
    assert.match(r.errJson.error.message, /pmo login/);
    assert.equal(r.errJson.error.code, 'user_banned');
    assert.equal(fake.requests.filter((q) => q.path.startsWith('/rest/')).length, 0);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

// ── AC-CLI-004 (unit half): signed out ───────────────────────────────────────────────────────────

test('AC-CLI-004: with no stored session every data command refuses and says to sign in', async () => {
  const configDir = tmpDir();
  try {
    for (const argv of [['whoami'], ['get', 'projects'], ['create', 'tasks', '{}'], ['update', 'tasks', '--filter', 'id=eq.1', '{}']]) {
      const r = await runCli(argv, { configDir });
      assert.equal(r.code, 1, argv.join(' '));
      assert.match(r.errJson.error.message, /not signed in.*pmo login/i);
    }
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-004: logout with an EXPIRED access token refreshes first, then revokes with the fresh token', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url, { expires_at: 0 });
    fake.state.accessValid.delete('access-1');
    const r = await runCli(['logout', '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    const refresh = fake.requests.find((q) => q.path === '/auth/v1/oauth/token');
    assert.equal(new URLSearchParams(refresh.body).get('refresh_token'), 'refresh-1');
    const call = fake.requests.find((q) => q.path === '/auth/v1/logout');
    assert.equal(call.headers.authorization, 'Bearer access-2', 'revoked with the refreshed token');
    assert.equal(readCredentials({ PMO_CONFIG_DIR: configDir }, fake.url), null);
    // The old refresh token is dead afterwards.
    const reuse = await fetch(`${fake.url}/auth/v1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: 'client-1' }),
    });
    assert.equal(reuse.status, 400);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-004: when the server does not confirm the revoke, logout keeps the credentials and exits 1', async () => {
  const fake = await fakeSupabase({
    handler: ({ url, send }) => {
      if (url.pathname === '/auth/v1/logout') {
        send(500, { code: 500, msg: 'unavailable' });
        return true;
      }
      return false;
    },
  });
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    const r = await runCli(['logout', '--url', fake.url], { configDir });
    assert.equal(r.code, 1);
    assert.match(r.errJson.error.message, /kept/i);
    assert.equal(readCredentials({ PMO_CONFIG_DIR: configDir }, fake.url).refresh_token, 'refresh-1');
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-004: a session the server already ended (refresh refused) is removed locally without a revoke call', async () => {
  const fake = await fakeSupabase({
    handler: ({ url, send }) => {
      if (url.pathname === '/auth/v1/oauth/token') {
        send(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        return true;
      }
      return false;
    },
  });
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url, { expires_at: 0 });
    const r = await runCli(['logout', '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json, { signed_out: true, url: fake.url, already_ended: true });
    assert.equal(fake.requests.filter((q) => q.path === '/auth/v1/logout').length, 0);
    assert.equal(readCredentials({ PMO_CONFIG_DIR: configDir }, fake.url), null);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-004: logout revokes this session only (scope=local) and removes it from the file', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    seedCredentials(configDir, 'http://127.0.0.1:1', { refresh_token: 'other' });
    const r = await runCli(['logout', '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json, { signed_out: true, url: fake.url });
    const call = fake.requests.find((q) => q.path === '/auth/v1/logout');
    assert.equal(call.search, '?scope=local');
    assert.equal(call.headers.authorization, 'Bearer access-1');
    assert.equal(readCredentials({ PMO_CONFIG_DIR: configDir }, fake.url), null);
    assert.equal(readCredentials({ PMO_CONFIG_DIR: configDir }, 'http://127.0.0.1:1').refresh_token, 'other');
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

// ── whoami ───────────────────────────────────────────────────────────────────────────────────────

test('AC-CLI-001: whoami reports the signed-in user and their PMO role from their own session', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    const r = await runCli(['whoami', '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json, {
      url: fake.url,
      id: 'user-1',
      email: 'owner@example.test',
      full_name: 'Owner',
      role: 'Admin',
      status: 'active',
    });
    for (const q of fake.requests) {
      assert.equal(q.headers.apikey, 'test-publishable-key');
      assert.equal(q.headers.authorization, 'Bearer access-1', 'every call carries the user token, never a service key');
    }
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

// ── AC-CLI-013: arguments → PostgREST ────────────────────────────────────────────────────────────

test('AC-CLI-013: --select, repeated --filter and --limit become a PostgREST query', () => {
  const q = buildQuery({ select: 'id,name', filters: ['status=eq.Leads', 'name=ilike.*Depot*'], limit: '5' });
  assert.equal(q.get('select'), 'id,name');
  assert.equal(q.get('status'), 'eq.Leads');
  assert.equal(q.get('name'), 'ilike.*Depot*');
  assert.equal(q.get('limit'), '5');
  assert.equal(buildQuery({ filters: ['archived_at=not.is.null'] }).get('archived_at'), 'not.is.null');
  assert.equal(buildQuery({ filters: ['id=in.(a,b)'] }).get('id'), 'in.(a,b)');
});

test('AC-CLI-013: malformed or smuggling arguments are refused', () => {
  assert.throws(() => buildQuery({ filters: ['status'] }), /col=op\.value/);
  assert.throws(() => buildQuery({ filters: ['status=Leads'] }), /operator/);
  assert.throws(() => buildQuery({ filters: ['status=drop.x'] }), /operator/);
  assert.throws(() => buildQuery({ filters: ['select=eq.x'] }), /reserved/);
  assert.throws(() => buildQuery({ filters: ['a&b=eq.x'] }), /column/);
  assert.throws(() => buildQuery({ limit: '-1' }), /limit/);
  assert.throws(() => buildQuery({ limit: 'ten' }), /limit/);
  // Embeds would read tables outside the allow-list — plain columns only.
  assert.throws(() => buildQuery({ select: '*,budget_lines(*)' }), /select/);
  assert.equal(buildQuery({ select: '*' }).get('select'), '*');
});

test('AC-CLI-013: get sends the query to the table under the user token and prints JSON', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    const r = await runCli(['get', 'companies', '--select', 'id,name', '--filter', 'type=eq.Client', '--limit', '2', '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    const call = fake.requests.find((q) => q.path === '/rest/v1/companies');
    const params = new URLSearchParams(call.search);
    assert.equal(params.get('select'), 'id,name');
    assert.equal(params.get('type'), 'eq.Client');
    assert.equal(params.get('limit'), '2');
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-013: create reads JSON inline, from @file or from stdin (-)', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    const file = path.join(configDir, 'row.json');
    fs.writeFileSync(file, JSON.stringify({ name: 'From file' }));
    let r = await runCli(['create', 'companies', `@${file}`, '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json, [{ name: 'From file' }]);
    r = await runCli(['create', 'companies', '{"name":"Inline"}', '--url', fake.url], { configDir });
    assert.deepEqual(r.json, [{ name: 'Inline' }]);
    const posts = fake.requests.filter((q) => q.method === 'POST' && q.path === '/rest/v1/companies');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].headers.prefer, 'return=representation');
    r = await runCli(['create', 'companies', '-', '--url', fake.url], {
      configDir,
      stdin: (async function* () {
        yield Buffer.from('[{"name":"From');
        yield Buffer.from(' stdin"}]');
      })(),
    });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json, [[{ name: 'From stdin' }]], 'the fake echoes the posted body');
    r = await runCli(['create', 'companies', 'not json', '--url', fake.url], { configDir });
    assert.equal(r.code, 2);
    assert.match(r.errJson.error.message, /JSON/);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-013: update needs a filter, PATCHes the matched rows, and a zero-row result is an error', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    let r = await runCli(['update', 'tasks', '{"title":"x"}', '--url', fake.url], { configDir });
    assert.equal(r.code, 2);
    assert.match(r.errJson.error.message, /--filter/);
    r = await runCli(['update', 'tasks', '--filter', 'id=eq.t1', '{"title":"x"}', '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    const patch = fake.requests.find((q) => q.method === 'PATCH');
    assert.equal(new URLSearchParams(patch.search).get('id'), 'eq.t1');
    r = await runCli(['update', 'tasks', '--filter', 'id=eq.missing', '{"title":"x"}', '--url', fake.url], { configDir });
    assert.equal(r.code, 1);
    assert.match(r.errJson.error.message, /no row/i);
    r = await runCli(['update', 'tasks', '--filter', 'id=eq.t1', '[{"title":"x"}]', '--url', fake.url], { configDir });
    assert.equal(r.code, 2, 'update takes one object, not a list');
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-002: a database refusal is passed through verbatim as JSON with a non-zero exit', async () => {
  const fake = await fakeSupabase({ refuseWrite: true });
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    const r = await runCli(['create', 'project_milestones', '{"project_id":"p","name":"m"}', '--url', fake.url], { configDir });
    assert.equal(r.code, 1);
    assert.equal(r.errJson.error.status, 403);
    assert.equal(r.errJson.error.code, '42501');
    assert.match(r.errJson.error.message, /row-level security/);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

// ── AC-CLI-009: allow-lists ──────────────────────────────────────────────────────────────────────

test('AC-CLI-009: the table allow-list is exactly the DD-API-3 entities', () => {
  assert.deepEqual([...ALLOWED_TABLES].sort(), [
    'companies',
    'contacts',
    'crm_activities',
    'meetings',
    'project_milestones',
    'projects',
    'tasks',
  ]);
});

test('AC-CLI-009: tables outside the allow-list are refused for every verb, before any network call', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    for (const argv of [
      ['get', 'budget_lines'],
      ['get', 'auth_users'],
      ['create', 'sales_invoices', '{}'],
      ['update', 'work_orders', '--filter', 'id=eq.1', '{}'],
      ['get', '../rpc/transition_project'],
    ]) {
      const r = await runCli([...argv, '--url', fake.url], { configDir });
      assert.equal(r.code, 2, argv.join(' '));
      assert.match(r.errJson.error.message, /not available/i);
    }
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-009: RPCs outside the allow-list are refused — no money, transition or budget-activation RPC', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    for (const name of ['transition_project', 'activate_budget_version', 'set_project_contract_value', 'create_payment', 'submit_sales_invoice']) {
      assert.equal(ALLOWED_RPCS.includes(name), false, name);
      const r = await runCli(['rpc', name, '{}', '--url', fake.url], { configDir });
      assert.equal(r.code, 2, name);
      assert.match(r.errJson.error.message, /not available/i);
    }
    assert.equal(fake.requests.length, 0);
    const ok = await runCli(['rpc', 'get_project_milestones', '{"p_project_id":"p1"}', '--url', fake.url], { configDir });
    assert.equal(ok.code, 0, ok.err);
    const call = fake.requests.find((q) => q.path === '/rest/v1/rpc/get_project_milestones');
    assert.deepEqual(JSON.parse(call.body), { p_project_id: 'p1' });
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

// ── AC-CLI-014: profiles, read-only and narrowed ─────────────────────────────────────────────────

test('AC-CLI-014: profiles is readable only, through a fixed set of non-sensitive columns', () => {
  assert.deepEqual(Object.keys(READ_ONLY_TABLES), ['profiles']);
  assert.deepEqual(READ_ONLY_TABLES.profiles, ['id', 'full_name', 'role', 'title', 'status']);
  assert.equal(ALLOWED_TABLES.includes('profiles'), false, 'profiles is not writable');
});

test('AC-CLI-014: get profiles selects only the non-sensitive columns by default, and a narrower --select is allowed', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    let r = await runCli(['get', 'profiles', '--filter', 'role=eq.Engineer', '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    let call = fake.requests.findLast((q) => q.path === '/rest/v1/profiles');
    assert.equal(new URLSearchParams(call.search).get('select'), 'id,full_name,role,title,status');
    assert.equal(new URLSearchParams(call.search).get('role'), 'eq.Engineer');
    r = await runCli(['get', 'profiles', '--select', 'id,full_name', '--url', fake.url], { configDir });
    assert.equal(r.code, 0, r.err);
    call = fake.requests.findLast((q) => q.path === '/rest/v1/profiles');
    assert.equal(new URLSearchParams(call.search).get('select'), 'id,full_name');
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-014: other profile columns cannot be selected or filtered on (no email lookups)', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    for (const args of [
      ['--select', '*'],
      ['--select', 'id,email'],
      ['--select', 'locale'],
      ['--filter', 'email=eq.someone@example.test'],
      ['--filter', 'manager_id=eq.x'],
    ]) {
      const r = await runCli(['get', 'profiles', ...args, '--url', fake.url], { configDir });
      assert.equal(r.code, 2, args.join(' '));
      assert.match(r.errJson.error.message, /profiles/);
    }
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('AC-CLI-014: profiles cannot be created or updated from the CLI', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    for (const argv of [
      ['create', 'profiles', '{"full_name":"X"}'],
      ['update', 'profiles', '--filter', 'id=eq.user-1', '{"role":"Admin"}'],
    ]) {
      const r = await runCli([...argv, '--url', fake.url], { configDir });
      assert.equal(r.code, 2, argv.join(' '));
      assert.match(r.errJson.error.message, /profiles is read-only/);
    }
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

// ── AC-CLI-007: no delete ────────────────────────────────────────────────────────────────────────

test('AC-CLI-007: the CLI offers no delete — no verb, no DELETE request, a clear refusal', async () => {
  assert.deepEqual([...COMMANDS].sort(), ['create', 'get', 'login', 'logout', 'rpc', 'update', 'whoami']);
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    for (const verb of ['delete', 'rm', 'remove', 'destroy']) {
      const r = await runCli([verb, 'tasks', '--filter', 'id=eq.1', '--url', fake.url], { configDir });
      assert.equal(r.code, 2, verb);
      assert.match(r.errJson.error.message, /^The PMO CLI offers no delete/);
    }
    assert.equal(fake.requests.filter((q) => q.method === 'DELETE').length, 0);
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

// ── AC-CLI-010: contract value + project status ──────────────────────────────────────────────────

test('AC-CLI-010: contract_value is refused in any create or update payload', () => {
  assert.throws(() => guardWritePayload('projects', { name: 'X', contract_value: 5 }, 'create'), /contract_value/);
  assert.throws(() => guardWritePayload('projects', [{ name: 'A' }, { name: 'B', contract_value: 0 }], 'create'), /contract_value/);
  assert.throws(() => guardWritePayload('projects', { contract_value: 1 }, 'update'), /contract_value/);
  assert.throws(() => guardWritePayload('tasks', { contract_value: 1 }, 'update'), /contract_value/);
});

test('AC-CLI-010: a project status change is refused; creation only as Leads or Internal Project', () => {
  assert.throws(() => guardWritePayload('projects', { status: 'Ongoing Project' }, 'update'), /status/);
  assert.throws(() => guardWritePayload('projects', { status: 'Leads' }, 'update'), /status/);
  assert.throws(() => guardWritePayload('projects', { name: 'X', status: 'Won, Pending KoM' }, 'create'), /Leads|Internal Project/);
  assert.doesNotThrow(() => guardWritePayload('projects', { name: 'X', status: 'Leads' }, 'create'));
  assert.doesNotThrow(() => guardWritePayload('projects', { name: 'X', status: 'Internal Project' }, 'create'));
  assert.doesNotThrow(() => guardWritePayload('projects', { name: 'X' }, 'create'));
  assert.doesNotThrow(() => guardWritePayload('projects', { name: 'Renamed' }, 'update'));
  // Other tables keep their own status columns (tasks, meetings) — only the project lifecycle is closed.
  assert.doesNotThrow(() => guardWritePayload('tasks', { status: 'Done' }, 'update'));
});

test('AC-CLI-010: archived_at cannot be set or cleared from the CLI (archiving stays in the app)', () => {
  assert.throws(() => guardWritePayload('tasks', { archived_at: '2026-01-01T00:00:00Z' }, 'update'), /archived_at/);
  assert.throws(() => guardWritePayload('projects', { archived_at: null }, 'update'), /archived_at/);
  assert.throws(() => guardWritePayload('companies', [{ name: 'A', archived_at: '2026-01-01' }], 'create'), /archived_at/);
});

test('AC-CLI-010: the refusal happens before any request reaches the server', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    let r = await runCli(['create', 'projects', '{"name":"X","contract_value":100}', '--url', fake.url], { configDir });
    assert.equal(r.code, 2);
    assert.match(r.errJson.error.message, /contract_value/);
    r = await runCli(['update', 'projects', '--filter', 'id=eq.p1', '{"status":"Ongoing Project"}', '--url', fake.url], { configDir });
    assert.equal(r.code, 2);
    assert.match(r.errJson.error.message, /status/);
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

// ── L5: no redirects ─────────────────────────────────────────────────────────────────────────────

test('AC-CLI-008: the CLI never follows an HTTP redirect with the user token', async () => {
  const fake = await fakeSupabase({
    handler: ({ url, res }) => {
      if (url.pathname === '/rest/v1/projects') {
        res.writeHead(302, { location: '/elsewhere' });
        res.end();
        return true;
      }
      return false;
    },
  });
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    const r = await runCli(['get', 'projects', '--url', fake.url], { configDir });
    assert.equal(r.code, 1);
    assert.equal(fake.requests.filter((q) => q.path === '/elsewhere').length, 0, 'the redirect was not followed');
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

// ── AC-CLI-015: the CLI and the database agree on the API client surface ─────────────────────────

test('AC-CLI-015: the CLI allow-lists match the database guard (latest migration defining api_client_request_guard)', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'supabase', 'migrations');
  const latest = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => /function public\.api_client_request_guard\(\)/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .pop();
  assert.ok(latest, 'a migration defines public.api_client_request_guard()');
  const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
  const list = (name) => {
    const m = sql.match(new RegExp(`${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`));
    assert.ok(m, `${name} is declared in ${latest}`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  };
  assert.deepEqual(list('write_tables'), [...ALLOWED_TABLES].sort());
  assert.deepEqual(list('read_only_tables'), Object.keys(READ_ONLY_TABLES).sort());
  assert.deepEqual(list('rpcs'), [...ALLOWED_RPCS].sort());
});

test('usage: no command or --help prints usage JSON and exits 2 / 0', async () => {
  const configDir = tmpDir();
  try {
    let r = await runCli([], { configDir });
    assert.equal(r.code, 2);
    assert.match(r.err, /usage/i);
    r = await runCli(['--help'], { configDir });
    assert.equal(r.code, 0);
    assert.match(r.out, /pmo login/);
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});



test('AC-EC-004 projects accept end_client_id and send it in the body like any project column (#758)', async () => {
  const assert = (await import('node:assert/strict')).default;
  const { guardWritePayload } = await import('./pmo.mjs');
  // The CLI write guard must NOT refuse a project payload naming end_client_id (create or update),
  // and the field passes through the generic write path unchanged.
  assert.doesNotThrow(() =>
    guardWritePayload('projects', { name: 'D', status: 'Leads', end_client_id: '75800000-0000-0000-0000-0000000000a1' }, 'create'),
  );
  assert.doesNotThrow(() =>
    guardWritePayload('projects', { end_client_id: '75800000-0000-0000-0000-0000000000a1' }, 'update'),
  );
});


test('company short name crosses the CLI write seam separately from its legal name (references AC-NICK-003)', async () => {
  const fake = await fakeSupabase();
  const configDir = tmpDir();
  try {
    seedCredentials(configDir, fake.url);
    const create = await runCli(['create', 'companies', '{"name":"Example Legal Company","type":"Client","short_name":"Example"}', '--url', fake.url], { configDir });
    assert.equal(create.code, 0, create.err);
    assert.deepEqual(create.json, [{ name: 'Example Legal Company', type: 'Client', short_name: 'Example' }]);
    const update = await runCli(['update', 'companies', '--filter', 'id=eq.c1', '{"short_name":"Example Two"}', '--url', fake.url], { configDir });
    assert.equal(update.code, 0, update.err);
    assert.deepEqual(update.json, [{ short_name: 'Example Two' }]);
  } finally {
    await fake.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
