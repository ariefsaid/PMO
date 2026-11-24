// @e2e-isolation: serial — the work-order safety section and the safety list only render while the organisation-wide safety-records switch is on; the spec sets it for the run and restores the prior value. It owns its checklist item, permit type and every record row, deleted in finally.
/**
 * JOB-F19 — safety records (#2596). The safety officer records today's toolbox talk, the pre-work (start-work) checklist and a
 * permit to work on a work order.
 * Goal oracle: all three show on that work order for that day, reached from the work order's own safety records.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';

test.setTimeout(180_000);

test('JOB-F19 the safety officer records a toolbox talk, the start-work checklist and a permit on the day, and all three show', async ({ page }) => {
  const svc = serviceClient('JOB-F19');
  const run = runId('f19');
  const safetyOfficer = await roleJobUser(svc, 'safety_officer', runId('f19-so'));
  const topic = `${run} working at height`;
  const checkItem = `${run} Area barricaded`;
  const permitType = `${run} hot work`;
  const permitNumber = `PTW-${run}`;
  let switchBefore: boolean | null = null;
  let switchTouched = false;
  let projectId = '';
  let workOrderId = '';
  let checkItemId = '';
  let permitTypeId = '';
  try {
    const org = need('org switch read', await svc.from('organizations').select('safety_records_enabled').eq('id', ORG_ID).single());
    switchBefore = Boolean(org.safety_records_enabled);
    ok('org switch on', await svc.from('organizations').update({ safety_records_enabled: true }).eq('id', ORG_ID));
    switchTouched = true;

    projectId = need('project', await svc.from('projects').insert({ org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD' }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} vessel erection`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;
    checkItemId = need('checklist item', await svc.from('safety_list_items').insert({
      org_id: ORG_ID, kind: 'checklist_item', label: checkItem, position: 1,
    }).select('id').single()).id;
    permitTypeId = need('permit type', await svc.from('safety_list_items').insert({
      org_id: ORG_ID, kind: 'permit_type', label: permitType, position: 1,
    }).select('id').single()).id;

    // 1. The safety officer starts today's record from the work order.
    await safetyOfficer.signIn(page);
    await page.goto(`/work-orders/${workOrderId}`);
    const section = page.getByTestId('safety-section');
    await expect(section).toBeVisible({ timeout: 20_000 });
    await section.getByTestId('safety-new-day').click();
    await expect(page).toHaveURL(/\/safety-days\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    // 2. Toolbox talk with its attendance.
    await page.getByLabel('Topic').fill(topic);
    await page.getByLabel('Presenter').fill('Site supervisor');
    await page.getByLabel(/Named visitor/).fill(`${run} rigger`);
    await page.getByTestId('safety-talk-save').click();
    await expect(page.getByTestId('safety-talk')).toContainText(topic, { timeout: 15_000 });

    // 3. Start-work check.
    const checkRow = page.getByTestId('safety-checklist-row').filter({ hasText: checkItem });
    await expect(checkRow).toBeVisible({ timeout: 15_000 });
    await checkRow.getByRole('combobox').selectOption({ label: 'Yes' });
    await expect(checkRow).toHaveAttribute('data-answer', 'yes', { timeout: 15_000 });

    // 4. Permit to work.
    await page.getByLabel('Permit number').fill(permitNumber);
    await page.getByLabel('Permit type').selectOption({ label: permitType });
    await page.getByLabel('Issued by').fill('Site supervisor');
    await page.getByTestId('safety-permit-add').click();
    await expect(page.getByTestId('safety-permit-row').filter({ hasText: permitNumber })).toBeVisible({ timeout: 15_000 });

    // 5. Goal: back on the work order, the day is recorded, and its record carries all three.
    await page.goto(`/work-orders/${workOrderId}`);
    const todayRow = page.locator(`[data-testid="safety-day-row"][data-date="${orgToday()}"]`);
    await expect(todayRow).toBeVisible({ timeout: 20_000 });
    await todayRow.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByTestId('safety-talk')).toContainText(topic, { timeout: 20_000 });
    await expect(page.getByTestId('safety-checklist-row').filter({ hasText: checkItem })).toHaveAttribute('data-answer', 'yes');
    await expect(page.getByTestId('safety-permit-row').filter({ hasText: permitNumber })).toBeVisible();
  } finally {
    if (workOrderId) ok('safety days cleanup', await svc.from('safety_days').delete().eq('work_order_id', workOrderId));
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    if (checkItemId) ok('checklist item cleanup', await svc.from('safety_list_items').delete().eq('id', checkItemId));
    if (permitTypeId) ok('permit type cleanup', await svc.from('safety_list_items').delete().eq('id', permitTypeId));
    if (switchTouched) ok('org switch restore', await svc.from('organizations').update({ safety_records_enabled: switchBefore ?? false }).eq('id', ORG_ID));
    await safetyOfficer.cleanup();
  }
});
