import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  findPort,
  installBrowserRouteGuard,
  startHandlerServer,
  stopHandlerServer,
  wantedHeaders,
} from './AC-S21-005-runtime.mjs';

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SUPPORT_DIR, '../..');
const EXPECTED_REPO_ROOT = path.resolve(APP_ROOT, '..');

const LOCAL_STATUS = {
  API_URL: 'http://127.0.0.1:54321',
  DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  ANON_KEY: 'anon-key',
  SERVICE_ROLE_KEY: 'service-role-key',
};

const FIXTURE = {
  orgId: '0e6fbc85-2b47-4ac2-9a0a-867b37c88f21',
  userId: '1a55d3f4-8b0d-4dbf-9e88-54b40d6fa50c',
  projectId: '27d4a2a1-4e0a-4c44-9e37-4a99ba8ea5b3',
  orgBindingId: '3cb28b67-9d51-4c2d-9d0b-6ff04b9ec5da',
  teamId: 's21_team_deadbeef',
  teamName: 'S21 Team deadbeef',
  spaceId: 's21_space_deadbeef',
  spaceName: 'S21 Space deadbeef',
  listId: 's21_list_deadbeef',
  listName: 'S21 Review deadbeef',
};

const SENTINEL = 'S21_SYNTHETIC_vault_sentinel';

class FakeHandlerChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 4242;
    this.exitCode = null;
    this.signalCode = null;
    this.signals = [];
    this.stdinPayloads = [];
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdout.resume = () => {};
    this.stderr.resume = () => {};
    this.stdin = {
      end: (payload) => {
        this.stdinPayloads.push(payload);
      },
    };
  }

  kill(signal) {
    this.signals.push(signal);
    if (this.dieOnSignal === signal) {
      this.exitCode = 0;
      queueMicrotask(() => this.emit('exit', 0));
    }
    return true;
  }
}

function fakeSpawn(child, { autoReady = true } = {}) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    if (autoReady) {
      queueMicrotask(() => child.stdout.emit('data', Buffer.from('{"event":"ready"}\n')));
    }
    return child;
  };
  spawnImpl.calls = calls;
  return spawnImpl;
}

function fakePage() {
  const registered = {};
  return {
    registered,
    route: async (_pattern, handler) => {
      registered.routeHandler = handler;
    },
  };
}

function fakeRoute(requestUrl, { method = 'GET', body = null } = {}) {
  const calls = { continue: 0, abort: 0, fulfill: null };
  return {
    calls,
    request: () => ({
      url: () => requestUrl,
      method: () => method,
      allHeaders: async () => ({
        authorization: 'Bearer browser-session',
        cookie: 'sid=1',
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      }),
      postDataBuffer: () => body,
    }),
    continue: async () => {
      calls.continue += 1;
    },
    abort: async () => {
      calls.abort += 1;
    },
    fulfill: async (response) => {
      calls.fulfill = response;
    },
  };
}

test('wantedHeaders keeps only the allowlisted forwarding headers, case-insensitively', () => {
  const forwarded = wantedHeaders({
    Authorization: 'Bearer session',
    APIKEY: 'anon',
    'Content-Type': 'application/json',
    'x-client-info': 'supabase-js',
    PREFER: 'count=exact',
    accept: 'application/json',
    'Accept-Language': 'en-US',
    'X-Supabase-Api-Version': '1',
    cookie: 'sid=1',
    host: 'evil.example',
    'x-forwarded-for': '203.0.113.9',
  });
  assert.deepEqual(
    Object.keys(forwarded).map((name) => name.toLowerCase()).sort(),
    [
    'accept',
    'accept-language',
    'apikey',
    'authorization',
    'content-type',
    'prefer',
    'x-client-info',
    'x-supabase-api-version',
  ],
  );
});

test('findPort returns a port that is immediately bindable on the loopback interface', async () => {
  const port = await findPort();
  assert.ok(Number.isInteger(port) && port > 0);
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(() => resolve()));
});

