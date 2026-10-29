// @e2e-isolation: self-isolated — creates and removes its own project, budget and requests.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const orgId = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const requester = '00000000-0000-0000-0000-0000000000a4';
const viteEnv = loadEnv('development', process.cwd(), 'VITE_');
const url = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_URL ?? viteEnv.VITE_SUPABASE_URL);
let admin: SupabaseClient;
let projectId = '';
let ids: string[] = [];

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('Currency position test needs the service role key');
  admin = createClient(url, key, { auth: { persistSession: false } });
  const tag = `currency position ${crypto.randomUUID()}`;
  const project = await admin.from('projects').insert({ org_id: orgId, name: tag, status: 'Ongoing Project', currency: 'USD' }).select('id').single();
  if (project.error) throw project.error;
  projectId = project.data.id;
  const version = await admin.from('budget_versions').insert({ org_id: orgId, project_id: projectId, name: tag, version: 1, status: 'Draft', currency: 'USD' }).select('id').single();
  if (version.error) throw version.error;
  const item = await admin.from('budget_line_items').insert({ org_id: orgId, budget_version_id: version.data.id, category: 'Materials', budgeted_amount: 1000 });
  if (item.error) throw item.error;
  const active = await admin.from('budget_versions').update({ status: 'Active' }).eq('id', version.data.id);
  if (active.error) throw active.error;
  for (const [currency, status, amount] of [['USD', 'Approved', 200], ['EUR', 'Approved', 300], ['USD', 'Requested', 50], ['EUR', 'Requested', 50]] as const) {
    const row = await admin.from('procurements').insert({ org_id: orgId, project_id: projectId, title: tag, requested_by_id: requester, status, currency, total_value: amount }).select('id').single();
    if (row.error) throw row.error;
    ids.push(row.data.id);
  }
});

test.afterEach(async () => {
  if (!admin) return;
  for (const id of ids) {
    const events = await admin.from('procurement_status_events').delete().eq('procurement_id', id);
    if (events.error) throw events.error;
    const procurement = await admin.from('procurements').delete().eq('id', id);
    if (procurement.error) throw procurement.error;
  }
  if (projectId) {
    const versions = await admin.from('budget_versions').delete().eq('project_id', projectId);
    if (versions.error) throw versions.error;
    const project = await admin.from('projects').delete().eq('id', projectId);
    if (project.error) throw project.error;
  }
  ids = [];
  projectId = '';
});

test('the budget position compares compatible currency and identifies foreign demand', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  const positionResponse = page.waitForResponse((response) => response.url().includes('/rpc/project_reserved_position') && response.request().method() === 'POST');
  await page.goto(`/procurement/${ids[2]}`);
  const response = await positionResponse;
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result[0].positions).toEqual(expect.arrayContaining([
    expect.objectContaining({ currency: 'USD', amount: '200.00' }),
    expect.objectContaining({ currency: 'EUR', amount: '300.00' }),
  ]));
  await expect(page.getByRole('heading', { name: 'Budget impact' })).toBeVisible();
  await expect(page.getByText(/Other currencies:.*300/)).toBeVisible();
  await expect(page.getByTestId('stat-tile').filter({ hasText: 'After this procurement' })).toContainText('750');
  await page.goto(`/procurement/${ids[3]}`);
  await expect(page.getByText(/Budget comparison unavailable for these currencies/).first()).toBeVisible();
  await expect(page.getByText(/headroom remaining/)).not.toBeVisible();
});
