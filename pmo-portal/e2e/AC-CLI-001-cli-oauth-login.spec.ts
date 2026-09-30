// @e2e-isolation: self-isolated — registers its OWN OAuth client and three run-scoped fixture users (never a shared seed user: banning or signing out a shared one would poison every later spec), creates only projects named with the exclusive prefix "E2E CLI-001 ", and deletes all of it before and after the run.
import { test, expect, type Browser } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireServiceRoleKey, SEED_PASSWORD } from './helpers';

/**
 * AC-CLI-001..005 (#728) — the PMO command-line client, signed in as the user through Supabase's
 * OAuth 2.1 server (DD-API-2), against the REAL stack: GoTrue's OAuth server, the app's consent
 * screen, PostgREST and RLS. The CLI's own logic (PKCE, allow-lists, guards, file mode) is unit-
 * tested in scripts/pmo.test.mjs; this journey proves what only the real stack can:
 *
 *   AC-CLI-001  login yields a session that acts AS the user (whoami, a create lands under RLS)
 *   AC-CLI-002  a user without write permission gets the database's refusal
 *   AC-CLI-003  a banned user's token is refused (writes, reads and refresh)
 *   AC-CLI-004  a signed-out token is refused (logout revokes the session server-side)
 *   AC-CLI-005  an expired access token is refreshed transparently, the rotated token persisted
 *
 * The browser is played by Playwright: the CLI runs with --no-browser, the test reads the sign-in
 * URL it prints, signs in on the real /login (the consent screen's return-to, AC-CLI-012) and
 * clicks Allow on the real /oauth/consent. The CLI's loopback server then completes the login.
 *
 * Tests run in order in one worker: the CLI listens on a small fixed set of registered loopback
 * ports (Supabase matches redirect URIs exactly), so logins must not overlap.
 */
test.describe.configure({ mode: 'default' });
test.setTimeout(120_000);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../../scripts/pmo.mjs');
const REGISTER = path.resolve(HERE, '../../scripts/register-oauth-client.mjs');

const SEED_ORG = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const EMAIL_PREFIX = 'e2e-cli-001-';
const NAME_PREFIX = 'E2E CLI-001 ';
const CLIENT_PREFIX = 'PMO CLI e2e ';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Fixture = { id: string; email: string };
let admin: SupabaseClient;
let clientId = '';
let clientName = '';
const users: Record<'pm' | 'engineer' | 'banned' | 'returning', Fixture> = {} as never;

function adminClient(): SupabaseClient {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('AC-CLI-001 requires the local Supabase stack');
  const key = requireServiceRoleKey();
  if (!key || !ANON_KEY) {
    throw new Error('AC-CLI-001 needs SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY — run through scripts/e2e-local.sh');
  }
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  json: unknown;
  error: { message: string; code?: string; status?: number } | null;
}

function parseResult(code: number | null, stdout: string, stderr: string): CliResult {
  let json: unknown = null;
  let error: CliResult['error'] = null;
  try {
    json = JSON.parse(stdout);
  } catch {
    /* no stdout JSON */
  }
  const last = stderr.trim().split('\n').pop() ?? '';
  try {
    error = (JSON.parse(last) as { error: CliResult['error'] }).error;
  } catch {
    /* no error JSON */
  }
  return { code, stdout, stderr, json, error };
}

function cliEnv(configDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PMO_CONFIG_DIR: configDir,
    PMO_SUPABASE_URL: SUPABASE_URL,
    PMO_SUPABASE_KEY: ANON_KEY,
    PMO_CLIENT_ID: clientId,
  };
}

function pmo(configDir: string, args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: cliEnv(configDir) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve(parseResult(code, stdout, stderr)));
  });
}

/**
 * `pmo login --no-browser`, with Playwright as the browser: open the printed sign-in URL, sign in
 * on /login (the consent screen sent us there), check the consent screen, click Allow. A user who
 * already allowed this client is not asked again (`consent: 'already'`) — the screen goes straight
 * back to the CLI.
 */
