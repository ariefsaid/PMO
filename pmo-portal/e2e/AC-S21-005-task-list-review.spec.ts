// @e2e-isolation: self-isolated — this journey owns one fresh test organization and exact run-scoped rows.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureS21FailureDiagnostic,
  createS21FixtureIdentity,
  createS21WriteAheadLedger,
  encodeS21CopyRow,
  recordS21PrimaryFailure,
} from './support/AC-S21-005-fixture.mjs';
import {
  classifyS21DiagnosticEndpoint,
  createS21ReloadDiagnostic,
} from './support/AC-S21-005-diagnostics.mjs';
import {
  aggregateS21BrowserGuardSnapshots,
  createS21BrowserRequestGuard,
  S21_MAX_CLICKUP_GETS,
  S21_MAX_HANDLER_POSTS,
  validateS21TransportSummary,
} from './support/AC-S21-005-transport.mjs';
import {
  runS21FixtureCleanup,
  S21_FIXTURE_PHASE_TIMEOUT_MS,
} from './support/AC-S21-005-lifecycle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const HANDLER_SOURCE = path.join(APP_ROOT, 'e2e/support/AC-S21-005-handler-server.mjs');
const HANDLER_CONFIG = path.join(REPO_ROOT, 'supabase/functions/external-link/deno.json');

type LocalStatus = {
  API_URL?: string;
  DB_URL?: string;
  ANON_KEY?: string;
  SERVICE_ROLE_KEY?: string;
};

type Fixture = ReturnType<typeof createS21FixtureIdentity>;
type FixtureLedger = ReturnType<typeof createS21WriteAheadLedger>;
type BrowserGuardSnapshot = { handlerPosts: number; clickupOnboardRequests: number };
type BrowserRouteGuard = {
  snapshot: () => BrowserGuardSnapshot;
  blocked: Record<string, number>;
};
type Ledger = Omit<FixtureLedger, 'ownedIds' | 'steps'> & {
  ownedIds: Omit<FixtureLedger['ownedIds'], 'projectBindingId' | 'auditEventIds' | 'historyEventIds'> & {
    projectBindingId: string | null;
    auditEventIds: string[];
    historyEventIds: string[];
  };
  steps: Record<string, string>;
  requestCaps: { clickupGets: number; handlerPosts: number };
  handlerResponseStatusCounts: Record<string, number>;
  browserBlockedByReason: Record<string, number>;
  transportSummary: unknown;
  journeyStage: string | null;
  failedJourneyStage: string | null;
  primaryFailureDiagnostic: ReturnType<typeof captureS21FailureDiagnostic> | null;
  reloadDiagnostic: ReturnType<ReturnType<typeof createS21ReloadDiagnostic>['snapshot']> | null;
  failureScreenshot: string | null;
  primaryFailure: string | null;
  cleanupFailureSteps: string[];
};

type FixtureSnapshot = {
  organizationCount: number;
  organizationNameCount: number;
  organizationTestCount: number;
  authUserIdCount: number;
  authEmailCount: number;
  profileCount: number;
  projectCount: number;
  projectCodeCount: number;
  projectNameCount: number;
  orgBindingCount: number;
  activeClickUpBindingCount: number;
  projectBindingCount: number;
  projectBindings: { id: string; external_container_id: string; direction: string | null; linked_by: string | null }[];
  projectTaskCount: number;
  domainOwnershipCount: number;
  externalRefsCount: number;
  outboxCount: number;
  vaultSecretCount: number;
  vaultReaderPresent: boolean;
  auditEvents: { id: string; action: string; entity_type: string | null; entity_id: string | null; actor_id: string | null }[];
  historyEvents: { id: string; entity_type: string; entity_id: string; op: string; actor_id: string | null }[];
  projectHistoryVisible: boolean;
  organization: { name: string; lifecycle_state: string } | null;
};

let status: LocalStatus;
let serviceUrl: string;
let serviceKey: string;
let anonKey: string;
let apiOrigin: string;
let appOrigin: string;
let fixture: Fixture;
let ledger: Ledger;
let journeyStage: string;
let evidence: Awaited<ReturnType<typeof makeEvidencePath>>;
let ledgerPath: string;
let initialAdmin: SupabaseClient;
let actorClient: SupabaseClient;
let actorAuthenticated = false;
let pageRouteSnapshot: (() => BrowserGuardSnapshot) | null = null;
let browserBlocked: Record<string, number> = {};
let browserRouteGuards: BrowserRouteGuard[] = [];
let handlerServer: HandlerServer | null = null;
let reloadDiagnostic: ReturnType<typeof createS21ReloadDiagnostic> | null = null;
let primaryFailure: unknown = null;
let cleanupFailed = false;
let cleanupFailureErrors: Error[] = [];
let projectCreated = false;
let bindingCreated = false;
let projectDeleted = false;
let fixturePreflightPassed = false;
let browserAdminLoginConfirmed = false;
let ephemeralPassword: string | null = null;
let vaultSecretSentinel: string | null = null;
let actorAccessToken: string | null = null;
let actorRefreshToken: string | null = null;

