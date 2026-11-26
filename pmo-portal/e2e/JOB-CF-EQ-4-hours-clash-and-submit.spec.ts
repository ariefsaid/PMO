// @e2e-isolation: self-isolated — creates its own uniquely-coded machines, its own active project and usage entries and deletes them; reads the seeded Engineer and Project Manager only.
/**
 * JOB-CF-EQ-4 — logging hours on a machine (fix lane "equipment manager's day", items 3, 4 and 5).
 * Two people log the same machine, project and day. A machine that is marked broken is flagged in the picker and asks first.
 * The submit action sits by the hours and says what happens next and who approves.
 * Goal oracle: the second person is told, in a sentence, that someone already logged it, keeps their typed hours, and is
 * never shown the raw "already exists" message; a broken machine asks before a row is added; submit-week is below the grid.
 */
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';
import { ENGINEER_ID, need, ORG_ID, PM_ID, serviceClient } from './support/jobJourney';
import { formatDay } from '../src/lib/format';

test.setTimeout(180_000);
const must = need('JOB-CF-EQ-4');
const db = serviceClient('JOB-CF-EQ-4');
const run = Date.now().toString(36);
// The usage grid's week, its "today" column and its editable-cell lock all come from the BROWSER clock, which
// playwright.config.ts pins to UTC — so the day this journey types into is the UTC calendar day. The organisation's
// Jakarta day runs a day ahead between 17:00 and 24:00 UTC, which would put a seeded entry in a column the grid draws as
// future (and, on a UTC Sunday evening, outside the week it shows). The database accepts the UTC day either way:
// save_equipment_usage refuses only a date after the organisation's own today.
// e2e-org-day: allow — the usage grid's week and "today" column come from the BROWSER clock, which
// playwright.config.ts pins to UTC; an org-day entry could land in a column the grid draws as future.
const workDay = new Date().toISOString().slice(0, 10);
const clashCode = `000-CF4A-${run}`;
const brokenCode = `000-CF4B-${run}`;
let clashId = ''; let brokenId = ''; let projectId = ''; let projectName = '';

test.beforeEach(async () => {
  // The Project picker offers only ACTIVE_PROJECT_STATUSES (src/lib/db/projects.ts listProjectPickerOptions, i.e. the
  // on-hand ∪ internal statuses), so the fixture makes its OWN project at an on-hand status instead of guessing at a
  // seeded one: an earlier version took an unordered `limit(1)` with no status filter and picked Northgate Mills, a
  // 'Negotiation' pipeline row the picker never offers, so the run waited on an option that could not exist.
  const project = must('project', await db.from('projects').insert({
    org_id: ORG_ID, name: `Hours clash ${run}`, status: 'Ongoing Project', project_manager_id: PM_ID,
  }).select('id, name').single());
  projectId = project.id; projectName = project.name;
  clashId = must('clash asset', await db.from('equipment_assets').insert({ org_id: ORG_ID, code: clashCode, name: `Roller ${run}`, default_unit: 'hours' }).select('id').single()).id;
  brokenId = must('broken asset', await db.from('equipment_assets').insert({ org_id: ORG_ID, code: brokenCode, name: `Paver ${run}`, default_unit: 'hours' }).select('id').single()).id;
  // The Engineer already has a draft for the roller on this project today; the machine paver is marked broken today.
  must('engineer draft', await db.from('equipment_usage_entries').insert({ org_id: ORG_ID, asset_id: clashId, project_id: projectId, work_date: workDay, quantity: 4, unit: 'hours', kind: 'work', status: 'Draft', author_id: ENGINEER_ID }).select('id').single());
  must('broken status', await db.from('equipment_status_days').insert({ org_id: ORG_ID, asset_id: brokenId, status_date: workDay, status: 'broken' }).select('id').single());
});
test.afterEach(async () => {
  for (const id of [clashId, brokenId]) {
    await db.from('equipment_usage_entries').delete().eq('asset_id', id);
    await db.from('equipment_status_days').delete().eq('asset_id', id);
    await db.from('equipment_status_history').delete().eq('asset_id', id);
    await db.from('equipment_assets').delete().eq('id', id);
  }
  // The project goes last: usage entries reference it, so they are gone by now.
  if (projectId) {
    const { error } = await db.from('projects').delete().eq('id', projectId);
    if (error) throw new Error(`JOB-CF-EQ-4 project cleanup: ${error.message}`);
  }
});

async function addRow(page: import('@playwright/test').Page, assetLabel: RegExp) {
  await page.getByRole('button', { name: 'Add row' }).click();
  await page.getByRole('combobox', { name: 'Equipment', exact: true }).click();
  await page.getByRole('option', { name: assetLabel }).click();
  await page.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name: new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

test('JOB-CF-EQ-4 a second person logging the same machine-day is told someone already did, and keeps their hours', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/equipment?view=hours');
  await addRow(page, new RegExp(clashCode));
  const cell = page.getByRole('textbox', { name: new RegExp(`Roller ${run} · .* · ${formatDay(workDay)}, hours`) });
  await cell.fill('6');
  await cell.press('Tab');
  const message = page.getByText(/already logged/).first();
  await expect(message).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Your 6 hours was not saved/)).toBeVisible();
  await expect(page.getByText(/already exists/i)).toHaveCount(0);
  await expect(cell).toHaveValue('6'); // the typed entry is kept
  const stored = await db.from('equipment_usage_entries').select('author_id').eq('asset_id', clashId);
  expect(stored.data?.map((r) => r.author_id)).toEqual([ENGINEER_ID]);
});

test('JOB-CF-EQ-4 a broken machine is marked in the picker and logging against it asks for confirmation', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/equipment?view=hours');
  await page.getByRole('button', { name: 'Add row' }).click();
  await page.getByRole('combobox', { name: 'Equipment', exact: true }).click();
  const option = page.getByRole('option', { name: new RegExp(brokenCode) });
  await expect(option).toContainText('Broken');
  await option.click();
  await page.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name: new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('is marked Broken. Log hours against it anyway?');
  await dialog.getByRole('button', { name: 'Log hours anyway' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Paver ${run}`) })).toBeVisible();
});

test('JOB-CF-EQ-4 submit-week sits below the hours and says what happens next and who approves', async ({ page }) => {
  must('own draft', await db.from('equipment_usage_entries').insert({ org_id: ORG_ID, asset_id: brokenId, project_id: projectId, work_date: workDay, quantity: 2, unit: 'hours', kind: 'work', status: 'Draft', author_id: PM_ID }).select('id').single());
  await signIn(page, 'pm@acme.test');
  await page.goto('/equipment?view=hours');
  const section = page.getByRole('region', { name: 'Submit the week' });
  await expect(section).toBeVisible({ timeout: 20_000 });
  await expect(section).toContainText('Submitting sends');
  await expect(section).toContainText('Approver:');
  await waitForFonts(page);
  const gridBox = await page.getByRole('table', { name: 'Equipment usage this week' }).boundingBox();
  const sectionBox = await section.boundingBox();
  expect(sectionBox!.y).toBeGreaterThan(gridBox!.y + gridBox!.height - 1);
});
