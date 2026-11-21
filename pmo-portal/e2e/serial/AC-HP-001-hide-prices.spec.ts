// @e2e-isolation: serial — flips the org-wide hide prices setting on the shared seed org and restores it (try/finally).
import { test, expect, type Page } from '@playwright/test';
import { signIn, pinEnglishLocale } from '../helpers';

/**
 * AC-HP-001 (#2699) — an Admin turns "Hide prices from requesters" on; a requester (the seeded Engineer, no built-in role) opens the
 * purchase list and sees no Value column; a Finance person still sees it; the Admin turns the setting off again.
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

    const requester = await browser.newPage();
    await pinEnglishLocale(requester);
    await signIn(requester, 'engineer@acme.test');
    await requester.goto('/procurement');
    await expect(requester.getByRole('heading', { name: /procurement|purchases/i }).first()).toBeVisible();
    await expect(requester.locator('[data-procurement-value]')).toHaveCount(0);
    await requester.close();

    const finance = await browser.newPage();
    await pinEnglishLocale(finance);
    await signIn(finance, 'finance@acme.test');
    await finance.goto('/procurement');
    await expect(finance.locator('[data-procurement-value]').first()).toBeVisible();
    await finance.close();
  } finally {
    await setHidePrices(page, false);
  }
});
