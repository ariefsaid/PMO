import { expect, type Browser } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownedContextOptions, requireServiceRoleKey, SEED_PASSWORD } from '../helpers';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../../../scripts/pmo.mjs');
const REGISTER = path.resolve(HERE, '../../../scripts/register-oauth-client.mjs');
export const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  json: unknown;
  error: { message: string; code?: string; status?: number; details?: unknown } | null;
}

export function parseResult(code: number | null, stdout: string, stderr: string): CliResult {
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

const serviceHeaders = () => ({ apikey: requireServiceRoleKey() ?? '', authorization: `Bearer ${requireServiceRoleKey()}` });

/** One spec's CLI: its own registered OAuth client (named `<clientPrefix><run>`), the CLI spawned under it, Playwright as the browser. */
export function createCliHarness(clientPrefix: string) {
  let clientId = '';
  let clientName = '';

  function cliEnv(configDir: string): NodeJS.ProcessEnv {
    return { ...process.env, PMO_CONFIG_DIR: configDir, PMO_SUPABASE_URL: SUPABASE_URL, PMO_SUPABASE_KEY: ANON_KEY, PMO_CLIENT_ID: clientId };
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
   * `pmo login --no-browser`, with Playwright as the browser: open the printed sign-in URL, sign in on /login (the consent
   * screen sent us there), check the consent screen, click Allow. A user who already allowed this client is not asked again.
   */
  async function loginAs(
    browser: Browser,
    configDir: string,
    user: { email: string },
    contextOptions: ReturnType<typeof ownedContextOptions>,
    { consent = 'ask' }: { consent?: 'ask' | 'already' } = {},
  ): Promise<CliResult> {
    const child = spawn(process.execPath, [CLI, 'login', '--no-browser', '--timeout', '90'], { env: cliEnv(configDir) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    const done = new Promise<CliResult>((resolve) => child.on('close', (code) => resolve(parseResult(code, stdout, stderr))));
    const authorizeUrl = await new Promise<string>((resolve, reject) => {
      child.stderr.on('data', (d) => {
        stderr += d;
        const m = stderr.match(/https?:\/\/\S+\/auth\/v1\/oauth\/authorize\?\S+/);
        if (m) resolve(m[0]);
      });
      child.on('close', () => reject(new Error(`pmo login exited before printing a URL:\n${stderr}`)));
    });
    const context = await browser.newContext(contextOptions);
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
        await expect(page.getByRole('heading', { level: 1, name: `Allow ${clientName} to access your PMO account?` })).toBeVisible({ timeout: 20_000 });
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

  /** The one-time admin setup, run for real: registers a PUBLIC client with the CLI's loopback URIs. */
  async function register(run: string): Promise<void> {
    clientName = `${clientPrefix}${run}`;
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
  }

  /** Delete every OAuth client this harness's prefix names (a crashed earlier run's included). */
  async function sweepClients(): Promise<void> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/oauth/clients?per_page=1000`, { headers: serviceHeaders() });
    const { clients = [] } = (await res.json()) as { clients?: { client_id: string; client_name: string }[] };
    for (const c of clients.filter((x) => x.client_name.startsWith(clientPrefix))) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/oauth/clients/${c.client_id}`, { method: 'DELETE', headers: serviceHeaders() });
    }
  }

  return { register, sweepClients, pmo, loginAs, clientId: () => clientId };
}
