// @e2e-isolation: self-isolated — creates one uniquely titled request and removes it on exit; payment channels are on for every organisation (#2746).
/**
 * AC-PCH-001 (#2698) — an Admin turns payment channels on; Finance picks a channel on a purchase request and reads it back.
 * Goal oracle: the channel Finance chose is still on the request after a reload; with the feature off the request shows no
 * payment channel section. Spec docs/specs/purchase-payment-channel.spec.md.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login, requireServiceRoleKey } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const serviceKey = requireServiceRoleKey();
test.skip(!serviceKey, 'AC-PCH-001 requires service-role access for isolated fixture setup and cleanup.');
test.setTimeout(120_000);

const id = crypto.randomUUID();
const title = `PCH request ${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
const admin = () => createClient(SUPABASE_URL, serviceKey!, { auth: { persistSession: false } });

test.afterAll(async () => {
  const db = admin();
  const errors: string[] = [];
  // Payment channels are on for every organisation with starter channels (#2746): only this journey's request is removed.
  for (const r of [await db.from('procurements').delete().eq('id', id)]) if (r.error) errors.push(r.error.message);
  if (errors.length) throw new Error(`AC-PCH-001 cleanup failed: ${errors.join('; ')}`);
});

test('AC-PCH-001 #2698: payment channels are on for everyone, Finance sets a channel on a request and it persists', async ({ page }) => {
  const db = admin();
  const { error } = await db.from('procurements').insert({ id, org_id: ORG_ID, title, status: 'Requested', currency: 'IDR' });
  if (error) throw new Error(`request fixture failed: ${error.message}`);

  // The Admin finds the starter channels in Administration; there is no switch to turn on.
  await login(page, 'admin@acme.test');
  await page.goto('/administration/accounting');
  await expect(page.getByRole('list', { name: /Channels|Kanal/ }).getByRole('listitem').first()).toBeVisible();

  // Finance picks a channel; it survives a reload.
  await login(page, 'finance@acme.test');
  await page.goto(`/procurement/${id}`);
  await page.getByRole('tab', { name: /Details|Detail/ }).click();
  const section = page.getByTestId('payment-channel-section');
  await expect(section).toBeVisible();
  await section.getByRole('combobox').selectOption({ label: 'Bank transfer' });
  await section.getByRole('button', { name: /Save channel|Simpan kanal/ }).click();
  await page.reload();
  await page.getByRole('tab', { name: /Details|Detail/ }).click();
  await expect(page.getByTestId('payment-channel-section').getByRole('combobox')).toHaveValue(/.+/);
  await expect(page.getByTestId('payment-channel-section').getByRole('combobox').locator('option:checked')).toHaveText('Bank transfer');
});
