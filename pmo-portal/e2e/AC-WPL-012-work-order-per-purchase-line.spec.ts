// @e2e-isolation: self-isolated — creates a unique client, project, two work orders and one purchase; deletes only rows linked to this run in finally.
// AC-WPL-012 — a purchase for two work orders: each line says which work order it is for, and once the purchase is paid the cost
// lands on each work order by its line. Goal oracle: after the 1,000 bill is paid, work order one shows 600 (its line) and work
// order two shows 400 (the line that took the request's work order); nothing is lost or counted twice.
// Written for the orchestrator's browser run; the amounts and test ids are the ones the plan-vs-actual row already exposes.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { login, pinEnglishLocale, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(120_000);

test('AC-WPL-012 each purchase line names its work order and the paid cost follows the line', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WPL-012 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'WPL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const ids = { company: '', project: '', wo1: crypto.randomUUID(), wo2: crypto.randomUUID(), procurement: '', request: crypto.randomUUID(), invoice: crypto.randomUUID() };
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };

  try {
    const profile = await admin.from('profiles').select('org_id').eq('email', 'admin@acme.test').single();
    if (profile.error) throw new Error('AC-WPL-012 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WPL-012 fixture client: ' + company.error.message);
    ids.company = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Split project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: ids.company,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-WPL-012 fixture project: ' + project.error.message);
    ids.project = project.data.id;
    const orders = await admin.from('work_orders').insert([ids.wo1, ids.wo2].map((id, i) => ({
      id, org_id: orgId, project_id: ids.project, title: 'Order ' + (i + 1) + ' ' + suffix, client_po_number: 'PO' + (i + 1) + '-' + suffix, status: 'Issued',
      wo_number: 'WO' + (i + 1) + '-' + suffix, issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    })));
    if (orders.error) throw new Error('AC-WPL-012 fixture work orders: ' + orders.error.message);

    // The journey: raise the purchase from the project, two lines, line one for work order one.
    await pinEnglishLocale(page);
    await login(page, 'admin@acme.test');
    await page.goto('/procurement/new?project=' + ids.project + '&have=need');
    await page.getByLabel(/title/i).first().fill('Split purchase ' + suffix);
    const addRow = page.getByTestId('line-items-section').getByRole('row').filter({ hasText: 'New line' });
    for (const [name, qty, rate] of [['Line one ' + suffix, '1', '600'], ['Line two ' + suffix, '1', '400']]) {
      await addRow.getByLabel(/new item description/i).fill(name);
      await addRow.getByLabel(/new item quantity/i).fill(qty);
      await addRow.getByLabel(/new item unit price/i).fill(rate);
      await addRow.getByRole('button', { name: /add line item/i }).click();
    }
    const section = page.getByTestId('line-work-orders-section');
    await expect(section).toBeVisible({ timeout: 15_000 });
    await section.getByRole('combobox', { name: 'Work order for Line one ' + suffix }).selectOption({ label: 'WO1-' + suffix });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Split purchase ' + suffix })).toBeVisible({ timeout: 20_000 });
    ids.procurement = page.url().split('/procurement/')[1].split(/[/?#]/)[0];

    // GOAL (storage): line one holds work order one; line two holds none (it follows the request).
    const lines = await admin.from('procurement_items').select('name, work_order_id').eq('procurement_id', ids.procurement).order('name');
    if (lines.error) throw new Error('AC-WPL-012 read lines: ' + lines.error.message);
    expect(lines.data?.map((l) => [l.name, l.work_order_id])).toEqual([['Line one ' + suffix, ids.wo1], ['Line two ' + suffix, null]]);

    // The request names work order two (the default for line two); the bill is paid in full.
    const request = await admin.from('purchase_requests').insert({ id: ids.request, org_id: orgId, procurement_id: ids.procurement, pr_number: 'PR-' + suffix, status: 'Approved', date: '2026-11-16', currency: 'EUR', work_order_id: ids.wo2 });
    if (request.error) throw new Error('AC-WPL-012 fixture request: ' + request.error.message);
    const budget = await admin.from('procurements').update({ budget_category: 'Materials' }).eq('id', ids.procurement);
    if (budget.error) throw new Error('AC-WPL-012 fixture budget category: ' + budget.error.message);
    const bill = await admin.from('procurement_invoices').insert({ id: ids.invoice, org_id: orgId, procurement_id: ids.procurement, vi_number: 'VI-' + suffix, invoice_date: '2026-11-16', status: 'Received', amount: 1000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR' });
    if (bill.error) throw new Error('AC-WPL-012 fixture bill: ' + bill.error.message);
    const pay = await admin.from('payments').insert({ org_id: orgId, procurement_id: ids.procurement, invoice_id: ids.invoice, status: 'Paid', amount: 1000, currency: 'EUR' });
    if (pay.error) throw new Error('AC-WPL-012 fixture payment: ' + pay.error.message);

    // GOAL (screen): each work order's direct cost on the project's plan-vs-actual row is its share.
    await page.goto('/projects/' + ids.project + '/contract');
    const row1 = page.getByTestId('wo-pva-row-' + ids.wo1);
    const row2 = page.getByTestId('wo-pva-row-' + ids.wo2);
    await expect(row1).toBeVisible({ timeout: 20_000 });
    await expect(row1.getByTestId('wo-pva-direct')).toContainText('600');
    await expect(row2.getByTestId('wo-pva-direct')).toContainText('400');
  } catch (e) {
    failure = e;
  } finally {
    if (ids.procurement) {
      await cleanup('delete payments', () => admin.from('payments').delete().eq('procurement_id', ids.procurement));
      await cleanup('delete invoice', () => admin.from('procurement_invoices').delete().eq('procurement_id', ids.procurement));
      await cleanup('delete request record', () => admin.from('purchase_requests').delete().eq('procurement_id', ids.procurement));
      await cleanup('delete purchase', () => admin.from('procurements').delete().eq('id', ids.procurement));
    }
    await cleanup('delete work orders', () => admin.from('work_orders').delete().in('id', [ids.wo1, ids.wo2]));
    if (ids.project) await cleanup('delete project', () => admin.from('projects').delete().eq('id', ids.project));
    if (ids.company) await cleanup('delete client', () => admin.from('companies').delete().eq('id', ids.company));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-WPL-012 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-WPL-012 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