function markCleanupFailure(step: string): void {
  cleanupFailed = true;
  ledger.cleanupFailureSteps.push(step);
  const code = `S21_CLEANUP_${step.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
  cleanupFailureErrors.push(safeFailure(code));
}

function setJourneyStage(stage: string): void {
  journeyStage = stage;
  ledger.journeyStage = stage;
}

function safeFailure(code: string): Error {
  return new Error(code);
}

function readLocalStatus(): LocalStatus {
  const result = spawnSync('supabase', ['status', '-o', 'json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw safeFailure('S21_LOCAL_SUPABASE_STATUS_UNAVAILABLE');
  try {
    return JSON.parse(result.stdout) as LocalStatus;
  } catch {
    throw safeFailure('S21_LOCAL_SUPABASE_STATUS_INVALID');
  }
}

function loopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
}

function databaseEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  if (!loopbackHost(url.hostname) || !url.username || !url.password || !url.pathname) {
    throw safeFailure('S21_DATABASE_TARGET_NOT_LOCAL');
  }
  return {
    PATH: `/opt/homebrew/opt/libpq/bin:${process.env.PATH ?? ''}`,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: String(url.port || 5432),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: 'disable',
  };
}

function runPsql(status: LocalStatus, input: string): Promise<string> {
  if (!status.DB_URL) throw safeFailure('S21_DATABASE_URL_UNAVAILABLE');
  const child = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    cwd: REPO_ROOT,
    env: databaseEnvironment(status.DB_URL),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.resume();
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(safeFailure('S21_DATABASE_COMMAND_UNAVAILABLE')));
    child.once('close', (code) => {
      if (code !== 0) return reject(safeFailure('S21_DATABASE_COMMAND_FAILED'));
      resolve(Buffer.concat(stdout).toString('utf8').trim());
    });
    child.stdin.end(input);
  });
}

function copySql(values: string[], statement: string): string {
  const secretColumn = values.length === 12 ? ', secret_value text' : '';
  return [
    'CREATE TEMP TABLE s21_values (',
    '  org_id uuid, user_id uuid, project_id uuid, org_binding_id uuid, project_binding_id text,',
    `  email text, org_name text, project_code text, project_name text, secret_ref text, list_id text${secretColumn}`,
    ');',
    'COPY s21_values FROM STDIN WITH (FORMAT csv);',
    encodeS21CopyRow(values),
    '\\.',
    statement,
  ].join('\n');
}

function fixtureValues(fixture: Fixture, projectBindingId = ''): string[] {
  return [
    fixture.orgId,
    fixture.userId,
    fixture.projectId,
    fixture.orgBindingId,
    projectBindingId,
    fixture.email,
    fixture.orgName,
    fixture.projectCode,
    fixture.projectName,
    fixture.secretRef,
    fixture.listId,
  ];
}

async function queryFixtureSnapshot(status: LocalStatus, fixture: Fixture, projectBindingId = ''): Promise<FixtureSnapshot> {
  const sql = copySql(fixtureValues(fixture, projectBindingId), `
    SELECT jsonb_build_object(
      'organizationCount', (SELECT count(*) FROM public.organizations o, s21_values p WHERE o.id = p.org_id),
      'organizationNameCount', (SELECT count(*) FROM public.organizations o, s21_values p WHERE o.name = p.org_name),
      'organizationTestCount', (SELECT count(*) FROM public.organizations o, s21_values p WHERE o.id = p.org_id AND o.lifecycle_state = 'test'),
      'authUserIdCount', (SELECT count(*) FROM auth.users u, s21_values p WHERE u.id = p.user_id),
      'authEmailCount', (SELECT count(*) FROM auth.users u, s21_values p WHERE lower(u.email) = lower(p.email)),
      'profileCount', (SELECT count(*) FROM public.profiles u, s21_values p WHERE u.id = p.user_id),
      'projectCount', (SELECT count(*) FROM public.projects x, s21_values p WHERE x.id = p.project_id AND x.org_id = p.org_id),
      'projectCodeCount', (SELECT count(*) FROM public.projects x, s21_values p WHERE x.org_id = p.org_id AND x.code = p.project_code),
      'projectNameCount', (SELECT count(*) FROM public.projects x, s21_values p WHERE x.org_id = p.org_id AND x.name = p.project_name),
      'orgBindingCount', (SELECT count(*) FROM public.external_org_bindings b, s21_values p WHERE b.id = p.org_binding_id AND b.org_id = p.org_id AND b.external_tier = 'clickup'),
      'activeClickUpBindingCount', (SELECT count(*) FROM public.external_org_bindings b, s21_values p WHERE b.org_id = p.org_id AND b.external_tier = 'clickup' AND b.status = 'active'),
      'projectBindingCount', (SELECT count(*) FROM public.external_project_bindings b, s21_values p WHERE b.org_id = p.org_id AND b.project_id = p.project_id AND b.external_tier = 'clickup'),
      'projectBindings', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', b.id, 'external_container_id', b.external_container_id,
          'direction', b.config->>'direction', 'linked_by', b.linked_by
        ) ORDER BY b.id)
        FROM public.external_project_bindings b, s21_values p
        WHERE b.org_id = p.org_id AND b.project_id = p.project_id AND b.external_tier = 'clickup'
      ), '[]'::jsonb),
      'projectTaskCount', (SELECT count(*) FROM public.tasks t, s21_values p WHERE t.org_id = p.org_id),
      'domainOwnershipCount', (SELECT count(*) FROM public.external_domain_ownership d, s21_values p WHERE d.org_id = p.org_id),
      'externalRefsCount', (SELECT count(*) FROM public.external_refs r, s21_values p WHERE r.org_id = p.org_id),
      'outboxCount', (SELECT count(*) FROM public.external_command_outbox o, s21_values p WHERE o.org_id = p.org_id),
      'vaultSecretCount', (SELECT count(*) FROM vault.secrets v, s21_values p WHERE v.name = p.secret_ref),
      'vaultReaderPresent', coalesce((SELECT public.read_vault_secret(p.secret_ref) IS NOT NULL FROM s21_values p), false),
      'auditEvents', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', a.id, 'action', a.action, 'entity_type', a.entity_type,
          'entity_id', a.entity_id, 'actor_id', a.actor_id
        ) ORDER BY a.created_at, a.id)
        FROM public.audit_events a, s21_values p WHERE a.org_id = p.org_id
      ), '[]'::jsonb),
      'historyEvents', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', h.id, 'entity_type', h.entity_type, 'entity_id', h.entity_id,
          'op', h.op, 'actor_id', h.actor_id
        ) ORDER BY h.seq)
        FROM public.record_changes h, s21_values p WHERE h.org_id = p.org_id
      ), '[]'::jsonb),
      'projectHistoryVisible', coalesce((SELECT public.record_history_visible('project', p.project_id) FROM s21_values p), false),
      'organization', (SELECT jsonb_build_object('name', o.name, 'lifecycle_state', o.lifecycle_state)
        FROM public.organizations o, s21_values p WHERE o.id = p.org_id)
    )::text;
  `);
  const result = await runPsql(status, sql);
  try {
    return JSON.parse(result) as FixtureSnapshot;
  } catch {
    throw safeFailure('S21_DATABASE_SNAPSHOT_INVALID');
  }
}

function assertInitialAbsence(snapshot: FixtureSnapshot): void {
  const counts = [
    snapshot.organizationCount, snapshot.organizationNameCount, snapshot.authUserIdCount, snapshot.authEmailCount,
    snapshot.profileCount, snapshot.projectCount, snapshot.projectCodeCount, snapshot.projectNameCount,
    snapshot.orgBindingCount, snapshot.activeClickUpBindingCount, snapshot.projectBindingCount,
    snapshot.projectTaskCount, snapshot.domainOwnershipCount, snapshot.externalRefsCount,
    snapshot.outboxCount, snapshot.vaultSecretCount,
  ];
  if (
    counts.some((count) => count !== 0) || snapshot.vaultReaderPresent || snapshot.auditEvents.length ||
    snapshot.historyEvents.length || snapshot.projectHistoryVisible
  ) {
    throw safeFailure('S21_FIXTURE_ID_COLLISION_OR_NONEMPTY_BASELINE');
  }
}

function createAdminClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function saveLedger(pathname: string, ledger: Ledger): Promise<void> {
  const nextPath = `${pathname}.next`;
  await writeFile(nextPath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  await chmod(nextPath, 0o600);
  await rename(nextPath, pathname);
  await chmod(pathname, 0o600);
}

async function makeEvidencePath(): Promise<{ directory: string; ledgerPath: string; failureScreenshotPath: string }> {
  const base = process.env.S21_EVIDENCE_DIR || tmpdir();
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(base, 's21-ac005-'));
  await chmod(directory, 0o700);
  return {
    directory,
    ledgerPath: path.join(directory, 'write-ahead-ledger.json'),
    failureScreenshotPath: path.join(directory, 'first-failure.png'),
  };
}

async function findPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw safeFailure('S21_LISTENER_PORT_UNAVAILABLE');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

type HandlerServer = {
  child: ChildProcessWithoutNullStreams;
  origin: string;
  waitUntilReady: Promise<void>;
  summary: () => unknown;
};

async function startHandlerServer(status: LocalStatus, fixture: Fixture, sentinel: string): Promise<HandlerServer> {
  if (!status.API_URL || !status.SERVICE_ROLE_KEY) throw safeFailure('S21_LOCAL_FUNCTION_CONFIG_UNAVAILABLE');
  const supabaseUrl = new URL(status.API_URL);
  if (!loopbackHost(supabaseUrl.hostname)) throw safeFailure('S21_DATABASE_TARGET_NOT_LOCAL');
  const port = await findPort();
  const origin = `http://127.0.0.1:${port}`;
  const childEnv: NodeJS.ProcessEnv = {
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
  const child = spawn('deno', args, { cwd: REPO_ROOT, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdoutLines: string[] = [];
  let carry = '';
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const waitUntilReady = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => readyReject(safeFailure('S21_HANDLER_SERVER_START_TIMEOUT')), 10_000);
    readyResolve = () => {
      clearTimeout(timer);
      resolve();
    };
    readyReject = (error) => {
      clearTimeout(timer);
      reject(error);
    };
  });
  let summary: unknown = null;
  child.stdout.on('data', (chunk: Buffer) => {
    carry += chunk.toString('utf8');
    const lines = carry.split('\n');
    carry = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { event?: string; [key: string]: unknown };
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
  return { child, origin, waitUntilReady, summary: () => summary ?? stdoutLines };
}

function waitForHandlerExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
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

async function terminateHandlerProcess(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return true;
  child.kill('SIGTERM');
  if (await waitForHandlerExit(child, 3_000)) return true;
  child.kill('SIGKILL');
  return waitForHandlerExit(child, 2_000);
}

async function stopHandlerServer(server: HandlerServer | null): Promise<unknown> {
  if (!server) return null;
  if (!await terminateHandlerProcess(server.child)) throw safeFailure('S21_HANDLER_SERVER_TEARDOWN_FAILED');
  return server.summary();
}

function wantedHeaders(headers: Record<string, string>): Record<string, string> {
  const allowed = new Set([
    'authorization', 'apikey', 'content-type', 'x-client-info', 'prefer',
    'accept', 'accept-language', 'x-supabase-api-version',
  ]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => allowed.has(name.toLowerCase())));
}

