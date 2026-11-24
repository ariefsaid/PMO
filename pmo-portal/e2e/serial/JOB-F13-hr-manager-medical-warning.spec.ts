// @e2e-isolation: serial — runs the organisation-wide expiry-warning job (which writes notices for every due document in the org) and creates a document type plus a person other journeys could see in the shared list; every owned row is deleted in finally.
/**
 * JOB-F13 — HR agrees a medical date with the construction manager (#2527). A worker's medical check is 14 days from expiry and
 * the worker's direct manager is the construction manager. The HR officer opens People -> Expiring documents and sees the
 * check with its date; the scheduled warning job then runs.
 * Goal oracle: both the HR officer and the construction manager are warned, and the worker is not — the notice goes to the
 * manager and to the HR function, not to a field worker's own inbox.
 * Note: a worker WITH an account of their own is also told of their own medical expiry by design (2384); this case's worker
 * has no app account, as most site workers do not.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { inDays, orgToday, sql } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';

test.setTimeout(180_000);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return y === Number(orgToday().slice(0, 4)) ? `${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${y}`; }; // the year is dropped in the current year

test('JOB-F13 a medical check 14 days from expiry warns the HR officer and the construction manager, not the worker', async ({ page }) => {
  const svc = serviceClient('JOB-F13');
  const run = runId('f13');
  const hrOfficer = await roleJobUser(svc, 'hr_officer', runId('f13-hr'));
  const manager = await roleJobUser(svc, 'construction_manager', runId('f13-cm'));
  const typeName = `${run} Medical check`;
  const personName = `${run} Worker`;
  const expires = inDays(14);
  let typeId = '';
  let personId = '';
  let docId = '';
  try {
    // A medical document type: its notices go to the person's manager and to whoever may see medical documents (the HR function).
    typeId = need('document type', await svc.from('document_types').insert({
      org_id: ORG_ID, name: typeName, applies_to: 'person', is_medical: true, notify_roles: [], notify_person: false,
    }).select('id').single()).id;
    personId = need('person', await svc.from('people').insert({
      org_id: ORG_ID, code: run, name: personName, manager_id: manager.id,
    }).select('id').single()).id;
    docId = need('medical document', await svc.from('expiry_documents').insert({
      org_id: ORG_ID, subject_kind: 'person', person_id: personId, type_id: typeId, expires_on: expires, medical_status: 'fit',
    }).select('id').single()).id;

    // 1. The HR officer opens People -> Expiring documents and sees the check with its date.
    await hrOfficer.signIn(page);
    await page.goto('/administration/people');
    await page.getByTestId('people-expiring-link').click();
    await expect(page).toHaveURL(/\/equipment\/expiring$/, { timeout: 15_000 });
    const row = page.getByRole('row', { name: new RegExp(personName) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(typeName);
    await expect(row).toContainText(dayLabel(expires));

    // 2. The warning day is reached and the scheduled job runs.
    expect(Number(sql('select public.run_document_expiry_warnings();'))).toBeGreaterThanOrEqual(1);

    // 3. Goal: the HR officer is warned...
    await page.goto('/');
    await page.getByRole('button', { name: /^notifications/i }).click();
    await expect(page.getByRole('list', { name: 'Notifications' }).getByText(new RegExp(`${typeName} expires in 14 days`)))
      .toBeVisible({ timeout: 20_000 });

    // ...the construction manager (the worker's manager) is warned...
    await manager.signIn(page);
    await page.goto('/');
    await page.getByRole('button', { name: /^notifications/i }).click();
    await expect(page.getByRole('list', { name: 'Notifications' }).getByText(new RegExp(`${typeName} expires in 14 days`)))
      .toBeVisible({ timeout: 20_000 });

    // ...and the worker, who has no app account, is not among the notice's addressees.
    expect(need('worker link', await svc.from('people').select('profile_id').eq('id', personId).single()).profile_id).toBeNull();
    const notices = await svc.from('document_expiry_notices').select('recipient_id').eq('document_id', docId);
    const recipients = new Set(((notices.data ?? []) as { recipient_id: string }[]).map((r) => r.recipient_id));
    expect(recipients.has(hrOfficer.id)).toBe(true);
    expect(recipients.has(manager.id)).toBe(true);
  } finally {
    if (docId) {
      ok('notices cleanup', await svc.from('document_expiry_notices').delete().eq('document_id', docId));
      sql(`delete from public.notifications where body ilike '%${personName.replace(/'/g, "''")}%' and title ilike '%${typeName.replace(/'/g, "''")}%';`);
      ok('document cleanup', await svc.from('expiry_documents').delete().eq('id', docId));
    }
    if (personId) ok('person cleanup', await svc.from('people').delete().eq('id', personId));
    if (typeId) ok('type cleanup', await svc.from('document_types').delete().eq('id', typeId));
    await manager.cleanup();
    await hrOfficer.cleanup();
  }
});
