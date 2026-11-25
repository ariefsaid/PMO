// @e2e-isolation: serial - turns the seed organisation's performance-indices setting on and disconnects its ERP binding (org-wide state other specs must see unchanged); restores both and deletes its own rows in finally.
// AC-CSP-016 - a Finance user opens a project and reads the cost and schedule performance indices with the as-of date and the
// basis line; a work order's row opens its page with the same indices.
// Goal oracle: validated progress 300,000 against 250,000 of direct cost reads cost performance index 1.20 on the project and on the
// work order, the schedule index reads "Behind plan" (the work order is mid-schedule with a straight-line plan above the progress).
import { test, expect, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pinEnglishLocale, requireServiceRoleKey, signIn } from '../helpers';
import { inDays } from '../support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

test.setTimeout(120_000);
test.use({ deviceScaleFactor: 2 });
// Evidence for the brief: two screenshots per new or changed screen (phone 390 px, desktop 1440 px).
const EVIDENCE = '../docs/evidence/1215/2597';
const shots = async (page: Page, locator: Locator, name: string) => {
  for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await locator.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/${name}-${label}.png`, fullPage: true });
  }
};

const day = (offset: number) => inDays(offset); // work/report/invoice dates are read by the organisation's calendar

test('AC-CSP-016 the project and the work order show the same cost and schedule indices', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-CSP-016 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'CSP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const ids = { company: '', project: '', wo: '', boq: '', line: '', report: '', procurement: '', invoice: '' };
  let orgId = '';
  let settingBefore = false;
  let activeBindings: string[] = [];
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
    // The seed organisation has an active ERP binding, so it reads cost from the ledger basis and the work-order cost read
    // (`work_order_cost_amounts`, `where not v_erp`) lists no PMO vendor bill. This journey proves PMO-recorded direct cost, so
    // it disconnects the binding for its duration (serial lane) and restores it in finally.
    activeBindings = must(await admin.from('external_org_bindings').select('id').eq('org_id', orgId).eq('status', 'active'), 'bindings').map((b) => b.id as string);
    if (activeBindings.length > 0) must(await admin.from('external_org_bindings').update({ status: 'disconnected' }).in('id', activeBindings).select('id'), 'disconnect bindings');
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
    await shots(page, panel, 'project-performance');

    await panel.getByTestId('project-performance-row-' + ids.wo).getByRole('link').click();
    await expect(page).toHaveURL((url) => url.pathname === '/work-orders/' + ids.wo);
    const woPanel = page.getByTestId('wo-page-performance');
    await expect(woPanel).toBeVisible({ timeout: 20_000 });
    await expect(woPanel.getByTestId('wo-page-performance-cpi-value')).toHaveText('1.20');
    await expect(woPanel.getByTestId('wo-page-performance-spi-value')).toHaveText(spi);
    await shots(page, woPanel, 'work-order-performance');

    // The Admin card for the switch and the two limits.
    await signIn(page, 'admin@acme.test');
    await page.goto('/administration/projects');
    const card = page.locator('#org-performance-indices');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await shots(page, card, 'admin-performance-settings');
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
    if (activeBindings.length > 0) await cleanup('restore bindings', () => admin.from('external_org_bindings').update({ status: 'active' }).in('id', activeBindings));
    if (orgId) await cleanup('reset setting', () => admin.from('organizations').update({ performance_indices_enabled: settingBefore }).eq('id', orgId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-CSP-016 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-CSP-016 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
