// @e2e-isolation: serial - temporarily changes organisation-wide switches and restores them after the journey.
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { need, ORG_ID, serviceClient } from '../support/jobJourney';

const must = need('AC-2796');
const db = serviceClient('AC-2796');
let saved: { module_people_crews: boolean; leave_requests_enabled: boolean };

test.beforeEach(async () => {
  saved = must('read switches', await db.from('organizations').select('module_people_crews, leave_requests_enabled').eq('id', ORG_ID).single()) as typeof saved;
  must('enable leave for the journey', await db.from('organizations').update({ module_people_crews: true, leave_requests_enabled: true }).eq('id', ORG_ID).select().single());
});

test.afterEach(async () => {
  if (saved) must('restore switches', await db.from('organizations').update(saved).eq('id', ORG_ID).select().single());
});

test('AC-2796 an Admin turns off people and crews and a user no longer sees leave', async ({ page, browser }) => {
  await signIn(page, 'engineer@acme.test');
  await expect(page.getByRole('link', { name: 'Leave', exact: true })).toBeVisible();
  const adminPage = await browser.newPage({ baseURL: new URL(page.url()).origin });
  await signIn(adminPage, 'admin@acme.test');
  await adminPage.goto('/administration/modules');
  const toggle = adminPage.getByRole('switch', { name: 'People and crews' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await adminPage.close();
  const moduleRead = page.waitForResponse((response) => response.url().includes('module_people_crews') && response.ok());
  await page.goto('/leave');
  await moduleRead;
  await expect(page.getByText('Leave requests are turned off for your organisation.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request leave' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Leave', exact: true })).toHaveCount(0);
});
