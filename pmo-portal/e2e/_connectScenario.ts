// Shared fixtures for the Odoo master-data bed journeys (#1504 S10; AC-ECA-050/051 Odoo parity). Synthetic names only.
// ECA-8 (#1607) may adopt these helpers; do not copy them.
import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, SEED_PASSWORD } from './helpers';
import { bindCall, createPacer, type OdooCall } from '../src/lib/adapterSeam/odoo/client';
import { discoverCapabilities } from '../src/lib/adapterSeam/odoo/discovery';
import type { Database } from '../src/lib/supabase/database.types';

export const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
export const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
export const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
export const BED_URL = process.env.ODOO_BED_URL ?? '';
export const BED_DB = process.env.ODOO_BED_DB ?? '';
export const BED_KEY = process.env.ODOO_BED_KEY ?? '';
const SWEEP_SECRET = process.env.ODOO_SWEEP_SECRET ?? '';
export const SERVICE_KEY = FUNCTIONS_URL && BED_URL ? (requireServiceRoleKey() ?? '') : '';

/** Gate on the dependencies (never CI): the Odoo bed, the served-functions lane and the local Supabase credentials. A partial bed config throws. */
export function scenarioGate(ac: string): { ready: boolean; reason: string } {
  const bed = [BED_URL, BED_DB, BED_KEY];
  if (bed.some(Boolean) && !bed.every(Boolean)) throw new Error(`${ac} requires the Odoo bed settings together (URL, database, key).`);
  const ready = Boolean(bed.every(Boolean) && FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && SWEEP_SECRET);
  return { ready, reason: `${ac} requires the Odoo bed, the served-functions lane and the local Supabase credentials.` };
}

