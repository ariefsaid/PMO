// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order, crew, people and a disposable Construction Manager login; cleanup ends the roster and placements (a crew's history is kept by design).
/**
 * JOB-F7 — crew register (#2528). The construction manager forms a crew (code, name), places two people in it, and rosters the
 * crew to a work order.
 * Goal oracle: the work order's crew list shows the crew with both people.
 * Partly built: positions (welder, fitter) come from standard roles per crew, not asserted here.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { visibleToast } from './helpers';
import { need, ORG_ID, serviceClient } from './support/jobJourney';
import { endCrewRows, seedWorkOrder } from './support/crewJourney';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);
const must = need('JOB-F7');
let db: SupabaseClient;
// Built per test so a `--list` run needs no environment.
const run = `E2E-F7-${Date.now()}`;
let wo = { projectId: '', workOrderId: '', title: '' };
let cm: Awaited<ReturnType<typeof roleJobUser>> | undefined;

test.beforeEach(async () => {
  db = serviceClient('JOB-F7');
  wo = await seedWorkOrder(db, 'JOB-F7', run, 'yard');
  cm = await roleJobUser(db, 'construction_manager', `f7-cm-${Date.now()}`);
  // The register holds people before a crew is formed (the case's precondition).
  for (const name of [`${run} Ana`, `${run} Budi`]) {
    must('person', await db.from('people').insert({ org_id: ORG_ID, kind: 'own', name }).select('id').single());
  }
});
test.afterEach(async () => {
  const crews = await db.from('crews').select('id').eq('org_id', ORG_ID).like('code', `${run.slice(-14)}%`);
  const crewIds = (crews.data ?? []).map((c) => c.id as string);
  await endCrewRows(db, crewIds);
  await cm?.cleanup();
  cm = undefined;
});

test('JOB-F7 a crew with two people rostered to a work order shows on the work order\'s crew list', async ({ page }) => {
  const code = run.slice(-14);
  if (!cm) throw new Error('JOB-F7: construction manager login missing');
  await cm.signIn(page);
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
