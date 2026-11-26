// @e2e-isolation: self-isolated — own project, work order, crew and person; the roster and placements are ended and the fixture removed where history allows.
// JOB-PC9 (project control manager, steps 7 and 14): resources allocated per work order. The project control manager rosters a crew on a work order for a date range and logs crane hours on it
// (equipment use screen, a project manager approves the week); the work order page then lists both.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn, pickComboboxOption } from './helpers';
import { roleJobUser } from './support/roleJobUser';
import { need, ok, ORG_ID, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120_000);
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
const pad = (n: number) => String(n).padStart(2, '0');
const workDay = new Date(); workDay.setDate(workDay.getDate() - 7);
const weekdayIndex = (workDay.getDay() + 6) % 7;
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let admin: SupabaseClient;
let crewId = ''; let assetId = '';
let planner: Awaited<ReturnType<typeof roleJobUser>>;
test.afterEach(async () => {
  if (!admin) return;
  if (assetId) {
    await admin.from('equipment_usage_entries').delete().eq('asset_id', assetId);
    await admin.from('equipment_assets').delete().eq('id', assetId);
    assetId = '';
  }
  if (!crewId) { await planner?.cleanup(); return; }
  const today = iso(new Date());
  await admin.from('work_order_crews').update({ valid_to: today }).eq('crew_id', crewId);
  await admin.from('crew_members').update({ valid_to: today }).eq('crew_id', crewId);
  crewId = '';
  await planner?.cleanup();
});

test('JOB-PC9 a project control manager rosters a crew and logs crane hours on a work order, and the work order page lists both', async ({ page }) => {
  admin = serviceClient('JOB-PC9');
  const run = runId('JOBPC9');
  planner = await roleJobUser(admin, 'project_control_manager', `${run}-pcm`);
  const fx = await projectWithWorkOrders(admin, run, ['Pipe rack']);
  const wo = fx.workOrders[0];
  const from = new Date(); const to = new Date(); to.setDate(to.getDate() + 5);
  crewId = need('crew', await admin.from('crews').insert({ org_id: ORG_ID, code: run.slice(-18), name: `${run} crew`, kind: 'own', field_controller_id: ENGINEER_ID }).select('id').single()).id;
  const person = need('person', await admin.from('people').insert({ org_id: ORG_ID, kind: 'own', name: `${run} Ana` }).select('id').single()).id;
  ok('placement', await admin.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: person, valid_from: iso(from) }));

  assetId = need('asset', await admin.from('equipment_assets').insert({ org_id: ORG_ID, code: run, name: `${run} crane`, default_unit: 'hours' }).select('id').single()).id;

  await planner.signIn(page);
  await page.goto(`/crews?view=roster&wo=${wo.id}`);
  await page.getByRole('button', { name: 'Roster a crew' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^crew/i).selectOption(crewId);
  await dialog.getByLabel(/^from/i).fill(iso(from));
  await dialog.getByLabel(/^to/i).fill(iso(to));
  await dialog.getByRole('button', { name: 'Roster a crew' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });

  // The work order lists the crew, for the dates given.
  const placements = page.getByRole('row').filter({ hasText: `${run} crew` });
  await expect(placements).toBeVisible({ timeout: 15_000 });
  const rosterRows = need('roster', await admin.from('work_order_crews').select('valid_from, valid_to').eq('work_order_id', wo.id));
  expect(rosterRows).toEqual([{ valid_from: iso(from), valid_to: iso(to) }]);

  // The project control manager logs 8 crane hours on the work order (equipment use grid); a project manager approves the week.
  await page.goto(`/equipment?week=${iso(workDay)}`);
  await page.getByRole('button', { name: 'Add row' }).click();
  await pickComboboxOption(page, page, /^Equipment/, new RegExp(run));
  await pickComboboxOption(page, page, /^Project/, new RegExp(`${run} project$`));
  await pickComboboxOption(page, page, /^Work order/, new RegExp(wo.title));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const row = page.getByRole('row', { name: new RegExp(`${run}.*${run} project`) }).first();
  const cell = row.getByRole('textbox').nth(weekdayIndex);
  await cell.fill('8');
  await cell.press('Enter');
  await expect(row.getByText('Draft')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Submit week' }).click();
  await expect(page.getByText('Submitted', { exact: true })).toHaveCount(1, { timeout: 15_000 });
  await signIn(page, 'pm@acme.test');
  await page.goto(`/equipment?week=${iso(workDay)}`);
  await page.getByRole('tab', { name: 'Approvals' }).click();
  await page.getByRole('button', { name: 'Approve week' }).click();
  await page.getByRole('dialog', { name: 'Approve equipment usage week?' }).getByRole('button', { name: 'Approve week' }).click();
  await expect(page.getByText('Nothing is waiting for approval this week')).toBeVisible({ timeout: 15_000 });

  // Goal: the work order's own page lists the rostered crew and the crane hours.
  await planner.signIn(page);
  await page.goto(`/work-orders/${wo.id}`);
  await expect(page.getByTestId('wo-crews-today')).toContainText(`${run} crew`, { timeout: 20_000 });
  await openWorkOrderArea(page, 'cost');
  const equipment = page.getByTestId('cost-group-equipment_usage');
  await expect(equipment).toContainText(run, { timeout: 20_000 });
  await expect(equipment).toContainText(/8 hours/);
});
