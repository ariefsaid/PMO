// @e2e-isolation: serial — sets the org-wide material-request approval chain and cut-off (cleared) that every material-request journey reads.
/** JOB-PU3 — a requester cannot send a request with no needed-by date; with one it is saved and the approver sees the date. */
import { test, expect } from '@playwright/test';
import { signIn, pickComboboxOption } from '../helpers';
import { inDays } from '../support/jobJourney';
import { mrqSetup, sendForApproval } from '../support/mrqJobFixture';
import { SEED_PROJECT_NAME } from '../support/stockFixture';

test.setTimeout(150_000);

test('JOB-PU3 a request without a needed-by date is refused; with one it is saved and the approver sees it', async ({ page }) => {
  const { item, wo } = await mrqSetup([{ role: 'Project Manager', label: 'Plan check' }]);
  const needed = inDays(4); // a needed-by date ahead of the organisation's today

  await signIn(page, 'engineer@acme.test');
  await page.goto('/material-requests/new');
  await pickComboboxOption(page, page, /^project/i, new RegExp(SEED_PROJECT_NAME));
  await pickComboboxOption(page, page, /^work order/i, new RegExp(wo.wo_number));
  await page.getByLabel(/^item/i).selectOption({ label: `${item.code} · ${item.name}` });
  await page.getByLabel(/^quantity/i).fill('2');

  const neededBy = page.getByLabel(/needed by/i);
  await neededBy.fill('');
  await neededBy.blur();
  await sendForApproval(page);
  await expect(page.getByText('Choose the date you need it.')).toBeVisible();
  await expect(page).toHaveURL(/\/material-requests\/new/);

  await neededBy.fill(needed);
  await neededBy.blur();
  await sendForApproval(page);
  await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  const requestUrl = new URL(page.url()).pathname;

  // The approver sees the date on the request.
  await signIn(page, 'pm@acme.test');
  await page.goto(requestUrl);
  const shown = new Date(needed).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  await expect(page.getByText(/needed by/i).first()).toContainText(shown, { timeout: 15_000 });
});