async function projectBindingReadback(db: SupabaseClient, fixture: Fixture) {
  const { data, error } = await db
    .from('external_project_bindings')
    .select('id, org_id, project_id, external_tier, external_container_id, config, linked_by')
    .eq('org_id', fixture.orgId)
    .eq('project_id', fixture.projectId)
    .eq('external_tier', 'clickup');
  if (error || !data) throw safeFailure('S21_PROJECT_BINDING_READBACK_FAILED');
  if (data.length > 1) throw safeFailure('S21_PROJECT_BINDING_MULTIPLE');
  return data[0] ?? null;
}

async function assertSingleRow<T>(
  query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  failureCode: string,
): Promise<T | null> {
  const { data, error } = await query;
  if (error || !data) throw safeFailure(failureCode);
  if (data.length > 1) throw safeFailure(`${failureCode}_MULTIPLE`);
  return data[0] ?? null;
}

async function removeVaultAndOrgBinding(status: LocalStatus, fixture: Fixture): Promise<void> {
  const sql = copySql(fixtureValues(fixture), `
    DO $$
    DECLARE
      p record;
      v_count integer;
    BEGIN
      SELECT * INTO p FROM s21_values;
      DELETE FROM public.external_org_bindings
       WHERE id = p.org_binding_id AND org_id = p.org_id AND external_tier = 'clickup';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count <> 1 THEN RAISE EXCEPTION 'S21_OWNED_BINDING_DELETE_COUNT'; END IF;
      PERFORM public.delete_vault_secret(p.secret_ref);
    END $$;
  `);
  await runPsql(status, sql);
}

async function assertFinalFixtureState(
  status: LocalStatus,
  fixture: Fixture,
  ledger: Ledger,
  projectCreated: boolean,
  bindingCreated: boolean,
  projectDeleted: boolean,
): Promise<void> {
  const snapshot = await queryFixtureSnapshot(status, fixture, ledger.ownedIds.projectBindingId ?? '');
  const expectedActions = [
    ...(projectCreated ? ['project.create'] : []),
    ...(bindingCreated ? ['integration.link'] : []),
    ...(projectDeleted ? ['project.delete'] : []),
  ].sort();
  const actualActions = snapshot.auditEvents.map((event) => event.action).sort();
  const exactHistory = projectCreated
    ? snapshot.historyEvents.length === 1 &&
      snapshot.historyEvents[0].entity_type === 'project' &&
      snapshot.historyEvents[0].entity_id === fixture.projectId &&
      snapshot.historyEvents[0].op === 'insert' &&
      snapshot.historyEvents[0].actor_id === fixture.userId
    : snapshot.historyEvents.length === 0;
  if (
    snapshot.organizationCount !== (ledger.steps.organization === 'verified' ? 1 : 0) ||
    snapshot.organizationNameCount !== (ledger.steps.organization === 'verified' ? 1 : 0) ||
    snapshot.organizationTestCount !== (ledger.steps.organization === 'verified' ? 1 : 0) ||
    (ledger.steps.organization === 'verified' && snapshot.organization?.name !== fixture.orgName) ||
    (ledger.steps.organization === 'verified' && snapshot.organization?.lifecycle_state !== 'test') ||
    snapshot.authUserIdCount !== 0 || snapshot.authEmailCount !== 0 || snapshot.profileCount !== 0 ||
    snapshot.projectCount !== 0 || snapshot.projectCodeCount !== 0 || snapshot.projectNameCount !== 0 ||
    snapshot.orgBindingCount !== 0 || snapshot.activeClickUpBindingCount !== 0 ||
    snapshot.projectBindingCount !== 0 || snapshot.projectTaskCount !== 0 ||
    snapshot.domainOwnershipCount !== 0 || snapshot.externalRefsCount !== 0 || snapshot.outboxCount !== 0 ||
    snapshot.vaultSecretCount !== 0 || snapshot.vaultReaderPresent ||
    JSON.stringify(actualActions) !== JSON.stringify(expectedActions) || !exactHistory ||
    snapshot.projectHistoryVisible
  ) {
    throw safeFailure('S21_FINAL_FIXTURE_STATE_MISMATCH');
  }
  ledger.ownedIds.auditEventIds = snapshot.auditEvents.map((event) => event.id);
  ledger.ownedIds.historyEventIds = snapshot.historyEvents.map((event) => event.id);
  ledger.steps.cleanup = 'verified';
}

