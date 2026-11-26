// @e2e-isolation: self-isolated — creates its own organisation, disposable foreman and field-user light logins, site supervisor login, people, project, work order with an area, crew, placements and roster; removes the fixture organisation and logins. The two workers' positions are mocked through their browser contexts, never a real one.
/**
 * JOB-F5 — clock in at the work location (#2705). A rostered foreman clocks in inside the work order's area on the phone home
 * screen; a rostered field worker clocks in outside it. The site supervisor who controls the crew decides the outside request.
 * Goal oracle: the inside check-in is recorded at once, and the outside one waits for the supervisor and only becomes attendance
 * when they approve it.
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { need, ok, runId, serviceClient } from './support/jobFixtures';
import { inDays, ORG_TIMEZONE } from './support/jobJourney';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test.setTimeout(240_000);

test('JOB-F5 an inside clock-in is recorded and an outside one waits for the site supervisor to approve', async ({ page }) => {
  const svc = serviceClient('JOB-F5');
  const run = runId('f5');
  const orgId = need('organisation', await svc.from('organizations').insert({
    name: `${run} organisation`, default_currency: 'USD', default_timezone: ORG_TIMEZONE,
    built_in_roles_enabled: true, phone_check_in_supervisor_role: 'site_supervisor',
  }).select('id').single()).id;
  const users: Awaited<ReturnType<typeof createJobRoleUser>>[] = [];
  const contexts: BrowserContext[] = [];
  try {
    const supervisor = await createJobRoleUser(svc, orgId, 'site_supervisor');
    users.push(supervisor);
    const foreman = await createJobRoleUser(svc, orgId, 'foreman');
    users.push(foreman);
    const fieldUser = await createJobRoleUser(svc, orgId, 'field_user');
    users.push(fieldUser);
    const projectId = need('project', await svc.from('projects').insert({
      org_id: orgId, name: `${run} project`, status: 'Ongoing Project', currency: 'USD',
    }).select('id').single()).id;
    const workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: orgId, project_id: projectId, title: `${run} slab`, status: 'Issued', order_value: 1000,
      tax_treatment: 'exclusive', tax_amount: 0, area_lat: -6.2, area_lng: 106.8, area_radius_m: 150,
    }).select('id').single()).id;
    // The organisation names the site supervisor as the role that decides outside check-ins.
    const crewId = need('crew', await svc.from('crews').insert({
      org_id: orgId, code: `F5-${run.slice(-8)}`, name: `${run} crew`, kind: 'own', field_controller_id: supervisor.id,
    }).select('id').single()).id;
    const personA = need('person A', await svc.from('people').insert({ org_id: orgId, kind: 'own', name: `${run} foreman`, profile_id: foreman.id }).select('id').single()).id;
    const personB = need('person B', await svc.from('people').insert({ org_id: orgId, kind: 'own', name: `${run} worker`, profile_id: fieldUser.id }).select('id').single()).id;
    for (const person of [personA, personB]) {
      ok('placement', await svc.from('crew_members').insert({ org_id: orgId, crew_id: crewId, worker_id: person, valid_from: inDays(0) }));
    }
    ok('roster', await svc.from('work_order_crews').insert({ org_id: orgId, work_order_id: workOrderId, crew_id: crewId, valid_from: inDays(0) }));

    // 1. The rostered foreman clocks in inside the area: recorded at once, no approval.
    const inside = await page.context().browser()!.newContext({ permissions: ['geolocation'], geolocation: { latitude: -6.2, longitude: 106.8, accuracy: 10 } });
    contexts.push(inside);
    const foremanPage = await inside.newPage();
    await foreman.signIn(foremanPage);
    await foremanPage.goto('/my');
    await expect(foremanPage.getByRole('heading', { name: 'Clock in' })).toBeVisible({ timeout: 20_000 });
    const mine = (p: typeof foremanPage) => p.getByRole('listitem').filter({ hasText: `${run} slab` });
    await mine(foremanPage).getByRole('button', { name: 'Clock in' }).click();
    await expect(mine(foremanPage).getByText(/Clocked in at \d{1,2}:\d{2}/)).toBeVisible({ timeout: 20_000 });
    const recorded = need('inside day', await svc.from('attendance_days').select('id').eq('work_order_id', workOrderId).eq('worker_id', personA));
    expect(recorded).toHaveLength(1);

    // 2. The rostered field worker clocks in about 1.1 km outside: it waits for the supervisor, and no attendance is recorded.
    const outside = await page.context().browser()!.newContext({ permissions: ['geolocation'], geolocation: { latitude: -6.19, longitude: 106.8, accuracy: 10 } });
    contexts.push(outside);
    const workerPage = await outside.newPage();
    await fieldUser.signIn(workerPage);
    await workerPage.goto('/my');
    await expect(workerPage.getByRole('heading', { name: 'Clock in' })).toBeVisible({ timeout: 20_000 });
    await mine(workerPage).getByRole('button', { name: 'Clock in' }).click();
    await expect(mine(workerPage).getByText(/outside the work area/i)).toBeVisible({ timeout: 20_000 });
    await expect(mine(workerPage).getByText(/Waiting for .+ to approve/)).toBeVisible();
    const beforeDecision = need('outside day', await svc.from('attendance_days').select('id').eq('work_order_id', workOrderId).eq('worker_id', personB));
    expect(beforeDecision).toHaveLength(0);

    // 3. The site supervisor sees the request where they look and approves it; only then is the second person's day recorded.
    await supervisor.signIn(page);
    await page.goto('/');
    const approvals = page.getByRole('link', { name: /^Approvals\s*, 1 pending$/ });
    await expect(approvals).toBeVisible();
    await approvals.click();
    const clockIns = page.getByRole('region', { name: 'Clock-ins to decide' });
    await expect(clockIns.getByRole('heading', { name: 'Clock-ins to decide (1)' })).toBeVisible();
    const waiting = clockIns.getByRole('link', { name: new RegExp(`${run} slab`) });
    await expect(waiting).toBeVisible();
    await waiting.click();
    await expect(page).toHaveURL(/\/crews$/);
    await expect(page.getByRole('heading', { name: 'Check-ins waiting for you' })).toBeVisible({ timeout: 20_000 });
    const request = page.getByRole('row').filter({ hasText: `${run} slab` });
    await expect(request.getByText(/Work area: centre -6\.2, 106\.8, radius 150 m/)).toBeVisible();
    await request.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByLabel('Notifications alt+T').getByText('Check-in approved')).toBeVisible({ timeout: 20_000 });

    const afterDecision = need('approved day', await svc.from('attendance_days').select('worker_id, source').eq('work_order_id', workOrderId));
    expect(afterDecision).toHaveLength(2);
    expect(afterDecision.map((d) => d.worker_id).sort()).toEqual([personA, personB].sort());
    expect(afterDecision.some((d) => d.source === 'phone_check_in')).toBe(true);
    await workerPage.reload();
    await expect(workerPage.getByText(/Clocked in at \d{1,2}:\d{2}/)).toBeVisible({ timeout: 20_000 });
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
    removeJobOrganization(orgId);
    for (const user of users) await user.remove();
  }
});
