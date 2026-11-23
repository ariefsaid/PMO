// @e2e-isolation: self-isolated — creates a unique local client, project, issued work order and one billing step; deletes only rows linked to this run in finally.
// AC-WOD-008 (#2805) — a person running a contract of many work orders reaches the work-order level from the top of the
// project page and from the work-order dashboard, sees each order's state (billed against its value, what is late), narrows
// to what is late, and opens the work order. Goal oracle: the URL is /work-orders/<id> and the page names that work order.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(60_000);

test('AC-WOD-008 the work-order level is one click from the project header and from the dashboard, late first, and a row opens the work order', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WOD-008 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'WOD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const number = 'WO-' + suffix;
  const title = 'Dashboard journey ' + suffix;
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
    if (profile.error) throw new Error('AC-WOD-008 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WOD-008 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Dashboard project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-WOD-008 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title, client_po_number: 'PO-' + suffix, status: 'Issued', wo_number: number,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (wo.error) throw new Error('AC-WOD-008 fixture work order: ' + wo.error.message);
    const started = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const step = await admin.from('work_order_billing_steps').insert({
      org_id: orgId, work_order_id: workOrderId, project_id: projectId, position: 1, name: 'Measurement sheet', target_days: 5, started_on: started,
    });
    if (step.error) throw new Error('AC-WOD-008 fixture billing step: ' + step.error.message);

    await signIn(page, 'finance@acme.test');
    await page.route('**/api/resource/**', (route) => route.abort());
    // From the project: the work orders are the second tab, under the header, not below the contract.
    await page.goto('/projects/' + projectId);
    await page.getByTestId('project-section-tabs').getByRole('tab', { name: 'Work order' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/projects/' + projectId + '/orders');
    const projectRow = page.getByRole('row', { name: new RegExp(number) });
    await expect(projectRow.getByTestId('wo-billed-' + workOrderId)).toContainText('500,000');
    await expect(projectRow.getByTestId('wo-missing-' + workOrderId)).toContainText('1 late');

    // From the dashboard: every work order, narrowed to what is late, then to this one.
    await page.goto('/work-orders');
    await page.getByRole('tab', { name: 'Late' }).click();
    await page.getByRole('searchbox').fill(suffix);
    const row = page.getByRole('row', { name: new RegExp(number) });
    await expect(row.getByTestId('wo-missing-' + workOrderId)).toContainText('1 late');
    await row.getByRole('link', { name: 'Open ' + number }).click();

    await expect(page).toHaveURL((url) => url.pathname === '/work-orders/' + workOrderId);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(number);
    await expect(page.getByText(title)).toBeVisible();
  } catch (e) {
    failure = e;
  } finally {
    if (workOrderId) await cleanup('delete billing step', () => admin.from('work_order_billing_steps').delete().eq('work_order_id', workOrderId));
    if (workOrderId) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-WOD-008 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-WOD-008 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