async function installBrowserRouteGuard(
  page: Page,
  apiOrigin: string,
  appOrigin: string,
  server: HandlerServer,
  ledger: Ledger,
  ledgerPath: string,
): Promise<{ snapshot: () => { handlerPosts: number; clickupOnboardRequests: number }; blocked: Record<string, number> }> {
  const guard = createS21BrowserRequestGuard(apiOrigin, appOrigin);
  const blocked: Record<string, number> = {};
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
      await saveLedger(ledgerPath, ledger);
    }
    const functionName = decision.path.slice(1);
    try {
      const body = request.postDataBuffer();
      const response = await fetch(`${server.origin}${decision.path}`, {
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
          const parsed = JSON.parse(responseBody) as { binding?: { id?: string } };
          if (parsed.binding?.id) {
            ledger.ownedIds.projectBindingId = parsed.binding.id;
            ledger.steps.projectBinding = 'handler-response-received';
            await saveLedger(ledgerPath, ledger);
          }
        } catch {
          // The persisted row is reconciled from Postgres after the browser journey.
        }
      }
      const responseHeaders: Record<string, string> = {};
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

async function visibleAny(locator: Locator): Promise<boolean> {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) return true;
  }
  return false;
}

async function visibleLinkedFieldValue(card: Locator, label: string, value: string): Promise<boolean> {
  const labelLocator = card.getByText(label, { exact: true });
  if (await labelLocator.count() !== 1) return false;
  const field = labelLocator.locator('..');
  if (await field.count() !== 1 || !await field.isVisible()) return false;
  return (await field.innerText()).replace(/\s+/g, ' ').trim() === `${label} ${value}`;
}

async function captureS21ReloadDom(page: Page, fixture: Fixture): Promise<Record<string, boolean>> {
  const compactCard = page.getByTestId('project-integrations-compact');
  const clickupCard = compactCard.locator('[data-tier="clickup"]');
  return {
    tasksHeadingVisible: await visibleAny(page.getByText('Tasks', { exact: true })),
    emptyTaskStateVisible: await visibleAny(page.getByText('No tasks yet', { exact: true })),
    bindingLoadingVisible: await visibleAny(page.getByTestId('project-integrations-loading')),
    compactCardPresent: (await compactCard.count()) > 0,
    compactCardUnique: (await compactCard.count()) === 1,
    clickupTierCardPresent: (await clickupCard.count()) > 0,
    bindingErrorVisible: await visibleAny(clickupCard.getByText(/Failed to load|Project link details could not be refreshed/)),
    listErrorVisible: await visibleAny(clickupCard.getByText(/Failed to load lists|List details could not be refreshed/)),
    listDetailsLoadingVisible: await visibleAny(clickupCard.getByText(/Loading list details; saved list ID:/)),
    savedListIdentityVisible: await visibleLinkedFieldValue(clickupCard, 'ClickUp List:', fixture.listName),
    initialSourceVisible: await visibleLinkedFieldValue(clickupCard, 'Initial source:', 'Start with PMO tasks'),
    pendingTransferNoticeVisible: await visibleAny(clickupCard.getByText(/Project linked\. Initial task transfer is not confirmed\./)),
  };
}

