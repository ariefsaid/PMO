// @e2e-isolation: serial - turns the seed organisation's performance-indices setting on (an org-wide switch other specs must see off); resets it and deletes its own rows in finally.
// AC-CSP-016 - a Finance user opens a project and reads the cost and schedule performance indices with the as-of date and the
// basis line; a work order's row opens its page with the same indices.
// Goal oracle: validated progress 300,000 against 250,000 of direct cost reads cost performance index 1.20 on the project and on the
// work order, the schedule index reads "Behind plan" (the work order is mid-schedule with a straight-line plan above the progress).
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pinEnglishLocale, requireServiceRoleKey, signIn } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

test.setTimeout(90_000);

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test('AC-CSP-016 the project and the work order show the same cost and schedule indices', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-CSP-016 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'CSP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const ids = { company: '', project: '', wo: '', boq: '', line: '', report: '', procurement: '', invoice: '' };
  let orgId = '';
  let settingBefore = false;
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };
  const must = <T,>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => {
    if (r.error || r.data === null || r.data === undefined) throw new Error('AC-CSP-016 fixture ' + what + ': ' + (r.error?.message ?? 'no row'));
    return r.data as NonNullable<T>;
  };

  try {
    const fin = must(await admin.from('profiles').select('id, org_id').eq('email', 'finance@acme.test').single(), 'finance profile');
    orgId = fin.org_id;
    const org = must(await admin.from('organizations').select('performance_indices_enabled').eq('id', orgId).single(), 'organisation');
    settingBefore = org.performance_indices_enabled;
    must(await admin.from('organizations').update({ performance_indices_enabled: true }).eq('id', orgId).select('id').single(), 'enable setting');

    ids.company = must(await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single(), 'client').id;
    ids.project = must(await admin.from('projects').insert({
      org_id: orgId, name: 'Performance project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: ids.company,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single(), 'project').id;
    ids.wo = crypto.randomUUID();
    must(await admin.from('work_orders').insert({
      id: ids.wo, org_id: orgId, project_id: ids.project, title: 'Performance ' + suffix, status: 'Issued', wo_number: 'WO-' + suffix,
      issued_at: new Date().toISOString(), order_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
      start_date: day(-10), end_date: day(10),
    }).select('id').single(), 'work order');
    ids.boq = must(await admin.from('boq_items').insert({
      org_id: orgId, project_id: ids.project, item_code: 'L1', description: 'Line', unit: 'm', quantity: 1000, rate: 1,
    }).select('id').single(), 'boq item').id;
    ids.line = must(await admin.from('work_order_lines').insert({ org_id: orgId, work_order_id: ids.wo, boq_item_id: ids.boq, quantity: 1 }).select('id').single(), 'work order line').id;
    ids.report = must(await admin.from('daily_site_reports').insert({
      org_id: orgId, project_id: ids.project, work_order_id: ids.wo, work_date: day(-5), status: 'validated', version: 1,
      author_id: fin.id, validated_by: (must(await admin.from('profiles').select('id').eq('org_id', orgId).neq('id', fin.id).limit(1).single(), 'second user')).id,
      validated_at: new Date().toISOString(),
    }).select('id').single(), 'validated report').id;
    must(await admin.from('dsr_progress_lines').insert({
      org_id: orgId, report_id: ids.report, position: 1, work_order_line_id: ids.line, quantity: 1, unit: 'm', frozen_amount: 300000,
    }).select('id').single(), 'progress line');
    ids.procurement = must(await admin.from('procurements').insert({
      org_id: orgId, title: 'Cost ' + suffix, project_id: ids.project, requested_by_id: fin.id, status: 'Ordered',
      total_value: 250000, approved_total_value: 250000, currency: 'EUR', budget_category: 'Materials',
    }).select('id').single(), 'procurement').id;
    ids.invoice = must(await admin.from('procurement_invoices').insert({
      org_id: orgId, procurement_id: ids.procurement, vi_number: 'VI-' + suffix, invoice_date: day(-5), status: 'Received', amount: 250000,
      tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR', work_order_id: ids.wo,
    }).select('id').single(), 'invoice').id;
    must(await admin.from('payments').insert({
      org_id: orgId, procurement_id: ids.procurement, invoice_id: ids.invoice, status: 'Paid', amount: 250000, currency: 'EUR',
    }).select('id').single(), 'payment');

    await pinEnglishLocale(page);
    await signIn(page, 'finance@acme.test');
    await page.goto('/projects/' + ids.project);
    const panel = page.getByTestId('project-performance');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByTestId('project-performance-cpi-value')).toHaveText('1.20');
    await expect(panel.getByTestId('project-performance-cpi-reading')).toHaveText('Earned value exceeds actual cost');
    await expect(panel.getByTestId('project-performance-spi-reading')).toHaveText('Behind plan');
    await expect(panel.getByTestId('project-performance-asof')).toContainText('As of');
    await expect(panel).toContainText('validated progress at contract rate');
    const spi = await panel.getByTestId('project-performance-spi-value').innerText();
    expect(spi).toMatch(/^0\.\d{2}$/);

    await panel.getByTestId('project-performance-row-' + ids.wo).getByRole('link').click();
    await expect(page).toHaveURL((url) => url.pathname === '/work-orders/' + ids.wo);
    const woPanel = page.getByTestId('wo-page-performance');
    await expect(woPanel).toBeVisible({ timeout: 20_000 });
    await expect(woPanel.getByTestId('wo-page-performance-cpi-value')).toHaveText('1.20');
    await expect(woPanel.getByTestId('wo-page-performance-spi-value')).toHaveText(spi);
  } catch (e) {
    failure = e;
  } finally {
    if (ids.invoice) await cleanup('delete payments', () => admin.from('payments').delete().eq('procurement_id', ids.procurement));
    if (ids.invoice) await cleanup('delete invoice', () => admin.from('procurement_invoices').delete().eq('id', ids.invoice));
    if (ids.procurement) await cleanup('delete procurement', () => admin.from('procurements').delete().eq('id', ids.procurement));
    if (ids.report) await cleanup('delete progress lines', () => admin.from('dsr_progress_lines').delete().eq('report_id', ids.report));
    if (ids.report) await cleanup('delete report events', () => admin.from('dsr_events').delete().eq('report_id', ids.report));
    if (ids.report) await cleanup('delete report', () => admin.from('daily_site_reports').delete().eq('id', ids.report));
    if (ids.line) await cleanup('delete work order line', () => admin.from('work_order_lines').delete().eq('id', ids.line));
    if (ids.boq) await cleanup('delete boq item', () => admin.from('boq_items').delete().eq('id', ids.boq));
    if (ids.wo) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', ids.wo));
    if (ids.project) await cleanup('delete project', () => admin.from('projects').delete().eq('id', ids.project));
    if (ids.company) await cleanup('delete client', () => admin.from('companies').delete().eq('id', ids.company));
    if (orgId) await cleanup('reset setting', () => admin.from('organizations').update({ performance_indices_enabled: settingBefore }).eq('id', orgId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-CSP-016 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-CSP-016 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
