// @e2e-isolation: serial — creates a disposable org + a disposable ERPNext company, and drives the served erpnext-sweep.
/**
 * Shared fixtures for AC-ECA-050/051 (ERP connect scenarios S-C / S-D on the ERPNext bed).
 *
 * Each run owns a FRESH org (so "3 vendors in PMO" is true) with its own Admin and Project Manager, and a FRESH
 * ERPNext Company on the bench (so "empty ERP" is true). Nothing here touches the shared seed org's binding.
 * The sweep is the system's timer: a journey that waits for staging or sends ticks it the way cron would.
 */
import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runFullSweep } from './_sweepHelpers';

export const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
export const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
export const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? '';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
/** What the SERVED function dials (a Docker-reachable address), distinct from the test process's BENCH_URL. */
const SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
export const SEED_PASSWORD = 'Passw0rd!dev';

export const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_URL && BENCH_KEY && BENCH_SECRET);

const headers = { Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`, 'Content-Type': 'application/json' };

type Json = Record<string, unknown>;

export async function bench<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BENCH_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`bench ${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export const benchCreate = async (doctype: string, doc: Json): Promise<Json> =>
  (await bench<{ data: Json }>('POST', `/api/resource/${encodeURIComponent(doctype)}`, doc)).data;

export const benchDoc = async (doctype: string, name: string): Promise<Json> =>
  (await bench<{ data: Json }>('GET', `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)).data;

export async function benchCount(doctype: string, filters: unknown[] = []): Promise<number> {
  const q = `doctype=${encodeURIComponent(doctype)}&filters=${encodeURIComponent(JSON.stringify(filters))}`;
  return Number((await bench<{ message: number }>('GET', `/api/method/frappe.client.get_count?${q}`)).message);
}

export async function benchList(doctype: string, filters: unknown[], fields: string[]): Promise<Json[]> {
  const q = `filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(fields))}&limit_page_length=500`;
  return (await bench<{ data: Json[] }>('GET', `/api/resource/${encodeURIComponent(doctype)}?${q}`)).data;
}

/** A brand-new ERPNext Company: ERPNext gives it its chart of accounts; it holds no suppliers, projects or documents. */
export async function createBenchCompany(suffix: string): Promise<string> {
  const abbr = `E${suffix.replace(/[^A-Z0-9]/gi, '').slice(-5).toUpperCase()}`;
  const name = `ECA Bed ${suffix}`;
  await benchCreate('Company', { company_name: name, abbr, default_currency: 'IDR', country: 'Indonesia' });
  return name;
}

export interface EcaOrg {
  orgId: string;
  adminId: string;
  adminEmail: string;
  pmId: string;
  pmEmail: string;
}

export async function createOrg(admin: SupabaseClient, suffix: string): Promise<EcaOrg> {
  const orgId = crypto.randomUUID();
  const { error } = await admin.from('organizations').insert({ id: orgId, name: `ECA bed org ${suffix}` });
  if (error) throw new Error(`seed organizations failed: ${error.message}`);
  const mk = async (role: string, tag: string) => {
    const email = `eca-${tag}-${suffix}@acme.test`.toLowerCase();
    const { data, error: userErr } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (userErr || !data.user) throw new Error(`create ${tag} failed: ${userErr?.message}`);
    const { error: profErr } = await admin.from('profiles')
      .upsert({ id: data.user.id, org_id: orgId, email, full_name: `ECA ${tag} ${suffix}`, role, status: 'active' }, { onConflict: 'id' });
    if (profErr) throw new Error(`seed ${tag} profile failed: ${profErr.message}`);
    return { id: data.user.id, email };
  };
  const a = await mk('Admin', 'admin');
  const p = await mk('Project Manager', 'pm');
  return { orgId, adminId: a.id, adminEmail: a.email, pmId: p.id, pmEmail: p.email };
}

/** Activate the org's ERPNext connection on `company`, employing the given process/revenue domains (the connect instant). */
export async function activateBinding(admin: SupabaseClient, orgId: string, company: string, domains: string[]): Promise<void> {
  // The credentials live in Vault under a per-org ref, as a real connect stores them (the setup checklist reads Vault only).
  const { data: adminProfile } = await admin.from('profiles').select('id').eq('org_id', orgId).eq('role', 'Admin').single();
  const secretRef = `eca-bench-${orgId}`;
  const { error: vaultErr } = await admin.rpc('create_vault_secret_for_org', {
    p_org_id: orgId, p_external_tier: 'erpnext', p_secret_value: `${BENCH_KEY}:${BENCH_SECRET}`, p_secret_name: secretRef,
    p_actor_id: adminProfile?.id,
  });
  if (vaultErr) throw new Error(`seed Vault secret failed: ${vaultErr.message}`);
  const { error } = await admin.from('external_org_bindings').upsert({
    org_id: orgId, external_tier: 'erpnext', site_url: SITE_URL, secret_ref: secretRef,
    webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET', version_major: 15, config: { company },
    status: 'active', connected_at: new Date().toISOString(), activated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,external_tier' });
  if (error) throw new Error(`seed external_org_bindings failed: ${error.message}`);
  for (const domain of domains) {
    const { error: ownErr } = await admin.from('external_domain_ownership')
      .upsert({ org_id: orgId, external_tier: 'erpnext', domain }, { onConflict: 'org_id,external_tier,domain' });
    if (ownErr) throw new Error(`seed external_domain_ownership(${domain}) failed: ${ownErr.message}`);
  }
}

export async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

/**
 * Wait for `check` to pass, ticking the real sweep between looks (the timer that stages the census and drains sends).
 * Fails with the last assertion error once `capMs` has passed.
 */
export async function untilWithSweep(orgId: string, check: () => Promise<void>, capMs: number): Promise<void> {
  const deadline = Date.now() + capMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
    }
    // A tick that overlaps another holds the org's lock and runs no pass: that is only a missed turn, so look again.
    await runFullSweep(FUNCTIONS_URL, orgId).catch((err: Error) => {
      if (!/overlapping tick/.test(err.message)) throw err;
    });
  }
}

/** Remove the disposable org (best effort: it is a throwaway) and, first, its connection so the sweep stops ticking it. */
export async function dropOrg(admin: SupabaseClient, org: EcaOrg): Promise<void> {
  await admin.from('external_domain_ownership').delete().eq('org_id', org.orgId);
  await admin.from('external_org_bindings').delete().eq('org_id', org.orgId);
  await admin.from('organizations').delete().eq('id', org.orgId);
  for (const id of [org.adminId, org.pmId]) await admin.auth.admin.deleteUser(id).catch(() => undefined);
}

export const nowPlus = (ms: number) => new Date(Date.now() + ms).toISOString();

/**
 * Open Integrations and click "Match records". When the button does not appear, the function's own answer to the checklist's
 * readiness read is the root cause, so fail with it instead of a bare locator timeout.
 */
export async function openMatchRecords(page: Page, org: EcaOrg): Promise<void> {
  await page.goto('/administration/integrations');
  const button = page.getByRole('button', { name: 'Match records' });
  try {
    await button.waitFor({ timeout: 60_000 });
  } catch (err) {
    const user = createClient(AUTH_URL, ANON_KEY);
    const { data } = await user.auth.signInWithPassword({ email: org.adminEmail, password: SEED_PASSWORD });
    const res = await fetch(`${FUNCTIONS_URL}/functions/v1/external-set-company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${data.session?.access_token}` },
      body: JSON.stringify({ tier: 'erpnext', setupAction: 'readiness' }),
    });
    throw new Error(`"Match records" did not appear; readiness answered ${res.status}: ${(await res.text()).slice(0, 500)}`, { cause: err });
  }
  await button.click();
}

/** Parties the bench already holds before the test adds any: ERPNext suppliers/customers are site-wide, not per Company. */
export const benchPartyCount = async (): Promise<number> => (await benchCount('Supplier')) + (await benchCount('Customer'));

/**
 * The org's own record of what it tried to send, for a failure message: a journey that waits for a send to land
 * has to say WHY it did not, not just that a count stayed short.
 */
export async function orgSendState(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data: outbox } = await admin.from('external_command_outbox')
    .select('domain,state,operation,attempt_count,last_error').eq('org_id', orgId);
  const { data: own } = await admin.from('external_domain_ownership').select('domain').eq('org_id', orgId);
  return `owned domains: ${JSON.stringify(own ?? [])}; outbox: ${JSON.stringify(outbox ?? []).slice(0, 3000)}`;
}
