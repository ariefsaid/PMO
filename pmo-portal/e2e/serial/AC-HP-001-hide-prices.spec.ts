// @e2e-isolation: serial — flips the org-wide hide prices setting on the shared seed org through the service role and restores it (try/finally).
import { test, expect } from '@playwright/test';
import { signIn, pinEnglishLocale } from '../helpers';
import { ORG_ID, need, serviceClient } from '../support/jobFixtures';

/**
 * AC-HP-001 (#2699) — with "Hide prices from requesters" on, the default Procurement view still shows the Value column and amounts to a
 * Finance person and to an office person (the seeded Engineer, no built-in role: price-visibility-roles FR-002). Only Foreman and Field user
 * hold no price right, and they are light accounts with no purchase list, so the hidden side is proved in the database (1850 pgTAP).
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

test('AC-HP-001: office roles keep prices on the purchase list while hiding is on', async ({ browser }) => {
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

    const office = await browser.newPage();
    await pinEnglishLocale(office);
    await signIn(office, 'engineer@acme.test');
    await office.goto('/procurement');
    const officeTable = office.getByRole('table', { name: /procurement/i }).first();
    await expect(officeTable).toBeVisible();
    await expect(officeTable.getByRole('columnheader', { name: /^Value/ })).toBeVisible();
    await expect(officeTable.getByRole('cell').filter({ hasText: /\$[\d,]+/ }).first()).toBeVisible();
    await office.close();
  } finally {
    await setHidePrices(previous);
  }
});
