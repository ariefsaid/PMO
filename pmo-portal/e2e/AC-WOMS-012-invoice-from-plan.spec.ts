// @e2e-isolation: self-isolated — creates a unique local client, project, and issued work order; deletes only rows linked to this run in finally.
// AC-WOMS-012 — the plan shows the client's work order as a billing milestone and "Invoice this" opens the shipped
// invoice-from-work-order flow; saving it moves the milestone to In progress. Goal oracle: a Draft linked to the WO.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { formatMoneyInputValue } from '../src/lib/format';

test.setTimeout(60_000);

const localized = (en: string, id: string) => new RegExp('(?:' + en + '|' + id + ')', 'i');

test('AC-WOMS-012 Finance invoices a work order from the project plan', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WOMS-012 requires the local fixture service client');
  const localUrl = requireMatchingLocalSupabaseUrls(undefined, undefined);
  const admin: SupabaseClient = createClient(localUrl, serviceKey, { auth: { persistSession: false } });
  const suffix = 'WOMS-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const workOrderNumber = 'WO-' + suffix;
  const amount = 250_000;
  let companyId = '';
  let projectId = '';
  let workOrderId = '';
  let testFailed = false;
  let testFailure: unknown;
  const cleanupFailures: string[] = [];

  const runCleanup = async (label: string, operation: () => PromiseLike<{ error: { message: string } | null }>) => {
    try {
      const result = await operation();
      if (result.error) cleanupFailures.push(label + ': ' + result.error.message);
    } catch (error) {
      cleanupFailures.push(label + ': ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  try {
    const profile = await admin.from('profiles').select('org_id').eq('email', 'finance@acme.test').single();
    if (profile.error) throw new Error('AC-WOMS-012 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;

    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WOMS-012 fixture client: ' + company.error.message);
    companyId = company.data.id;

    const project = await admin.from('projects')
      .insert({
        org_id: orgId, name: 'Plan project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
        contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
        tax_base_numerator: 1, tax_base_denominator: 1,
      })
      .select('id')
      .single();
    if (project.error) throw new Error('AC-WOMS-012 fixture project: ' + project.error.message);
    projectId = project.data.id;

    workOrderId = crypto.randomUUID();
    const workOrder = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title: 'Plan milestone ' + suffix, client_po_number: 'PO-' + suffix,
      status: 'Issued', wo_number: workOrderNumber, issued_at: new Date().toISOString(), order_value: 1_000_000,
      tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (workOrder.error) throw new Error('AC-WOMS-012 fixture work order: ' + workOrder.error.message);

    await signIn(page, 'finance@acme.test');
    // The local fixture runs native revenue mode; keep ERP resource traffic out of this journey.
    await page.route('**/api/resource/**', (route) => route.abort());

    await page.goto('/projects/' + projectId + '/overview');
    const milestone = page.getByTestId('billing-milestone-' + workOrderId);
    await expect(milestone.getByText(localized('Planned', 'Direncanakan'))).toBeVisible();
    await milestone.getByRole('link', { name: localized('Invoice ' + workOrderNumber, 'Tagih ' + workOrderNumber) }).click();

    // The hand-off lands on Contract & billing for that work order and spends its one-shot flag.
    await expect(page).toHaveURL((url) => url.pathname === `/projects/${projectId}/contract`
      && url.searchParams.get('wo') === workOrderId && !url.searchParams.has('invoice'));
    const form = page.getByRole('dialog');
    await expect(form.getByRole('heading', { name: localized('Invoice this work order', 'Tagih Work Order ini') })).toBeVisible();
    const amountField = form.getByLabel(/amount \(excl\. PPN\)|jumlah \(belum termasuk PPN\)/i);
    // Nothing is invoiced yet, so what is left on this work order is its whole value.
    await expect(amountField).toHaveValue(formatMoneyInputValue(1_000_000, 'en-US'));
    await amountField.fill(String(amount));
    await form.getByRole('button', { name: /create draft invoice|buat draf faktur/i }).click();
    await expect(form).toBeHidden();

    const saved = await admin.from('sales_invoices').select('work_order_id,status,amount').eq('work_order_id', workOrderId).single();
    if (saved.error) throw new Error('AC-WOMS-012 persisted draft: ' + saved.error.message);
    expect(saved.data).toMatchObject({ work_order_id: workOrderId, status: 'Draft' });
    expect(Number(saved.data.amount)).toBe(amount);

    await page.goto('/projects/' + projectId + '/overview');
    await expect(page.getByTestId('billing-milestone-' + workOrderId).getByText(localized('In progress', 'Berjalan'))).toBeVisible();
  } catch (error) {
    testFailed = true;
    testFailure = error;
  } finally {
    if (projectId) {
      let invoiceIds: string[] = [];
      try {
        const invoices = await admin.from('sales_invoices').select('id').eq('project_id', projectId);
        if (invoices.error) cleanupFailures.push('read invoices: ' + invoices.error.message);
        invoiceIds = (invoices.data ?? []).map((row: { id: string }) => row.id);
      } catch (error) {
        cleanupFailures.push('read invoices: ' + (error instanceof Error ? error.message : String(error)));
      }
      if (invoiceIds.length > 0) {
        await runCleanup('delete receipts', () => admin.from('incoming_payments').delete().in('sales_invoice_id', invoiceIds));
      }
      await runCleanup('delete invoices', () => admin.from('sales_invoices').delete().eq('project_id', projectId));
    }
    if (workOrderId) await runCleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) await runCleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await runCleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
  }

  if (cleanupFailures.length > 0) {
    const cleanupError = new Error('AC-WOMS-012 cleanup failed: ' + cleanupFailures.join('; '));
    if (testFailed) throw new AggregateError([testFailure, cleanupError], 'AC-WOMS-012 failed and cleanup reported errors');
    throw cleanupError;
  }
  if (testFailed) throw testFailure;
});
