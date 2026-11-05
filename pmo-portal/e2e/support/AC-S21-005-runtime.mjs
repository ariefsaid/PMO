// S21 runtime seam: owned edge-function handler lifecycle and browser forwarding.
// Moved verbatim from AC-S21-005-task-list-review.spec.ts; the journey spec owns browser actions.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loopbackHost } from './AC-S21-005-database.mjs';
import { createS21BrowserRequestGuard } from './AC-S21-005-transport.mjs';

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SUPPORT_DIR, '../..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const HANDLER_SOURCE = path.join(SUPPORT_DIR, 'AC-S21-005-handler-server.mjs');
const HANDLER_CONFIG = path.join(REPO_ROOT, 'supabase/functions/external-link/deno.json');

function safeFailure(code) {
  return new Error(code);
}

export async function findPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw safeFailure('S21_LISTENER_PORT_UNAVAILABLE');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

export async function startHandlerServer(status, fixture, sentinel, deps = {}) {
  const spawnImpl = deps.spawnImpl ?? spawn;
  const readyTimeoutMs = deps.readyTimeoutMs ?? 10_000;
  if (!status.API_URL || !status.SERVICE_ROLE_KEY) throw safeFailure('S21_LOCAL_FUNCTION_CONFIG_UNAVAILABLE');
  const supabaseUrl = new URL(status.API_URL);
  if (!loopbackHost(supabaseUrl.hostname)) throw safeFailure('S21_DATABASE_TARGET_NOT_LOCAL');
  const port = await findPort();
  const origin = `http://127.0.0.1:${port}`;
  const childEnv = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? tmpdir(),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
  };

  const readablePaths = [
    path.join(REPO_ROOT, 'supabase/functions/external-lists'),
    path.join(REPO_ROOT, 'supabase/functions/external-link'),
    path.join(REPO_ROOT, 'supabase/functions/_shared'),
    path.join(REPO_ROOT, 'pmo-portal/src'),
    path.join(APP_ROOT, 'e2e/support'),
    HANDLER_CONFIG,
  ];
  const localNet = `${supabaseUrl.hostname}:${supabaseUrl.port || 80}`;
  const args = [
    'run',
    '--no-remote',
    '--config', path.relative(REPO_ROOT, HANDLER_CONFIG),
    `--allow-net=${localNet},127.0.0.1:${port}`,
    '--allow-env=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,EDGE_JWT_ISSUER',
    `--allow-read=${readablePaths.join(',')}`,
    path.relative(REPO_ROOT, HANDLER_SOURCE),
  ];
  const child = spawnImpl('deno', args, { cwd: REPO_ROOT, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdoutLines = [];
  let carry = '';
  let readyResolve;
  let readyReject;
  const waitUntilReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => readyReject(safeFailure('S21_HANDLER_SERVER_START_TIMEOUT')), readyTimeoutMs);
    readyResolve = () => {
      clearTimeout(timer);
      resolve();
    };
    readyReject = (error) => {
      clearTimeout(timer);
      reject(error);
    };
  });
  let summary = null;
  child.stdout.on('data', (chunk) => {
    carry += chunk.toString('utf8');
    const lines = carry.split('\n');
    carry = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.event === 'ready') readyResolve();
        if (event.event === 'summary') summary = event;
        if (event.event === 'ready' || event.event === 'summary') stdoutLines.push(line);
      } catch {
        // Deno diagnostics stay in memory only; never print raw function/server output.
      }
    }
  });
  child.stderr.resume();
  child.once('error', () => readyReject(safeFailure('S21_HANDLER_SERVER_START_FAILED')));
  child.once('exit', () => readyReject(safeFailure('S21_HANDLER_SERVER_EXITED_EARLY')));
  child.stdin.end(JSON.stringify({
    supabaseUrl: status.API_URL,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
    issuer: `${status.API_URL.replace(/\/$/, '')}/auth/v1`,
    host: '127.0.0.1',
    port,
    teamId: fixture.teamId,
    teamName: fixture.teamName,
    spaceId: fixture.spaceId,
    spaceName: fixture.spaceName,
    listId: fixture.listId,
    listName: fixture.listName,
    sentinel,
  }));
  try {
    await waitUntilReady;
  } catch (error) {
    if (!await terminateHandlerProcess(child)) throw safeFailure('S21_HANDLER_SERVER_TEARDOWN_FAILED');
    throw error;
  }
  return { child, origin, port, waitUntilReady, summary: () => summary ?? stdoutLines };
}

export function waitForHandlerExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

export async function terminateHandlerProcess(child, deps = {}) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return true;
  child.kill('SIGTERM');
  if (await waitForHandlerExit(child, deps.termTimeoutMs ?? 3_000)) return true;
  child.kill('SIGKILL');
  return waitForHandlerExit(child, deps.killTimeoutMs ?? 2_000);
}

export async function stopHandlerServer(server, deps = {}) {
  if (!server) return null;
  if (!await terminateHandlerProcess(server.child, deps)) throw safeFailure('S21_HANDLER_SERVER_TEARDOWN_FAILED');
  return server.summary();
}

export function wantedHeaders(headers) {
  const allowed = new Set([
    'authorization', 'apikey', 'content-type', 'x-client-info', 'prefer',
    'accept', 'accept-language', 'x-supabase-api-version',
  ]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => allowed.has(name.toLowerCase())));
}

export async function installBrowserRouteGuard(page, apiOrigin, appOrigin, server, ledger, persist, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const guard = createS21BrowserRequestGuard(apiOrigin, appOrigin);
  /** @type {Record<string, number>} */
  const blocked = {};
  await page.route('**/*', async (route) => {
    const request = route.request();
    const decision = guard.classify(request.url(), request.method());
    if (decision.kind === 'local') {
      await route.continue();
      return;
    }
    if (decision.kind === 'blocked') {
      const reason = decision.reason ?? 'unclassified';
      blocked[reason] = (blocked[reason] ?? 0) + 1;
      await route.abort();
      return;
    }

    if (decision.path === '/external-link' && request.method() === 'POST') {
      ledger.steps.projectBinding = 'in-flight';
      await persist(ledger);
    }
    const functionName = decision.path.slice(1);
    try {
      const body = request.postDataBuffer();
      const response = await fetchImpl(`${server.origin}${decision.path}`, {
        method: request.method(),
        headers: wantedHeaders(await request.allHeaders()),
        ...(body && request.method() !== 'OPTIONS' ? { body } : {}),
        redirect: 'manual',
      });
      const status = String(response.status);
      ledger.handlerResponseStatusCounts[status] = (ledger.handlerResponseStatusCounts[status] ?? 0) + 1;
      const responseBody = await response.text();
      if (decision.path === '/external-link' && request.method() === 'POST' && response.ok) {
        try {
          const parsed = JSON.parse(responseBody);
          if (parsed.binding?.id) {
            ledger.ownedIds.projectBindingId = parsed.binding.id;
            ledger.steps.projectBinding = 'handler-response-received';
            await persist(ledger);
          }
        } catch {
          // The persisted row is reconciled from Postgres after the browser journey.
        }
      }
      const responseHeaders = {};
      for (const name of ['content-type', 'access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods']) {
        const value = response.headers.get(name);
        if (value) responseHeaders[name] = value;
      }
      await route.fulfill({ status: response.status, headers: responseHeaders, body: responseBody });
    } catch {
      blocked[`forward-failed:${functionName}`] = (blocked[`forward-failed:${functionName}`] ?? 0) + 1;
      await route.abort();
    }
  });
  return { snapshot: () => guard.snapshot(), blocked };
}
