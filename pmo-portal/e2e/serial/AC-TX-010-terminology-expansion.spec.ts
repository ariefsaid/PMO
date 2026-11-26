// @e2e-isolation: serial — changes the organisation's shared terminology and role names and restores them afterward.
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { login, requireServiceRoleKey } from '../helpers';

const org = '00000000-0000-0000-0000-000000000001';
const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

test('AC-TX-010: an Admin renames a new term and a role; both persist and reset to the defaults', async ({ page }) => {
  test.setTimeout(120_000);
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local stack required');
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('Local service role key required');
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  async function cleanup() {
    const a = await db.from('org_terminology').delete().eq('org_id', org).eq('term_key', 'deliveryNote');
    if (a.error) throw a.error;
    const b = await db.from('org_role_names').delete().eq('org_id', org).eq('role_key', 'storekeeper');
    if (b.error) throw b.error;
  }
  try {
    await login(page, 'admin@acme.test');
    await page.goto('/administration/terminology');

    const term = page.getByTestId('term-row-deliveryNote-en');
    await term.getByLabel('Singular').fill('waybill');
    await term.getByLabel('Plural').fill('waybills');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Terminology saved').first()).toBeVisible();

    // Role names are one switch away from the terms (the page opens on Terms).
    await page.getByRole('button', { name: 'Role names' }).click();
    const role = page.getByTestId('role-name-row-storekeeper-en');
    await role.getByLabel('Name').fill('Yard Lead');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Role name saved').first()).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('term-row-deliveryNote-en').getByLabel('Singular')).toHaveValue('waybill');
    await page.getByRole('button', { name: 'Role names' }).click();
    await expect(page.getByTestId('role-name-row-storekeeper-en').getByLabel('Name')).toHaveValue('Yard Lead');

    await page.getByTestId('role-name-card-storekeeper').getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByText('Back to the default name').first()).toBeVisible();
    await expect(page.getByTestId('role-name-row-storekeeper-en').getByLabel('Name')).toHaveValue('');
  } finally {
    await cleanup();
  }
});
