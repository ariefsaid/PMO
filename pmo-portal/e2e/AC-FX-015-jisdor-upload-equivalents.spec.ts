// @e2e-isolation: self-isolated — owns a synthetic org and its FX history/documents.
import { test, expect, type Locator } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { loadEnv } from 'vite';
import { requireServiceRoleKey } from './helpers';
import { createFxFixture, removeFxFixture } from './fx-rates.fixtures';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

let admin: ReturnType<typeof createClient> | undefined;
let fixture: Awaited<ReturnType<typeof createFxFixture>> | undefined;

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key)
    throw new Error(
      'AC-FX-015 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it',
    );
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  try {
    fixture = await createFxFixture(admin);
  } catch (error) {
    if (fixture) await removeFxFixture(admin, fixture);
    throw error;
  }
});

test.afterEach(async () => {
  if (!admin || !fixture) return;
  const owned = fixture;
  fixture = undefined;
  await removeFxFixture(admin, owned);
  const checks = await Promise.all([
    admin.from('organizations').select('id', { count: 'exact', head: true }).eq('id', owned.orgId),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('id', owned.financeId),
    admin.from('companies').select('id', { count: 'exact', head: true }).eq('id', owned.companyId),
    admin.from('projects').select('id', { count: 'exact', head: true }).eq('id', owned.projectId),
    admin
      .from('sales_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('id', owned.invoiceId),
    admin.from('fx_rates').select('id', { count: 'exact', head: true }).eq('org_id', owned.orgId),
  ]);
  for (const check of checks)
    if (check.error) throw new Error(`AC-FX-015 cleanup verification: ${check.error.message}`);
  for (const check of checks) expect(check.count).toBe(0);
});

// Multi-page journey (upload, repeat import, project, invoice): the default 30 s test budget is too tight on CI.
test.setTimeout(60_000);

test('AC-FX-015 Finance uploads isolated JISDOR rates, sees equivalents, and can safely repeat the import', async ({
  page,
}) => {
  if (!admin || !fixture) throw new Error('AC-FX-015 fixture setup did not complete');
  const owned = fixture;
  expect(owned.orgId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(owned.projectId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(owned.invoiceId).toMatch(/^[0-9a-f-]{36}$/i);
  const initial = await admin
    .from('fx_rates')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', owned.orgId);
  if (initial.error)
    throw new Error(`AC-FX-015 fixture rate count failed: ${initial.error.message}`);
  expect(initial.count).toBe(0);

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(owned.email);
  await page.getByLabel(/password/i).fill(owned.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/administration/exchange-rates');
  await expect(page.getByTestId('administration-panel-exchange-rates')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Exchange rates', level: 1 })).toBeVisible();

  const csv = Buffer.from('date,rate\n2026-10-09,16234.56\n2026-10-12,16300');
  const uploadFile = async (name: string) => {
    await page.getByRole('button', { name: 'Upload rates' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Upload rates' });
    await dialog
      .getByLabel('Choose BI Excel or date,rate CSV')
      .setInputFiles({ name, mimeType: 'text/csv', buffer: csv });
    return dialog;
  };
  const confirmSave = async (dialog: Locator) => {
    await dialog.getByRole('button', { name: 'Continue' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Save these JISDOR rates?' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Save rates' }).click();
    await expect(confirmation).toBeHidden();
  };

  let dialog = await uploadFile('jisdor-first.csv');
  await expect(dialog.getByText('2 new', { exact: true })).toBeVisible();
  await expect(dialog.getByText('16,234.56')).toBeVisible();
  await expect(dialog.getByText('16,300')).toBeVisible();
  const previewCount = await admin
    .from('fx_rates')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', owned.orgId);
  if (previewCount.error)
    throw new Error(`AC-FX-015 preview rate count failed: ${previewCount.error.message}`);
  expect(previewCount.count).toBe(0);
  await confirmSave(dialog);

  await page.reload();
  await expect(page.getByRole('table')).toContainText('16,234.56');
  await expect(page.getByRole('table')).toContainText('16,300');
  const persisted = await admin
    .from('fx_rates')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', owned.orgId);
  if (persisted.error)
    throw new Error(`AC-FX-015 persisted rate count failed: ${persisted.error.message}`);
  expect(persisted.count).toBe(2);

  dialog = await uploadFile('jisdor-repeat.csv');
  await expect(dialog.getByText('2 unchanged', { exact: true })).toBeVisible();
  await confirmSave(dialog);
  const repeated = await admin
    .from('fx_rates')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', owned.orgId);
  if (repeated.error)
    throw new Error(`AC-FX-015 repeated rate count failed: ${repeated.error.message}`);
  expect(repeated.count).toBe(2);

  // The Budget tab shows the rupiah equivalent only because this organisation's default currency is IDR.
  const budget = await (admin as unknown as SupabaseClient<Database>)
    .from('budget_versions')
    .insert({ org_id: owned.orgId, project_id: owned.projectId, name: 'FX Budget', version: 1, status: 'Draft', currency: 'USD' })
    .select('id')
    .single();
  if (budget.error) throw new Error(`AC-FX-015 budget fixture: ${budget.error.message}`);
  const budgetId = (budget.data as { id: string } | null)?.id;
  if (!budgetId) throw new Error('AC-FX-015 budget fixture: no id returned');
  try {
    const line = await (admin as unknown as SupabaseClient<Database>)
      .from('budget_line_items')
      .insert({ org_id: owned.orgId, budget_version_id: budgetId, category: 'Labor', description: 'FX labor', budgeted_amount: 1000 });
    if (line.error) throw new Error(`AC-FX-015 budget line fixture: ${line.error.message}`);
    const active = await (admin as unknown as SupabaseClient<Database>).from('budget_versions').update({ status: 'Active' }).eq('id', budgetId);
    if (active.error) throw new Error(`AC-FX-015 budget activate fixture: ${active.error.message}`);
    await page.goto(`/projects/${owned.projectId}/budget`);
    const budgetEquivalent = page.getByText('≈ IDR 16,300,000 (using IDR 16,300 rate)', { exact: true }).first();
    await expect(budgetEquivalent).toBeVisible();
    // The card's caption is one element: what a person reads is exactly what a screen reader reads.
    await expect(budgetEquivalent).toHaveText('≈ IDR 16,300,000 (using IDR 16,300 rate)');
  } finally {
    await admin.from('budget_line_items').delete().eq('budget_version_id', budgetId);
    await admin.from('budget_versions').delete().eq('id', budgetId);
  }

  await page.goto(`/projects/${owned.projectId}/overview`);
  await expect(page.getByRole('heading', { name: /FX Project/ })).toBeVisible();
  const moneyPosition = page.getByRole('region', { name: 'Money position' });
  await expect(moneyPosition.getByTestId('contract-value-amount')).toContainText('100');
  await expect(page.getByText('≈ IDR 1,623,456 (using IDR 16,234.56 rate)', { exact: true }).first()).toBeVisible();

  await page.goto(`/sales-invoices/${owned.invoiceId}`);
  await expect(page.getByText(/FX Client/).first()).toBeVisible();
  await expect(page.getByText(/\$100\b/).first()).toBeVisible();
  await expect(page.getByText(/\$25\b/).first()).toBeVisible();
  await expect(
    page.getByText('≈ IDR 1,630,000 (using IDR 16,300 rate)', { exact: true }).first(),
  ).toBeVisible();
  // The visible line is exactly what a person reads; the screen-reader text adds the rate's source date.
  const outstanding = page.getByText('≈ IDR 407,500 (using IDR 16,300 rate)', { exact: true });
  await expect(outstanding).toBeVisible();
  await expect(outstanding.locator('..')).toHaveText(
    /^≈ IDR 407,500 \(using IDR 16,300 rate\) \(JISDOR rate of .+2026\)$/,
  );
});
