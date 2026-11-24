// @e2e-isolation: serial — changes the organisation's shared work-order term for the run and restores it in afterEach.
/**
 * JOB-A2 — our own words (#2529). The Admin sets the organisation's term for a work order to "SPK".
 * Goal oracle: a user opening the project's work orders tab sees the tab and its panel labelled "SPK", the work order page
 * says "SPK" where it named a work order, and a typed work order title is untouched.
 */
import { test, expect } from '@playwright/test';
import { visibleToast } from '../helpers';
import { ORG_ID, ok, runId, serviceClient } from '../support/jobFixtures';
import { seedWorkOrder } from '../support/crewJourney';
import { roleJobUser } from '../support/roleJobUser';

test.setTimeout(180_000);
const db = serviceClient('JOB-A2');
const run = runId('a2');
let wo = { projectId: '', workOrderId: '', title: '' };
let previous: Record<string, unknown> | null = null;
let admin: Awaited<ReturnType<typeof roleJobUser>> | null = null;
let engineer: Awaited<ReturnType<typeof roleJobUser>> | null = null;

test.beforeEach(async () => {
  wo = await seedWorkOrder(db, 'JOB-A2', run, 'yard');
  const prior = await db.from('org_terminology').select('*').eq('org_id', ORG_ID).eq('term_key', 'workOrder').eq('locale', 'en').maybeSingle();
  if (prior.error) throw prior.error;
  previous = prior.data;
});
test.afterEach(async () => {
  await db.from('org_terminology').delete().eq('org_id', ORG_ID).eq('term_key', 'workOrder').eq('locale', 'en');
  if (previous) await db.from('org_terminology').insert(previous);
  ok('work order cleanup', await db.from('work_orders').delete().eq('id', wo.workOrderId));
  ok('project cleanup', await db.from('projects').delete().eq('id', wo.projectId));
  await engineer?.cleanup();
  await admin?.cleanup();
});

test('JOB-A2 a renamed work order term shows on the project tab and the work order page for any user', async ({ page }) => {
  admin = await roleJobUser(db, 'administrator', runId('a2-adm'));
  engineer = await roleJobUser(db, 'engineer', runId('a2-eng'));

  // 1. The Administrator renames the organisation's work-order term to SPK.
  await admin.signIn(page);
  await page.goto('/administration/terminology');
  const row = page.getByTestId('term-row-workOrder-en');
  await row.getByLabel('Singular').fill('SPK');
  await row.getByLabel('Plural').fill('SPK');
  await page.getByTestId('term-card-workOrder').getByRole('button', { name: 'Save' }).click();
  await expect(visibleToast(page, 'Terminology saved')).toBeVisible({ timeout: 15_000 });

  // 2. Any user opens the project: its work orders tab reads SPK, and so does the panel it opens.
  await engineer.signIn(page);
  await page.goto(`/projects/${wo.projectId}/contract`);
  const tab = page.getByRole('tab', { name: /^SPK$/ }).first();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await expect(page.getByRole('tabpanel', { name: /^SPK$/ })).toBeVisible();

  // 3. The work order's own page says SPK where it named a work order; the typed title is untouched.
  await page.goto(`/work-orders/${wo.workOrderId}`);
  await expect(page.getByText(wo.title).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/SPK/).filter({ visible: true }).first()).toBeVisible();
});
