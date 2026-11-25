// @e2e-isolation: serial — the report's stock posting is a per-organisation setting (dsr_stock_issue, off by default) and the two-record decision needs a named validator role; the spec reads both, sets them, and restores them in finally.
/**
 * JOB-F11 — installed and returned material (#2676). A daily report carries a material line of 5 units; validation posts it from the
 * work order's site stock, and a correction reverses that posting and posts the corrected line.
 * Goal oracle: the work order's site stock falls by 5 on validation; the correction reverses and re-posts, so the site stock ends at
 * start − 3, and the corrected report shows its own posted document.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, profileId, runId, serviceClient } from '../support/jobFixtures';
import type { SupabaseClient } from '@supabase/supabase-js';
import { roleJobUser } from '../support/roleJobUser';
import { ADMIN_SEED_EMAIL } from '../support/transferJourney';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';
import { expectOnHand } from '../support/stockUi';

test.setTimeout(300_000);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const stockSettings = async (svc: SupabaseClient) => need('stock settings', await svc.from('organizations').select('dsr_stock_issue, dsr_stock_issue_items, daily_report_validate_roles').eq('id', ORG_ID).single());

test('JOB-F11 validating a report with a material line of 5 falls site stock by 5, and a correction reverses and re-posts it', async ({ page }) => {
  const svc = serviceClient('JOB-F11');
  const before = await stockSettings(svc);
  const admin = await userClient(ADMIN_SEED_EMAIL);
  const author = await roleJobUser(svc, 'site_supervisor', runId('f11-ss'));
  const pm1 = await roleJobUser(svc, 'project_manager', runId('f11-pm1'));
  const pm2 = await roleJobUser(svc, 'project_manager', runId('f11-pm2'));
  const run = runId('f11');
  let projectId = ''; let workOrderId = '';
  try {
    // Settings as an Admin would leave them for this shop: material lines post, and a project manager validates a report.
    ok('stock setting', await admin.rpc('set_dsr_stock_issue', { p_on: true, p_items: 'all' }));
    ok('validate roles', await admin.rpc('set_daily_report_validate_roles', { p_roles: ['project_manager'] }));

    const sfx = runSuffix();
    projectId = need('project', await svc.from('projects').insert({ org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD' }).select('id').single()).id;
    // The site location must be an open site/yard/staging warehouse of the work order's own project (guard 1320).
    const site = await makeWarehouse(svc, sfx, 'SITE', 'site', projectId);
    const item = await makeItem(svc, sfx, 'PIPE');
    ok('consumable', await svc.from('stock_items').update({ consumable: true }).eq('id', item.id));
    await keeperOf(admin, site.id, await profileId(svc, ADMIN_SEED_EMAIL));
    await postReceive(admin, site.id, item.id, '50');
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} pipe run`, status: 'Issued', issued_at: new Date().toISOString(),
      order_value: 10_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD', site_warehouse_id: site.id,
    }).select('id').single()).id;
    const boq = need('boq', await svc.from('boq_items').insert({ org_id: ORG_ID, project_id: projectId, item_code: 'W-1', description: 'Weld joints', unit: 'm', quantity: 100, rate: 5 }).select('id').single());
    ok('allocation', await svc.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: boq.id, quantity: 100 }));

    // 1. The site supervisor files the day's report with a material line of 5 units and its paper photo.
    await author.signIn(page);
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByLabel('Project').selectOption({ label: `${run} project` });
    await page.getByLabel('Work order').selectOption({ label: `${run} pipe run` });
    await page.getByRole('button', { name: 'Start report' }).click();
    await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const reportUrl = page.url();
    const reportId = reportUrl.split('/').pop() ?? '';
    await page.getByRole('button', { name: 'Add consumable' }).click();
    await page.getByLabel('Stock item').selectOption({ label: `${item.code} · ${item.name}` });
    await page.getByLabel(/^Quantity/).last().fill('5');
    // One contract item on the work order: the report takes it itself, so there is no "Used on contract item" choice to make.
    await page.getByTestId('dsr-photo-input').setInputFiles({ name: 'paper-form.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('dsr-photos')).toContainText('paper-form.png', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });

    // 2. Validation posts the line: the site stock falls by 5 and the report names the issue document.
    await pm1.signIn(page);
    await page.goto(reportUrl);
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'validated', { timeout: 20_000 });
    await expect(page.getByTestId('dsr-stock-posted')).toBeVisible({ timeout: 20_000 });
    await expectOnHand(page, site, item.code, '45');

    // 3. A correction reverses that issue and posts the corrected line of 3.
    await page.getByRole('button', { name: 'Correct' }).click();
    const dialog = page.getByRole('dialog', { name: 'Correct this report' });
    await dialog.getByRole('textbox').fill('Recount on site: 3 used, not 5');
    await dialog.getByRole('button', { name: 'Start correction' }).click();
    await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page).not.toHaveURL(reportUrl);
    const correctedUrl = page.url();
    await page.getByLabel(/^Quantity/).last().fill('3');
    // The correction is its own report: it carries its own photo of the paper form before it can be sent.
    if (await page.getByTestId('dsr-photos').getByText('paper-form.png').count() === 0) {
      await page.getByTestId('dsr-photo-input').setInputFiles({ name: 'paper-form.png', mimeType: 'image/png', buffer: PNG });
      await expect(page.getByTestId('dsr-photos')).toContainText('paper-form.png', { timeout: 20_000 });
    }
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 20_000 });

    await pm2.signIn(page);
    await page.goto(correctedUrl);
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'validated', { timeout: 20_000 });
    await expect(page.getByTestId('dsr-stock-posted')).toBeVisible({ timeout: 20_000 });

    // Goal: reversed once and re-posted, so the site holds start − 3.
    await expectOnHand(page, site, item.code, '47');
    const correctedId = correctedUrl.split('/').pop() ?? '';
    const postings = need('postings', await svc.from('dsr_stock_postings').select('report_id, reversed_at').in('report_id', [reportId, correctedId]));
    expect(postings).toHaveLength(2);
    expect(postings.filter((p) => p.reversed_at !== null)).toHaveLength(1);
  } finally {
    ok('restore stock setting', await admin.rpc('set_dsr_stock_issue', { p_on: before.dsr_stock_issue === true, p_items: before.dsr_stock_issue_items ?? 'all' }));
    ok('restore validate roles', await admin.rpc('set_daily_report_validate_roles', { p_roles: before.daily_report_validate_roles ?? [] }));
    if (projectId) {
      ok('reports cleanup', await svc.from('daily_site_reports').delete().eq('project_id', projectId));
      if (workOrderId) ok('allocations cleanup', await svc.from('work_order_lines').delete().eq('work_order_id', workOrderId));
      ok('boq cleanup', await svc.from('boq_items').delete().eq('project_id', projectId));
      ok('work orders cleanup', await svc.from('work_orders').delete().eq('project_id', projectId));
      ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    }
    await pm2.cleanup(); await pm1.cleanup(); await author.cleanup();
  }
});
