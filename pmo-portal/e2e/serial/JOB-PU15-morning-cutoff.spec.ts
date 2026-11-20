// @e2e-isolation: serial — sets the org-wide daily cut-off (cleared in afterEach) that every material-request submit reads.
/** JOB-PU15 — after the daily cut-off a request for tomorrow is refused and the earliest date offered is the day after; a later date goes through. */
import { test, expect } from '@playwright/test';
import { signIn, pickComboboxOption } from '../helpers';
import { mrqSetup, sendForApproval } from '../support/mrqJobFixture';
import { SEED_PROJECT_NAME, userClient } from '../support/stockFixture';

test.setTimeout(150_000);

test.afterEach(async () => { await (await userClient('admin@acme.test')).rpc('mrq_set_cutoff', { p_cutoff: null }); });

test('JOB-PU15 a request for tomorrow sent after the cut-off is refused with the earliest date; a later date is accepted', async ({ page }) => {
  // 00:00 makes "after the cut-off" true at any time the journey runs.
  const { item, wo } = await mrqSetup([{ role: 'Project Manager', label: 'Plan check' }], '00:00');

  await signIn(page, 'engineer@acme.test');
  await page.goto('/material-requests/new');
  await pickComboboxOption(page, page, /^project/i, new RegExp(SEED_PROJECT_NAME));
  await pickComboboxOption(page, page, /^work order/i, new RegExp(wo.wo_number));
  await page.getByLabel(/^item/i).selectOption({ label: `${item.code} · ${item.name}` });
  await page.getByLabel(/^quantity/i).fill('2');

  // The needed-by date defaults to tomorrow: the cut-off has passed, so it is refused and the earliest date is named.
  await sendForApproval(page);
  await expect(page.getByText(/closed at 00:00/i)).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/material-requests\/(new|[0-9a-f-]{36}\/edit)/);

  const dayAfter = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const neededBy = page.getByLabel(/needed by/i);
  await neededBy.fill(dayAfter);
  await neededBy.blur();
  await sendForApproval(page);
  await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByText('Waiting for approval').first()).toBeVisible();
});
