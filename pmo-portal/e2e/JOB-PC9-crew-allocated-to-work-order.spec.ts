// @e2e-isolation: self-isolated — own project, work order, crew and person; the roster and placements are ended and the fixture removed where history allows.
// JOB-PC9 (planner): resources allocated per work order. PARTLY LANDED: a crew is rostered on a work order for a date range and the work order lists it
// for those dates; renting equipment against the work order is a separate screen (equipment use) and the crane-allocation part is held (owner question).
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from './helpers';
import { need, ok, ORG_ID, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';

test.setTimeout(120_000);
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let admin: SupabaseClient;
let crewId = '';
test.afterEach(async () => {
  if (!admin || !crewId) return;
  const today = iso(new Date());
  await admin.from('work_order_crews').update({ valid_to: today }).eq('crew_id', crewId);
  await admin.from('crew_members').update({ valid_to: today }).eq('crew_id', crewId);
  crewId = '';
});

test('JOB-PC9 a crew rostered on a work order for a date range is listed on it for those dates', async ({ page }) => {
  admin = serviceClient('JOB-PC9');
  const run = runId('JOBPC9');
  const fx = await projectWithWorkOrders(admin, run, ['Pipe rack']);
  const wo = fx.workOrders[0];
  const from = new Date(); const to = new Date(); to.setDate(to.getDate() + 5);
  crewId = need('crew', await admin.from('crews').insert({ org_id: ORG_ID, code: run.slice(-18), name: `${run} crew`, kind: 'own', field_controller_id: ENGINEER_ID }).select('id').single()).id;
  const person = need('person', await admin.from('people').insert({ org_id: ORG_ID, kind: 'own', name: `${run} Ana` }).select('id').single()).id;
  ok('placement', await admin.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: person, valid_from: iso(from) }));

  await signIn(page, 'pm@acme.test');
  await page.goto(`/crews?view=roster&wo=${wo.id}`);
  await page.getByRole('button', { name: 'Roster a crew' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^crew/i).selectOption({ label: new RegExp(run) as unknown as string }).catch(async () => {
    await dialog.getByLabel(/^crew/i).selectOption({ index: 1 });
  });
  await dialog.getByLabel(/^from/i).fill(iso(from));
  await dialog.getByLabel(/^to/i).fill(iso(to));
  await dialog.getByRole('button', { name: 'Roster a crew' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });

  // The work order lists the crew, for the dates given.
  const placements = page.getByRole('row').filter({ hasText: `${run} crew` });
  await expect(placements).toBeVisible({ timeout: 15_000 });
  const rosterRows = need('roster', await admin.from('work_order_crews').select('valid_from, valid_to').eq('work_order_id', wo.id));
  expect(rosterRows).toEqual([{ valid_from: iso(from), valid_to: iso(to) }]);
});
