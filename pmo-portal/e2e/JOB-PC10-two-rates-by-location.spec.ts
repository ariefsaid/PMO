// @e2e-isolation: self-isolated — creates its own project with a two-rate catalogue item; deletes it (and its lines) in afterEach.
// JOB-PC10 (project control): two rates per item, by area. A catalogue item carries a remote and a non-remote rate; adding it as a contract line
// at the remote location takes the remote rate. PARTLY LANDED: the location is chosen on the line, there is no "area of the work order" field yet.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickComboboxOption, signIn } from './helpers';
import { cleanupAll, need, ok, ORG_ID, runId, serviceClient } from './support/jobFixtures';

test.setTimeout(120_000);

let admin: SupabaseClient;
let projectId = '';

test.afterEach(async () => {
  if (!admin) return;
  await cleanupAll(admin, [['boq_items', 'project_id', projectId ? [projectId] : []]]);
  // Catalogue rows and the project go together (the project FK cascades the catalogue).
  await cleanupAll(admin, [['projects', 'id', projectId ? [projectId] : []]]);
  projectId = '';
});

test('JOB-PC10 a catalogue line added at the remote location takes the remote rate', async ({ page }) => {
  admin = serviceClient('JOB-PC10');
  const run = runId('JOBPC10');
  projectId = need('project', await admin.from('projects').insert({ org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD' }).select('id').single()).id;
  const remote = need('remote', await admin.from('rate_catalogue_variants').insert({ org_id: ORG_ID, project_id: projectId, name: 'Remote' }).select('id').single()).id;
  const nonRemote = need('non-remote', await admin.from('rate_catalogue_variants').insert({ org_id: ORG_ID, project_id: projectId, name: 'Non-remote', is_default: true }).select('id').single()).id;
  const item = need('item', await admin.from('rate_catalogue_items').insert({ org_id: ORG_ID, project_id: projectId, item_code: `${run}-WELD`, description: `${run} butt weld`, unit: 'inch' }).select('id').single()).id;
  ok('rates', await admin.from('rate_catalogue_rates').insert([
    { org_id: ORG_ID, item_id: item, variant_id: remote, rate: 120, effective_from: '2026-01-01' },
    { org_id: ORG_ID, item_id: item, variant_id: nonRemote, rate: 100, effective_from: '2026-01-01' },
  ]));

  await signIn(page, 'finance@acme.test');
  await page.goto(`/projects/${projectId}/contract`);
  await page.getByRole('button', { name: 'Edit lines' }).click({ timeout: 30_000 });
  await page.getByRole('button', { name: /^add line$/i }).click();
  const dialog = page.getByRole('dialog');
  await pickComboboxOption(dialog, page, /catalogue item/i, new RegExp(`${run}-WELD`));
  await dialog.getByLabel(/^location/i).selectOption({ label: 'Remote' });
  await expect(dialog.getByText(/Rate:.*120\.00/)).toBeVisible();
  await dialog.getByLabel('ERP item').fill(`${run}-WELD`);
  await dialog.getByLabel('Description').fill('Butt weld');
  await dialog.getByLabel('Unit').fill('inch');
  await dialog.getByLabel(/quantity/i).fill('10');
  await dialog.getByRole('button', { name: /save line/i }).click();
  // The saved line carries the remote rate, not the non-remote one.
  await expect.poll(async () => (await admin.from('boq_items').select('id').eq('project_id', projectId)).data?.length, { timeout: 20_000 }).toBe(1);
  const line = need('line', await admin.from('boq_items').select('rate, catalogue_variant_id').eq('project_id', projectId).single());
  expect(Number(line.rate)).toBe(120);
  expect(line.catalogue_variant_id).toBe(remote);
});
