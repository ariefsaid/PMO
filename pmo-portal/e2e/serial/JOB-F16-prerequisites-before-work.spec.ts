// @e2e-isolation: serial — the work-order safety section only renders while the organisation-wide safety-records switch is on; the spec sets it for the run and restores the prior value. Every other row it creates is its own and deleted in finally.
/**
 * JOB-F16 — prerequisites before work (#2527 / #2596). A welder holds a certificate 20 days from expiry and today's safety
 * record carries a permit to work.
 * Goal oracle: the HR officer opens the person and sees the certificate with its expiry date; the safety officer opens the
 * work order's safety record and sees the permit with its validity. Both show with their dates.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { inDays, orgToday } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';
import { openWorkOrderArea } from '../support/workOrderArea';

test.setTimeout(180_000);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return y === Number(orgToday().slice(0, 4)) ? `${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${y}`; }; // the year is dropped in the current year

test('JOB-F16 the welder certificate and the permit to work both show with their dates to HR and to the safety officer', async ({ page }) => {
  const svc = serviceClient('JOB-F16');
  const run = runId('f16');
  const hrOfficer = await roleJobUser(svc, 'hr_officer', runId('f16-hr'));
  const safetyOfficer = await roleJobUser(svc, 'safety_officer', runId('f16-so'));
  const typeName = `${run} Welder certificate`;
  const personName = `${run} Welder`;
  const permitNumber = `PTW-${run}`;
  const expires = inDays(20);
  const today = orgToday();
  let switchBefore: boolean | null = null;
  let switchTouched = false;
  let projectId = '';
  let workOrderId = '';
  let typeId = '';
  let personId = '';
  let dayId = '';
  try {
    const org = need('org switch read', await svc.from('organizations').select('safety_records_enabled').eq('id', ORG_ID).single());
    switchBefore = Boolean(org.safety_records_enabled);
    ok('org switch on', await svc.from('organizations').update({ safety_records_enabled: true }).eq('id', ORG_ID));
    switchTouched = true;

    projectId = need('project', await svc.from('projects').insert({ org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD' }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} pipe erection`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;
    typeId = need('document type', await svc.from('document_types').insert({
      org_id: ORG_ID, name: typeName, applies_to: 'person', is_medical: false, notify_roles: [],
    }).select('id').single()).id;
    personId = need('person', await svc.from('people').insert({ org_id: ORG_ID, code: run, name: personName }).select('id').single()).id;
    need('certificate', await svc.from('expiry_documents').insert({
      org_id: ORG_ID, subject_kind: 'person', person_id: personId, type_id: typeId, number: `CERT-${run}`, expires_on: expires,
    }).select('id').single());
    dayId = need('safety day', await svc.from('safety_days').insert({
      org_id: ORG_ID, project_id: projectId, work_order_id: workOrderId, work_date: today, status: 'draft', author_id: safetyOfficer.id,
    }).select('id').single()).id;
    need('permit', await svc.from('safety_permits').insert({
      org_id: ORG_ID, day_id: dayId, permit_number: permitNumber, valid_from: `${today}T07:00:00Z`, valid_to: `${today}T17:00:00Z`, issued_by: safetyOfficer.id,
    }).select('id').single());

    // 1. The HR officer opens People -> the person and sees the certificate with its expiry date.
    await hrOfficer.signIn(page);
    await page.goto('/administration/people');
    await page.getByRole('link', { name: personName }).click();
    await expect(page).toHaveURL(/\/equipment\/people\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const certificate = page.getByRole('row', { name: new RegExp(typeName) });
    await expect(certificate).toBeVisible({ timeout: 20_000 });
    await expect(certificate).toContainText(dayLabel(expires));

    // 2. The safety officer opens the work order and its safety record for today.
    await safetyOfficer.signIn(page);
    await page.goto(`/work-orders/${workOrderId}`);
    await openWorkOrderArea(page, 'documents');
    const section = page.getByTestId('safety-section');
    await expect(section).toBeVisible({ timeout: 20_000 });
    const todayRow = page.locator(`[data-testid="safety-day-row"][data-date="${today}"]`);
    await expect(todayRow).toBeVisible({ timeout: 20_000 });
    await todayRow.getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL(/\/safety-days\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    // 3. Goal: the permit shows with its number and its validity dates.
    const permit = page.getByTestId('safety-permit-row').filter({ hasText: permitNumber });
    await expect(permit).toBeVisible({ timeout: 20_000 });
    await expect(permit).toContainText(dayLabel(today));
    await expect(permit).toContainText('07:00');
    await expect(permit).toContainText('17:00');
  } finally {
    if (dayId) ok('safety day cleanup', await svc.from('safety_days').delete().eq('id', dayId));
    if (personId) ok('documents cleanup', await svc.from('expiry_documents').delete().eq('person_id', personId));
    if (typeId) ok('type cleanup', await svc.from('document_types').delete().eq('id', typeId));
    if (personId) ok('person cleanup', await svc.from('people').delete().eq('id', personId));
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    if (switchTouched) ok('org switch restore', await svc.from('organizations').update({ safety_records_enabled: switchBefore ?? false }).eq('id', ORG_ID));
    await safetyOfficer.cleanup();
    await hrOfficer.cleanup();
  }
});