test.beforeAll(async ({ playwright: _playwright }, testInfo) => {
  test.setTimeout(S21_FIXTURE_PHASE_TIMEOUT_MS);
  status = readLocalStatus();
  serviceUrl = status.API_URL ?? '';
  serviceKey = status.SERVICE_ROLE_KEY ?? '';
  anonKey = status.ANON_KEY ?? '';
  if (!serviceUrl || !serviceKey || !anonKey || !status.DB_URL) throw safeFailure('S21_LOCAL_CONFIG_UNAVAILABLE');
  apiOrigin = new URL(serviceUrl).origin;
  if (!loopbackHost(new URL(serviceUrl).hostname)) throw safeFailure('S21_API_TARGET_NOT_LOCAL');

  fixture = createS21FixtureIdentity();
  ledger = createS21WriteAheadLedger(fixture) as unknown as Ledger;
  journeyStage = 'fixture-preflight';
  ledger.journeyStage = journeyStage;
  ledger.failedJourneyStage = null;
  ledger.primaryFailureDiagnostic = null;
  ledger.reloadDiagnostic = null;
  ledger.failureScreenshot = null;
  ledger.requestCaps = { clickupGets: S21_MAX_CLICKUP_GETS, handlerPosts: S21_MAX_HANDLER_POSTS };
  ledger.handlerResponseStatusCounts = {};
  ledger.browserBlockedByReason = {};
  ledger.transportSummary = null;
  ledger.primaryFailure = null;
  ledger.cleanupFailureSteps = [];
  evidence = await makeEvidencePath();
  ledgerPath = evidence.ledgerPath;
  initialAdmin = createAdminClient(serviceUrl, serviceKey);
  actorClient = createAdminClient(serviceUrl, anonKey);
  actorAuthenticated = false;
  pageRouteSnapshot = null;
  browserBlocked = {};
  browserRouteGuards = [];
  handlerServer = null;
  reloadDiagnostic = null;
  primaryFailure = null;
  cleanupFailed = false;
  cleanupFailureErrors = [];
  projectCreated = false;
  bindingCreated = false;
  projectDeleted = false;
  fixturePreflightPassed = false;
  browserAdminLoginConfirmed = false;
  ephemeralPassword = null;
  vaultSecretSentinel = null;
  actorAccessToken = null;
  actorRefreshToken = null;

  await saveLedger(ledgerPath, ledger);
  try {
    assertInitialAbsence(await queryFixtureSnapshot(status, fixture));
    fixturePreflightPassed = true;

    setJourneyStage('organization');
    ledger.steps.organization = 'in-flight';
    await saveLedger(ledgerPath, ledger);
    const orgWrite = await initialAdmin.from('organizations').insert({
      id: fixture.orgId,
      name: fixture.orgName,
      default_currency: 'IDR',
      default_locale: 'en',
      default_number_locale: 'en-US',
      default_timezone: 'Asia/Jakarta',
      lifecycle_state: 'test',
    });
    const { data: orgRead, error: orgReadError } = await initialAdmin
      .from('organizations')
      .select('id, name, lifecycle_state, default_currency, default_locale, default_number_locale, default_timezone')
      .eq('id', fixture.orgId)
      .maybeSingle();
    if (
      orgReadError || !orgRead || orgRead.name !== fixture.orgName || orgRead.lifecycle_state !== 'test' ||
      orgRead.default_currency !== 'IDR' || orgRead.default_locale !== 'en' ||
      orgRead.default_number_locale !== 'en-US' || orgRead.default_timezone !== 'Asia/Jakarta'
    ) throw safeFailure('S21_ORGANIZATION_WRITE_NOT_RECONCILED');
    void orgWrite;
    ledger.steps.organization = 'verified';
    await saveLedger(ledgerPath, ledger);

    setJourneyStage('auth-user');
    ledger.steps.authUser = 'in-flight';
    await saveLedger(ledgerPath, ledger);
    ephemeralPassword = `${crypto.randomUUID()}-Aa1!`;
    const userWrite = await initialAdmin.auth.admin.createUser({
      id: fixture.userId,
      email: fixture.email,
      password: ephemeralPassword,
      email_confirm: true,
    });
    const { data: authRead } = await initialAdmin.auth.admin.getUserById(fixture.userId);
    if (userWrite.error && !authRead.user) throw safeFailure('S21_AUTH_USER_WRITE_NOT_RECONCILED');
    if (!authRead.user || authRead.user.id !== fixture.userId || authRead.user.email !== fixture.email) {
      throw safeFailure('S21_AUTH_USER_IDENTITY_MISMATCH');
    }
    ledger.steps.authUser = 'verified';
    await saveLedger(ledgerPath, ledger);

    setJourneyStage('profile');
    ledger.steps.profile = 'in-flight';
    await saveLedger(ledgerPath, ledger);
    const profileWrite = await initialAdmin.from('profiles').insert({
      id: fixture.userId,
      org_id: fixture.orgId,
      email: fixture.email,
      full_name: fixture.displayName,
      role: 'Admin',
      status: 'active',
    });
    const { data: profileRead, error: profileReadError } = await initialAdmin
      .from('profiles')
      .select('id, org_id, email, full_name, role, status')
      .eq('id', fixture.userId)
      .maybeSingle();
    if (
      profileReadError || !profileRead || profileRead.org_id !== fixture.orgId ||
      profileRead.email !== fixture.email || profileRead.full_name !== fixture.displayName ||
      profileRead.role !== 'Admin' || profileRead.status !== 'active'
    ) throw safeFailure('S21_PROFILE_WRITE_NOT_RECONCILED');
    void profileWrite;
    ledger.steps.profile = 'verified';
    await saveLedger(ledgerPath, ledger);

    setJourneyStage('fixture-admin-login');
    const login = await actorClient.auth.signInWithPassword({ email: fixture.email, password: ephemeralPassword });
    if (login.error || !login.data.session || login.data.user.id !== fixture.userId) {
      throw safeFailure('S21_FIXTURE_ACTOR_AUTHENTICATION_FAILED');
    }
    actorAuthenticated = true;
    actorAccessToken = login.data.session.access_token;
    actorRefreshToken = login.data.session.refresh_token;

    setJourneyStage('project-create-and-audit');
    ledger.steps.project = 'in-flight';
    await saveLedger(ledgerPath, ledger);
    const projectWrite = await actorClient.from('projects').insert({
      id: fixture.projectId,
      org_id: fixture.orgId,
      code: fixture.projectCode,
      name: fixture.projectName,
      status: 'Internal Project',
      project_manager_id: null,
    }).select('id').single();
    const { data: projectRead, error: projectReadError } = await initialAdmin
      .from('projects')
      .select('id, org_id, code, name, status, project_manager_id')
      .eq('id', fixture.projectId)
      .maybeSingle();
    if (
      projectReadError || !projectRead || projectRead.org_id !== fixture.orgId ||
      projectRead.code !== fixture.projectCode || projectRead.name !== fixture.projectName ||
      projectRead.status !== 'Internal Project' || projectRead.project_manager_id !== null
    ) throw safeFailure('S21_PROJECT_WRITE_NOT_RECONCILED');
    projectCreated = true;
    // The exact authenticated row readback is authoritative after an unknown insert response.
    void projectWrite;
    const projectStart = await queryFixtureSnapshot(status, fixture);
    if (
      projectStart.auditEvents.filter((event) => event.action === 'project.create').length !== 1 ||
      projectStart.historyEvents.length !== 1 || projectStart.historyEvents[0].op !== 'insert' ||
      projectStart.historyEvents[0].actor_id !== fixture.userId
    ) throw safeFailure('S21_PROJECT_CREATE_AUDIT_OR_HISTORY_MISMATCH');
    ledger.steps.project = 'verified';
    await saveLedger(ledgerPath, ledger);

    setJourneyStage('vault-and-org-binding');
    vaultSecretSentinel = `S21_SYNTHETIC_${crypto.randomUUID().replaceAll('-', '')}`;
    ledger.steps.vaultAndOrgBinding = 'in-flight';
    await saveLedger(ledgerPath, ledger);
    // The sentinel is a COPY parameter received over stdin and consumed only inside Vault.
    const boundSecretSql = copySql([
      fixture.orgId,
      fixture.userId,
      fixture.projectId,
      fixture.orgBindingId,
      '',
      fixture.email,
      fixture.orgName,
      fixture.projectCode,
      fixture.projectName,
      fixture.secretRef,
      fixture.listId,
      vaultSecretSentinel,
    ], `
      DO $$
      DECLARE p record;
      BEGIN
        SELECT * INTO p FROM s21_values;
        PERFORM vault.create_secret(p.secret_value, p.secret_ref);
      END $$;
      INSERT INTO public.external_org_bindings
        (id, org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at, config)
      SELECT p.org_binding_id, p.org_id, 'clickup', '', p.secret_ref, 'active', p.user_id, now(), '{}'::jsonb
        FROM s21_values p;
      COMMIT;
    `);
    try {
      await runPsql(status, `BEGIN;\n${boundSecretSql}`);
    } catch {
      const reconcile = await queryFixtureSnapshot(status, fixture);
      if (
        reconcile.orgBindingCount !== 1 || reconcile.vaultSecretCount !== 1 ||
        !reconcile.vaultReaderPresent
      ) throw safeFailure('S21_VAULT_BINDING_WRITE_NOT_RECONCILED');
    }
    const orgBindingRead = await queryFixtureSnapshot(status, fixture);
    if (orgBindingRead.orgBindingCount !== 1 || orgBindingRead.activeClickUpBindingCount !== 1 ||
      orgBindingRead.vaultSecretCount !== 1 || !orgBindingRead.vaultReaderPresent) {
      throw safeFailure('S21_VAULT_BINDING_STATE_MISMATCH');
    }
    ledger.steps.vaultAndOrgBinding = 'verified';
    await saveLedger(ledgerPath, ledger);

    setJourneyStage('handler-and-browser-setup');
    const clickupSentinel = vaultSecretSentinel;
    handlerServer = await startHandlerServer(status, fixture, clickupSentinel);
    const appBaseUrl = testInfo.project.use.baseURL;
    if (!appBaseUrl) throw safeFailure('S21_APP_BASE_URL_UNAVAILABLE');
    appOrigin = new URL(appBaseUrl).origin;
    await saveLedger(ledgerPath, ledger);
  } catch (error) {
    primaryFailure = error;
    recordS21PrimaryFailure(ledger, error, {
      stage: journeyStage,
      secretValues: [status.DB_URL, serviceKey, anonKey, ephemeralPassword, vaultSecretSentinel]
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
      includeDetails: false,
    });
    try {
      await saveLedger(ledgerPath, ledger);
    } catch {
      // Preserve the fixture/setup failure when private evidence storage is unavailable.
    }
    throw error;
  }
});

