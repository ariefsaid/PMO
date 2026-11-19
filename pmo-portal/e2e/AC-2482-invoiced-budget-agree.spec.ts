// @e2e-isolation: self-isolated — creates its own uniquely named projects, invoices and one Requested purchase (on a seeded project, read-only otherwise); deletes them afterwards; mutates no shared seed row.
/**
 * AC-2482 (#2482) — goal: the same project shows the same "invoiced" figure on every screen that shows it, and the
 * same "budget used" on every screen that shows it; a figure that is unknown reads as unknown (a dash), never as zero.
 *
 * Screens that show the figures (enumerated from the shipped code, 2026-11-19):
 *   Invoiced (per project)  Contract tab · Overview money strip · Reports (Projects as at) invoiced-to-date column.
 *   Budget used             project header · Budget tab tile · project list row · procurement approval panel.
 * Not on the list, and why: the home screen's Invoiced tile is an org-wide total for a chosen period (not a project
 * figure), and the project list has no invoiced column. Neither can be compared per project.
 *
 * The invoices carry no tax so the Contract tab (contract basis), the Overview strip (including tax) and Reports
 * (excluding tax) are the same number by construction; any disagreement is an app defect, fixed in the shared read model.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pinEnglishLocale, requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
const SEEDED_BUDGET_PROJECT_CODE = 'SP-2401'; // seeded: Active budget and paid purchases, so Budget used is a known figure

test.setTimeout(120_000);

let admin: SupabaseClient;
const projectIds: string[] = [];
const procurementIds: string[] = [];

test.beforeAll(() => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-2482 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh');
  admin = createClient(requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_URL), key, { auth: { persistSession: false } });
});

test.afterEach(async () => {
  for (const id of procurementIds.splice(0)) {
    await admin.from('procurement_status_events').delete().eq('procurement_id', id);
    await admin.from('procurements').delete().eq('id', id);
  }
  for (const id of projectIds.splice(0)) {
    await admin.from('sales_invoices').delete().eq('project_id', id);
    await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', id);
  }
});

const percentOf = (text: string | null) => /(≈ )?\d+%/.exec(text ?? '')?.[0] ?? null;

async function newProject(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await admin.from('projects').insert({
    id, org_id: ORG_ID, name, status: 'Ongoing Project', currency: 'IDR', contract_value: 1_000_000,
    tax_treatment: 'exclusive', tax_amount: 0, project_manager_id: PM_ID, ...extra,
  });
  if (error) throw new Error(`AC-2482 fixture project: ${error.message}`);
  projectIds.push(id);
  return id;
}

async function addInvoice(projectId: string, amount: number, currency: string, invoiceDate: string): Promise<void> {
  const { error } = await admin.from('sales_invoices').insert({
    id: crypto.randomUUID(), org_id: ORG_ID, project_id: projectId, amount, currency, tax_treatment: 'exclusive', tax_amount: 0,
    status: 'Unpaid', invoice_date: invoiceDate,
  });
  if (error) throw new Error(`AC-2482 fixture invoice: ${error.message}`);
}

async function showReportsRevenue(page: Page) {
  await page.route('**/rest/v1/org_features*', async (route) => {
    const response = await route.fetch({ maxRetries: 2 });
    if (!response.ok()) return route.fulfill({ response });
    const rows = (await response.json()) as Array<{ feature_key?: string; enabled?: boolean }>;
    return route.fulfill({ response, json: [...rows.filter((r) => r.feature_key !== 'revenue'), { feature_key: 'revenue', enabled: true }] });
  });
}

