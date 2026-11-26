// @e2e-isolation: serial — switches the organisation-wide revenue-plan setting on and edits the organisation's non-working dates (org-global singletons) for the run and restores both in finally.
// AC-WDT-014 — An Admin on a phone adds a non-working date; Finance then enters a month amount on a work order. The day view carries no target on that date,
// and the work-order page and the project roll-up show the same month-to-date target.
// Goal oracle: the listed date is marked non-working with no target, and both screens agree on target to date.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pinEnglishLocale, requireServiceRoleKey, signIn } from '../helpers';
import { orgToday } from '../support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';
import { openWorkOrderArea } from '../support/workOrderArea';

test.setTimeout(90_000);
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const EVIDENCE = '../docs/evidence/1215/2672';
const shots = async (page: import('@playwright/test').Page, locator: import('@playwright/test').Locator, name: string) => {
  for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await locator.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/${name}-${label}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
};

test('AC-WDT-014 a non-working date is left out of the month spread, and both screens agree on target to date', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WDT-014 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'WDT-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  let companyId = '';
  let projectId = '';
  let workOrderId = '';
  let orgId = '';
  let hadSettings = true;
  let listedDate = '';
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };
  try {
    const profile = await admin.from('profiles').select('org_id').eq('email', 'finance@acme.test').single();
    if (profile.error) throw new Error('AC-WDT-014 fixture profile: ' + profile.error.message);
    orgId = profile.data.org_id;
    const existing = await admin.from('org_revenue_plan_settings').select('org_id').eq('org_id', orgId).maybeSingle();
    hadSettings = Boolean(existing.data);
    const on = await admin.from('org_revenue_plan_settings').upsert({ org_id: orgId, enabled: true, working_weekdays: [1, 2, 3, 4, 5] });
    if (on.error) throw new Error('AC-WDT-014 fixture setting: ' + on.error.message);
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WDT-014 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Target project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-WDT-014 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title: 'Target WO ' + suffix, client_po_number: 'PO-' + suffix, status: 'Issued', wo_number: 'WO-' + suffix,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (wo.error) throw new Error('AC-WDT-014 fixture work order: ' + wo.error.message);

    // The first weekday of the ORGANISATION'S current month, so the date is added to the same month both screens read.
    const orgNow = orgToday();
    const first = new Date(Date.UTC(Number(orgNow.slice(0, 4)), Number(orgNow.slice(5, 7)) - 1, 1));
    while (first.getUTCDay() === 0 || first.getUTCDay() === 6) first.setUTCDate(first.getUTCDate() + 1);
    listedDate = first.toISOString().slice(0, 10); // e2e-org-day: allow — month arithmetic on the org month chosen above, not the runner's day

    await pinEnglishLocale(page);
    await signIn(page, 'admin@acme.test');
    await page.goto('/administration/projects');
    const card = page.locator('#non-working-dates');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByLabel('Date').fill(listedDate);
    await card.getByLabel('Label (optional)').fill('Closure ' + suffix);
    await card.getByRole('button', { name: 'Add date' }).click();
    await expect(card.getByTestId('nwd-' + listedDate)).toContainText('Closure ' + suffix);
    await shots(page, card, 'non-working-dates');

    await page.context().clearCookies();
    await signIn(page, 'finance@acme.test');
    await page.goto('/work-orders/' + workOrderId);
    await openWorkOrderArea(page, 'cost');
    const plan = page.getByTestId('wo-page-revenue-plan');
    await expect(plan).toBeVisible({ timeout: 15_000 });
    await plan.getByRole('button', { name: 'Enter plan' }).click();
    await page.getByLabel(/Amount/).fill('2200.00');
    await page.getByRole('button', { name: 'Save plan' }).click();

    const daily = page.getByTestId('wo-page-daily-target');
    await expect(daily).toBeVisible({ timeout: 15_000 });
    const listedRow = daily.getByTestId('wo-daily-row-' + listedDate);
    await expect(listedRow).toContainText('Non-working day: Closure ' + suffix);
    await expect(listedRow.locator('td').first()).toHaveText('—');
    await shots(page, daily, 'work-order-daily-target');
    const mtdTarget = (await daily.getByTestId('wo-daily-mtd-target').textContent()) ?? '';
    expect(mtdTarget).not.toBe('');

    await page.goto('/projects/' + projectId + '/orders');
    const row = page.getByTestId('daily-target-row-' + workOrderId);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(mtdTarget);
    await shots(page, page.getByTestId('project-daily-target'), 'project-daily-target');
  } catch (e) {
    failure = e;
  } finally {
    if (orgId && listedDate) await cleanup('delete non-working date', () => admin.from('org_non_working_dates').delete().eq('org_id', orgId).eq('work_date', listedDate));
    if (workOrderId) await cleanup('delete plan', () => admin.from('work_order_revenue_plan').delete().eq('work_order_id', workOrderId));
    if (workOrderId) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
    if (orgId && !hadSettings) await cleanup('restore setting', () => admin.from('org_revenue_plan_settings').delete().eq('org_id', orgId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-WDT-014 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-WDT-014 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
