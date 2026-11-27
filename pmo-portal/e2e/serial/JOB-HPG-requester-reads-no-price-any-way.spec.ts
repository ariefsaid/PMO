// @e2e-isolation: serial — turns the org-wide "hide prices from requesters" setting on (Admin) and restores it; the request is this run's own.
/**
 * JOB-HPG (#2788) — the database keeps the hide-prices promise on every way of reading: with the setting on, a Site Supervisor opens
 * their own request on screen, and the same signed-in session asking the database directly for that request's table, its lines and
 * its order gets no price (the request comes back only through the price-free read, without its total). Finance still reads the total.
 * The same person adds, edits and removes a line on their own draft request while hiding is on, and purchasing retains control of its optional estimate (DD-R1125-16).
 */
import { expect, test, type Page } from '@playwright/test';
import { createProcurementFixture, type ProcurementFixture } from '../procurement-fixture';
import { roleJobUser } from '../support/roleJobUser';
import { ok, runId, serviceClient } from '../support/jobFixtures';
import { userClient } from '../support/stockFixture';

test.setTimeout(120_000);

let requester: Awaited<ReturnType<typeof roleJobUser>>;
let purchase: ProcurementFixture;
let draft: ProcurementFixture;
let pricesWereHidden = false;

test.beforeAll(async () => {
  const svc = serviceClient('JOB-HPG');
  const admin = await userClient('admin@acme.test');
  const org = await svc.from('organizations').select('hide_prices_from_requesters').eq('id', '00000000-0000-0000-0000-000000000001').single();
  ok('hide-prices setting read', org);
  pricesWereHidden = Boolean((org.data as { hide_prices_from_requesters: boolean }).hide_prices_from_requesters);
  ok('hide prices', await admin.rpc('set_hide_prices_enabled', { p_enabled: true }));
  requester = await roleJobUser(svc, 'site_supervisor', runId('hpg-requester'));
  purchase = await createProcurementFixture({ status: 'Approved', title: 'JOB-HPG any way', withSupplier: true, requestedBy: requester.id });
  draft = await createProcurementFixture({ status: 'Draft', title: 'JOB-HPG own draft', requestedBy: requester.id });
});

test.afterAll(async () => {
  await draft?.cleanup();
  await purchase?.cleanup();
  await requester?.cleanup();
  if (!pricesWereHidden) {
    const admin = await userClient('admin@acme.test');
    const r = await admin.rpc('set_hide_prices_enabled', { p_enabled: false });
    if (r.error) throw new Error(`JOB-HPG restore setting: ${r.error.message}`);
  }
});

/** Reads a REST path with the page's own signed-in session, as any client of that person could. */
async function readAsPage(page: Page, path: string): Promise<unknown> {
  return page.evaluate(async ({ url, key, path }) => {
    const stored = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = stored ? (JSON.parse(localStorage.getItem(stored) as string) as { access_token: string }).access_token : '';
    const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    return res.json();
  }, { url: process.env.SUPABASE_URL as string, key: process.env.VITE_SUPABASE_ANON_KEY as string, path });
}

test('JOB-HPG the Site Supervisor opens their request and no way of reading returns a price', async ({ page }) => {
  await requester.signIn(page);
  await page.goto('/');
  await page.getByRole('link', { name: /Purchasing|Procurement/ }).first().click();
  await expect(page.getByText(purchase.code).first()).toBeVisible({ timeout: 20_000 });

  // The same session asks the database directly.
  expect(await readAsPage(page, `procurements?select=id,total_value&id=eq.${purchase.id}`)).toEqual([]);
  expect(await readAsPage(page, `procurement_items?select=id,rate,amount&procurement_id=eq.${purchase.id}`)).toEqual([]);
  expect(await readAsPage(page, `procurements_masked?select=code,total_value,vendor_id&id=eq.${purchase.id}`))
    .toEqual([{ code: purchase.code, total_value: null, vendor_id: null }]);
  expect(await readAsPage(page, `procurement_items_masked?select=name,rate,amount&procurement_id=eq.${purchase.id}`))
    .toEqual([{ name: 'Fixture line', rate: null, amount: null }]);

  // Finance, who may see prices, reads the real total of the same request.
  const finance = await userClient('finance@acme.test');
  const priced = await finance.from('procurements').select('total_value').eq('id', purchase.id).single();
  ok('finance read', priced);
  expect(Number((priced.data as { total_value: number }).total_value)).toBe(12000);
});

test('JOB-HPG the Site Supervisor adds, edits and removes a line on their own draft while prices are hidden', async ({ page }) => {
  const item = `HPG bolts ${runId('line')}`;
  await requester.signIn(page);
  await page.goto(draft.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: /^Line items/ }).click();
  const lines = page.getByTestId('line-items-section');
  await expect(lines.getByRole('button', { name: 'Edit Fixture line', exact: true })).toBeVisible({ timeout: 20_000 });

  await lines.getByLabel(/new item description/i).fill(item);
  await lines.getByLabel(/new item quantity/i).fill('3');
  // DD-R1125-16: the requester enters item and quantity only.
  await expect(lines.getByLabel(/new item unit price/i)).toHaveCount(0);
  await lines.getByRole('button', { name: /add line item/i }).click();
  const saved = lines.getByRole('row').filter({ hasText: item });
  await expect(saved).toHaveCount(1, { timeout: 20_000 });
  await expect(saved.getByText(/12[.,]00/)).toHaveCount(0);

  // Purchasing supplies the estimate; the requester still cannot read it.
  const finance = await userClient('finance@acme.test');
  ok('finance estimate', await finance.from('procurement_items').update({ rate: 4 }).eq('procurement_id', draft.id).eq('name', item));
  await saved.getByRole('button', { name: `Edit ${item}` }).click();
  await lines.getByLabel(`Edit quantity for ${item}`).fill('5');
  await lines.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(saved.getByRole('cell', { name: '5', exact: true })).toBeVisible({ timeout: 20_000 });
  // Editing quantity preserves the estimate supplied by Finance.
  const kept = await finance.from('procurement_items').select('quantity, rate').eq('procurement_id', draft.id).eq('name', item).single();
  ok('finance line read', kept);
  expect(Number((kept.data as { quantity: number }).quantity)).toBe(5);
  expect(Number((kept.data as { rate: number }).rate)).toBe(4);

  await saved.getByRole('button', { name: `Remove ${item}` }).click();
  await page.getByRole('button', { name: 'Remove item' }).click();
  await expect(saved).toHaveCount(0, { timeout: 20_000 });
});
