// @e2e-isolation: self-isolated — two disposable logins on the seed org (Administrator and Quantity Surveyor); no shared row is written and both logins are deleted in finally.
/**
 * JOB-A1 — roles we define: a person's job role decides what they can do.
 * The Administrator sees the person's job role in the user directory. The Quantity Surveyor — the role the case
 * gives a user — signs in and gets the daily report entry, and is offered no crew-time approval: the timesheet
 * review surface refuses them and Timesheets carries no approvals affordance.
 * Goal oracle: the Quantity Surveyor sees "New report" on Site reports, and cannot open the timesheet review.
 * Screen note: the app ships the job roles and assigns one per person (Administration → Users → Change job role),
 * so the directory is the Admin's role screen; there is no separate "Roles" page.
 */
import { test, expect } from '@playwright/test';
import { runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

test('JOB-A1 an administrator assigns the Quantity Surveyor role and that role gets report entry but no crew-time approval', async ({ page }) => {
  const svc = serviceClient('JOB-A1');
  const surveyorName = runId('a1-qs');
  const admin = await roleJobUser(svc, 'administrator', runId('a1-adm'));
  const surveyor = await roleJobUser(svc, 'quantity_surveyor', surveyorName);
  try {
    // 1. Administrator opens the user directory: the person's job role is what governs their rights.
    await admin.signIn(page);
    await page.goto('/administration/users');
    await page.getByLabel('Search users').fill(surveyorName);
    const row = page.getByRole('row', { name: new RegExp(surveyorName) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText('Quantity Surveyor')).toBeVisible();

    // 2. The Quantity Surveyor signs in and sees the daily report entry.
    await surveyor.signIn(page);
    await page.goto('/site-reports');
    await expect(page.getByRole('button', { name: 'New report' }).first()).toBeVisible({ timeout: 20_000 });

    // 3. …and is not offered the crew-time approval: no Approvals affordance, and the review surface refuses them.
    await page.goto('/timesheets');
    await expect(page.getByRole('link', { name: /^Approvals/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Approvals' })).toHaveCount(0);
    await page.goto('/timesheets/review');
    await expect(page.getByText("You don't have access to timesheet review")).toBeVisible({ timeout: 20_000 });
  } finally {
    await surveyor.cleanup();
    await admin.cleanup();
  }
});
