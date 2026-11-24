// @e2e-isolation: serial — saves the organisation-wide billing plan target; afterEach deletes the settings row it made and archives its project.
/**
 * JOB-BQ6 (billing lane): which claims to bill this month. Three work orders carry progress the client accepted and nobody has
 * claimed; the billing officer picks two and sets the month's target, and the plan shows the picked total against it.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { createJobRoleUser } from './support/jobRoleUser';

test.setTimeout(180_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let companyId = '';
let priorSettings: Record<string, unknown> | null = null;

test.beforeEach(async () => {
  admin = serviceClient('JOB-BQ6');
  const run = runId('bq6');
  companyId = need('client', await admin.from('companies').insert({ org_id: ORG_ID, name: `${run} client`, type: 'Client' }).select('id').single()).id as string;
  projectId = need('project', await admin.from('projects').insert({
    org_id: ORG_ID, name: run, status: 'Ongoing Project', currency: 'IDR', client_id: companyId,
    contract_value: 100_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12, tax_base_numerator: 11, tax_base_denominator: 12,
  }).select('id').single()).id as string;
  const finance = need('finance profile', await admin.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single());
  // Three work orders, each with accepted-but-unclaimed progress: 12 × 1,000 = 12,000 each.
  for (const [i, label] of ['first', 'second', 'third'].entries()) {
    const boqId = need(`${label} line`, await admin.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: `BQ6-${i + 1}`, description: `${run} ${label} item`, unit: 'm', quantity: 100, rate: 1000, earning_basis: 'unit_rate', line_no: i + 1,
    }).select('id').single()).id as string;
    const workOrderId = crypto.randomUUID();
    ok(`${label} order`, await admin.from('work_orders').insert({
      id: workOrderId, org_id: ORG_ID, project_id: projectId, title: `${run} ${label} order`, wo_number: `WO-${run}-${i + 1}`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 100_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR',
    }));
    ok(`${label} allocation`, await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: boqId, quantity: 20 }));
    const acceptanceId = need(`${label} acceptance`, await admin.from('work_order_acceptances').insert({
      org_id: ORG_ID, project_id: projectId, work_order_id: workOrderId, acceptance_date: new Date().toISOString().slice(0, 10),
      is_final: false, status: 'Confirmed', prepared_by: finance.id, confirmed_by: finance.id, confirmed_at: new Date().toISOString(), confirm_basis: 'standard',
    }).select('id').single()).id as string;
    ok(`${label} acceptance line`, await admin.from('work_order_acceptance_lines').insert({ acceptance_id: acceptanceId, boq_item_id: boqId, quantity: 12 }));
  }
  const prior = await admin.from('org_billing_plan_settings').select('*').eq('org_id', ORG_ID).maybeSingle();
  priorSettings = prior.data ?? null;
  await admin.from('org_billing_plan_settings').delete().eq('org_id', ORG_ID);
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`JOB-BQ6 cleanup ${step}: ${e.message}`); };
  fail('month targets', (await admin.from('billing_plan_month_targets').delete().eq('org_id', ORG_ID)).error);
  fail('settings', (await admin.from('org_billing_plan_settings').delete().eq('org_id', ORG_ID)).error);
  if (priorSettings) fail('restore settings', (await admin.from('org_billing_plan_settings').insert(priorSettings)).error);
  // A confirmed acceptance is permanent by design, so the project is archived instead: its work leaves every plan.
  if (projectId) fail('archive project', (await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId)).error);
  if (companyId) fail('client', (await admin.from('companies').delete().eq('id', companyId)).error);
});

test('JOB-BQ6 the billing officer picks two of three accepted work orders and the plan shows the picked total against the target', async ({ page }) => {
  const db = admin as SupabaseClient;
  const billing = await createJobRoleUser(db, ORG_ID, 'billing_officer');
  try {
    await billing.signIn(page);
    await page.goto(`/finance/billing-plan?project=${projectId}`);
    await expect(page.getByTestId('billing-plan-target')).toContainText(/No target set/, { timeout: 15_000 });

    // The month's target.
    await page.getByTestId('billing-plan-settings-button').click();
    const settings = page.getByRole('dialog');
    await settings.getByLabel(/Default monthly target/).fill('30000');
    await settings.getByLabel(/^Currency/).fill('IDR');
    await settings.getByRole('button', { name: /Save settings/ }).click();
    await expect(settings).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId('billing-plan-target')).toContainText(/30[.,]000/);

    // Three candidates; pick two.
    const lines = page.getByTestId('billing-plan-line');
    await expect(lines).toHaveCount(3, { timeout: 15_000 });
    await lines.nth(0).getByRole('checkbox').click();
    await lines.nth(1).getByRole('checkbox').click();
    await expect(page.getByTestId('billing-plan-picked')).toContainText(/24[.,]000/);
    await expect(page.getByTestId('billing-plan-remaining')).toContainText(/6[.,]000/);
    await expect(page.getByTestId('billing-plan-summary')).toContainText(/Left to target/);
  } finally {
    await billing.remove();
  }
});
