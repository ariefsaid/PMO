// @e2e-isolation: serial — turns the org-wide "hide prices from requesters" setting on and off (Admin); the request is this run's own.
/**
 * JOB-PU9 — requesters do not see prices: with the setting on, the Requester opens their own request and reads its title, lines and
 * status but no unit price, line total or amount.
 * The supplier follows the price visibility setting.
 */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createProcurementFixture, SEED_SUPPLIER_NAME, type ProcurementFixture } from '../procurement-fixture';
import { roleJobUser } from '../support/roleJobUser';
import { ok, runId, serviceClient } from '../support/jobFixtures';
import { userClient } from '../support/stockFixture';

test.setTimeout(120_000);

let requester: Awaited<ReturnType<typeof roleJobUser>>;
let purchase: ProcurementFixture;
let pricesWereHidden = false;

test.beforeAll(async () => {
  const svc = serviceClient('JOB-PU9');
  const admin = await userClient('admin@acme.test');
  const org = await svc.from('organizations').select('hide_prices_from_requesters').eq('id', '00000000-0000-0000-0000-000000000001').single();
  ok('hide-prices setting read', org);
  pricesWereHidden = Boolean((org.data as { hide_prices_from_requesters: boolean }).hide_prices_from_requesters);
  ok('hide prices', await admin.rpc('set_hide_prices_enabled', { p_enabled: true }));

  requester = await roleJobUser(svc, 'site_supervisor', runId('pu9-requester'));
  purchase = await createProcurementFixture({ status: 'Approved', title: 'JOB-PU9 prices hidden', withSupplier: true, requestedBy: requester.id });
});

test.afterAll(async () => {
  await purchase?.cleanup();
  await requester?.cleanup();
  if (!pricesWereHidden) {
    const admin = await userClient('admin@acme.test');
    const r = await admin.rpc('set_hide_prices_enabled', { p_enabled: false });
    if (r.error) throw new Error(`JOB-PU9 restore setting: ${r.error.message}`);
  }
});

test('JOB-PU9 the requester opens My requests and no price or supplier shows', async ({ page }) => {
  await requester.signIn(page);
  await page.goto('/');
  await page.getByRole('link', { name: /Purchasing|Procurement/ }).first().click();
  await expect(page.getByText(purchase.code).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(SEED_SUPPLIER_NAME, { exact: true })).toHaveCount(0);
  await page.getByText(purchase.code).first().click();
  // The row opens its preview; the request itself is one step on.
  await page.getByRole('dialog').getByRole('link', { name: 'Open full page' }).click();
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });

  // The request itself is there — title, status, its line.
  await expect(page.getByRole('heading', { name: /JOB-PU9 prices hidden/ }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: /^Line items/ }).click();
  await expect(page.getByText('Fixture line').first()).toBeVisible();

  // …and no money: no line amounts, no stage amounts, no money panel, and the request total never renders.
  await page.getByRole('tab', { name: /^Line items/ }).click();
  // Look only once the table has drawn its line: an absent header would otherwise pass before the table exists.
  await expect(page.getByRole('cell', { name: 'Fixture line' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('columnheader', { name: /Unit price/i })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: /Line total/i })).toHaveCount(0);
  await expect(page.getByText(/^Money ·/)).toHaveCount(0);
  await expect(page.getByText(/12[.,]000/)).toHaveCount(0);
  await expect(page.getByText(SEED_SUPPLIER_NAME, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'More procurement actions', exact: true }).first().click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  const path = await (await downloaded).path();
  if (!path) throw new Error('The request export did not produce a file');
  const csv = await readFile(path, 'utf8');
  expect(csv).not.toContain(SEED_SUPPLIER_NAME);
  expect(csv.split('\n')[0]).toBe('number,title,status,project');
});
