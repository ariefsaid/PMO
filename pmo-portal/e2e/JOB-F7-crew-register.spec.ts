// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order, crew and people through the screens; cleanup ends the roster and placements (a crew's history is kept by design).
/**
 * JOB-F7 — crew register (#2528). The field admin forms a crew (code, name), places two people in it, and rosters the crew
 * to a work order.
 * Goal oracle: the work order's crew list shows the crew with both people.
 * Partly built: positions (welder, fitter) come from standard roles per crew, not asserted here.
 */
import { test, expect } from '@playwright/test';
import { signIn, visibleToast } from './helpers';
import { need, ORG_ID, serviceClient } from './support/jobJourney';
import { endCrewRows, seedWorkOrder } from './support/crewJourney';

test.setTimeout(180_000);
const must = need('JOB-F7');
const db = serviceClient('JOB-F7');
const run = `E2E-F7-${Date.now()}`;
let wo = { projectId: '', workOrderId: '', title: '' };

test.beforeEach(async () => { wo = await seedWorkOrder(db, 'JOB-F7', run, 'yard'); });
test.afterEach(async () => {
  const crews = await db.from('crews').select('id').eq('org_id', ORG_ID).like('code', `${run.slice(-14)}%`);
  await endCrewRows(db, (crews.data ?? []).map((c) => c.id as string));
});

test('JOB-F7 a crew with two people rostered to a work order shows on the work order\'s crew list', async ({ page }) => {
  const code = run.slice(-14);
  await signIn(page, 'admin@acme.test');
  await page.goto('/crews');
  await page.getByRole('button', { name: 'New crew' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Code/).fill(code);
  await form.getByLabel(/^Name/).fill(`${run} crew`);
  await form.getByRole('button', { name: 'Create crew' }).click();
  await expect(visibleToast(page, 'Crew created')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: `Show the people in ${run} crew` }).click();
  for (const person of [`${run} Ana`, `${run} Budi`]) {
    await page.getByRole('button', { name: 'Add person' }).first().click();
    const place = page.getByRole('dialog');
    await place.getByRole('combobox', { name: /^Person/ }).click();
    await page.getByRole('combobox', { name: /^(search|cari) /i }).fill(person);
    await page.getByRole('listbox').getByRole('option', { name: new RegExp(person) }).click();
    await place.getByRole('button', { name: 'Add person' }).click();
    await expect(visibleToast(page, 'Person placed').last()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('row', { name: new RegExp(person) })).toBeVisible();
  }

  await page.goto(`/crews?view=roster&wo=${wo.workOrderId}`);
  await page.getByRole('button', { name: 'Roster a crew' }).first().click();
  await page.getByRole('dialog').getByLabel(/^Crew/).selectOption({ label: `${code} · ${run} crew` });
  await page.getByRole('dialog').getByRole('button', { name: 'Roster a crew' }).click();
  await expect(visibleToast(page, 'Crew rostered')).toBeVisible({ timeout: 15_000 });

  const card = page.getByRole('region', { name: new RegExp(`${code} · ${run} crew`) });
  await expect(card.getByText(`${run} Ana`)).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(`${run} Budi`)).toBeVisible();
  void must;
});
