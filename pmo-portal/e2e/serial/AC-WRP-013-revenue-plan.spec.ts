// @e2e-isolation: serial — switches the organisation-wide revenue-plan setting on for the run (an org-global singleton) and restores it in finally.
// AC-WRP-013 — Finance on a phone enters a month amount on a work order; the work-order page and the project roll-up show the same plan to date and gap.
// Goal oracle: the plan figure the user typed is what both screens report as plan to date, and the gap reads as "behind plan".
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pinEnglishLocale, requireServiceRoleKey, signIn } from '../helpers';
import { formatExactMoney } from '../../src/lib/format';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

test.setTimeout(90_000);
test.use({ viewport: { width: 390, height: 844 } });

test('AC-WRP-013 a month plan entered on the work order shows the same plan to date and gap on the project page', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WRP-013 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'WRP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  let companyId = '';
  let projectId = '';
  let workOrderId = '';
  let orgId = '';
  let hadSettings = true;
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };
  try {
    const profile = await admin.from('profiles').select('org_id').eq('email', 'finance@acme.test').single();
    if (profile.error) throw new Error('AC-WRP-013 fixture profile: ' + profile.error.message);
    orgId = profile.data.org_id;
    const existing = await admin.from('org_revenue_plan_settings').select('org_id').eq('org_id', orgId).maybeSingle();
    hadSettings = Boolean(existing.data);
    const on = await admin.from('org_revenue_plan_settings').upsert({ org_id: orgId, enabled: true, working_weekdays: [1, 2, 3, 4, 5] });
    if (on.error) throw new Error('AC-WRP-013 fixture setting: ' + on.error.message);
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WRP-013 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Plan project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-WRP-013 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title: 'Plan WO ' + suffix, client_po_number: 'PO-' + suffix, status: 'Issued', wo_number: 'WO-' + suffix,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (wo.error) throw new Error('AC-WRP-013 fixture work order: ' + wo.error.message);

    await pinEnglishLocale(page);
    await signIn(page, 'finance@acme.test');
    await page.goto('/work-orders/' + workOrderId);
    const section = page.getByTestId('wo-page-revenue-plan');
    await expect(section).toBeVisible({ timeout: 15_000 });
    await expect(section.getByTestId('wo-revenue-plan-gap')).toHaveText('No plan entered');
    await section.getByRole('button', { name: 'Enter plan' }).click();
    // The month list runs from six months back; index 5 is last month, wholly in the past, so plan to date is the whole amount.
    await page.getByLabel('Month').selectOption({ index: 5 });
    await page.getByLabel(/Amount/).fill('1000.00');
    await page.getByRole('button', { name: 'Save plan' }).click();
    const expectedPlan = formatExactMoney('1000.00', 'EUR', 'en-US') ?? 'unformattable';
    await expect(section.getByTestId('wo-revenue-plan-plan')).toHaveText(expectedPlan);
    await expect(section.getByTestId('wo-revenue-plan-gap')).toHaveText(expectedPlan + ' behind plan');

    await page.goto('/projects/' + projectId + '/contract');
    const row = page.getByTestId('revenue-plan-row-' + workOrderId);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(expectedPlan);
    await expect(row).toContainText(expectedPlan + ' behind plan');
  } catch (e) {
    failure = e;
  } finally {
    if (workOrderId) await cleanup('delete plan', () => admin.from('work_order_revenue_plan').delete().eq('work_order_id', workOrderId));
    if (workOrderId) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
    if (orgId && !hadSettings) await cleanup('restore setting', () => admin.from('org_revenue_plan_settings').delete().eq('org_id', orgId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-WRP-013 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-WRP-013 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