export type Admin = SupabaseClient<Database>;
export type Actor = { id: string; email: string; password: string };
export const adminClient = (): Admin => createClient<Database>(AUTH_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export const must = async <T>(label: string, result: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> => {
  const { data, error } = await result;
  if (error) throw new Error(`${label}: ${error.message}`);
  return (data ?? []) as NonNullable<T>;
};
const rpc = (c: Admin, name: string, args: Record<string, unknown>) =>
  (c.rpc as unknown as (fn: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>)(name, args);

/** The bed as the test process reaches it (the served functions reach it as host.docker.internal). */
export function directBedUrl(): string {
  const url = new URL(BED_URL);
  url.hostname = '127.0.0.1';
  return url.origin;
}

export type BedCompany = { id: number; name: string; currency: string };

export async function bedCall(): Promise<{ call: OdooCall; company: BedCompany }> {
  const raw = bindCall({ baseUrl: directBedUrl(), apiKey: BED_KEY, database: BED_DB, fetchImpl: fetch, pace: createPacer(5) });
  const companies = await raw<Array<{ id: number; name: string; currency_id: [number, string] }>>('res.company', 'search_read', { domain: [], fields: ['id', 'name', 'currency_id'], order: 'id asc' });
  const picked = companies.find((c) => c.currency_id?.[1] === 'IDR') ?? companies[0];
  if (!picked) throw new Error('The Odoo bed has no company.');
  const call = (async <T>(model: string, method: string, body: Record<string, unknown> = {}) =>
    raw<T>(model, method, { ...body, context: { allowed_company_ids: [picked.id], company_id: picked.id, ...((body.context as object) ?? {}) } })) as OdooCall;
  return { call, company: { id: picked.id, name: picked.name, currency: picked.currency_id?.[1] ?? 'IDR' } };
}

/** Row counts the scenarios compare before and after: accounts and taxes must never be created by a send. */
export async function bedCounts(call: OdooCall): Promise<{ accounts: number; taxes: number; partners: number; analytic: number; products: number }> {
  const n = (model: string, domain: unknown[] = []) => call<number>(model, 'search_count', { domain, context: { active_test: false } });
  const [accounts, taxes, partners, analytic, products] = await Promise.all([
    n('account.account'), n('account.tax'), n('res.partner'), n('account.analytic.account'), n('product.product'),
  ]);
  return { accounts, taxes, partners, analytic, products };
}

export type ScenarioOrg = {
  orgId: string; admin: Actor; company: BedCompany; call: OdooCall; stamp: string;
  planId: number; secretRef: string; cleanup: () => Promise<void>;
};

async function ensureFeature(admin: Admin, orgId: string, key: string) {
  const { data } = await rpc(admin, 'service_feature_enabled', { p_org_id: orgId, p_key: key });
  if (data === true) return;
  const operator = createClient<Database>(AUTH_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await operator.auth.signInWithPassword({ email: 'operator@pmo.test', password: SEED_PASSWORD });
  if (error) throw new Error('could not sign in the local Operator fixture');
  const toggled = await operator.rpc('operator_toggle_feature', { p_org_id: orgId, p_key: key, p_enabled: true });
  if (toggled.error) throw new Error(`could not enable ${key} for the scenario organisation`);
}

/**
 * A fresh, isolated PMO org with an Admin, connected to and activated on the bed. No PMO masters and no mirror yet:
 * the scenario seeds what it needs, then calls `sweep()`.
 */
export async function provisionOdooOrg(admin: Admin, stamp: string): Promise<ScenarioOrg> {
  const { call, company } = await bedCall();
  const orgId = crypto.randomUUID();
  const actor: Actor = { id: '', email: `${stamp.toLowerCase()}-admin@example.test`, password: `${crypto.randomUUID()}Aa1!` };
  const secretRef = `${stamp}-${crypto.randomUUID()}`;
  let connected = false;
  const cleanup = async () => {
    if (connected && actor.id) await Promise.resolve(rpc(admin, 'disconnect_external_integration', { p_org_id: orgId, p_external_tier: 'odoo', p_actor_id: actor.id })).catch(() => undefined);
    for (const table of ['external_domain_ownership', 'external_project_bindings', 'external_command_outbox', 'external_refs', 'erp_connect_proposals', 'erp_connect_census', 'erp_connect_runs', 'external_sync_watermarks', 'external_master_records', 'external_org_bindings', 'procurement_items', 'procurements', 'projects', 'companies']) {
      await (admin.from(table as never) as unknown as { delete: () => { eq: (c: string, v: string) => PromiseLike<unknown> } }).delete().eq('org_id', orgId);
    }
    if (actor.id) { await admin.from('profiles').delete().eq('id', actor.id); await admin.auth.admin.deleteUser(actor.id); }
    await admin.from('organizations').delete().eq('id', orgId);
  };
  try {
    await must('org', admin.from('organizations').insert({ id: orgId, name: `${stamp} organization`, default_currency: company.currency, lifecycle_state: 'test' }).select('id').single());
    const created = await admin.auth.admin.createUser({ email: actor.email, password: actor.password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('could not create the scenario Admin');
    actor.id = created.data.user.id;
    await must('profile', admin.from('profiles').insert({ id: actor.id, org_id: orgId, full_name: `${stamp} admin`, email: actor.email, role: 'Admin', status: 'active', locale: 'en', timezone: 'UTC' }).select('id').single());
    await ensureFeature(admin, orgId, 'erp_sync');

    await must('stage', rpc(admin, 'stage_vault_secret_for_org', { p_org_id: orgId, p_external_tier: 'odoo', p_secret_value: BED_KEY, p_secret_name: secretRef, p_actor_id: actor.id }));
    await must('finalize', rpc(admin, 'finalize_odoo_connect', {
      p_org_id: orgId, p_secret_ref: secretRef, p_site_url: new URL(BED_URL).origin, p_database: BED_DB,
      p_key_expires_on: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10), p_discard: false, p_kill_switch_enabled: true, p_actor_id: actor.id,
    }));
    connected = true;
    const capabilities = await discoverCapabilities(call, { versionMajor: 20, now: new Date() });
    await must('activate', rpc(admin, 'activate_odoo_binding', {
      p_org_id: orgId, p_version_major: 20, p_company_id: company.id, p_company_name: company.name, p_config_patch: { capabilities }, p_actor_id: actor.id,
    }));
    const [plan] = await call<Array<{ id: number }>>('account.analytic.plan', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    if (!plan) throw new Error('The Odoo bed needs an analytic plan.');
    return { orgId, admin: actor, company, call, stamp, planId: plan.id, secretRef, cleanup };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}

/** One 5-minute tick, on demand: the real sweep function with its secret (directories, matching, accepted sends). */
export async function sweep(): Promise<void> {
  const res = await fetch(`${FUNCTIONS_URL}/functions/v1/odoo-sweep`, { method: 'POST', headers: { Authorization: `Bearer ${SWEEP_SECRET}`, 'Content-Type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`the sweep answered ${res.status}`);
}

export async function accessToken(actor: Actor): Promise<string> {
  const c = createClient<Database>(AUTH_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: actor.email, password: actor.password });
  if (error || !data.session) throw new Error('could not sign the scenario Admin in');
  return data.session.access_token;
}

/** The shared setup verbs (census, list-proposals, accept-proposals, ...) exactly as the Integrations screen calls them. */
export async function setup<T = Record<string, unknown>>(token: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${FUNCTIONS_URL}/functions/v1/external-set-company`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ tier: 'odoo', ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(`setup ${String(body.setupAction)} answered ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

/** Poll `read` (sweeping between polls) until `done` holds; the failure carries the last value. */
export async function sweepUntil<T>(read: () => Promise<T>, done: (v: T) => boolean, label: string, rounds = 12): Promise<T> {
  let last = await read();
  for (let i = 0; i < rounds && !done(last); i += 1) { await sweep(); last = await read(); }
  expect(done(last), `${label}: ${JSON.stringify(last)}`).toBe(true);
  return last;
}

export async function signIn(page: Page, actor: Actor) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(actor.email);
  await page.getByLabel(/password/i).fill(actor.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Open Integrations and wait for the Odoo section; on a miss the error names the page it landed on, since the screenshot is shared and cleared by other runs. */
export async function openOdooSection(page: Page) {
  await page.goto('/administration/integrations');
  await page.getByTestId('odoo-section').waitFor({ timeout: 60_000 }).catch(async () => {
    throw new Error(`no Odoo section on ${page.url()}: ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 700)}`);
  });
}
