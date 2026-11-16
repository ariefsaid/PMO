// @e2e-isolation: self-isolated — registers its OWN OAuth client and three run-scoped fixture users (never a shared seed user: banning or signing out a shared one would poison every later spec), creates only projects named with the exclusive prefix "E2E CLI-001 ", and deletes all of it before and after the run.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ownedContextOptions, requireServiceRoleKey, SEED_PASSWORD } from './helpers';
import { ANON_KEY, SUPABASE_URL, createCliHarness } from './support/pmoCli';

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

const SEED_ORG = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const EMAIL_PREFIX = 'e2e-cli-001-';
const NAME_PREFIX = 'E2E CLI-001 ';
const CLIENT_PREFIX = 'PMO CLI e2e ';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Fixture = { id: string; email: string };
let admin: SupabaseClient;
const cli = createCliHarness(CLIENT_PREFIX);
const { pmo, loginAs } = cli;
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
  await cli.sweepClients();
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

test.beforeAll(async ({ browser }, workerInfo) => {
  admin = adminClient();
  await sweep();
  // The one-time admin setup, run for real: registers a PUBLIC client with the CLI's loopback URIs.
  await cli.register(RUN);
  users.pm = await createFixtureUser('Project Manager', 'pm');
  users.engineer = await createFixtureUser('Engineer', 'engineer');
  users.banned = await createFixtureUser('Project Manager', 'banned');
  // `returning` has already allowed the client once — AC-CLI-004/005 sign in again and must NOT be
  // asked a second time. Its first approval happens here so those tests stand alone.
  users.returning = await createFixtureUser('Project Manager', 'returning');
  const firstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-cli-e2e-'));
  try {
    const first = await loginAs(browser, firstDir, users.returning, ownedContextOptions(workerInfo));
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

test('AC-CLI-001: the CLI signs in as the user, and what it creates lands under that user’s own permissions', async ({ browser }, testInfo) => {
  const login = await loginAs(browser, configDir, users.pm, ownedContextOptions(testInfo));
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

test('AC-CLI-002: a user without write permission on an entity gets the database’s refusal', async ({ browser }, testInfo) => {
  const { data: project, error } = await admin
    .from('projects')
    .insert({ name: `${NAME_PREFIX}${RUN} eng`, status: 'Internal Project', org_id: SEED_ORG })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  const login = await loginAs(browser, configDir, users.engineer, ownedContextOptions(testInfo));
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

test('AC-CLI-003: a banned user’s token is refused — writes, reads and refresh', async ({ browser }, testInfo) => {
  const login = await loginAs(browser, configDir, users.banned, ownedContextOptions(testInfo));
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

test('AC-CLI-004: after logout the CLI refuses, and the old session is refused by the server', async ({ browser }, testInfo) => {
  // `returning` allowed this client in beforeAll, so the consent screen sends the browser straight back.
  const login = await loginAs(browser, configDir, users.returning, ownedContextOptions(testInfo), { consent: 'already' });
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
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token, client_id: cli.clientId() }),
  });
  expect(refresh.status).toBe(400);
  const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${access_token}` },
  });
  expect(user.status).toBe(403);
});

test('AC-CLI-005: an expired access token is refreshed transparently and the rotated refresh token is kept', async ({ browser }, testInfo) => {
  const login = await loginAs(browser, configDir, users.returning, ownedContextOptions(testInfo), { consent: 'already' });
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
