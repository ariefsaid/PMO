// @e2e-isolation: self-isolated — creates a unique local client, project and issued work order; deletes only rows linked to this run in finally.
// AC-WORP-004 — from a sales invoice a Finance user opens the work order's own page. Goal oracle: the URL is
// /work-orders/<id> and the page names that work order (number, title) and its project.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(60_000);

test('AC-WORP-004 a sales invoice opens its work-order page', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WORP-004 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'WORP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const number = 'WO-' + suffix;
  const title = 'Page journey ' + suffix;
  let companyId = '';
  let projectId = '';
  let workOrderId = '';
  let invoiceId = '';
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };

  try {
    const profile = await admin.from('profiles').select('org_id').eq('email', 'finance@acme.test').single();
    if (profile.error) throw new Error('AC-WORP-004 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WORP-004 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Page project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-WORP-004 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title, client_po_number: 'PO-' + suffix, status: 'Issued', wo_number: number,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (wo.error) throw new Error('AC-WORP-004 fixture work order: ' + wo.error.message);

    invoiceId = crypto.randomUUID();
    const invoice = await admin.from('sales_invoices').insert({ id: invoiceId, org_id: orgId, customer_id: companyId, project_id: projectId,
      work_order_id: workOrderId, pmo_number: 'INV-' + suffix, invoice_date: '2026-11-01', amount: 1000, tax_treatment: 'exclusive', tax_amount: 0,
      currency: 'EUR', status: 'Draft', pmo_native: true, native_lines: [{ description: 'Work', qty: 1, rate: 1000 }] });
    if (invoice.error) throw new Error('AC-WORP-004 fixture invoice: ' + invoice.error.message);
    await signIn(page, 'finance@acme.test');
    await page.route('**/api/resource/**', (route) => route.abort());
    await page.goto('/sales-invoices/' + invoiceId);
    await page.getByRole('link', { name: number }).click();

    await expect(page).toHaveURL((url) => url.pathname === '/work-orders/' + workOrderId);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(number);
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByTestId('record-header').getByText('Page project ' + suffix)).toBeVisible();
  } catch (e) {
    failure = e;
  } finally {
    if (invoiceId) await cleanup('delete invoice', () => admin.from('sales_invoices').delete().eq('id', invoiceId));
    if (workOrderId) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-WORP-004 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-WORP-004 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
