// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order and near-miss issue; cleanup removes the issue (and its files) and the project.
/**
 * JOB-F19 — safety records (site issue log). The safety officer records a near miss on the incidents screen against a work order.
 * Goal oracle: the near miss is in the register and its record names the work order and the date.
 * Partly built: only incidents exist; permits to work, observations, stop-work and safe hours are not built, and the work
 * order page carries no list of its incidents, so "lists under the work order" is asserted on the incident's own record.
 */
import { test, expect } from '@playwright/test';
import { pickComboboxOption } from './helpers';
import { roleJobUser } from './support/roleJobUser';
import { runId } from './support/jobFixtures';
import { addIssueType, cleanSiteIssue } from './siteIssueFixture';
import { need, orgToday, ORG_ID, serviceClient } from './support/jobJourney';
import { seedWorkOrder } from './support/crewJourney';

test.setTimeout(180_000);
const db = serviceClient('JOB-F19');
const run = `E2E-F19-${Date.now()}`;
let wo = { projectId: '', workOrderId: '', title: '' };

test.beforeEach(async () => { wo = await seedWorkOrder(db, 'JOB-F19', run, 'plant'); });
test.afterEach(async () => {
  await cleanSiteIssue(`${run} near miss`);
  await db.from('work_orders').delete().eq('id', wo.workOrderId);
  await db.from('projects').delete().eq('id', wo.projectId);
  void need; void ORG_ID;
});

test('JOB-F19 a near miss recorded on a work order is in the register with the work order and its date', async ({ page }) => {
  await addIssueType(`${run} near miss`);
  const officer = await roleJobUser(db, 'safety_officer', runId('f19-so'));
  try {
  await officer.signIn(page);
  await page.goto(`/incidents?project=${wo.projectId}`);
  await page.getByRole('button', { name: /file incident/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^type/i).selectOption({ label: `${run} near miss` });
  await dialog.getByLabel(/severity/i).selectOption('Low');
  // The form pre-fills the date from the browser's clock (IncidentFormModal.todayLocalISO), which on the
  // UTC-pinned browser is the organisation's yesterday after 17:00 UTC; the filer means the organisation's
  // day, so the journey states it explicitly — the same review any filer gives the pre-filled date.
  await dialog.getByLabel(/^Date/i).fill(orgToday());
  await pickComboboxOption(dialog, page, /^Work order/, new RegExp(wo.title));
  await dialog.getByRole('button', { name: /^file incident$/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

  await page.getByRole('link', { name: new RegExp(`open ${run} near miss`, 'i') }).click();
  await expect(page.getByText(wo.title).first()).toBeVisible({ timeout: 20_000 });
  const today = orgToday(); // the screen stamps the incident with the organisation's day
  const dayMon = `${Number(today.slice(8, 10))} ${new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${today}T00:00:00Z`))}`; // the year is dropped within the current year
  await expect(page.getByText(dayMon, { exact: true }).first()).toBeVisible();
  } finally { await officer.cleanup(); }
});
