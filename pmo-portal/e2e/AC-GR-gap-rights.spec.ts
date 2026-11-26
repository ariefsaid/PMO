// @e2e-isolation: self-isolated — disposable organisation and job-role logins.
import { test, expect } from '@playwright/test';
import { serviceClient, need } from './support/jobFixtures';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';
test.setTimeout(120_000);
test('AC-GR-001 Equipment Officer registers a machine on the asset register', async ({ page }) => {
  const db = serviceClient('AC-GR');
  const org = need('org', await db.from('organizations').insert({ name: `Register ${crypto.randomUUID()}`, built_in_roles_enabled: true }).select('id').single());
  const officer = await createJobRoleUser(db, org.id, 'equipment_officer');
  try {
    await officer.signIn(page);
    await page.goto('/equipment/assets');
    await page.getByTestId('list-page-header').getByRole('button', { name: 'New asset' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/^Code/).fill('GR-001');
    await form.getByLabel(/^Name/).fill('Registered machine');
    await form.getByRole('button', { name: 'Create asset' }).click();
    await expect(page.getByRole('link', { name: 'Open Registered machine' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('link', { name: 'Open Registered machine' })).toBeVisible();
    await page.getByRole('button', { name: /row actions/i }).click();
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page.getByRole('dialog').getByLabel(/^Name/).fill('Updated machine');
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Open Updated machine' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('link', { name: 'Open Updated machine' })).toBeVisible();
  } finally { removeJobOrganization(org.id); await officer.remove(); }
});
test('AC-GR-002 Project Control Manager reads another managers catalogue prices', async ({ page }) => {
  const db = serviceClient('AC-GR');
  const org = need('org', await db.from('organizations').insert({ name: `Catalogue ${crypto.randomUUID()}`, built_in_roles_enabled: true }).select('id').single());
  const pcm = await createJobRoleUser(db, org.id, 'project_control_manager');
  const manager = await createJobRoleUser(db, org.id, 'project_manager');
  try {
    const project = need('project', await db.from('projects').insert({ org_id: org.id, name: 'Catalogue project', status: 'Ongoing Project', currency: 'USD', contract_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, project_manager_id: manager.id }).select('id').single());
    const item = need('item', await db.from('rate_catalogue_items').insert({ org_id: org.id, project_id: project.id, item_code: 'GR-RATE', description: 'Catalogue work', unit: 'm' }).select('id').single());
    const variant = need('variant', await db.from('rate_catalogue_variants').insert({ org_id: org.id, project_id: project.id, name: 'Remote location' }).select('id').single());
    const rates = await db.from('rate_catalogue_rates').insert({ org_id: org.id, item_id: item.id, variant_id: variant.id, rate: 120, effective_from: '2026-01-01' });
    if (rates.error) throw rates.error;
    await pcm.signIn(page);
    await page.goto(`/projects/${project.id}/contract`);
    await page.getByRole('button', { name: 'Rate catalogue', exact: true }).click();
    const catalogue = page.getByRole('region', { name: 'Rate catalogue' });
    await expect(catalogue.getByRole('rowheader', { name: 'GR-RATE Catalogue work' })).toBeVisible();
    await expect(catalogue.getByRole('cell', { name: 'Remote location' })).toBeVisible();
    await expect(catalogue.getByRole('cell', { name: /120/ })).toBeVisible();
    await expect(catalogue.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
  } finally { removeJobOrganization(org.id); await pcm.remove(); await manager.remove(); }
});