test.beforeEach(async ({ page }) => {
  test.setTimeout(S21_FIXTURE_PHASE_TIMEOUT_MS);
  browserAdminLoginConfirmed = false;
  if (!handlerServer) throw safeFailure('S21_HANDLER_SERVER_UNAVAILABLE');
  try {
    const routeGuard = await installBrowserRouteGuard(page, apiOrigin, appOrigin, handlerServer, ledger, ledgerPath);
    pageRouteSnapshot = routeGuard.snapshot;
    browserBlocked = routeGuard.blocked;
    browserRouteGuards.push(routeGuard);
  } catch (error) {
    primaryFailure = error;
    recordS21PrimaryFailure(ledger, error, {
      stage: 'browser-route-guard',
      secretValues: [serviceKey, anonKey, ephemeralPassword, vaultSecretSentinel, actorAccessToken, actorRefreshToken]
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
      includeDetails: false,
    });
    try {
      await saveLedger(ledgerPath, ledger);
    } catch {
      // Preserve the route setup failure when private evidence storage is unavailable.
    }
    throw error;
  }
});

async function adminLoginAndOpenTaskRoute(page: Page): Promise<Locator> {
  setJourneyStage('admin-login-page-load');
  await page.goto('/login');
  setJourneyStage('admin-login-email-entry');
  await page.getByLabel(/email/i).fill(fixture.email);
  setJourneyStage('admin-login-password-entry');
  if (!ephemeralPassword) throw safeFailure('S21_FIXTURE_PASSWORD_UNAVAILABLE');
  await page.getByLabel(/password/i).fill(ephemeralPassword);
  setJourneyStage('admin-login-submit');
  await page.getByRole('button', { name: /sign in/i }).click();
  setJourneyStage('admin-home-after-login');
  await expect(page).toHaveURL(/\/$/);
  browserAdminLoginConfirmed = true;

  setJourneyStage('open-project-task-route');
  await page.goto(`/projects/${fixture.projectId}/tasks`);
  setJourneyStage('tasks-heading-visible');
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  setJourneyStage('empty-task-state-visible');
  await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible();
  return page.getByTestId('project-integrations-compact');
}

