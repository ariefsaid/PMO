// @e2e-isolation: serial - turns the organisation's two-step transfer mode on for the journey (an org-wide switch every stock journey reads); reset in afterEach.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from '../helpers';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';

test.setTimeout(240_000);
const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const photo = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: jpg });

let admin: SupabaseClient | undefined;
let shortLine: string | undefined;
test.afterEach(async () => {
  if (!admin) return;
  if (shortLine) { await admin.rpc('resolve_stock_transfer_shortfall', { p_line: shortLine, p_resolution: 'returned', p_reason: null }); shortLine = undefined; }
  await admin.rpc('set_stock_transfer_mode', { p_mode: 'one_step' });
});

test('AC-TST-028 AC-WAIT-076 a keeper sends, the receiver counts short on a phone with photos and a guest signs, and the shortfall stays open', async ({ page }) => {
  const sfx = runSuffix();
  admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx);
  const source = await makeWarehouse(admin, sfx, 'S', 'central');
  const dest = await makeWarehouse(admin, sfx, 'D', 'site');
  await keeperOf(admin, dest.id);                                                  // the Engineer keeps the destination
  await postReceive(admin, source.id, item.id, '10');
  const mode = await admin.rpc('set_stock_transfer_mode', { p_mode: 'two_step' });
  expect(mode.error).toBeNull();

  // The Admin sends 10 from a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/transfers/new');
  await page.getByRole('combobox', { name: /From warehouse/ }).selectOption({ label: `${source.code} - ${source.name}` });
  await page.getByRole('combobox', { name: /To warehouse/ }).selectOption({ label: `${dest.code} - ${dest.name}` });
  await page.getByRole('combobox', { name: /^Item/ }).click();
  await page.getByRole('combobox', { name: /^(search|cari) /i }).fill(item.code);
  await page.getByRole('option', { name: new RegExp(item.code) }).click();
  await page.getByRole('textbox', { name: /^Quantity/ }).fill('10');
  await page.getByRole('button', { name: 'Send transfer' }).click();
  // Sending is a deliberate confirm: the page submit only opens the guard; the keeper confirms it.
  const sendConfirm = page.getByRole('dialog', { name: 'Send this transfer?' });
  await expect(sendConfirm).toBeVisible();
  await sendConfirm.getByRole('button', { name: 'Send transfer', exact: true }).click();
  await expect(page.getByText('In transit').first()).toBeVisible();
  const transferId = page.url().split('/').pop()!;

  // AC-WAIT-076: the sender is told the exact person this Sent transfer is assigned to, with their role — the
  // destination keeper, not a generic "Waiting" label and not the sender themselves.
  await expect(page.getByTestId('transfer-waiting')).toContainText('Tomas Beck', { timeout: 20_000 });
  await expect(page.getByTestId('transfer-waiting')).toContainText('Engineer');
  expect(await page.getByTestId('transfer-waiting').textContent()).toMatch(/^Waiting for /);

  // The Engineer (keeper of the destination) counts 7 of 10; a guest with no account signs on this phone.
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/stock/transfers/${transferId}`);
  const counted = page.getByLabel(/^Counted/);
  await counted.fill('7');
  await expect(page.getByText(/3 short: it stays in transit/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Confirm the handover in PMO now' }).click();
  await page.getByRole('checkbox', { name: 'The person signing has no account' }).click();
  await page.getByLabel(/Name of the person signing/).fill('Gate Guard');
  await page.getByLabel('Photo of the goods').setInputFiles(photo('goods.jpg'));
  await page.getByLabel('Photo of the person receiving').setInputFiles(photo('person.jpg'));
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page.getByText('Received, shortfall open').first()).toBeVisible();
  await expect(page.getByText(/Gate Guard \(no account\)/)).toBeVisible();

  // The shortfall is recorded: 3 still in transit, 7 at the destination, and it is listed as open.
  await page.goto('/stock/transfers');
  await expect(page.getByText(/1 shortfall open/)).toBeVisible();
  const line = await admin.from('stock_transfer_lines').select('id').eq('transfer_id', transferId).single();
  shortLine = line.data?.id;
  expect(shortLine).toBeTruthy();
});
