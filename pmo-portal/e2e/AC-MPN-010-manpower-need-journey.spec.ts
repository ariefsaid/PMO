// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order, position, checklist item and people; cleanup archives the position and item and removes the links and needs it made.
/**
 * AC-MPN-010 — a manager records a need for two people, links two people, one becomes cleared on the checklist (the checklist
 * decides, the need only reads it), and the need shows filled 1, in progress 1, open 0; once both are cleared it can be marked met.
 * Goal oracle: the figures on the need card are the ones the checklist implies, and the need ends as Met.
 */
import { test, expect } from '@playwright/test';
import { signIn, visibleToast } from './helpers';
import { iso, need, ORG_ID, serviceClient } from './support/jobJourney';
import { seedWorkOrder } from './support/crewJourney';

test.setTimeout(180_000);
const must = need('AC-MPN-010');
const db = serviceClient('AC-MPN-010');
const run = `E2E-MPN-${Date.now()}`;
let projectId = ''; let positionId = ''; let itemId = ''; let workerA = ''; let workerB = '';
const nameA = `${run} Dewi`; const nameB = `${run} Eka`;

test.beforeEach(async () => {
  ({ projectId } = await seedWorkOrder(db, 'AC-MPN-010', run, 'A'));
  positionId = must('position', await db.from('cost_disciplines').insert({ org_id: ORG_ID, code: run.slice(-18), name: `${run} Welder` }).select('id').single()).id;
  itemId = must('item', await db.from('clearance_items').insert({ org_id: ORG_ID, name: `${run} induction`, is_required: true }).select('id').single()).id;
  workerA = must('worker A', await db.from('people').insert({ org_id: ORG_ID, kind: 'own', name: nameA }).select('id').single()).id;
  workerB = must('worker B', await db.from('people').insert({ org_id: ORG_ID, kind: 'own', name: nameB }).select('id').single()).id;
});
test.afterEach(async () => {
  await db.from('manpower_needs').update({ status: 'cancelled' }).eq('discipline_id', positionId);
  await db.from('person_clearances').delete().eq('item_id', itemId);
  await db.from('clearance_items').update({ archived_at: new Date().toISOString() }).eq('id', itemId);
  await db.from('cost_disciplines').update({ archived_at: new Date().toISOString() }).eq('id', positionId);
});

test('AC-MPN-010 a need shows filled, in progress and open from the checklist and ends as met', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/crews?view=manpower');
  await page.getByRole('button', { name: 'Record a need' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByRole('combobox', { name: /Project/ }).selectOption(projectId);
  await form.getByRole('combobox', { name: /Position/ }).selectOption({ label: `${run} Welder` });
  await form.getByLabel(/Headcount/).fill('2');
  await form.getByRole('button', { name: 'Record need' }).click();
  await expect(visibleToast(page, 'Need recorded')).toBeVisible({ timeout: 15_000 });

  // The need is a row; it opens in the side drawer (kept in the address, so a reload reopens it).
  await page.getByRole('row', { name: new RegExp(`${run} Welder`) }).getByRole('button', { name: /Open the need/ }).click();
  const drawer = page.getByRole('dialog');
  const card = drawer.locator('[data-testid^="manpower-need-"]');
  for (const name of [nameA, nameB]) {
    await card.getByRole('combobox', { name: /Link a person/ }).click();
    await page.getByRole('listbox').getByRole('option', { name: new RegExp(name) }).click();
    await expect(visibleToast(page, 'Person linked')).toBeVisible({ timeout: 15_000 });
  }
  const figure = (label: string) => card.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd');
  await expect(figure('In progress')).toHaveText('2');

  must('clear A', await db.from('person_clearances').insert({ org_id: ORG_ID, person_id: workerA, item_id: itemId, done_on: iso(new Date()) }).select('id').single());
  await page.reload();
  await expect(figure('Filled')).toHaveText('1', { timeout: 20_000 });
  await expect(figure('In progress')).toHaveText('1');
  await expect(figure('To fill')).toHaveText('0');
  await expect(drawer.getByRole('button', { name: 'Mark as met' })).toBeDisabled();

  must('clear B', await db.from('person_clearances').insert({ org_id: ORG_ID, person_id: workerB, item_id: itemId, done_on: iso(new Date()) }).select('id').single());
  await page.reload();
  await drawer.getByRole('button', { name: 'Mark as met' }).click();
  await expect(visibleToast(page, 'Marked as met')).toBeVisible({ timeout: 15_000 });
  await expect(drawer.getByText('Met', { exact: true })).toBeVisible();
});
