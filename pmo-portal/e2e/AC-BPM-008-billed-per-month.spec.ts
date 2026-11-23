// @e2e-isolation: self-isolated — creates a unique local client, project and issued work order; deletes only rows linked to this run in finally.
// AC-BPM-008 — Finance opens a work order billed in two months and reads what was billed in each, on the work-order page.
// Goal oracle: the Billing panel lists both months with their amounts.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(60_000);

test('AC-BPM-008 the work-order page lists what was billed per month', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-BPM-008 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'BPM-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const number = 'WO-' + suffix;
  const title = 'Billed months ' + suffix;
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
    if (profile.error) throw new Error('AC-BPM-008 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-BPM-008 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Page project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-BPM-008 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title, client_po_number: 'PO-' + suffix, status: 'Issued', wo_number: number,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (wo.error) throw new Error('AC-BPM-008 fixture work order: ' + wo.error.message);

    const mk = (date: string, amount: number, n: string) => ({ org_id: orgId, customer_id: companyId, project_id: projectId, work_order_id: workOrderId,
      si_number: 'SI-' + suffix + n, invoice_date: date, amount, currency: 'EUR', tax_treatment: 'exclusive', tax_amount: 0, status: 'Unpaid' });
    const invoice = await admin.from('sales_invoices').insert([mk('2026-09-10', 1000, '-A'), mk('2026-10-20', 2500, '-B')]);
    if (invoice.error) throw new Error('AC-BPM-008 fixture invoices: ' + invoice.error.message);
    await signIn(page, 'finance@acme.test');
    await page.route('**/api/resource/**', (route) => route.abort());
    await page.goto('/work-orders/' + workOrderId);

    const list = page.getByTestId('billed-per-month');
    await expect(list).toBeVisible();
    await expect(list.getByTestId('billed-month-2026-10')).toContainText('2,500');
    await expect(list.getByTestId('billed-month-2026-09')).toContainText('1,000');
    await expect(list.getByRole('listitem').first()).toContainText('to date');
  } catch (e) {
    failure = e;
  } finally {
    if (workOrderId) await cleanup('delete invoices', () => admin.from('sales_invoices').delete().eq('work_order_id', workOrderId));
    if (workOrderId) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-BPM-008 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-BPM-008 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
