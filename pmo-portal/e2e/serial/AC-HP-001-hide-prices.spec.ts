// @e2e-isolation: serial — flips the org-wide hide prices setting on the shared seed org and restores it (try/finally).
import { test, expect, type Page } from '@playwright/test';
import { signIn, pinEnglishLocale } from '../helpers';

/**
 * AC-HP-001 (#2699) — an Admin turns "Hide prices from requesters" on. On the default Procurement view a Finance person still sees the
 * Value column and amounts; a requester (the seeded Engineer, no built-in role) sees no Value column and no amount in the table.
 * The Admin turns the setting off again.
 */
test.setTimeout(240_000);

async function setHidePrices(page: Page, on: boolean) {
  await page.goto('/administration/people');
  const turnOn = page.getByRole('button', { name: 'Hide prices from requesters' });
  const turnOff = page.getByRole('button', { name: 'Show prices to requesters again' });
  if (on && (await turnOn.isVisible())) { await turnOn.click(); await expect(turnOff).toBeVisible(); }
  if (!on && (await turnOff.isVisible())) { await turnOff.click(); await expect(turnOn).toBeVisible(); }
}

test('AC-HP-001: a requester sees no prices on the purchase list; Finance does', async ({ page, browser }) => {
  await pinEnglishLocale(page);
  await signIn(page, 'admin@acme.test');
  try {
    await setHidePrices(page, true);

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
    await setHidePrices(page, false);
  }
});
