// @e2e-isolation: serial — flips the org-wide built-in roles setting on the shared seed org and restores it (try/finally); gives one seeded person a role and clears it.
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, pinEnglishLocale } from '../helpers';

/**
 * AC-BIR-001 (#2709) — an Admin turns built-in roles on, gives a person a role from the Edit role form, sees it in the
 * directory, and while the setting is off the Edit role form is the plain five-level form.
 * Also writes the two evidence screenshots per new screen (phone 390 and desktop 1440) under docs/evidence/1215/2709/.
 */
test.setTimeout(420_000);

const EVIDENCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/evidence/1215/2709');
const SIZES = [{ name: 'phone-390', width: 390, height: 844 }, { name: 'desktop-1440', width: 1440, height: 900 }] as const;

/** Evidence capture only when asked (EVIDENCE_SHOTS=1), so a normal run writes no files. */
async function shoot(page: Page, screen: string) {
  if (process.env.EVIDENCE_SHOTS !== '1') return;
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(EVIDENCE, `${screen}-${size.name}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

test('AC-BIR-001: setting off keeps the plain form; on offers 28 roles; a role is given and shown', async ({ page }) => {
  await pinEnglishLocale(page);
  await signIn(page, 'admin@acme.test');
  try {
    // Off by default: the plain access-level form, no picker (checked again at the end).

    // Turn the setting on.
    await page.goto('/administration/people');
    const turnOn = page.getByRole('button', { name: 'Turn on built-in roles' });
    await expect(turnOn).toBeVisible();
    await page.getByRole('heading', { name: 'Built-in roles' }).scrollIntoViewIfNeeded();
    await shoot(page, 'setting-off');
    await turnOn.click();
    await expect(page.getByRole('button', { name: 'Turn off built-in roles' })).toBeVisible();
    await page.getByRole('heading', { name: 'Built-in roles' }).scrollIntoViewIfNeeded();
    await shoot(page, 'setting-on');

    // Give the seeded Engineer the Planner role.
    await page.goto('/administration/users');
    await page.getByRole('searchbox').first().fill('engineer@acme.test');
    const menu = page.getByRole('button', { name: 'Row actions' }).first();
    await menu.click();
    await page.getByRole('menuitem', { name: 'Edit role' }).click();
    const picker = page.getByLabel('Built-in role');
    await expect(picker).toBeVisible();
    await expect(picker.locator('option:not([disabled])')).toHaveCount(29); // none + 28
    await picker.selectOption('billing_officer');
    await expect(page.getByText('Access level: Finance (set by the built-in role)')).toBeVisible();
    await shoot(page, 'edit-role-picker');
    await page.getByRole('button', { name: 'Save role' }).click();
    await page.getByRole('button', { name: 'Change role' }).click();
    await expect(page.getByText('Billing Officer').first()).toBeVisible();

    // Clear it again so the seed person is back to the plain level.
    await menu.click();
    await page.getByRole('menuitem', { name: 'Edit role' }).click();
    await page.getByLabel('Built-in role').selectOption('');
    await page.getByRole('button', { name: 'Save role' }).click();
    await page.getByRole('button', { name: 'Change role' }).click();
    await expect(page.getByText('Billing Officer')).toHaveCount(0);
  } finally {
    await page.goto('/administration/people');
    const off = page.getByRole('button', { name: 'Turn off built-in roles' });
    if (await off.isVisible().catch(() => false)) await off.click();
  }

  // Off again: the Edit role form is the plain one.
  await page.goto('/administration/users');
  await page.getByRole('searchbox').first().fill('engineer@acme.test');
  await page.getByRole('button', { name: 'Row actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Edit role' }).click();
  await expect(page.getByLabel('Built-in role')).toHaveCount(0);
});
