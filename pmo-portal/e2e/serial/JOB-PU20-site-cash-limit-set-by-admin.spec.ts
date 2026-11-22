// @e2e-isolation: serial - sets and clears the organisation-wide site cash limit (a singleton row read by the site cash journeys); restores the row it found in finally.
/**
 * JOB-PU20 — site cash can be set up: the organisation has no site cash limit, so Finance is refused; the refusal names where an
 * Admin sets it and who; the Admin sets it on the Purchase rules card; Finance then sets up site cash for a project.
 * Orders to the person: the refusal is in the reader's language and carries no database text.
 */
import { test, expect } from '@playwright/test';
import { signIn, pickComboboxOption } from '../helpers';
import { serviceClient } from '../procurement-fixture';

test.setTimeout(150_000);

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const ADMIN_ID = '00000000-0000-0000-0000-0000000000a5';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';

test('JOB-PU20 Finance is told where the Admin sets the site cash limit, the Admin sets it, and site cash is then set up', async ({ page }) => {
  const admin = serviceClient();
  const tag = `JOB-PU20 ${Date.now()}`;
  const previous = (await admin.from('org_imprest_settings').select('procurement_limit').eq('org_id', ORG_ID).maybeSingle()).data;
  const project = (await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).data;
  if (!project) throw new Error('JOB-PU20 could not create its project');
  try {
    await admin.from('org_imprest_settings').delete().eq('org_id', ORG_ID);

    // Finance: set up site cash with no limit set. The refusal names the place and the role.
    await signIn(page, 'finance@acme.test');
    await page.goto('/imprest');
    await page.getByRole('button', { name: 'Set up site cash' }).click();
    const dialog = page.getByRole('dialog');
    await pickComboboxOption(dialog, page, /Project/, new RegExp(tag));
    await pickComboboxOption(dialog, page, /Custodian/, 'first');
    await dialog.getByLabel(/^Limit/).fill('5000000');
    await dialog.getByRole('button', { name: 'Set up site cash' }).click();
    await expect(dialog).toContainText(/Administration, Accounting, Purchase rules/, { timeout: 15_000 });
    await expect(dialog).toContainText(/An Admin sets it/);
    await expect(dialog).not.toContainText(/procurement limit/i);

    // Admin: the limit has a screen.
    await signIn(page, 'admin@acme.test');
    await page.goto('/administration/accounting');
    const card = page.getByTestId('org-imprest-limit');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(/Not set yet/);
    await card.getByLabel('Limit per spend').fill('5000000');
    await card.getByRole('button', { name: 'Save limit' }).click();
    await expect(card).toContainText(/Current limit/, { timeout: 15_000 });
    const saved = (await admin.from('org_imprest_settings').select('procurement_limit, updated_by').eq('org_id', ORG_ID).maybeSingle()).data;
    expect(Number(saved?.procurement_limit)).toBe(5_000_000);
    expect(saved?.updated_by).toBe(ADMIN_ID);

    // Finance: site cash is now set up.
    await signIn(page, 'finance@acme.test');
    await page.goto('/imprest');
    await page.getByRole('button', { name: 'Set up site cash' }).click();
    const again = page.getByRole('dialog');
    await pickComboboxOption(again, page, /Project/, new RegExp(tag));
    await pickComboboxOption(again, page, /Custodian/, 'first');
    await again.getByLabel(/^Limit/).fill('5000000');
    await again.getByRole('button', { name: 'Set up site cash' }).click();
    await expect(page).toHaveURL(/\/imprest\/[0-9a-f-]{36}/, { timeout: 20_000 });
  } finally {
    const floats = (await admin.from('imprest_floats').select('id').eq('project_id', project.id)).data ?? [];
    for (const f of floats) {
      await admin.from('imprest_float_changes').delete().eq('float_id', f.id);
      await admin.from('imprest_floats').delete().eq('id', f.id);
    }
    await admin.from('projects').delete().eq('id', project.id);
    await admin.from('org_imprest_settings').delete().eq('org_id', ORG_ID);
    if (previous) await admin.from('org_imprest_settings').insert({ org_id: ORG_ID, procurement_limit: previous.procurement_limit, updated_by: ADMIN_ID });
  }
});
