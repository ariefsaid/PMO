// @e2e-isolation: self-isolated — owns its HR Officer login, person and medical document type; removes only its own records.
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { userClient } from './support/stockFixture';

test('AC-HRM-001 HR Officer records a person’s medical clearance and expiry on their record', async ({ page }) => {
  const svc = serviceClient('AC-HRM-001');
  const run = runId('medical');
  const actor = await roleJobUser(svc, 'hr_officer', run);
  const admin = await userClient('admin@acme.test');
  let personId = ''; let typeId = ''; const itemIds: string[] = [];
  try {
    // Admin creates the medical type; HR does not need document-type administration rights.
    typeId = need('medical type', await admin.from('document_types').insert({ name: run, applies_to: 'person', is_medical: true }).select('id').single()).id;
    personId = need('person', await admin.from('people').insert({ code: run, name: run, kind: 'own' }).select('id').single()).id;
    for (const [name, documentType] of [[`${run} papers`, null], [`${run} medical`, typeId], [`${run} induction`, null]] as const) {
      itemIds.push(need('checklist item', await admin.from('clearance_items').insert({ name, is_required: true, document_type_id: documentType }).select('id').single()).id);
    }
    await actor.signIn(page);
    await page.goto(`/equipment/people/${personId}`);
    await page.getByRole('button', { name: 'Add document', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add document' });
    await dialog.getByLabel('Document type').selectOption(typeId);
    await dialog.getByLabel('Medical status').selectOption('fit');
    await dialog.getByLabel('Expiry date').fill('2028-12-31');
    await dialog.getByRole('button', { name: 'Save document', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Fit', { exact: true })).toBeVisible();
    const stored = need('saved medical record', await svc.from('expiry_documents').select('is_medical,medical_status,expires_on').eq('person_id', personId).single());
    expect(stored).toEqual({ is_medical: true, medical_status: 'fit', expires_on: '2028-12-31' });
    await page.getByRole('link', { name: 'Open checklist', exact: true }).click();
    await page.getByRole('button', { name: `Record ${run} papers`, exact: true }).click();
    const papers = page.getByRole('dialog', { name: `${run} papers` });
    await papers.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(papers).toBeHidden();
    for (const name of ['papers', 'medical']) {
      await expect(page.getByRole('listitem').filter({ hasText: `${run} ${name}` }).getByText('Done', { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('listitem').filter({ hasText: `${run} induction` }).getByText('Not done', { exact: true })).toBeVisible();
  } finally {
    if (personId) { ok('checklist state cleanup', await svc.from('person_clearances').delete().eq('person_id', personId)); ok('documents cleanup', await svc.from('expiry_documents').delete().eq('person_id', personId)); ok('person cleanup', await svc.from('people').delete().eq('id', personId)); }
    if (itemIds.length) ok('checklist items cleanup', await svc.from('clearance_items').delete().in('id', itemIds));
    if (typeId) ok('type cleanup', await svc.from('document_types').delete().eq('id', typeId).eq('org_id', ORG_ID));
    await actor.cleanup();
  }
});