async function loginAs(
  browser: Browser,
  configDir: string,
  user: Fixture,
  { consent = 'ask' }: { consent?: 'ask' | 'already' } = {},
): Promise<CliResult> {
  const child = spawn(process.execPath, [CLI, 'login', '--no-browser', '--timeout', '90'], { env: cliEnv(configDir) });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  const done = new Promise<CliResult>((resolve) =>
    child.on('close', (code) => resolve(parseResult(code, stdout, stderr))),
  );
  const authorizeUrl = await new Promise<string>((resolve, reject) => {
    child.stderr.on('data', (d) => {
      stderr += d;
      const m = stderr.match(/https?:\/\/\S+\/auth\/v1\/oauth\/authorize\?\S+/);
      if (m) resolve(m[0]);
    });
    child.on('close', () => reject(new Error(`pmo login exited before printing a URL:\n${stderr}`)));
  });

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(authorizeUrl);
    // Signed out in this browser → the consent screen's guard sends us to /login (AC-CLI-012).
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(SEED_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    // …and sign-in returns us to the consent screen, which names the client and the account.
    if (consent === 'ask') {
      await expect(page).toHaveURL(/\/oauth\/consent\?authorization_id=/, { timeout: 20_000 });
      await expect(
        page.getByRole('heading', { level: 1, name: `Allow ${clientName} to access your PMO account?` }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
      await page.getByRole('button', { name: 'Allow' }).click();
    }
    // The browser lands on the CLI's loopback page.
    await expect(page.getByRole('heading', { name: 'Signed in to PMO' })).toBeVisible({ timeout: 20_000 });
  } finally {
    await context.close();
  }
  return done;
}

function readCreds(configDir: string): Record<string, { access_token: string; refresh_token: string; expires_at: number }> {
  return JSON.parse(fs.readFileSync(path.join(configDir, 'credentials.json'), 'utf8'));
}

async function sweep(): Promise<void> {
  const { error: projErr } = await admin.from('projects').delete().eq('org_id', SEED_ORG).like('name', `${NAME_PREFIX}%`);
  if (projErr) throw new Error(`AC-CLI-001 cleanup (projects) failed: ${projErr.message}`);
  const { data: profiles } = await admin.from('profiles').select('id').like('email', `${EMAIL_PREFIX}%`);
  for (const { id } of (profiles ?? []) as { id: string }[]) {
    await admin.from('profiles').delete().eq('id', id);
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/oauth/clients?per_page=1000`, {
    headers: { apikey: requireServiceRoleKey() ?? '', authorization: `Bearer ${requireServiceRoleKey()}` },
  });
  const { clients = [] } = (await res.json()) as { clients?: { client_id: string; client_name: string }[] };
  for (const c of clients.filter((x) => x.client_name.startsWith(CLIENT_PREFIX))) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/oauth/clients/${c.client_id}`, {
      method: 'DELETE',
      headers: { apikey: requireServiceRoleKey() ?? '', authorization: `Bearer ${requireServiceRoleKey()}` },
    });
  }
}

async function createFixtureUser(role: 'Project Manager' | 'Engineer', label: string): Promise<Fixture> {
  const email = `${EMAIL_PREFIX}${label}-${RUN}@acme.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`AC-CLI-001 fixture user failed: ${error?.message}`);
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert(
      { id: data.user.id, org_id: SEED_ORG, email, full_name: `CLI ${label}`, role, status: 'active' },
      { onConflict: 'id' },
    );
  if (profileErr) throw new Error(`AC-CLI-001 fixture profile failed: ${profileErr.message}`);
  return { id: data.user.id, email };
}

test.beforeAll(async ({ browser }) => {
  admin = adminClient();
  await sweep();
  // The one-time admin setup, run for real: registers a PUBLIC client with the CLI's loopback URIs.
  clientName = `${CLIENT_PREFIX}${RUN}`;
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [REGISTER, '--name', clientName], {
      env: { ...process.env, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: requireServiceRoleKey() },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`register failed: ${stderr}`))));
  });
  clientId = (JSON.parse(out) as { client_id: string }).client_id;
  users.pm = await createFixtureUser('Project Manager', 'pm');
  users.engineer = await createFixtureUser('Engineer', 'engineer');
  users.banned = await createFixtureUser('Project Manager', 'banned');
  // `returning` has already allowed the client once — AC-CLI-004/005 sign in again and must NOT be
  // asked a second time. Its first approval happens here so those tests stand alone.
  users.returning = await createFixtureUser('Project Manager', 'returning');
  const firstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-cli-e2e-'));
  try {
    const first = await loginAs(browser, firstDir, users.returning);
    if (first.code !== 0) throw new Error(`AC-CLI-001 fixture: first login failed: ${first.stderr}`);
  } finally {
    fs.rmSync(firstDir, { recursive: true, force: true });
  }
});

test.afterAll(async () => {
  if (admin) await sweep();
});

let configDir = '';
test.beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-cli-e2e-'));
});
test.afterEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
});

test('AC-CLI-001: the CLI signs in as the user, and what it creates lands under that user’s own permissions', async ({ browser }) => {
  const login = await loginAs(browser, configDir, users.pm);
  expect(login.code, login.stderr).toBe(0);
  expect(login.json).toMatchObject({ signed_in: true, user: { id: users.pm.id, email: users.pm.email } });
  expect(fs.statSync(path.join(configDir, 'credentials.json')).mode & 0o777).toBe(0o600);

  const who = await pmo(configDir, ['whoami']);
  expect(who.code, who.stderr).toBe(0);
  expect(who.json).toMatchObject({ id: users.pm.id, email: users.pm.email, role: 'Project Manager', status: 'active' });

  // AC-CLI-014 on the real schema: people can be looked up (for project_manager_id / assignee_id)
  // through the narrowed, read-only profiles columns — and nothing else about them.
  const people = await pmo(configDir, ['get', 'profiles', '--filter', `id=eq.${users.engineer.id}`]);
  expect(people.code, people.stderr).toBe(0);
  expect(people.json).toEqual([
    { id: users.engineer.id, full_name: 'CLI engineer', role: 'Engineer', title: null, status: 'active' },
  ]);

  const name = `${NAME_PREFIX}${RUN}`;
  const project = await pmo(configDir, ['create', 'projects', JSON.stringify({ name, status: 'Internal Project' })]);
  expect(project.code, project.stderr).toBe(0);
  const [projectRow] = project.json as { id: string; org_id: string; name: string }[];
  expect(projectRow).toMatchObject({ name, org_id: SEED_ORG });

  const milestone = await pmo(configDir, [
    'create',
    'project_milestones',
    JSON.stringify({ project_id: projectRow.id, name: 'Mobilisation' }),
  ]);
  expect(milestone.code, milestone.stderr).toBe(0);

  // GOAL: the rows really exist in the database, in the user's org — read back through the CLI…
  const read = await pmo(configDir, ['get', 'project_milestones', '--select', 'name,project_id', '--filter', `project_id=eq.${projectRow.id}`]);
  expect(read.json).toEqual([{ name: 'Mobilisation', project_id: projectRow.id }]);
  // …and independently of it.
  const { data } = await admin.from('project_milestones').select('name, org_id').eq('project_id', projectRow.id);
  expect(data).toEqual([{ name: 'Mobilisation', org_id: SEED_ORG }]);

  // AC-CLI-015 (owned by pgTAP): the DATABASE holds the API-client surface, not just the CLI. The
  // same token, sent straight to the Data API, may not delete or reach a table outside the surface.
  const token = readCreds(configDir)[SUPABASE_URL].access_token;
  const api = { apikey: ANON_KEY, authorization: `Bearer ${token}` };
  const del = await fetch(`${SUPABASE_URL}/rest/v1/project_milestones?project_id=eq.${projectRow.id}`, {
    method: 'DELETE',
    headers: api,
  });
  expect(del.status).toBe(403);
  expect(((await del.json()) as { code: string }).code).toBe('42501');
  const outside = await fetch(`${SUPABASE_URL}/rest/v1/work_orders?select=id&limit=1`, { headers: api });
  expect(outside.status).toBe(403);
  const { data: still } = await admin.from('project_milestones').select('name').eq('project_id', projectRow.id);
  expect(still).toEqual([{ name: 'Mobilisation' }]);
});

test('AC-CLI-002: a user without write permission on an entity gets the database’s refusal', async ({ browser }) => {
  const { data: project, error } = await admin
    .from('projects')
    .insert({ name: `${NAME_PREFIX}${RUN} eng`, status: 'Internal Project', org_id: SEED_ORG })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  const login = await loginAs(browser, configDir, users.engineer);
  expect(login.code, login.stderr).toBe(0);

  // Engineers may not write milestones (project_milestones_write: Admin / Project Manager only).
  const attempt = await pmo(configDir, [
    'create',
    'project_milestones',
    JSON.stringify({ project_id: project.id, name: 'Not allowed' }),
  ]);
  expect(attempt.code).toBe(1);
  expect(attempt.error).toMatchObject({ status: 403, code: '42501' });
  expect(attempt.error?.message).toMatch(/row-level security/);
  const { data } = await admin.from('project_milestones').select('id').eq('project_id', project.id);
  expect(data).toEqual([]);
});

test('AC-CLI-003: a banned user’s token is refused — writes, reads and refresh', async ({ browser }) => {
  const login = await loginAs(browser, configDir, users.banned);
  expect(login.code, login.stderr).toBe(0);
  const before = await pmo(configDir, ['get', 'companies', '--select', 'id', '--limit', '1']);
  expect((before.json as unknown[]).length).toBe(1);

  const { error } = await admin.auth.admin.updateUserById(users.banned.id, { ban_duration: '876000h' });
  if (error) throw new Error(error.message);

  const write = await pmo(configDir, ['create', 'projects', JSON.stringify({ name: `${NAME_PREFIX}${RUN} banned`, status: 'Leads' })]);
  expect(write.code).toBe(1);
  expect(write.error).toMatchObject({ code: '42501' });
  const read = await pmo(configDir, ['get', 'companies', '--select', 'id', '--limit', '1']);
  expect(read.json).toEqual([]);

  // Once the access token is due for refresh, the refresh itself is refused.
  const creds = readCreds(configDir);
  creds[SUPABASE_URL].expires_at = 0;
  fs.writeFileSync(path.join(configDir, 'credentials.json'), JSON.stringify(creds), { mode: 0o600 });
  const who = await pmo(configDir, ['whoami']);
  expect(who.code).toBe(1);
  expect(who.error).toMatchObject({ code: 'user_banned' });
  expect(who.error?.message).toMatch(/pmo login/);
  const { data } = await admin.from('projects').select('id').eq('name', `${NAME_PREFIX}${RUN} banned`);
  expect(data).toEqual([]);
});

test('AC-CLI-004: after logout the CLI refuses, and the old session is refused by the server', async ({ browser }) => {
  // `returning` allowed this client in beforeAll, so the consent screen sends the browser straight back.
  const login = await loginAs(browser, configDir, users.returning, { consent: 'already' });
  expect(login.code, login.stderr).toBe(0);
  const creds = readCreds(configDir);
  const { access_token, refresh_token } = creds[SUPABASE_URL];
  // The stored access token has expired: logout must refresh before it revokes (M2).
  creds[SUPABASE_URL].expires_at = 0;
  fs.writeFileSync(path.join(configDir, 'credentials.json'), JSON.stringify(creds), { mode: 0o600 });

  const out = await pmo(configDir, ['logout']);
  expect(out.code, out.stderr).toBe(0);
  expect(out.json).toMatchObject({ signed_out: true });

  const who = await pmo(configDir, ['whoami']);
  expect(who.code).toBe(1);
  expect(who.error?.message).toMatch(/not signed in/i);

  // The session is revoked server-side, not just forgotten locally.
  const refresh = await fetch(`${SUPABASE_URL}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token, client_id: clientId }),
  });
  expect(refresh.status).toBe(400);
  const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${access_token}` },
  });
  expect(user.status).toBe(403);
});

test('AC-CLI-005: an expired access token is refreshed transparently and the rotated refresh token is kept', async ({ browser }) => {
  const login = await loginAs(browser, configDir, users.returning, { consent: 'already' });
  expect(login.code, login.stderr).toBe(0);
  const creds = readCreds(configDir);
  const old = { ...creds[SUPABASE_URL] };
  creds[SUPABASE_URL].expires_at = 0;
  fs.writeFileSync(path.join(configDir, 'credentials.json'), JSON.stringify(creds), { mode: 0o600 });

  const who = await pmo(configDir, ['whoami']);
  expect(who.code, who.stderr).toBe(0);
  expect(who.json).toMatchObject({ email: users.returning.email });

  const now = readCreds(configDir)[SUPABASE_URL];
  expect(now.refresh_token).not.toBe(old.refresh_token);
  expect(now.access_token).not.toBe(old.access_token);
  expect(now.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  expect(fs.statSync(path.join(configDir, 'credentials.json')).mode & 0o777).toBe(0o600);
});
