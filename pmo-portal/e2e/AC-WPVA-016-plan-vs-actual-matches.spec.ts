// @e2e-isolation: self-isolated — creates a unique local client, project and issued work order; deletes only rows linked to this run in finally.
// AC-WPVA-016 — a work order opened from the project tab shows the same plan-vs-actual as the project tab's row.
// Goal oracle: the work-order page's direct cost, shared cost and result figures equal the project tab row's.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pinEnglishLocale, requireServiceRoleKey, signIn } from './helpers';
import { formatExactMoney } from '../src/lib/format';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(60_000);

test('AC-WPVA-016 the work-order page plan-vs-actual matches the project tab row', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WPVA-016 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'WPVA-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const number = 'WO-' + suffix;
  const title = 'Page journey ' + suffix;
  let companyId = '';
  let projectId = '';
  let workOrderId = '';
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };

  try {
    const profile = await admin.from('profiles').select('org_id').eq('email', 'finance@acme.test').single();
    if (profile.error) throw new Error('AC-WPVA-016 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WPVA-016 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Page project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-WPVA-016 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title, client_po_number: 'PO-' + suffix, status: 'Issued', wo_number: number,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (wo.error) throw new Error('AC-WPVA-016 fixture work order: ' + wo.error.message);

    const plan = await admin.from('work_order_plan_lines').insert([
      { org_id: orgId, project_id: projectId, work_order_id: workOrderId, discipline_id: null, kind: 'direct_budget', value: 5000 },
      { org_id: orgId, project_id: projectId, work_order_id: workOrderId, discipline_id: null, kind: 'indirect_budget', value: 700 },
    ]);
    if (plan.error) throw new Error('AC-WPVA-016 fixture plan: ' + plan.error.message);

    await pinEnglishLocale(page);
    await signIn(page, 'finance@acme.test');
    await page.route('**/api/resource/**', (route) => route.abort());
    await page.goto('/projects/' + projectId + '/contract');
    const row = page.getByTestId('wo-pva-row-' + workOrderId);
    await expect(row).toBeVisible();
    // The amount is each cell's first line; a variance note may follow it (the page also notes shared cost against its plan).
    const amountOf = async (testId: string) => (await row.getByTestId(testId).innerText()).split('\n')[0].trim();
    const sameAmount = (amount: string) => new RegExp('^' + amount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\d.,])');
    const tab = {
      direct: sameAmount(await amountOf('wo-pva-direct')),
      allocated: sameAmount(await amountOf('wo-pva-allocated')),
      result: sameAmount(await amountOf('wo-pva-result')),
    };
    await page.getByTestId('wo-page-link-' + workOrderId).click();

    await expect(page).toHaveURL((url) => url.pathname === '/work-orders/' + workOrderId);
    const panel = page.getByTestId('wo-page-pva');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('wo-page-pva-plan-direct')).toHaveText(formatExactMoney('5000.00', 'EUR', 'en-US') ?? 'unformattable');
    await expect(panel.getByTestId('wo-page-pva-direct')).toHaveText(tab.direct);
    await expect(panel.getByTestId('wo-page-pva-allocated')).toHaveText(tab.allocated);
    await expect(panel.getByTestId('wo-page-pva-result')).toHaveText(tab.result);
  } catch (e) {
    failure = e;
  } finally {
    if (workOrderId) await cleanup('delete plan', () => admin.from('work_order_plan_lines').delete().eq('work_order_id', workOrderId));
    if (workOrderId) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-WPVA-016 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-WPVA-016 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