test('startHandlerServer runs the handler from the repo root with a minimal environment', async () => {
  const child = new FakeHandlerChild();
  const spawnImpl = fakeSpawn(child);
  await startHandlerServer(LOCAL_STATUS, FIXTURE, SENTINEL, { spawnImpl });

  assert.equal(spawnImpl.calls.length, 1);
  const { command, args, options } = spawnImpl.calls[0];
  assert.equal(command, 'deno');
  assert.equal(options.cwd, EXPECTED_REPO_ROOT);
  assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'PATH', 'TMPDIR']);

  const joined = args.join(' ');
  assert.match(joined, /--no-remote/);
  assert.match(joined, /--config supabase\/functions\/external-link\/deno\.json /);
  assert.match(joined, new RegExp(`--allow-net=127\\.0\\.0\\.1:54321,127\\.0\\.0\\.1:\\d+`));
  assert.match(joined, /--allow-env=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,EDGE_JWT_ISSUER/);
  assert.match(joined, /pmo-portal\/e2e\/support\/AC-S21-005-handler-server\.mjs$/);
  assert.match(joined, /--allow-read=.*supabase\/functions\/external-lists/);
  assert.match(joined, /--allow-read=.*supabase\/functions\/_shared/);
  assert.ok(!joined.includes(LOCAL_STATUS.SERVICE_ROLE_KEY), 'service key must not appear in argv');
  assert.ok(!joined.includes(SENTINEL), 'vault sentinel must not appear in argv');
});

test('startHandlerServer hands the handler its config over stdin and reports the loopback origin', async () => {
  const child = new FakeHandlerChild();
  const spawnImpl = fakeSpawn(child);
  const server = await startHandlerServer(LOCAL_STATUS, FIXTURE, SENTINEL, { spawnImpl });

  assert.equal(child.stdinPayloads.length, 1);
  const handshake = JSON.parse(child.stdinPayloads[0]);
  assert.deepEqual(handshake, {
    supabaseUrl: LOCAL_STATUS.API_URL,
    serviceRoleKey: LOCAL_STATUS.SERVICE_ROLE_KEY,
    issuer: `${LOCAL_STATUS.API_URL}/auth/v1`,
    host: '127.0.0.1',
    port: server.port,
    teamId: FIXTURE.teamId,
    teamName: FIXTURE.teamName,
    spaceId: FIXTURE.spaceId,
    spaceName: FIXTURE.spaceName,
    listId: FIXTURE.listId,
    listName: FIXTURE.listName,
    sentinel: SENTINEL,
  });
  assert.equal(server.origin, `http://127.0.0.1:${server.port}`);
});

test('startHandlerServer resolves readiness from the handler stdout protocol and keeps only protocol lines', async () => {
  const child = new FakeHandlerChild();
  const server = await startHandlerServer(LOCAL_STATUS, FIXTURE, SENTINEL, {
    spawnImpl: fakeSpawn(child),
  });
  child.stdout.emit('data', Buffer.from('{"event":"summary","handlerPosts":{"externalLists":1,"externalLink":1}}\n'));
  assert.deepEqual(server.summary(), {
    event: 'summary',
    handlerPosts: { externalLists: 1, externalLink: 1 },
  });
});

test('startHandlerServer rejects a non-loopback database target before spawning', async () => {
  const child = new FakeHandlerChild();
  const spawnImpl = fakeSpawn(child);
  await assert.rejects(
    startHandlerServer(
      { ...LOCAL_STATUS, API_URL: 'https://supabase.example.com' },
      FIXTURE,
      SENTINEL,
      { spawnImpl },
    ),
    (error) => error.message === 'S21_DATABASE_TARGET_NOT_LOCAL',
  );
  assert.equal(spawnImpl.calls.length, 0);
});

test('startHandlerServer rejects with a start timeout and terminates the child it spawned', async () => {
  const child = new FakeHandlerChild();
  child.dieOnSignal = 'SIGTERM';
  await assert.rejects(
    startHandlerServer(LOCAL_STATUS, FIXTURE, SENTINEL, {
      spawnImpl: fakeSpawn(child, { autoReady: false }),
      readyTimeoutMs: 25,
    }),
    (error) => error.message === 'S21_HANDLER_SERVER_START_TIMEOUT',
  );
  assert.deepEqual(child.signals, ['SIGTERM']);
});

