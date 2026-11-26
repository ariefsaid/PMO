// @e2e-isolation: self-isolated — creates its own client, project, issued work order and inspection (with its purchase case and report object) and deletes only rows linked to this run in finally.
// AC-TPI-015 (#2580): a Project Manager requests a test on a work order, raises its purchase, records the invitation, the execution and an
// uploaded report, and the work-order page shows it complete with its cost. Goal oracle: the page reads "Reported", "Complete" and the
// committed cost of the purchase raised for it. Real browser, real database.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { orgToday } from './support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120_000);

test('AC-TPI-015 request, purchase, invitation, execution and report show the inspection complete with its cost', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-TPI-015 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'TPI-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const testName = 'Soil bearing test ' + suffix;
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
    const profile = await admin.from('profiles').select('org_id').eq('email', 'pm@acme.test').single();
    if (profile.error) throw new Error('AC-TPI-015 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-TPI-015 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Inspection project ' + suffix, status: 'Ongoing Project', currency: 'USD', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-TPI-015 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title: 'Inspected works ' + suffix, status: 'Issued', wo_number: 'WO-' + suffix,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    });
    if (wo.error) throw new Error('AC-TPI-015 fixture work order: ' + wo.error.message);

    await signIn(page, 'pm@acme.test');
    await page.goto('/work-orders/' + workOrderId);
    await openWorkOrderArea(page, 'checks');

    // request the test, required before billing
    await page.getByRole('button', { name: 'Request inspection' }).click();
    await page.getByLabel('What is being tested').fill(testName);
    await page.getByRole('checkbox', { name: 'billing' }).click();
    await page.getByRole('button', { name: 'Request', exact: true }).click();
    const card = page.getByTestId('wo-inspections').getByRole('listitem').filter({ hasText: testName });
    await expect(card.getByTestId('inspection-status')).toHaveText('Requested');
    await expect(page.getByTestId('inspections-billing-open')).toBeVisible();

    // raise the purchase: a Draft procurement case is created and linked
    await card.getByRole('button', { name: 'Raise purchase' }).click();
    // BQ9: raising creates a purchase, so it is confirmed first.
    await page.getByRole('dialog').getByRole('button', { name: 'Raise purchase' }).click();
    await expect(card.getByTestId('inspection-status')).toHaveText('Purchase raised');

    // procurement's own flow later records an order on that case: it lands on this work order (FR-TPI-021)
    const inspection = await admin.from('third_party_inspections').select('id, procurement_id').eq('work_order_id', workOrderId).single();
    if (inspection.error || !inspection.data.procurement_id) throw new Error('AC-TPI-015 purchase link missing: ' + inspection.error?.message);
    const po = await admin.from('purchase_orders').insert({
      org_id: orgId, procurement_id: inspection.data.procurement_id, po_number: 'PO-' + suffix, status: 'Issued',
      date: orgToday(), amount: 1000, currency: 'USD',
    });
    if (po.error) throw new Error('AC-TPI-015 fixture order: ' + po.error.message);

    await card.getByRole('button', { name: 'Record invitation' }).click();
    await expect(card.getByTestId('inspection-status')).toHaveText('Invited');
    await card.getByRole('button', { name: 'Record execution' }).click();
    await expect(card.getByTestId('inspection-status')).toHaveText('Executed');

    // the report: a file, then a result
    await expect(card.getByRole('button', { name: 'Mark reported' })).toBeDisabled();
    await card.getByTestId('inspection-file-input').setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e report') });
    await expect(card.getByRole('button', { name: 'report.pdf' })).toBeVisible();
    await card.getByLabel('Result').selectOption('pass');
    await card.getByRole('button', { name: 'Mark reported' }).click();

    await expect(card.getByTestId('inspection-status')).toHaveText('Reported');
    await expect(card.getByText('Complete')).toBeVisible();
    await expect(page.getByTestId('inspections-billing-open')).toHaveCount(0);
    await page.reload();
    await expect(card.getByTestId('inspection-cost')).toContainText(/1,000.*committed/);
  } catch (e) {
    failure = e;
  } finally {
    if (workOrderId) {
      const insp = await admin.from('third_party_inspections').select('id, procurement_id').eq('work_order_id', workOrderId);
      for (const i of insp.data ?? []) {
        const files = await admin.from('third_party_inspection_files').select('file_path').eq('inspection_id', i.id);
        const paths = (files.data ?? []).map((f) => f.file_path);
        await cleanup('delete report files', () => admin.from('third_party_inspection_files').delete().eq('inspection_id', i.id));
        if (paths.length) await cleanup('delete report objects', () => admin.storage.from('inspection-reports').remove(paths));
        await cleanup('delete inspection', () => admin.from('third_party_inspections').delete().eq('id', i.id));
        await cleanup('delete inspection history', () => admin.from('record_changes').delete().eq('entity_id', i.id));
        if (i.procurement_id) {
          await cleanup('delete orders', () => admin.from('purchase_orders').delete().eq('procurement_id', i.procurement_id));
          await cleanup('delete create intent', () => admin.from('procurement_create_intents').delete().eq('procurement_id', i.procurement_id));
          await cleanup('delete case history', () => admin.from('record_changes').delete().eq('parent_id', projectId));
          await cleanup('delete case', () => admin.from('procurements').delete().eq('id', i.procurement_id));
        }
      }
      await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    }
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-TPI-015 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-TPI-015 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
