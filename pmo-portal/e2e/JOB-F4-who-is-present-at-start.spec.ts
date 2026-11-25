// @e2e-isolation: self-isolated — creates its own disposable site supervisor and two field-user logins, four people, project, work order with an area, crew, placements and roster; removes every row by its exact id. The workers' positions are mocked through their browser contexts, never a real one.
/**
 * JOB-F4 — who is present at the start of the day (#2882, OD-R1125-1). Two members of a crew clock in; the Site Supervisor who
 * controls the crew opens Crews → Attendance. Goal oracle: the two who clocked in read present and the rest read
 * "Not yet present": nobody is present or absent by default.
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { inDays } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(240_000);

test('JOB-F4 the supervisor sees the two who clocked in as present and everyone else as not yet present', async ({ page }) => {
  const svc = serviceClient('JOB-F4');
  const run = runId('f4');
  const supervisor = await roleJobUser(svc, 'site_supervisor', runId('f4-ss'));
  const workers = [await roleJobUser(svc, 'field_user', runId('f4-a')), await roleJobUser(svc, 'field_user', runId('f4-b'))];
  let projectId = ''; let workOrderId = ''; let crewId = '';
  const people: string[] = [];
  const contexts: BrowserContext[] = [];
  try {
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD',
    }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} slab`, status: 'Issued', order_value: 1000,
      tax_treatment: 'exclusive', tax_amount: 0, area_lat: -6.2, area_lng: 106.8, area_radius_m: 150,
    }).select('id').single()).id;
    crewId = need('crew', await svc.from('crews').insert({
      org_id: ORG_ID, code: `F4-${run.slice(-8)}`, name: `${run} crew`, kind: 'own', field_controller_id: supervisor.id,
    }).select('id').single()).id;
    const names = ['Ana', 'Budi', 'Citra', 'Dewi'];
    for (const [i, name] of names.entries()) {
      people.push(need(`person ${name}`, await svc.from('people').insert({
        org_id: ORG_ID, kind: 'own', name: `${run} ${name}`, ...(i < 2 ? { profile_id: workers[i].id } : {}),
      }).select('id').single()).id);
    }
    for (const person of people) {
      ok('placement', await svc.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: person, valid_from: inDays(0) }));
    }
    ok('roster', await svc.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: inDays(0) }));

    // 1. Two members clock in on their phones, inside the work area.
    for (const worker of workers) {
      const inside = await page.context().browser()!.newContext({ permissions: ['geolocation'], geolocation: { latitude: -6.2, longitude: 106.8, accuracy: 10 } });
      contexts.push(inside);
      const phone = await inside.newPage();
      await worker.signIn(phone);
      await phone.goto('/my');
      await expect(phone.getByRole('heading', { name: 'Clock in' })).toBeVisible({ timeout: 20_000 });
      const mine = phone.getByRole('listitem').filter({ hasText: `${run} slab` });
      await mine.getByRole('button', { name: 'Clock in' }).click();
      await expect(mine.getByText(/Clocked in at \d{1,2}:\d{2}/)).toBeVisible({ timeout: 20_000 });
    }

    // 2. The Site Supervisor opens Crews → Attendance for the crew's work order.
    await supervisor.signIn(page);
    await page.goto(`/crews?view=attendance&wo=${workOrderId}`);
    const row = (name: string) => page.getByRole('row', { name: new RegExp(`${run} ${name}`) });
    await expect(row('Ana')).toBeVisible({ timeout: 20_000 });

    // Goal: the two who clocked in are present; nobody else is present or absent.
    await expect(row('Ana').getByRole('combobox')).toHaveValue('present');
    await expect(row('Budi').getByRole('combobox')).toHaveValue('present');
    for (const name of ['Citra', 'Dewi']) {
      await expect(row(name).getByRole('combobox')).toHaveValue('unmarked');
      await expect(row(name).getByRole('option', { name: 'Not yet present' })).toHaveCount(1);
    }
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
    if (workOrderId) ok('check-ins cleanup', await svc.from('phone_check_ins').delete().eq('work_order_id', workOrderId));
    if (workOrderId) ok('attendance cleanup', await svc.from('attendance_days').delete().eq('work_order_id', workOrderId));
    if (crewId) ok('roster cleanup', await svc.from('work_order_crews').delete().eq('crew_id', crewId));
    if (crewId) ok('placement cleanup', await svc.from('crew_members').delete().eq('crew_id', crewId));
    for (const person of people) ok('person cleanup', await svc.from('people').delete().eq('id', person));
    if (crewId) ok('crew cleanup', await svc.from('crews').delete().eq('id', crewId));
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    for (const worker of workers) await worker.cleanup();
    await supervisor.cleanup();
  }
});

test('JOB-F4 the manager recorded on a crew member, who does not run the crew, marks that member absent and the others stay not yet present', async ({ page }) => {
  const svc = serviceClient('JOB-F4-manager');
  const run = runId('f4m');
  const controller = await roleJobUser(svc, 'site_supervisor', runId('f4m-ss'));
  const manager = await roleJobUser(svc, 'site_supervisor', runId('f4m-mg'));
  let projectId = ''; let workOrderId = ''; let crewId = '';
  const people: string[] = [];
  try {
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD',
    }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} slab`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
    }).select('id').single()).id;
    crewId = need('crew', await svc.from('crews').insert({
      org_id: ORG_ID, code: `F4M-${run.slice(-7)}`, name: `${run} crew`, kind: 'own', field_controller_id: controller.id,
    }).select('id').single()).id;
    for (const name of ['Ana', 'Budi', 'Citra']) {
      people.push(need(`person ${name}`, await svc.from('people').insert({
        org_id: ORG_ID, kind: 'own', name: `${run} ${name}`, ...(name === 'Citra' ? { manager_id: manager.id } : {}),
      }).select('id').single()).id);
    }
    for (const person of people) {
      ok('placement', await svc.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: person, valid_from: inDays(0) }));
    }
    ok('roster', await svc.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: inDays(0) }));

    // The manager opens Crews → Attendance: only their report's row has a control.
    await manager.signIn(page);
    await page.goto(`/crews?view=attendance&wo=${workOrderId}`);
    const row = (name: string) => page.getByRole('row', { name: new RegExp(`${run} ${name}`) });
    await expect(row('Citra')).toBeVisible({ timeout: 20_000 });
    for (const name of ['Ana', 'Budi']) await expect(row(name).getByRole('combobox')).toHaveCount(0);
    await row('Citra').getByRole('combobox').selectOption('absent');
    await page.getByRole('button', { name: 'Save attendance' }).click();
    await expect(page.getByText('Attendance saved').first()).toBeVisible({ timeout: 15_000 });

    // Goal: after a fresh load their report reads Absent; nobody else was recorded.
    await page.reload();
    await expect(row('Citra').getByRole('combobox')).toHaveValue('absent', { timeout: 20_000 });
    for (const name of ['Ana', 'Budi']) await expect(row(name).getByText('Not yet present', { exact: true })).toBeVisible();
  } finally {
    if (workOrderId) ok('attendance cleanup', await svc.from('attendance_days').delete().eq('work_order_id', workOrderId));
    if (crewId) ok('roster cleanup', await svc.from('work_order_crews').delete().eq('crew_id', crewId));
    if (crewId) ok('placement cleanup', await svc.from('crew_members').delete().eq('crew_id', crewId));
    for (const person of people) ok('person cleanup', await svc.from('people').delete().eq('id', person));
    if (crewId) ok('crew cleanup', await svc.from('crews').delete().eq('id', crewId));
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await manager.cleanup(); await controller.cleanup();
  }
});
