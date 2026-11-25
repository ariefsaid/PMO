// @e2e-isolation: serial — the receiver's recount needs the organisation's two-step transfer mode (one setting for the whole org); the spec reads it, turns it on, and puts it back in finally.
/**
 * JOB-F9 — receive with a recount (#2690). Material is sent from the warehouse to the site; the storekeeper at the site
 * recounts and confirms 9 of the 10 sent.
 * Goal oracle: the shortfall of 1 is recorded against the transfer — the transfer reads "Received, shortfall open" and its
 * Shortfalls section holds that 1, while the site holds the 9 that actually arrived.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { visibleToast } from '../helpers';
import { serviceClient } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { expectOnHand } from '../support/stockUi';
import { userClient } from '../support/stockFixture';
import { ADMIN_SEED_EMAIL, sendTransfer, setTransferMode, transferMode, type SentTransfer } from '../support/transferJourney';

test.setTimeout(240_000);

/** An Admin closes the transfer's open shortfalls (the short unit goes back to the source), as the Shortfalls section does. */
async function closeShortfalls(svc: SupabaseClient, transferId: string): Promise<void> {
  const admin = await userClient(ADMIN_SEED_EMAIL);
  const open = await svc.from('stock_transfer_lines').select('id').eq('transfer_id', transferId).is('short_resolution', null).not('qty_counted', 'is', null);
  if (open.error) throw new Error(`open shortfalls: ${open.error.message}`);
  for (const line of open.data ?? []) {
    const done = await admin.rpc('resolve_stock_transfer_shortfall', { p_line: line.id, p_resolution: 'returned' });
    if (done.error) throw new Error(`resolve shortfall: ${done.error.message}`);
  }
}

test('JOB-F9 the storekeeper recounts a delivery of 10 as 9 and the shortfall of 1 is recorded', async ({ page }) => {
  const svc = serviceClient('JOB-F9');
  const previous = await transferMode(svc);
  const keeper = await roleJobUser(svc, 'storekeeper', `f9-keeper-${Date.now()}`);
  let fx: SentTransfer | undefined;
  try {
    await setTransferMode('two_step');
    fx = await sendTransfer(svc, keeper.id, '10');

    // 1. Storekeeper: Stock → Transfers, opens the transfer addressed to them.
    await keeper.signIn(page);
    await page.goto('/stock/transfers');
    await page.locator(`a[href="/stock/transfers/${fx.transferId}"]`).click();
    await expect(page.getByRole('heading', { name: new RegExp(fx.number) })).toBeVisible({ timeout: 20_000 });

    // 2. Count what arrived: 9 of the 10 sent. The screen says where the 1 goes.
    const counted = page.getByLabel(/^Counted/);
    await expect(counted).toHaveValue(/10/);
    await counted.fill('9');
    await expect(page.getByLabel(/^Accepted/)).toHaveValue('9');
    await expect(page.getByText(/1 short: it stays in transit/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(visibleToast(page, 'Receipt recorded')).toBeVisible({ timeout: 20_000 });

    // Goal: the shortfall of 1 is held against the transfer, and the site holds the 9 that arrived.
    await expect(page.getByText('Received, shortfall open')).toBeVisible({ timeout: 20_000 });
    const shortfalls = page.getByRole('region', { name: 'Shortfalls' });
    await expect(shortfalls).toBeVisible({ timeout: 20_000 });
    await expect(shortfalls.getByText('1 short')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Shortfalls' }).getByText('1 short')).toBeVisible({ timeout: 20_000 });
    await expectOnHand(page, fx.site, fx.itemCode, '9');
  } finally {
    if (previous !== 'two_step') {
      // The open shortfall the journey made blocks the switch back to one-step; the Admin closes it (the short unit goes back to the source) first.
      if (fx) await closeShortfalls(svc, fx.transferId);
      await setTransferMode(previous);
    }
    await keeper.cleanup();
  }
});
