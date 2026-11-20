// @e2e-isolation: serial — changes the organisation's shared work-order term and restores it afterward.
/**
 * JOB-A2 — our own words (#2529). The Admin sets the organisation's term for a work order to a custom word.
 * Goal oracle: a user opening a work order sees the custom word where the page named a work order, and a typed work order
 * title is untouched.
 * Partly asserted: the project's own "Work Orders" tab and per-project terms are not asserted (terms are per organisation).
 */
import { test, expect } from '@playwright/test';
import { signIn, visibleToast } from '../helpers';
import { need, ORG_ID, PM_ID, serviceClient } from '../support/jobJourney';
import { seedWorkOrder } from '../support/crewJourney';

const db = serviceClient('JOB-A2');
const run = `E2E-A2-${Date.now()}`;
let wo = { projectId: '', workOrderId: '', title: '' };
let previous: Record<string, unknown> | null = null;

test.beforeEach(async () => {
  wo = await seedWorkOrder(db, 'JOB-A2', run, 'yard');
  const prior = await db.from('org_terminology').select('*').eq('org_id', ORG_ID).eq('term_key', 'workOrder').eq('locale', 'en').maybeSingle();
  if (prior.error) throw prior.error;
  previous = prior.data;
});
test.afterEach(async () => {
  await db.from('org_terminology').delete().eq('org_id', ORG_ID).eq('term_key', 'workOrder').eq('locale', 'en');
  if (previous) await db.from('org_terminology').insert(previous);
  await db.from('work_orders').delete().eq('id', wo.workOrderId);
  await db.from('projects').delete().eq('id', wo.projectId);
  void need; void PM_ID;
});

test('JOB-A2 a renamed work order term shows on the work order page for any user', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/terminology');
  const row = page.getByTestId('term-row-workOrder-en');
  await row.getByLabel('Singular').fill('task order');
  await row.getByLabel('Plural').fill('task orders');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(visibleToast(page, 'Terminology saved')).toBeVisible({ timeout: 15_000 });

  await signIn(page, 'pm@acme.test');
  await page.goto(`/work-orders/${wo.workOrderId}`);
  await expect(page.getByText(wo.title).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/task order/i).filter({ visible: true }).first()).toBeVisible();
});
