// @e2e-isolation: serial — sets the org-wide daily cut-off (cleared in afterEach) that every material-request submit reads.
/** JOB-PU15 — after the daily cut-off a request for tomorrow is refused and the refusal names the earliest date; that date (one day
 *  further on) is accepted, so the earliest needed-by date the requester can have is a day later. */
import { expect, test } from '@playwright/test';
import { pickComboboxOption } from '../helpers';
import { mrqSetup, sendForApproval } from '../support/mrqJobFixture';
import { roleJobUser } from '../support/roleJobUser';
import { runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { SEED_PROJECT_NAME, userClient } from '../support/stockFixture';
import { inDays } from '../support/jobJourney';

test.setTimeout(150_000);

test.afterEach(async () => { await (await userClient('admin@acme.test')).rpc('mrq_set_cutoff', { p_cutoff: null }); });

test('JOB-PU15 a request for tomorrow sent after the cut-off is refused naming the next date; that date is accepted', async ({ page }) => {
  // 00:00 makes "after the cut-off" true at any time the journey runs.
  const { item, wo } = await mrqSetup([{ role: 'Project Manager', label: 'Plan check' }], '00:00');
  const requester = await roleJobUser(serviceClient('JOB-PU15'), 'site_supervisor', runId('pu15-requester'));
  try {
    await requester.signIn(page);
    await page.goto('/material-requests/new');
    await pickComboboxOption(page, page, /^project/i, new RegExp(SEED_PROJECT_NAME));
    await pickComboboxOption(page, page, /^work order/i, new RegExp(wo.wo_number));
    await page.getByLabel(/^item/i).selectOption({ label: `${item.code} · ${item.name}` });
    await page.getByLabel(/^quantity/i).fill('2');

    // The needed-by date defaults to tomorrow: the cut-off has passed, so it is refused and the earliest date is named.
    await sendForApproval(page);
    await expect(page.getByText(/closed at 00:00/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/The earliest date you can request is/i)).toBeVisible();
    await expect(page).toHaveURL(/\/material-requests\/(new|[0-9a-f-]{36}\/edit)/);

    // Tomorrow itself is still refused, spelled out.
    const neededBy = page.getByLabel(/needed by/i);
    await neededBy.fill(inDays(1));
    await neededBy.blur();
    await sendForApproval(page);
    await expect(page.getByText(/The earliest date you can request is/i)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/material-requests\/(new|[0-9a-f-]{36}\/edit)/);

    // The date the refusal named (one day further on) goes through.
    await neededBy.fill(inDays(2));
    await neededBy.blur();
    await sendForApproval(page);
    await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByText('Waiting for approval').first()).toBeVisible();
  } finally {
    // The accepted request names the requester as its creator; remove this run's request (and its steps, lines, events) before the profile goes.
    const mine = `select id from material_requests where created_by = '${requester.id}'`;
    sqlAsOwner(`delete from material_request_events where request_id in (${mine}); delete from material_request_steps where request_id in (${mine}); delete from material_request_lines where request_id in (${mine}); delete from material_requests where created_by = '${requester.id}';`);
    await requester.cleanup();
  }
});
