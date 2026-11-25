// @e2e-isolation: self-isolated — owns its project-administrator and project-manager logins, project, work order, crew, checkpoints and daily site report; reads an active org idle reason without mutating any org-wide list; removes all owned rows and uploaded photo in finally.
// JOB-PC15 (project control): effective working hours. The project administrator records timed checkpoints (work start past target
// with a required photo, plus mid-shift and close on time) on the work order, files a daily site report with idle time under a named cause,
// the project manager validates it, and the crews punctuality screen shows both the late start and the lost time by cause.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, ok, ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

// 1x1 PNG for the required checkpoint photo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('JOB-PC15 project administrator records timed checkpoints and idle time on a site report, and the crews view shows the late start and lost time by cause', async ({ page }) => {
  const svc = serviceClient('JOB-PC15');
  const run = runId('JOBPC15');
  const fieldAdmin = await roleJobUser(svc, 'project_administrator', `${run}-fa`);
  const pm = await roleJobUser(svc, 'project_manager', `${run}-pm`);

  let projectId = '';
  let woId = '';
  let boqId = '';
  let crewId = '';
  let reportId = '';
  let today = '';
  const checkpointIds: string[] = [];

  try {
    const org = need('org timezone', await svc.from('organizations').select('default_timezone').eq('id', ORG_ID).single());
    const tz = (org.default_timezone as string | null) ?? 'UTC';
    today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    // Read an active org idle reason without modifying the organisation's list.
    const reasons = need('idle reasons', await svc.from('dsr_idle_reasons')
      .select('id, label').eq('org_id', ORG_ID).is('archived_at', null).order('label').limit(1));
    if (reasons.length === 0) throw new Error('JOB-PC15 requires at least one active dsr_idle_reasons row in the organisation');
    const idleReason = reasons[0] as { id: string; label: string };

    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID,
      name: `${run} project`,
      status: 'Ongoing Project',
      currency: 'USD',
      project_manager_id: pm.id,
    }).select('id').single()).id as string;

    woId = crypto.randomUUID();
    ok('work order', await svc.from('work_orders').insert({
      id: woId,
      org_id: ORG_ID,
      project_id: projectId,
      title: `${run} field shift`,
      status: 'Issued',
      wo_number: `WO-${run}`,
      issued_at: new Date().toISOString(),
      order_value: 25_000,
      tax_treatment: 'exclusive',
      tax_amount: 0,
      currency: 'USD',
    }));

    boqId = need('boq item', await svc.from('boq_items').insert({
      org_id: ORG_ID,
      project_id: projectId,
      item_code: 'SH-1',
      description: 'Shift work',
      unit: 'm',
      quantity: 100,
      rate: 25,
    }).select('id').single()).id as string;

    ok('work order line', await svc.from('work_order_lines').insert({
      org_id: ORG_ID,
      work_order_id: woId,
      boq_item_id: boqId,
      quantity: 100,
    }));

    const crewName = `${run} crew`;
    crewId = need('crew', await svc.from('crews').insert({
      org_id: ORG_ID,
      code: run.slice(-18),
      name: crewName,
      kind: 'own',
      field_controller_id: fieldAdmin.id,
    }).select('id').single()).id as string;

    ok('roster', await svc.from('work_order_crews').insert({
      org_id: ORG_ID,
      work_order_id: woId,
      crew_id: crewId,
      valid_from: today,
    }));

    // Three checkpoints for today: work start already past target (with required photo), plus mid-shift and shift close still ahead.
    const startId = crypto.randomUUID();
    const midId = crypto.randomUUID();
    const closeId = crypto.randomUUID();
    checkpointIds.push(startId, midId, closeId);
    const nowMs = Date.now();
    ok('checkpoints', await svc.from('site_checkpoints').insert([
      {
        id: startId, org_id: ORG_ID, work_order_id: woId, crew_id: crewId, work_date: today,
        position: 1, name: 'Work start', marks_work_start: true,
        due_at: new Date(nowMs - 30 * 60_000).toISOString(), grace_minutes: 0, photo_required: true,
      },
      {
        id: midId, org_id: ORG_ID, work_order_id: woId, crew_id: crewId, work_date: today,
        position: 2, name: 'Mid-shift check', marks_work_start: false,
        due_at: new Date(nowMs + 2 * 3600_000).toISOString(), grace_minutes: 0, photo_required: false,
      },
      {
        id: closeId, org_id: ORG_ID, work_order_id: woId, crew_id: crewId, work_date: today,
        position: 3, name: 'Shift close', marks_work_start: false,
        due_at: new Date(nowMs + 4 * 3600_000).toISOString(), grace_minutes: 0, photo_required: false,
      },
    ]));

    // 1. Project administrator records all three checkpoints on the work order (work start records late with a photo).
    await fieldAdmin.signIn(page);
    await page.goto(`/work-orders/${woId}`);

    const startRow = page.getByTestId(`checkpoint-${startId}`);
    await expect(startRow).toBeVisible({ timeout: 30_000 });
    await expect(startRow).toContainText('Work start');
    await startRow.getByRole('button', { name: 'Record', exact: true }).click();
    const startConfirm = startRow.getByRole('button', { name: 'Record now' });
    await expect(startConfirm).toBeDisabled();
    await startRow.getByTestId('checkpoint-photo-input').setInputFiles({ name: 'start.png', mimeType: 'image/png', buffer: PNG });
    await startConfirm.click();
    await expect(startRow.getByText('Recorded late')).toBeVisible({ timeout: 30_000 });
    await expect(startRow).toContainText('Recorded');
    await expect(startRow.getByRole('button', { name: 'View photo' })).toBeVisible();

    for (const [id, label] of [[midId, 'Mid-shift check'], [closeId, 'Shift close']] as const) {
      const cpRow = page.getByTestId(`checkpoint-${id}`);
      await expect(cpRow).toContainText(label);
      await cpRow.getByRole('button', { name: 'Record', exact: true }).click();
      await cpRow.getByRole('button', { name: 'Record now' }).click();
      await expect(cpRow.getByText('On time')).toBeVisible({ timeout: 30_000 });
      await expect(cpRow).toContainText('Recorded');
    }

    // 2. Project administrator files a daily site report with 10 minutes of idle time under the named cause and submits it.
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByLabel('Project').selectOption(projectId);
    await page.getByLabel('Work order').selectOption(woId);
    await page.getByRole('button', { name: 'Start report' }).click();
    await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    reportId = page.url().split('/').pop()!;

    await page.getByRole('button', { name: 'Add progress' }).click();
    await page.getByLabel('Contract item').selectOption({ label: 'SH-1 · Shift work' });
    await page.getByLabel(/^Quantity/).fill('10');
    await page.getByLabel('Start', { exact: true }).fill('08:00');
    await page.getByLabel('End', { exact: true }).fill('17:00');
    await page.getByRole('button', { name: 'Add idle time' }).click();
    await page.getByLabel('Idle minutes').fill('10');
    await page.getByLabel('Reason', { exact: true }).selectOption(idleReason.id);

    await page.getByRole('button', { name: 'Save draft' }).click();
    await page.getByTestId('dsr-photo-input').setInputFiles({ name: 'form.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('dsr-author-needs-photo')).toHaveCount(0, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 20_000 });

    // 3. Project manager validates the submitted report.
    await pm.signIn(page);
    await page.goto(`/site-reports/${reportId}`);
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'validated', { timeout: 20_000 });

    // 4. Project administrator opens the crews punctuality screen and confirms both the late start and lost time by cause.
    await fieldAdmin.signIn(page);
    await page.goto('/site-reports/crews');
    const crewCard = page.getByTestId(`crew-${crewId}`);
    await expect(crewCard).toBeVisible({ timeout: 30_000 });
    await expect(crewCard).toContainText(crewName);
    await expect(crewCard).toContainText('0 of 1 days on time');
    await expect(crewCard).toContainText('Late');
    await expect(crewCard).toContainText(/\d+ min late/);

    const lostTime = page.getByTestId('lost-time');
    await expect(lostTime).toBeVisible({ timeout: 20_000 });
    const causeRow = lostTime.getByRole('listitem').filter({ hasText: idleReason.label });
    await expect(causeRow).toBeVisible();
    await expect(causeRow).toContainText(/\d+h \d{2}m/);
  } finally {
    if (reportId) {
      const { data: dsrPhotos } = await svc.from('dsr_photos').select('file_path').eq('report_id', reportId);
      const paths = (dsrPhotos ?? []).map((p: { file_path: string }) => p.file_path).filter(Boolean);
      if (paths.length) await svc.storage.from('site-report-photos').remove(paths);
    }
    if (woId && crewId && today) {
      const { data: files } = await svc.storage.from('site-checkpoint-photos').list(`${ORG_ID}/${woId}/${crewId}/${today}`);
      if (files?.length) {
        await svc.storage.from('site-checkpoint-photos').remove(files.map((f) => `${ORG_ID}/${woId}/${crewId}/${today}/${f.name}`));
      }
    }
    await cleanupAll(svc, [
      ['audit_events', 'entity_id', checkpointIds],
      ['site_checkpoints', 'work_order_id', woId ? [woId] : []],
      ['daily_site_reports', 'id', reportId ? [reportId] : []],
      ['work_order_lines', 'work_order_id', woId ? [woId] : []],
      ['boq_items', 'id', boqId ? [boqId] : []],
      ['work_order_crews', 'work_order_id', woId ? [woId] : []],
      ['crews', 'id', crewId ? [crewId] : []],
      ['work_orders', 'id', woId ? [woId] : []],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
    await pm.cleanup();
    await fieldAdmin.cleanup();
  }
});
