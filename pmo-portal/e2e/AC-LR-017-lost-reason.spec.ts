// @e2e-isolation: self-isolated — creates its own uniquely named deal via service role, loses it, deletes it; no shared seed row is moved.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from './helpers';

test.setTimeout(180_000);

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

const svcKey = requireServiceRoleKey();
if (!svcKey) {
  throw new Error('AC-LR-017: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey (local fixture dependency) - it must not silently skip.');
}
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

let PROJECT_ID: string;
let RUN_ID: string;

test.beforeEach(async () => {
  RUN_ID = crypto.randomUUID().slice(0, 8);
  PROJECT_ID = crypto.randomUUID();
  const { error } = await admin.from('projects').insert({
    id: PROJECT_ID,
    org_id: ORG_ID,
    name: 'LR 1577 ' + RUN_ID,
    status: 'Negotiation',
    currency: 'USD',
    contract_value: 0,
    tax_treatment: 'exclusive',
    tax_amount: 0,
  });
  if (error) throw new Error(`AC-LR-017 seed deal failed: ${error.message}`);
});

test.afterEach(async () => {
  await admin.from('record_changes').delete().eq('entity_id', PROJECT_ID);
  await admin.from('projects').delete().eq('id', PROJECT_ID);
});

test('AC-LR-017 / AC-LR-018 Executive marks deal lost with reason: picker required, deal page shows Price, dashboard reflects count, dialog passes axe', async ({ page }) => {
  await signIn(page, 'exec@acme.test');
  await page.goto('/projects/' + PROJECT_ID);

  // Click the deal page's "Mark lost" button
  await page.getByRole('button', { name: 'Mark lost' }).click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();

  // Confirm button inside dialog is disabled until reason is selected
  const confirmBtn = dialog.getByRole('button', { name: 'Mark lost' });
  await expect(confirmBtn).toBeDisabled();

  // AC-LR-018: axe on confirm dialog
  const axeResults = await new AxeBuilder({ page })
    .include('[role="alertdialog"]')
    .analyze();
  expect(axeResults.violations).toEqual([]);

  // Select "Price" (value 'price')
  await dialog.getByLabel(/Reason/i).selectOption('price');
  await expect(confirmBtn).toBeEnabled();

  const moved = page.waitForResponse((r) => r.url().includes('/rpc/transition_project'));
  await confirmBtn.click();
  expect((await moved).ok()).toBe(true);

  // Reload deal page and assert "Lost reason" tile reads "Price"
  await page.reload();
  await expect(page.getByText('Lost reason')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Price')).toBeVisible();

  // Go to Company dashboard and assert loss breakdown lists Price with >= 1 lost
  await page.goto('/');
  const priceRow = page.getByTestId('loss-reason-price');
  await expect(priceRow).toBeVisible({ timeout: 20_000 });
  await expect(priceRow).toContainText(/\d+ lost/);
});