async function recordS21BrowserFailure(page: Page, error: unknown): Promise<void> {
  const secretValues = [
    status.DB_URL,
    serviceKey,
    anonKey,
    ephemeralPassword,
    vaultSecretSentinel,
    actorAccessToken,
    actorRefreshToken,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  recordS21PrimaryFailure(ledger, error, {
    stage: journeyStage,
    secretValues,
    includeDetails: browserAdminLoginConfirmed,
  });
  primaryFailure = error;
  if (browserAdminLoginConfirmed) {
    try {
      const reloadFailure = journeyStage === 'reload-linked-task-route' || journeyStage.startsWith('reloaded-');
      if (reloadFailure && reloadDiagnostic) {
        try {
          ledger.reloadDiagnostic = reloadDiagnostic.snapshot(await captureS21ReloadDom(page, fixture));
        } catch {
          ledger.reloadDiagnostic = reloadDiagnostic.snapshot();
        }
      }
      await page.screenshot({ path: evidence.failureScreenshotPath, animations: 'disabled', fullPage: reloadFailure });
      await chmod(evidence.failureScreenshotPath, 0o600);
      ledger.failureScreenshot = path.basename(evidence.failureScreenshotPath);
    } catch {
      ledger.failureScreenshot = 'unavailable';
    }
  }
  ledger.journeyStage = 'cleanup';
  try {
    await saveLedger(ledgerPath, ledger);
  } catch {
    // The original journey failure remains authoritative if diagnostics cannot be saved.
  }
}

test.describe.serial('S21 complete ordered task-link journey', () => {
  test('Supporting proof: Admin reviews the ClickUp list, saves the source, and reads back the binding', async ({ page }) => {
    test.setTimeout(S21_FIXTURE_PHASE_TIMEOUT_MS);
    try {
      const activeHandlerServer = handlerServer;
      if (!activeHandlerServer) throw safeFailure('S21_HANDLER_SERVER_UNAVAILABLE');
      const integrationCard = await adminLoginAndOpenTaskRoute(page);
      setJourneyStage('clickup-link-action-visible');
      await expect(integrationCard.getByRole('button', { name: 'Link to ClickUp' })).toBeVisible();
      setJourneyStage('open-clickup-link-picker');
      await integrationCard.getByRole('button', { name: 'Link to ClickUp' }).click();

      setJourneyStage('clickup-list-picker-opens');
      const listPicker = page.getByRole('combobox', { name: 'ClickUp List' });
      await listPicker.click();
      setJourneyStage('exact-existing-list-option-selectable');
      await page.getByRole('option', { name: new RegExp(fixture.listName) }).click();
      setJourneyStage('initial-transfer-direction-selected');
      await page.getByRole('radio', { name: /Start with PMO tasks/ }).check();
      setJourneyStage('review-link-action');
      await page.getByRole('button', { name: 'Review link' }).click();
      const reviewDialog = page.getByRole('dialog', { name: 'Review ClickUp link' });
      const reviewProjectField = reviewDialog.getByText('PMO project', { exact: true }).locator('..');
      const reviewListField = reviewDialog.getByText('ClickUp List', { exact: true }).locator('..');
      setJourneyStage('review-project-name-visible');
      await expect(reviewDialog).toBeVisible();
      await expect(reviewProjectField.getByText(fixture.projectName, { exact: true })).toBeVisible();
      setJourneyStage('review-list-name-visible');
      await expect(reviewListField.getByText(fixture.listName, { exact: true })).toBeVisible();
      setJourneyStage('review-transfer-direction-visible');
      await expect(reviewDialog.getByText(/Start with PMO tasks/).last()).toBeVisible();
      setJourneyStage('review-transfer-notice-visible');
      await expect(reviewDialog.getByText(/This choice describes the initial task transfer only/)).toBeVisible();
      setJourneyStage('review-no-transfer-completion-claim');
      await expect(reviewDialog.getByText(/Saving this link does not confirm that the initial task transfer has completed/)).toBeVisible();

      setJourneyStage('confirm-project-link-action');
      await page.getByRole('button', { name: 'Confirm ClickUp link' }).click();
      setJourneyStage('link-success-and-pending-transfer-visible');
      await expect(page.getByText(/Project linked\. Initial task transfer is not confirmed\./)).toBeVisible();
      setJourneyStage('initial-project-binding-readback');
      const firstBinding = await projectBindingReadback(initialAdmin, fixture);
      if (!firstBinding || firstBinding.external_container_id !== fixture.listId ||
        firstBinding.config?.direction !== 'push-seed' || firstBinding.linked_by !== fixture.userId) {
        throw safeFailure('S21_PROJECT_BINDING_PERSISTENCE_MISMATCH');
      }
      ledger.ownedIds.projectBindingId = firstBinding.id;
      bindingCreated = true;
      ledger.steps.projectBinding = 'verified';
      const browserSnapshot = pageRouteSnapshot?.();
      if (!browserSnapshot || browserSnapshot.clickupOnboardRequests !== 0 || browserSnapshot.handlerPosts > S21_MAX_HANDLER_POSTS) {
        throw safeFailure('S21_BROWSER_REQUEST_POLICY_VIOLATION');
      }
      ledger.browserBlockedByReason = { ...browserBlocked };
      if (Object.keys(browserBlocked).length > 0) throw safeFailure('S21_BROWSER_OUTBOUND_BLOCKED');
      ledger.transportSummary = activeHandlerServer.summary();
      await saveLedger(ledgerPath, ledger);
    } catch (error) {
      await recordS21BrowserFailure(page, error);
      throw error;
    }
  });

  test('AC-S21-005: Admin sees the persisted ClickUp link and initial source after reload', async ({ page }) => {
    test.setTimeout(S21_FIXTURE_PHASE_TIMEOUT_MS);
    try {
      const activeHandlerServer = handlerServer;
      if (!activeHandlerServer) throw safeFailure('S21_HANDLER_SERVER_UNAVAILABLE');
      const integrationCard = await adminLoginAndOpenTaskRoute(page);
      const firstBindingId = ledger.ownedIds.projectBindingId;
      if (!firstBindingId) throw safeFailure('S21_PROJECT_BINDING_PERSISTENCE_MISMATCH');

      setJourneyStage('reload-linked-task-route');
      reloadDiagnostic = createS21ReloadDiagnostic();
      page.on('response', (response) => {
        const category = classifyS21DiagnosticEndpoint(response.url(), apiOrigin);
        if (category) reloadDiagnostic?.recordResponse(category, response.status());
      });
      page.on('requestfailed', (request) => {
        const category = classifyS21DiagnosticEndpoint(request.url(), apiOrigin);
        if (category) reloadDiagnostic?.recordFailure(category);
      });
      await page.reload();
      setJourneyStage('reloaded-list-name-visible');
      const reloadedListField = integrationCard.getByText('ClickUp List:', { exact: true }).locator('..');
      await expect(reloadedListField).toHaveCount(1);
      await expect(reloadedListField).toHaveText(`ClickUp List: ${fixture.listName}`);
      setJourneyStage('reloaded-transfer-direction-visible');
      const reloadedSourceField = integrationCard.getByText('Initial source:', { exact: true }).locator('..');
      await expect(reloadedSourceField).toHaveCount(1);
      await expect(reloadedSourceField).toHaveText('Initial source: Start with PMO tasks');
      setJourneyStage('reloaded-link-success-visible');
      await expect(integrationCard.getByText(/Project linked\. Initial task transfer is not confirmed\./)).toBeVisible();
      setJourneyStage('reloaded-empty-task-state-visible');
      await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible();
      setJourneyStage('persisted-project-binding-readback');
      const secondBinding = await projectBindingReadback(initialAdmin, fixture);
      setJourneyStage('persisted-project-binding-fields-match');
      expect(secondBinding).toMatchObject({
        id: firstBindingId,
        org_id: fixture.orgId,
        project_id: fixture.projectId,
        external_tier: 'clickup',
        external_container_id: fixture.listId,
        config: { direction: 'push-seed' },
        linked_by: fixture.userId,
      });
      setJourneyStage('task-set-remains-unchanged');
      const { count: taskCount, error: taskCountError } = await initialAdmin
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', fixture.orgId)
        .eq('project_id', fixture.projectId);
      if (taskCountError || taskCount !== 0) throw safeFailure('S21_TASK_SET_CHANGED');

      const browserSnapshot = pageRouteSnapshot?.();
      if (!browserSnapshot || browserSnapshot.clickupOnboardRequests !== 0 || browserSnapshot.handlerPosts > S21_MAX_HANDLER_POSTS) {
        throw safeFailure('S21_BROWSER_REQUEST_POLICY_VIOLATION');
      }
      ledger.browserBlockedByReason = { ...browserBlocked };
      if (Object.keys(browserBlocked).length > 0) throw safeFailure('S21_BROWSER_OUTBOUND_BLOCKED');
      ledger.steps.projectBinding = 'verified-after-reload';
      ledger.transportSummary = activeHandlerServer.summary();
      await saveLedger(ledgerPath, ledger);
    } catch (error) {
      await recordS21BrowserFailure(page, error);
      throw error;
    }
  });
});


async function stopAndVerifyOwnedHandler(server: HandlerServer): Promise<void> {
  const failureStart = cleanupFailureErrors.length;
  try {
    ledger.transportSummary = await stopHandlerServer(server);
  } catch {
    markCleanupFailure('handler-stop');
  }
  let browserGuardSummary: ReturnType<typeof aggregateS21BrowserGuardSnapshots> | null = null;
  {
    try {
      const measured = validateS21TransportSummary(ledger.transportSummary, { requireLink: primaryFailure === null });
      browserGuardSummary = browserRouteGuards.length > 0
        ? aggregateS21BrowserGuardSnapshots(browserRouteGuards.map((guard) => ({
          snapshot: guard.snapshot(),
          blocked: guard.blocked,
        })))
        : null;
      const browserStatusTotal = Object.values(ledger.handlerResponseStatusCounts).reduce((sum, count) => sum + count, 0);
      const browserStatusesSuccessful = Object.keys(ledger.handlerResponseStatusCounts).every((status) => /^2\d\d$/.test(status));
      if (!browserGuardSummary || browserGuardSummary.handlerPosts !== measured.handlerPosts ||
          browserStatusTotal !== measured.handlerPosts || !browserStatusesSuccessful) {
        throw safeFailure('S21_HANDLER_COUNT_MISMATCH');
      }
    } catch {
      markCleanupFailure('transport-summary');
    }
  }
  if (browserGuardSummary) {
    ledger.browserBlockedByReason = { ...browserGuardSummary.blocked };
    if (browserGuardSummary.clickupOnboardRequests !== 0) markCleanupFailure('operator-initializer');
    if (Object.keys(browserGuardSummary.blocked).length > 0) markCleanupFailure('browser-outbound');
  }
  try {
    await saveLedger(ledgerPath, ledger);
  } catch {
    markCleanupFailure('write-ahead-ledger');
  }


  if (cleanupFailureErrors.length > failureStart) {
    throw new AggregateError(cleanupFailureErrors.slice(failureStart), 'S21 owned handler cleanup failed');
  }
}

async function cleanupOwnedFixtureRows(): Promise<void> {
  const failureStart = cleanupFailureErrors.length;
  try {
      if (!fixturePreflightPassed) throw safeFailure('S21_COLLISION_PRESERVED');
      const binding = await projectBindingReadback(initialAdmin, fixture);
      if (binding) {
        if (binding.external_container_id !== fixture.listId || binding.linked_by !== fixture.userId) {
          throw safeFailure('S21_PROJECT_BINDING_UNOWNED');
        }
        ledger.ownedIds.projectBindingId = binding.id;
        bindingCreated = true;
        ledger.steps.cleanup = 'project-binding-delete-in-flight';
        await saveLedger(ledgerPath, ledger);
        const { error } = await initialAdmin.from('external_project_bindings').delete()
          .eq('id', binding.id).eq('org_id', fixture.orgId).eq('project_id', fixture.projectId)
          .eq('external_tier', 'clickup');
        const after = await projectBindingReadback(initialAdmin, fixture);
        if (after) throw safeFailure(error ? 'S21_PROJECT_BINDING_DELETE_UNRESOLVED' : 'S21_PROJECT_BINDING_DELETE_FAILED');
        ledger.steps.projectBinding = 'removed';
        await saveLedger(ledgerPath, ledger);
      }
  } catch {
    markCleanupFailure('project-binding');
  }

  try {
      if (!fixturePreflightPassed) throw safeFailure('S21_COLLISION_PRESERVED');
      const project = await assertSingleRow(
        initialAdmin.from('projects').select('id, org_id, code, name').eq('id', fixture.projectId).eq('org_id', fixture.orgId),
        'S21_PROJECT_CLEANUP_READ_FAILED',
      );
      if (project) {
        if (project.code !== fixture.projectCode || project.name !== fixture.projectName) throw safeFailure('S21_PROJECT_UNOWNED');
        ledger.steps.cleanup = 'project-delete-in-flight';
        await saveLedger(ledgerPath, ledger);
        if (!actorAuthenticated) throw safeFailure('S21_PROJECT_DELETE_ACTOR_UNAVAILABLE');
        await actorClient.from('projects').delete().eq('id', fixture.projectId).eq('org_id', fixture.orgId);
        const after = await assertSingleRow(
          initialAdmin.from('projects').select('id').eq('id', fixture.projectId).eq('org_id', fixture.orgId),
          'S21_PROJECT_CLEANUP_RECONCILE_FAILED',
        );
        if (after) throw safeFailure('S21_PROJECT_DELETE_UNRESOLVED');
        projectDeleted = true;
        ledger.steps.project = 'removed';
        await saveLedger(ledgerPath, ledger);
      }
  } catch {
    markCleanupFailure('project');
  }

  try {
      if (!fixturePreflightPassed) throw safeFailure('S21_COLLISION_PRESERVED');
      const { data: authRead, error: authReadError } = await initialAdmin.auth.admin.getUserById(fixture.userId);
      if (authReadError && authReadError.status !== 404) throw safeFailure('S21_AUTH_CLEANUP_READ_FAILED');
      if (authRead.user) {
        if (authRead.user.email !== fixture.email) throw safeFailure('S21_AUTH_USER_UNOWNED');
        ledger.steps.cleanup = 'auth-user-delete-in-flight';
        await saveLedger(ledgerPath, ledger);
        await initialAdmin.auth.admin.deleteUser(fixture.userId);
        const { data: after } = await initialAdmin.auth.admin.getUserById(fixture.userId);
        if (after.user) throw safeFailure('S21_AUTH_USER_DELETE_UNRESOLVED');
      }
      const profile = await assertSingleRow(
        initialAdmin.from('profiles').select('id').eq('id', fixture.userId).eq('org_id', fixture.orgId),
        'S21_PROFILE_CLEANUP_READ_FAILED',
      );
      if (profile) throw safeFailure('S21_PROFILE_CASCADE_NOT_VERIFIED');
      ledger.steps.authUser = 'removed';
      ledger.steps.profile = 'removed';
      await saveLedger(ledgerPath, ledger);
  } catch {
    markCleanupFailure('auth-profile');
  }

  try {
      if (!fixturePreflightPassed) throw safeFailure('S21_COLLISION_PRESERVED');
      const snapshot = await queryFixtureSnapshot(status, fixture);
      if (snapshot.orgBindingCount === 1 && snapshot.vaultSecretCount === 1 && snapshot.vaultReaderPresent) {
        ledger.steps.cleanup = 'vault-binding-delete-in-flight';
        await saveLedger(ledgerPath, ledger);
        await removeVaultAndOrgBinding(status, fixture);
      } else if (snapshot.orgBindingCount !== 0 || snapshot.vaultSecretCount !== 0 || snapshot.vaultReaderPresent) {
        throw safeFailure('S21_VAULT_BINDING_PARTIAL_STATE');
      }
      const after = await queryFixtureSnapshot(status, fixture);
      if (after.orgBindingCount !== 0 || after.vaultSecretCount !== 0 || after.vaultReaderPresent) {
        throw safeFailure('S21_VAULT_BINDING_DELETE_UNRESOLVED');
      }
      ledger.steps.vaultAndOrgBinding = 'removed';
      await saveLedger(ledgerPath, ledger);
  } catch {
    markCleanupFailure('vault-org-binding');
  }

  if (!cleanupFailed && fixturePreflightPassed) {
    try {
      await assertFinalFixtureState(status, fixture, ledger, projectCreated, bindingCreated, projectDeleted);
      await saveLedger(ledgerPath, ledger);
    } catch {
      markCleanupFailure('final-retention-proof');
    }
  }
  await actorClient.auth.signOut({ scope: 'local' }).catch(() => undefined);
  if (cleanupFailureErrors.length > failureStart) {
    throw new AggregateError(cleanupFailureErrors.slice(failureStart), 'S21 owned fixture row cleanup failed');
  }
}

test.afterAll(async () => {
  test.setTimeout(S21_FIXTURE_PHASE_TIMEOUT_MS);
  if (!ledger) return;
  await runS21FixtureCleanup({
    preflightPassed: fixturePreflightPassed,
    ownedServer: handlerServer,
    primaryFailure,
    stopOwnedServer: (server) => stopAndVerifyOwnedHandler(server as HandlerServer),
    cleanupOwnedRows: cleanupOwnedFixtureRows,
  });
});