test('startHandlerServer rejects with early-exit when the child dies before signaling ready', async () => {
  const child = new FakeHandlerChild();
  const server = startHandlerServer(LOCAL_STATUS, FIXTURE, SENTINEL, {
    spawnImpl: fakeSpawn(child, { autoReady: false }),
    readyTimeoutMs: 500,
  });
  // The module attaches its exit listener after the port probe resolves; the handshake
  // write is the first thing that happens once every listener is in place.
  await new Promise((resolve) => {
    const poll = () => (child.stdinPayloads.length > 0 ? resolve() : setTimeout(poll, 1));
    poll();
  });
  child.exitCode = 1;
  child.emit('exit', 1);
  await assert.rejects(server, (error) => error.message === 'S21_HANDLER_SERVER_EXITED_EARLY');
});

test('stopHandlerServer stops nothing when no owned server exists', async () => {
  assert.equal(await stopHandlerServer(null), null);
});

test('stopHandlerServer terminates on SIGTERM and falls back to the captured protocol lines', async () => {
  const child = new FakeHandlerChild();
  child.dieOnSignal = 'SIGTERM';
  const server = await startHandlerServer(LOCAL_STATUS, FIXTURE, SENTINEL, {
    spawnImpl: fakeSpawn(child),
  });
  const summary = await stopHandlerServer(server, { termTimeoutMs: 50, killTimeoutMs: 20 });
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.deepEqual(summary, ['{"event":"ready"}']);
});

test('stopHandlerServer escalates SIGTERM to SIGKILL and fails teardown for a surviving child', async () => {
  const child = new FakeHandlerChild();
  const server = await startHandlerServer(LOCAL_STATUS, FIXTURE, SENTINEL, {
    spawnImpl: fakeSpawn(child),
  });
  await assert.rejects(
    stopHandlerServer(server, { termTimeoutMs: 20, killTimeoutMs: 20 }),
    (error) => error.message === 'S21_HANDLER_SERVER_TEARDOWN_FAILED',
  );
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
});

test('browser forwarding leaves same-origin requests to the network and never counts them', async () => {
  const page = fakePage();
  const guard = await installBrowserRouteGuard(
    page,
    LOCAL_STATUS.API_URL,
    'http://127.0.0.1:3000',
    { origin: 'http://127.0.0.1:9' },
    { steps: {}, ownedIds: {}, handlerResponseStatusCounts: {} },
    async () => {},
  );
  const route = fakeRoute('http://127.0.0.1:3000/login');
  await page.registered.routeHandler(route);
  assert.equal(route.calls.continue, 1);
  assert.equal(route.calls.abort, 0);
  assert.equal(route.calls.fulfill, null);
  assert.deepEqual(guard.snapshot(), { handlerPosts: 0, clickupOnboardRequests: 0 });
  assert.deepEqual(guard.blocked, {});
});

test('browser forwarding aborts non-local and operator-initializer requests and records the reasons', async () => {
  const page = fakePage();
  const ledger = { steps: {}, ownedIds: {}, handlerResponseStatusCounts: {} };
  const guard = await installBrowserRouteGuard(
    page,
    LOCAL_STATUS.API_URL,
    'http://127.0.0.1:3000',
    { origin: 'http://127.0.0.1:9' },
    ledger,
    async () => {},
  );

  const external = fakeRoute('https://api.clickup.com/api/v2/team');
  await page.registered.routeHandler(external);
  const initializer = fakeRoute(`${LOCAL_STATUS.API_URL}/functions/v1/clickup-onboard`, { method: 'POST' });
  await page.registered.routeHandler(initializer);

  assert.equal(external.calls.abort, 1);
  assert.equal(initializer.calls.abort, 1);
  assert.deepEqual(guard.blocked, { 'non-local-origin': 1, 'operator-initializer': 1 });
  assert.equal(guard.snapshot().clickupOnboardRequests, 1);
  assert.equal(guard.snapshot().handlerPosts, 0);
});

