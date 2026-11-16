// @e2e-isolation: self-isolated — creates its own uniquely named deal via service role, loses it from the phone menu, deletes it; no shared seed row is moved.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from './helpers';

test.setTimeout(180_000);

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

const svcKey = requireServiceRoleKey();
if (!svcKey) {
  throw new Error('AC-2421-1: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey (local fixture dependency) - it must not silently skip.');
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
    name: 'PD 2421 ' + RUN_ID,
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

test.use({ viewport: { width: 390, height: 844 } });

test('AC-2421-1: on a phone the deal page has one More actions menu and the stage once, and Mark lost from it moves the deal', async ({ page }) => {
  await signIn(page, 'exec@acme.test');
  await page.goto('/projects/' + PROJECT_ID);

  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(1);
  // The stage reads once as the status pill; the journey's own step list is the only other place it appears.
  await expect(page.locator('xpath=//main//*[normalize-space(text())="Negotiation" and not(ancestor::li) and not(ancestor::*[@role="listitem"])]')).toHaveCount(1);
  await expect(page.getByText('Current stage')).toHaveCount(0);

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark lost' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Reason/i).selectOption('price');
  const moved = page.waitForResponse((r) => r.url().includes('/rpc/transition_project'));
  await dialog.getByRole('button', { name: 'Mark lost' }).click();
  expect((await moved).ok()).toBe(true);
});
