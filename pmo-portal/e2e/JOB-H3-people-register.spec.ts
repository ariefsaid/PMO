// @e2e-isolation: self-isolated — creates its own uniquely-named person through the screen and deletes it afterwards; reads the seeded Admin only.
/**
 * JOB-H3 — people register (#2542b). HR adds a person with a job title to the register and opens the person's record.
 * Goal oracle: the register lists the person with a person code and job title, and the record opens.
 * Not built: ex-employees with active badges, candidates, and a former-staff filter, so the rehire half of the job is not asserted.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { ORG_ID, serviceClient } from './support/jobJourney';

test.setTimeout(120_000);
const db = serviceClient('JOB-H3');
const run = `E2E-H3-${Date.now()}`;

test.afterEach(async () => { await db.from('people').delete().eq('org_id', ORG_ID).like('name', `${run}%`); });

test('JOB-H3 HR adds a person with a job title and finds them in the register', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/people');
  await page.getByRole('button', { name: 'Add person' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Name/).fill(`${run} Dewi`);
  await form.getByLabel(/^Job title/).fill('Welder');
  await form.getByRole('button', { name: 'Save person' }).click();
  await expect(form).toHaveCount(0, { timeout: 15_000 });

  const row = page.getByRole('row', { name: new RegExp(`${run} Dewi`) });
  await expect(row.locator('.record-id')).toHaveText(/^P-\d{4,}$/);
  await expect(row.getByText('Welder')).toBeVisible();
  await row.getByRole('link', { name: `${run} Dewi` }).click();
  await expect(page).toHaveURL(/\/equipment\/people\//);
});
