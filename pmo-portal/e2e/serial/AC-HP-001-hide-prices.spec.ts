// @e2e-isolation: serial — flips the org-wide hide prices setting on the shared seed org through the service role and restores it (try/finally).
import { test, expect } from '@playwright/test';
import { signIn, pinEnglishLocale } from '../helpers';
import { ORG_ID, need, serviceClient } from '../support/jobFixtures';

/**
 * AC-HP-001 (#2699) — with "Hide prices from requesters" on, the default Procurement view shows a Finance person the Value column and
 * amounts, while a requester (the seeded Engineer, no built-in role) sees no Value column and no amount in the table.
 * The setting ships with the next release, so this journey sets it through the service role and restores the previous value.
 */
test.setTimeout(240_000);

async function readHidePrices(): Promise<boolean> {
  const admin = serviceClient('AC-HP-001');
  const current = need('read the hide prices setting', await admin.from('organizations').select('hide_prices_from_requesters').eq('id', ORG_ID).single());
  return current.hide_prices_from_requesters as boolean;
}

async function setHidePrices(on: boolean): Promise<void> {
  const admin = serviceClient('AC-HP-001');
  need('set the hide prices setting', await admin.from('organizations').update({ hide_prices_from_requesters: on }).eq('id', ORG_ID).select('id').single());
}

test('AC-HP-001: a requester sees no prices on the purchase list; Finance does', async ({ browser }) => {
  const previous = await readHidePrices();
  try {
    await setHidePrices(true);
    const finance = await browser.newPage();
    await pinEnglishLocale(finance);
    await signIn(finance, 'finance@acme.test');
    await finance.goto('/procurement');
    const financeTable = finance.getByRole('table', { name: /procurement/i }).first();
    await expect(financeTable).toBeVisible();
    await expect(financeTable.getByRole('columnheader', { name: /^Value/ })).toBeVisible();
    await expect(financeTable.getByRole('cell').filter({ hasText: /\$[\d,]+/ }).first()).toBeVisible();
    await finance.close();

    const requester = await browser.newPage();
    await pinEnglishLocale(requester);
    await signIn(requester, 'engineer@acme.test');
    await requester.goto('/procurement');
    const requesterTable = requester.getByRole('table', { name: /procurement/i }).first();
    await expect(requesterTable).toBeVisible();
    await expect(requesterTable.getByRole('row').nth(1)).toBeVisible();
    await expect(requesterTable.getByRole('columnheader', { name: /^Value/ })).toHaveCount(0);
    await expect(requesterTable.getByText(/\$\d/)).toHaveCount(0);
    await requester.close();
  } finally {
    await setHidePrices(previous);
  }
});