test('AC-2482 invoiced reads the same on the Contract tab, the Overview strip and Reports', async ({ page }) => {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const name = `AC2482 invoiced ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const projectId = await newProject(name, { start_date: `${now.getUTCFullYear()}-01-01`, end_date: `${now.getUTCFullYear()}-12-31` });
  await addInvoice(projectId, 250_000, 'IDR', `${ym}-10`);
  await addInvoice(projectId, 150_000, 'IDR', `${ym}-12`);
  // 400,000 exactly, however the screen formats it (full "400,000" or a compact "400K"/"400 jt"-style tile).
  const IS_EXPECTED = /(^|[^\d.,])400([.,]000(?![\d])|\s?(K|k|rb))/;

  await pinEnglishLocale(page);
  await showReportsRevenue(page);
  await signIn(page, 'finance@acme.test');

  await page.goto(`/projects/${projectId}/contract`);
  const contractStep = page.getByRole('list', { name: 'Contract' }).getByRole('listitem').filter({ hasText: /^Invoiced/ });
  await expect(contractStep).toBeVisible({ timeout: 20_000 });
  await expect(contractStep).toHaveText(IS_EXPECTED, { timeout: 15_000 });

  await page.goto(`/projects/${projectId}`);
  const overviewInvoiced = page.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Invoiced$/ }) }).first();
  await expect(overviewInvoiced).toBeVisible({ timeout: 20_000 });
  await expect(overviewInvoiced).toHaveText(IS_EXPECTED, { timeout: 15_000 });

  await page.goto('/reports');
  await page.getByLabel('As at').fill(ym);
  const row = page.locator('tr', { hasText: name });
  await expect(row.getByTestId('pack-cell-invoicedToDate')).toHaveText(IS_EXPECTED, { timeout: 20_000 });
});

test('AC-2482 budget used reads the same on the header, the Budget tab, the project list and the approval panel', async ({ page }) => {
  const seeded = await admin.from('projects').select('id, name').eq('code', SEEDED_BUDGET_PROJECT_CODE).single();
  if (seeded.error) throw new Error(`AC-2482 seeded project: ${seeded.error.message}`);
  const projectId = seeded.data.id as string;
  const projectName = seeded.data.name as string;
  const title = `AC2482 approval ${Date.now()}`;
  const pr = await admin.from('procurements').insert({
    org_id: ORG_ID, title, project_id: projectId, requested_by_id: ENGINEER_ID, status: 'Requested', total_value: 1_000, budget_category: 'Materials',
  }).select('id').single();
  if (pr.error) throw new Error(`AC-2482 fixture purchase: ${pr.error.message}`);
  procurementIds.push(pr.data.id as string);

  await pinEnglishLocale(page);
  await signIn(page, 'finance@acme.test');

  await page.goto(`/projects/${projectId}`);
  const header = page.getByTestId('project-budget-figures');
  await expect(header).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => percentOf(await header.textContent()), { timeout: 15_000 }).not.toBeNull();
  const onHeader = percentOf(await header.textContent());

  await page.goto(`/projects/${projectId}/budget`);
  const tile = page.getByTestId('budget-used-tile');
  await expect.poll(async () => percentOf(await tile.textContent()), { timeout: 20_000 }).not.toBeNull();
  const onBudgetTab = percentOf(await tile.textContent());

  await page.goto('/projects');
  const row = page.locator('tr', { hasText: projectName });
  await expect(row.first()).toBeVisible({ timeout: 20_000 });
  const bar = row.first().getByLabel(/% of Active budget before tax/);
  await expect(bar).toBeVisible();
  const onList = /(\d+)%/.exec((await bar.getAttribute('aria-label')) ?? '')?.[0] ?? null;

  await page.goto(`/procurement/${pr.data.id}`);
  const parts = page.getByTestId('budget-impact-parts');
  await expect(parts).toBeVisible({ timeout: 20_000 });
  const onApproval = percentOf(await parts.getByText(/Budget used/).locator('xpath=ancestor::div[1]').textContent());

  expect(onHeader, 'project header').not.toBeNull();
  expect(onBudgetTab, 'Budget tab').toBe(onHeader);
  expect(onList, 'project list').toBe(onHeader);
  expect(onApproval, 'approval panel').toBe(onHeader);
});

test('AC-2482 unknown figures read as unknown, never zero, on every screen', async ({ page }) => {
  const name = `AC2482 unknown ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // No Active budget (budget used unknown) and one invoice in a different currency (invoiced unknown in the project currency).
  const projectId = await newProject(name);
  await addInvoice(projectId, 100, 'USD', new Date().toISOString().slice(0, 10));

  await pinEnglishLocale(page);
  await signIn(page, 'finance@acme.test');

  await page.goto(`/projects/${projectId}/contract`);
  const invoiced = page.getByRole('list', { name: 'Contract' }).getByRole('listitem').filter({ hasText: /^Invoiced/ });
  await expect(invoiced).toBeVisible({ timeout: 20_000 });
  await expect(invoiced).toContainText('—');
  await expect(page.getByTestId('contract-mixed-currency')).toBeVisible();

  await page.goto(`/projects/${projectId}`);
  const header = page.getByTestId('project-budget-figures');
  await expect(header).toBeVisible({ timeout: 20_000 });
  await expect(header).toContainText('—');
  await expect(header).not.toContainText(/\d+%/);

  await page.goto(`/projects/${projectId}/budget`);
  const tile = page.getByTestId('budget-used-tile');
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await expect(tile).not.toContainText(/\d+%/);

  await page.goto('/projects');
  const row = page.locator('tr', { hasText: name });
  await expect(row.first()).toBeVisible({ timeout: 20_000 });
  await expect(row.first().getByLabel(/% of Active budget before tax/)).toHaveCount(0);
});
