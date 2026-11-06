// @e2e-isolation: self-isolated — creates its own project with an Active and a Draft budget each run, never touches a shared seed row, and archives the project afterwards.
/** AC-009 — goal: rows pasted from a spreadsheet land in the selected Draft at the reviewed amounts and leave the Active budget alone. */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pinEnglishLocale, requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import type { Database } from '../src/lib/supabase/database.types';

test('AC-009 pasted direct and quantity × rate rows are saved to the Draft and the Active budget is unchanged', async ({ page }, testInfo) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-009 requires the local fixture service client');
  const url = requireMatchingLocalSupabaseUrls(undefined, undefined);
  const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });
  const suffix = `PASTE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const projectId = crypto.randomUUID();

  try {
    const pm = await admin.from('profiles').select('id, org_id').eq('email', 'pm@acme.test').single().throwOnError();
    const orgId = pm.data.org_id;
    await admin.from('projects').insert({
      id: projectId, org_id: orgId, name: `Paste rows project ${suffix}`, status: 'Ongoing Project', currency: 'IDR',
      project_manager_id: pm.data.id,
    }).throwOnError();
    const active = await admin.from('budget_versions').insert({ org_id: orgId, project_id: projectId, name: `Active ${suffix}`, version: 1, status: 'Draft', currency: 'IDR' }).select('id').single().throwOnError();
    await admin.from('budget_line_items').insert({ org_id: orgId, budget_version_id: active.data.id, category: 'Labor', description: 'Approved labor', budgeted_amount: 5000 }).throwOnError();
    await admin.from('budget_versions').update({ status: 'Active' }).eq('id', active.data.id).throwOnError();
    const draft = await admin.from('budget_versions').insert({ org_id: orgId, project_id: projectId, name: `Draft ${suffix}`, version: 2, status: 'Draft', currency: 'IDR' }).select('id').single().throwOnError();
    await admin.from('budget_line_items').insert({ org_id: orgId, budget_version_id: draft.data.id, category: 'Labor', description: 'Existing draft line', budgeted_amount: 100 }).throwOnError();

    await pinEnglishLocale(page);
    await signIn(page, 'pm@acme.test');
    await page.goto(`/projects/${projectId}/budget`);
    await page.getByRole('button', { name: 'Edit draft' }).click();
    await page.getByRole('button', { name: 'Paste rows' }).click();
    const dialog = page.getByRole('dialog', { name: 'Paste rows' });

    // Direct amounts: column 3 is the amount. Grouped thousands are accepted; the unknown category is mapped by the user.
    await dialog.getByRole('textbox', { name: /Rows pasted from a spreadsheet/ }).fill('Labor\tDesign work\t1,500.50\nSite kit\tCement\t2000');
    await dialog.getByRole('combobox', { name: /Map "Site kit" to/ }).selectOption('Materials');
    await expect(dialog.getByTestId('paste-summary')).toContainText('2 valid, 0 invalid');
    await dialog.getByRole('button', { name: 'Save 2 valid rows' }).click();
    await expect(dialog.getByTestId('paste-result-summary')).toContainText('2 of 2 rows saved.', { timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('paste-direct-saved.png') });
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    // Quantity × Rate: the product is exact (2.5 × 3.3 = 8.25).
    await page.getByRole('button', { name: 'Paste rows' }).click();
    const second = page.getByRole('dialog', { name: 'Paste rows' });
    await second.getByRole('textbox', { name: /Rows pasted from a spreadsheet/ }).fill('Equipment\tCrane hire\t2.5\t3.3');
    await second.getByRole('combobox', { name: 'Amount column' }).selectOption({ label: 'Not used' });
    await second.getByRole('combobox', { name: 'Quantity column' }).selectOption({ label: 'Col 3' });
    await second.getByRole('combobox', { name: 'Rate column' }).selectOption({ label: 'Col 4' });
    await expect(second.getByRole('radio', { name: 'Use Quantity × Rate' })).toBeChecked();
    await expect(second.getByTestId('paste-summary')).toContainText('1 valid, 0 invalid');
    await second.getByRole('button', { name: 'Save 1 valid row' }).click();
    await expect(second.getByTestId('paste-result-summary')).toContainText('1 of 1 rows saved.', { timeout: 15_000 });
    await second.getByRole('button', { name: 'Done' }).click();

    // Reload: the Draft holds the original and the three new lines at the reviewed total; the Active version is untouched.
    await page.reload();
    await page.getByRole('button', { name: 'Edit draft' }).click();
    const editor = page.getByTestId('budget-draft-editor');
    for (const text of ['Existing draft line', 'Design work', 'Cement', 'Crane hire']) await expect(editor).toContainText(text);
    await expect(page.getByTestId('budget-edit-total')).toContainText('3,608.75');
    await page.screenshot({ path: testInfo.outputPath('paste-reloaded-draft.png'), fullPage: true });

    const draftLines = await admin.from('budget_line_items').select('category, budgeted_amount, fiscal_year').eq('budget_version_id', draft.data.id).throwOnError();
    expect(draftLines.data).toHaveLength(4);
    expect(draftLines.data.reduce((sum, line) => sum + Math.round(Number(line.budgeted_amount) * 100), 0)).toBe(360_875);
    expect(draftLines.data.every((line) => line.fiscal_year === null)).toBe(true);
    const activeAfter = await admin.from('budget_versions').select('status, budget_line_items(budgeted_amount)').eq('id', active.data.id).single().throwOnError();
    expect(activeAfter.data.status).toBe('Active');
    expect(activeAfter.data.budget_line_items.map((line) => Number(line.budgeted_amount))).toEqual([5000]);
    // The effective project budget is the Active version's total; the Draft rows do not move it.
    const effective = await admin.rpc('get_project_budget', { p_project_id: projectId }).throwOnError();
    expect(Number(effective.data)).toBe(5000);
    const draftAfter = await admin.from('budget_versions').select('status').eq('id', draft.data.id).single().throwOnError();
    expect(draftAfter.data.status).toBe('Draft');
  } finally {
    await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId).throwOnError();
  }
});