test('browser forwarding proxies owned function posts through the local handler and records the binding', async () => {
  const page = fakePage();
  const ledger = { steps: {}, ownedIds: {}, handlerResponseStatusCounts: {} };
  const persists = [];
  const forwarded = [];
  const handlerResponse = new Response(JSON.stringify({ binding: { id: 'pb-forwarded-1' } }), { status: 200 });
  const guard = await installBrowserRouteGuard(
    page,
    LOCAL_STATUS.API_URL,
    'http://127.0.0.1:3000',
    { origin: 'http://127.0.0.1:9' },
    ledger,
    async (book) => {
      persists.push({ step: book.steps.projectBinding, bindingId: book.ownedIds.projectBindingId });
    },
    {
      fetchImpl: async (url, init) => {
        forwarded.push({ url, init });
        return handlerResponse;
      },
    },
  );

  const body = Buffer.from(JSON.stringify({ project_id: 'project', list_id: 'list' }));
  const route = fakeRoute(`${LOCAL_STATUS.API_URL}/functions/v1/external-link`, { method: 'POST', body });
  await page.registered.routeHandler(route);

  assert.deepEqual(persists, [
    { step: 'in-flight', bindingId: undefined },
    { step: 'handler-response-received', bindingId: 'pb-forwarded-1' },
  ]);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].url, 'http://127.0.0.1:9/external-link');
  assert.equal(forwarded[0].init.method, 'POST');
  assert.equal(forwarded[0].init.redirect, 'manual');
  assert.deepEqual(forwarded[0].init.headers, {
    authorization: 'Bearer browser-session',
    'content-type': 'application/json',
  });
  assert.ok(!('cookie' in forwarded[0].init.headers), 'cookies must never be forwarded');
  assert.equal(forwarded[0].init.body, body);
  assert.deepEqual(ledger.handlerResponseStatusCounts, { '200': 1 });
  assert.deepEqual(guard.snapshot(), { handlerPosts: 1, clickupOnboardRequests: 0 });
  assert.equal(route.calls.fulfill.status, 200);
  assert.deepEqual(route.calls.fulfill.headers, { 'content-type': 'text/plain;charset=UTF-8' });
  assert.equal(route.calls.fulfill.body, JSON.stringify({ binding: { id: 'pb-forwarded-1' } }));
  assert.deepEqual(guard.blocked, {});
});

test('browser forwarding forwards OPTIONS preflights without a body', async () => {
  const page = fakePage();
  const ledger = { steps: {}, ownedIds: {}, handlerResponseStatusCounts: {} };
  const forwarded = [];
  await installBrowserRouteGuard(
    page,
    LOCAL_STATUS.API_URL,
    'http://127.0.0.1:3000',
    { origin: 'http://127.0.0.1:9' },
    ledger,
    async () => {},
    {
      fetchImpl: async (url, init) => {
        forwarded.push({ url, init });
        return new Response(null, { status: 204 });
      },
    },
  );

  const route = fakeRoute(`${LOCAL_STATUS.API_URL}/functions/v1/external-lists`, { method: 'OPTIONS' });
  await page.registered.routeHandler(route);

  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].init.method, 'OPTIONS');
  assert.equal('body' in forwarded[0].init, false, 'OPTIONS must be forwarded without a body');
  assert.equal(route.calls.fulfill.status, 204);
  assert.deepEqual(ledger.handlerResponseStatusCounts, { '204': 1 });
});

test('browser forwarding counts a failed handler hop as a blocked forward-failed request', async () => {
  const page = fakePage();
  const ledger = { steps: {}, ownedIds: {}, handlerResponseStatusCounts: {} };
  const guard = await installBrowserRouteGuard(
    page,
    LOCAL_STATUS.API_URL,
    'http://127.0.0.1:3000',
    { origin: 'http://127.0.0.1:9' },
    ledger,
    async () => {},
    {
      fetchImpl: async () => {
        throw new Error('handler hop refused');
      },
    },
  );

  const route = fakeRoute(`${LOCAL_STATUS.API_URL}/functions/v1/external-link`, {
    method: 'POST',
    body: Buffer.from('{}'),
  });
  await page.registered.routeHandler(route);

  assert.equal(route.calls.abort, 1);
  assert.equal(route.calls.fulfill, null);
  assert.deepEqual(guard.blocked, { 'forward-failed:external-link': 1 });
  assert.deepEqual(ledger.handlerResponseStatusCounts, {});
});
