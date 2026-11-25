// @e2e-isolation: serial — updates the organisation-wide document_warning_days setting for the run and restores the prior value and deletes all owned rows in finally.
/**
 * JOB-F14 — HR manager configures a person document type's notified roles and expiry warning days.
 * The HR manager adds a non-medical person document type notifying Project Manager (alongside the direct manager)
 * and updates the organisation's expiry warning days; when a worker's document hits that warning day and the
 * warning job runs, the configured Project Manager (NOT the worker's direct manager) and the direct manager (a foreman, Engineer
 * base, matched only as direct manager) are warned; a bystander of a role not ticked gets none.
 */
import { test, expect } from '@playwright/test';
import { visibleToast } from '../helpers';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { inDays, sql } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';

test.setTimeout(180_000);

test('JOB-F14 HR manager configures expiry recipients and warning days and the direct manager receives the warning', async ({ page }) => {
  const svc = serviceClient('JOB-F14');
  const run = runId('f14');
  const hrManager = await roleJobUser(svc, 'hr_manager', runId('f14-hrm'));
  const manager = await roleJobUser(svc, 'foreman', runId('f14-fm'));
  const pm = await roleJobUser(svc, 'project_manager', runId('f14-pm'));
  const bystander = await roleJobUser(svc, 'field_user', runId('f14-by'));
  const typeName = `${run} Site Pass`;
  let previousDays: number[] | null = null;
  let daysTouched = false;
  let typeId = '';
  let personId = '';
  let docId = '';
  try {
    const org = need('warning days read', await svc.from('organizations').select('document_warning_days').eq('id', ORG_ID).single());
    previousDays = (org.document_warning_days as number[] | null) ?? null;
    const existing = previousDays && previousDays.length > 0 ? previousDays : [30, 14, 7];
    const targetDay = existing.includes(35) ? 40 : 35;
    const nextDaysText = `${targetDay}, 14, 7`;

    // 1. HR manager adds a non-medical Person document type with Project Manager notified.
    await hrManager.signIn(page);
    await page.goto('/administration/document-types');
    const section = page.locator('#document-types');
    await expect(section).toBeVisible({ timeout: 20_000 });
    await section.getByRole('button', { name: 'Add document type' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add document type' });
    await dialog.locator('#document-type-name').fill(typeName);
    await dialog.getByRole('checkbox', { name: 'Project Manager' }).check();
    await dialog.getByRole('button', { name: 'Save document type' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(visibleToast(page, 'Document type saved')).toBeVisible({ timeout: 15_000 });

    const typeRow = section.getByRole('row', { name: new RegExp(typeName) });
    await expect(typeRow).toBeVisible({ timeout: 15_000 });
    await expect(typeRow).toContainText('Direct manager');
    await expect(typeRow).toContainText('Project Manager');

    // 2. HR manager updates the warning days to include targetDay and saves.
    const daysInput = section.locator('#document-warning-days');
    await daysInput.fill(nextDaysText);
    await section.getByRole('button', { name: 'Save warning days' }).click();
    await expect(visibleToast(page, 'Warning days saved')).toBeVisible({ timeout: 15_000 });
    daysTouched = true;

    // 3. Seed a worker managed by the Construction Manager with that document expiring in targetDay days, then run warnings.
    typeId = need('created type', await svc.from('document_types').select('id').eq('org_id', ORG_ID).eq('name', typeName).single()).id;
    personId = need('worker', await svc.from('people').insert({
      org_id: ORG_ID, code: `${run}-W`, kind: 'own', name: `${run} Worker`, manager_id: manager.id,
    }).select('id').single()).id;
    docId = need('expiry doc', await svc.from('expiry_documents').insert({
      org_id: ORG_ID, subject_kind: 'person', person_id: personId, type_id: typeId, expires_on: inDays(targetDay),
    }).select('id').single()).id;

    expect(Number(sql('select public.run_document_expiry_warnings();'))).toBeGreaterThanOrEqual(1);

    // 4. Goal: the configured Project Manager (not the direct manager) and the direct manager see the warning; the bystander does not.
    const warning = new RegExp(`${typeName} expires in ${targetDay} days`);
    for (const who of [pm, manager]) {
      await who.signIn(page);
      await page.goto('/');
      await page.getByRole('button', { name: /^notifications/i }).click();
      await expect(page.getByRole('list', { name: 'Notifications' }).getByText(warning)).toBeVisible({ timeout: 20_000 });
    }
    await bystander.signIn(page);
    await page.goto('/');
    await page.getByRole('button', { name: /^notifications/i }).click();
    await expect(page.getByRole('list', { name: 'Notifications' }).getByText(warning)).toHaveCount(0);
    const notices = await svc.from('document_expiry_notices').select('recipient_id').eq('document_id', docId);
    const recipients = new Set(((notices.data ?? []) as { recipient_id: string }[]).map((n) => n.recipient_id));
    expect(recipients.has(pm.id)).toBe(true);
    expect(recipients.has(manager.id)).toBe(true);
    expect(recipients.has(bystander.id)).toBe(false);
  } finally {
    if (daysTouched) {
      ok('restore warning days', await svc.from('organizations').update({ document_warning_days: previousDays ?? [30, 14, 7] }).eq('id', ORG_ID));
    }
    if (docId) {
      await svc.from('notifications').delete().eq('metadata->entity->>id', docId);
      await svc.from('document_expiry_notices').delete().eq('document_id', docId);
      await svc.from('expiry_documents').delete().eq('id', docId);
    }
    if (personId) await svc.from('people').delete().eq('id', personId);
    if (typeId) await svc.from('document_types').delete().eq('id', typeId);
    await hrManager.cleanup();
    await bystander.cleanup();
    await pm.cleanup();
    await manager.cleanup();
  }
});
