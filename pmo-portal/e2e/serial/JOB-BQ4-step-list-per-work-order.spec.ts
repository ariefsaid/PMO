// @e2e-isolation: serial — flips the organisation-wide "edit issued work-order checklists" switch and the default billing step template; afterEach puts both back.
/**
 * JOB-BQ4 (billing lane): a step list per work order, from a template. An Admin turns on checklist editing; the billing officer
 * saves a template and uses it for new work orders; a new work order carries its steps, and adding one there changes only that
 * work order — the template is untouched until it is deliberately saved as a template.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { createJobRoleUser } from '../support/jobRoleUser';

test.setTimeout(240_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let workOrderId = '';
let companyId = '';
let templateId = '';
let savedTemplateIds: string[] = [];
// The logins go last: the templates, steps and orders they made reference their profiles, so deleting a login first fails.
let users: Awaited<ReturnType<typeof createJobRoleUser>>[] = [];
let priorChecklist = false;
let priorDefault: string | null = null;

test.beforeEach(async () => {
  admin = serviceClient('JOB-BQ4');
  const db = admin;
  const run = runId('bq4');
  companyId = need('client', await db.from('companies').insert({ org_id: ORG_ID, name: `${run} client`, type: 'Client' }).select('id').single()).id as string;
  projectId = need('project', await db.from('projects').insert({
    org_id: ORG_ID, name: run, status: 'Ongoing Project', currency: 'IDR', client_id: companyId, contract_value: 1_000_000,
    tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 0, tax_base_numerator: 1, tax_base_denominator: 1,
  }).select('id').single()).id as string;
  workOrderId = crypto.randomUUID();
  ok('work order', await db.from('work_orders').insert({
    id: workOrderId, org_id: ORG_ID, project_id: projectId, title: `${run} order`, status: 'Draft',
    order_value: 100_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR',
  }));
  const org = need('organisation', await db.from('organizations').select('work_order_checklist_enabled').eq('id', ORG_ID).single());
  priorChecklist = org.work_order_checklist_enabled as boolean;
  const settings = await db.from('org_billing_step_settings').select('default_template_id').eq('org_id', ORG_ID).maybeSingle();
  if (settings.error) throw new Error(`JOB-BQ4 fixture settings: ${settings.error.message}`);
  priorDefault = (settings.data?.default_template_id as string | null) ?? null;
  templateId = need('template', await db.from('billing_step_templates').insert({ org_id: ORG_ID, name: `BQ4 ${run}` }).select('id').single()).id as string;
  need('template step', await db.from('billing_step_template_steps').insert({ org_id: ORG_ID, template_id: templateId, position: 1, name: 'Prepare evidence' }).select('id').single());
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`JOB-BQ4 cleanup ${step}: ${e.message}`); };
  fail('restore switch', (await admin.from('organizations').update({ work_order_checklist_enabled: priorChecklist }).eq('id', ORG_ID)).error);
  fail('restore default', (await admin.from('org_billing_step_settings').upsert({ org_id: ORG_ID, default_template_id: priorDefault })).error);
  fail('templates', (await admin.from('billing_step_templates').delete().like('name', 'BQ4 %')).error);
  for (const id of savedTemplateIds) fail('saved template', (await admin.from('billing_step_templates').delete().eq('id', id)).error);
  if (projectId) {
    fail('steps', (await admin.from('work_order_billing_steps').delete().eq('project_id', projectId)).error);
    fail('work order', (await admin.from('work_orders').delete().eq('id', workOrderId)).error);
    fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  }
  if (companyId) fail('client', (await admin.from('companies').delete().eq('id', companyId)).error);
  const gone = users; users = [];
  for (const u of gone) await u.remove();
});

test('JOB-BQ4 a work order takes its steps from a template and an added step leaves the template unchanged', async ({ page }) => {
  const db = admin as SupabaseClient;
  const adminUser = await createJobRoleUser(db, ORG_ID, 'administrator');
  const billing = await createJobRoleUser(db, ORG_ID, 'billing_officer');
  users = [adminUser, billing];
  try {
    // 1. An Admin allows editing issued work-order checklists.
    await adminUser.signIn(page);
    await page.goto('/administration/accounting');
    const toggle = page.getByRole('switch', { name: /Edit issued work-order checklists/ });
    await toggle.scrollIntoViewIfNeeded();
    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // 2. The billing officer makes the template the one new work orders take, with its step.
    await page.context().clearCookies();
    await billing.signIn(page);
    await page.goto(`/projects/${projectId}/contract`);
    await page.getByRole('button', { name: 'Billing terms' }).click();
    const terms = page.getByRole('dialog');
    await terms.getByRole('button', { name: 'Manage templates' }).click();
    const templates = page.getByRole('dialog', { name: 'Billing step templates' });
    const row = templates.getByRole('listitem').filter({ hasText: `BQ4 ` });
    await expect(row).toContainText('1 step');
    await row.getByRole('button', { name: /Use BQ4 .* for new work orders/ }).click();
    await expect(row.getByTestId('default-step-template')).toBeVisible({ timeout: 15_000 });
    await templates.getByRole('button', { name: 'Done' }).click();
    await expect(terms).toBeHidden();

    // 3. A newly issued work order carries that list; the billing officer adds one step to it.
    await db.from('work_orders').update({ status: 'Issued', issued_at: new Date().toISOString() }).eq('id', workOrderId).throwOnError();
    await page.goto(`/work-orders/${workOrderId}`);
    const steps = page.getByTestId('wo-billing-steps');
    await expect(steps.getByRole('listitem', { name: 'Prepare evidence' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Add step' }).click();
    await page.getByLabel('Step name').fill('Check retention');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(steps.getByRole('listitem', { name: 'Check retention' })).toBeVisible({ timeout: 15_000 });

    // 4. The template is unchanged: it still holds only its own step.
    await page.goto(`/projects/${projectId}/contract`);
    await page.getByRole('button', { name: 'Billing terms' }).click();
    const terms2 = page.getByRole('dialog');
    await terms2.getByRole('button', { name: 'Manage templates' }).click();
    const templates2 = page.getByRole('dialog', { name: 'Billing step templates' });
    await expect(templates2.getByRole('listitem').filter({ hasText: 'BQ4 ' })).toContainText('1 step');
    await templates2.getByRole('button', { name: 'Done' }).click();
    await expect(terms2).toBeHidden();

    // 5. Saved deliberately, the work order's own list becomes a template of its own.
    await page.goto(`/work-orders/${workOrderId}`);
    await page.getByRole('button', { name: 'Save as template' }).click();
    const save = page.getByRole('dialog', { name: 'Save as template' });
    await save.getByLabel('Template name').fill('BQ4 saved two steps');
    await save.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByTestId('wo-billing-step-template-saved')).toContainText('BQ4 saved two steps', { timeout: 15_000 });
    const saved = need('saved template', await db.from('billing_step_templates').select('id').eq('org_id', ORG_ID).eq('name', 'BQ4 saved two steps').single());
    savedTemplateIds = [saved.id as string];
    const savedSteps = need('saved template steps', await db.from('billing_step_template_steps').select('id').eq('template_id', saved.id as string));
    expect(savedSteps.length).toBe(2);
  } finally {
    // (the logins are removed in afterEach, after the rows they made)
  }
});
