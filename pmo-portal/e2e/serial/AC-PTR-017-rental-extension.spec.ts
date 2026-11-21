// @e2e-isolation: self-isolated — switches purchase types on for the seed organisation for the run and back off in afterAll (no other journey reads it); each run raises its own uniquely titled rental and extension (procurement history is append-only, so none is deleted).
/** AC-PTR-017 — goal: a requester on a phone raises a rental purchase and extends it; the extension is its own Draft purchase, linked both ways. Also captures the evidence screenshots (phone 390 and desktop 1440, 2x) for the two new screens. */
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';
import { runSuffix, userClient } from './support/stockFixture';

const EVIDENCE = '../docs/evidence/1215/2697';
test.setTimeout(180_000);

test.beforeAll(async () => {
  const admin = await userClient('admin@acme.test');
  const on = await admin.rpc('set_purchase_types_enabled', { p_enabled: true });
  if (on.error) throw new Error('enable: ' + on.error.message);
});
test.afterAll(async () => {
  const admin = await userClient('admin@acme.test');
  await admin.rpc('set_purchase_types_enabled', { p_enabled: false });
});

async function typeDay(page: Page, label: RegExp, iso: string) {
  const field = page.getByLabel(label);
  await field.fill(iso);
  await field.press('Tab');
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });

  test('AC-PTR-017: a requester raises a rental on a phone and extends it into a separate Draft purchase linked both ways', async ({ page }) => {
    const title = `E2E crane hire ${runSuffix()}`;
    await signIn(page, 'engineer@acme.test');
    await page.goto('/procurement/new?have=need');
    await page.getByLabel(/^title/i).fill(title);
    await page.getByLabel('Purchase type').selectOption({ label: 'Rental' });
    await typeDay(page, /Rental from/, '2026-01-01');
    await typeDay(page, /Rental to/, '2026-01-31');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const originalUrl = page.url();
    const panel = page.getByTestId('rental-panel');
    await expect(panel).toContainText('Rental');

    await panel.getByRole('button', { name: 'Extend rental' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/^From/)).toHaveValue(/1 Feb 2026|2026-02-01/);
    await page.screenshot({ path: `${EVIDENCE}/extend-modal-phone-390.png` });
    await dialog.getByRole('button', { name: 'Create extension order' }).click();

    // The extension is a different purchase, in Draft, that says what it extends.
    await expect(page).not.toHaveURL(originalUrl, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('rental-extends')).toContainText(title, { timeout: 20_000 });
    await expect(page.getByText('Draft').first()).toBeVisible();

    // And the original lists it back.
    await page.goto(originalUrl);
    await expect(page.getByTestId('rental-extensions')).toContainText(title);
  });

  test('AC-PTR-017: the Admin screen for purchase types on a phone (evidence)', async ({ page }) => {
    await signIn(page, 'admin@acme.test');
    await page.goto('/purchase-types/settings');
    await expect(page.getByRole('heading', { name: 'Purchase types', level: 1 })).toBeVisible();
    await expect(page.getByTestId('purchase-type-row').first()).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/settings-phone-390.png`, fullPage: true });
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  test('AC-PTR-017: the two new screens on a desktop (evidence)', async ({ page }) => {
    await signIn(page, 'admin@acme.test');
    await page.goto('/purchase-types/settings');
    await expect(page.getByTestId('purchase-type-row').first()).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/settings-desktop-1440.png`, fullPage: true });

    const title = `E2E pump hire ${runSuffix()}`;
    await page.goto('/procurement/new?have=need');
    await page.getByLabel(/^title/i).fill(title);
    await page.getByLabel('Purchase type').selectOption({ label: 'Rental' });
    await typeDay(page, /Rental from/, '2026-01-01');
    await typeDay(page, /Rental to/, '2026-01-31');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.getByTestId('rental-panel').getByRole('button', { name: 'Extend rental' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/extend-modal-desktop-1440.png` });
  });
});
