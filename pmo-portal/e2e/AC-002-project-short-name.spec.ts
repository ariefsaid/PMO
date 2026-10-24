// @e2e-isolation: self-isolated — creates a uniquely named Lead project and deletes only its exact contractual-name prefix in the seed org.
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { login, pickComboboxOption, requireServiceRoleKey } from './helpers';

const SEED_ORG = '00000000-0000-0000-0000-000000000001';
const NAME_PREFIX = 'E2E short-name ';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';

function localAdminClient() {
  const hostname = new URL(SUPABASE_URL).hostname;
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error('AC-002 cleanup requires the local Supabase stack');
  }
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-002 requires the local Supabase service role key; use scripts/e2e-local.sh');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

async function cleanup(name?: string) {
  if (!name) return;
  const { error } = await localAdminClient()
    .from('projects')
    .delete()
    .eq('org_id', SEED_ORG)
    .eq('name', name);
  if (error) throw new Error(`AC-002 cleanup failed: ${error.message}`);
}

test.setTimeout(120_000);

test('AC-002 #1325: create, find, edit, reload and clear a project alias without changing its contractual name', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const contractualName = `${NAME_PREFIX}Contract ${runId}`;
  const initialAlias = `North Terminal ${runId}`;
  const editedAlias = `West Terminal ${runId}`;
  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    await login(page, 'pm@acme.test');
    await page.goto('/projects');
    await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /new project/i }).first().click();
    await page.getByLabel(/project name/i).fill(contractualName);
    await page.getByLabel(/short name/i).fill(initialAlias);
    await pickComboboxOption(page, page, /client company/i, 'first');
    await page.getByRole('button', { name: /^Create project$/i }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/u, { timeout: 20_000 });

    // The canonical record and current breadcrumb lead with the alias but retain the legal title.
    await expect(page.getByRole('heading', { name: initialAlias })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: initialAlias }).locator('[title]')).toHaveAttribute('title', contractualName);
    await expect(page.getByLabel('Breadcrumb').locator('[aria-current="page"]')).toHaveAttribute('title', contractualName);

    // The pipeline uses the alias for display and accepts either identity in its bounded list filter.
    await page.goto('/sales?status=Leads');
    const pipelineSearch = page.getByRole('searchbox', { name: /search projects/i });
    await pipelineSearch.fill(contractualName);
    await expect(page.getByText(initialAlias).first()).toBeVisible();
    await pipelineSearch.fill(initialAlias);
    await expect(page.getByText(initialAlias).first()).toBeVisible();

    // The global palette also finds the cached project by its alias and discloses its legal name.
    await page.keyboard.press('Control+k');
    const commandSearch = page.getByRole('combobox');
    await commandSearch.fill(initialAlias);
    const paletteResult = page.getByRole('option', { name: new RegExp(initialAlias) });
    await expect(paletteResult).toBeVisible();
    await expect(paletteResult).toContainText(contractualName);
    await page.keyboard.press('Escape');

    // Open the record from its short-first pipeline card, then edit and reload.
    await page.goto('/sales?status=Leads');
    const openDeal = page.getByRole('button', { name: new RegExp(initialAlias) });
    await openDeal.click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/u);
    await page.getByRole('button', { name: /^Edit$/i }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog.getByLabel(/project name/i)).toHaveValue(contractualName);
    await expect(editDialog.getByLabel(/short name/i)).toHaveValue(initialAlias);
    await editDialog.getByLabel(/short name/i).fill(editedAlias);
    await editDialog.getByRole('button', { name: /save project/i }).click();
    await expect(page.getByRole('heading', { name: editedAlias }).locator('[title]')).toHaveAttribute('title', contractualName);
    await page.reload();
    await expect(page.getByRole('heading', { name: editedAlias }).locator('[title]')).toHaveAttribute('title', contractualName);

    // Explicitly clearing the alias restores the contractual fallback; it does not clear the project.
    await page.getByRole('button', { name: /^Edit$/i }).click();
    const clearDialog = page.getByRole('dialog');
    await clearDialog.getByLabel(/short name/i).fill('');
    await clearDialog.getByRole('button', { name: /save project/i }).click();
    await expect(page.getByRole('heading', { name: contractualName })).toBeVisible();
    await expect(page.getByRole('heading', { name: contractualName }).locator('[title]')).toHaveAttribute('title', contractualName);
  } finally {
    await cleanup(contractualName);
  }
});
