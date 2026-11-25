// @e2e-isolation: self-isolated — creates its own disposable HR officer login and uniquely-named people per run, and deletes every row it owns in finally.
/**
 * JOB-H3 — the people register keeps former staff on record (#2542b, #2703).
 * The HR officer adds a person with a job title; the register lists them with a person code and job title and the
 * record opens. A person who has left (as an Admin marks them left) is out of the default Active view but the HR
 * officer finds them under the Former staff view.
 * Goal oracle: the new person shows in the register with a P-code and job title; the former person shows when the
 * staff-status view is Former staff.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, ok, need, runId, serviceClient } from './support/jobFixtures';
import { orgToday } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

test('JOB-H3 HR officer adds a person and finds a former employee under the Former staff view', async ({ page }) => {
  const svc = serviceClient('JOB-H3');
  const run = runId('h3');
  const hrOfficer = await roleJobUser(svc, 'hr_officer', runId('h3-hro'));
  try {
    // Precondition, exactly as an Admin's "Mark as left" writes it: archived_at is the day the person left.
    need('former person', await svc.from('people').insert({
      org_id: ORG_ID, code: `${run}-OLD`, name: `${run} Former Welder`, job_title: 'Welder',
      archived_at: `${orgToday()}T00:00:00Z`,
    }).select('id').single());

    // 1. HR officer opens the register and adds a person with a job title.
    await hrOfficer.signIn(page);
    await page.goto('/administration/people');
    await page.getByRole('button', { name: 'Add person' }).first().click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/^Name/).fill(`${run} Dewi`);
    await form.getByLabel(/^Job title/).fill('Welder');
    await form.getByRole('button', { name: 'Save person' }).click();
    await expect(form).toHaveCount(0, { timeout: 15_000 });

    // 2. The register lists the person with a person code and job title; the record opens.
    const row = page.getByRole('row', { name: new RegExp(`${run} Dewi`) });
    await expect(row.locator('.record-id')).toHaveText(/^P-\d{4,}$/);
    await expect(row.getByText('Welder')).toBeVisible();
    await row.getByRole('link', { name: `${run} Dewi` }).click();
    await expect(page).toHaveURL(/\/equipment\/people\//);

    // 3. Former staff: the person who has left is out of the Active view and shows under Former staff.
    await page.goto('/administration/people');
    await expect(page.getByRole('row', { name: new RegExp(`${run} Former Welder`) })).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Former staff' }).click();
    const former = page.getByRole('row', { name: new RegExp(`${run} Former Welder`) });
    await expect(former).toBeVisible({ timeout: 15_000 });
    await expect(former.getByText('Former staff')).toBeVisible();
  } finally {
    ok('people cleanup', await svc.from('people').delete().eq('org_id', ORG_ID).like('name', `${run}%`));
    await hrOfficer.cleanup();
  }
});
