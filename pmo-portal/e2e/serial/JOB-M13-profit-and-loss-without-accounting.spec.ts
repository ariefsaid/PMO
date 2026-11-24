// @e2e-isolation: serial — disconnects the seed organisation's accounting binding for the run (org-wide state other specs must see unchanged) and restores it in afterAll; owns its Executive login.
// JOB-M13 (acceptance 01-management, TC-M-12): profit and loss without an accounting system. An organisation with nothing
// connected: the Executive opens Finance → Statements and reads the management profit and loss built from PMO Portal's own
// records, and nothing asks them to set accounting up.
import { test, expect } from '@playwright/test';
import { serviceClient, runId } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { disconnectSeedOrgErp, type NoErpHandle } from './noErpOrg';

test.setTimeout(120_000);

let noErp: NoErpHandle | undefined;
test.beforeAll(async () => { noErp = await disconnectSeedOrgErp(); });
test.afterAll(async () => { await noErp?.restore(); });

test('JOB-M13 the Executive reads the management profit and loss, and nothing asks to set accounting up', async ({ page }) => {
  const svc = serviceClient('JOB-M13');
  const actor = await roleJobUser(svc, 'executive', runId('JOBM13'));
  try {
    await actor.signIn(page);
    // Finance → Statements.
    await page.goto('/finance');
    await page.getByRole('link', { name: /^Statements$/ }).first().click();
    await expect(page).toHaveURL(/\/finance\/statements/);
    await expect(page.getByRole('heading', { name: /Management profit and loss/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/come from an accounting system when one is connected/i)).toBeVisible();
    // Nothing asks the Executive to set accounting up.
    await expect(page.getByRole('button', { name: /Set up accounting/i })).toHaveCount(0);
    await expect(page.getByText(/No statements yet/i)).toHaveCount(0);

    // The management profit and loss itself, from PMO Portal's own records.
    await page.getByRole('button', { name: /Open reports/i }).click();
    await expect(page).toHaveURL(/\/finance\/reports/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByTestId('management-pack-table-card')).toBeVisible({ timeout: 30_000 });
  } finally {
    await actor.cleanup();
  }
});
