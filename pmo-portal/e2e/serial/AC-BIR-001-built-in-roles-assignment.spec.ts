// @e2e-isolation: serial — gives one seeded person a role and clears it; built-in roles are on for every organisation (#2746), so no org-wide setting is flipped.
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, pinEnglishLocale } from '../helpers';

/**
 * AC-BIR-001 (#2709) — an Admin gives a person a built-in role from the Edit role form and sees it in the directory
 * (built-in roles are on for every organisation, #2746).
 * Also writes the two evidence screenshots per new screen (phone 390 and desktop 1440) under docs/evidence/1215/2709/.
 */
test.setTimeout(240_000);

const EVIDENCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/evidence/1215/2709');
const SIZES = [{ name: 'phone-390', width: 390, height: 844 }, { name: 'desktop-1440', width: 1440, height: 900 }] as const;

/** Evidence capture only when asked (EVIDENCE_SHOTS=1), so a normal run writes no files. */
async function shoot(page: Page, screen: string) {
  if (process.env.EVIDENCE_SHOTS !== '1') return;
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    const heading = page.getByRole('heading', { name: 'Built-in roles' });
    if (screen.startsWith('setting')) await heading.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(EVIDENCE, `${screen}-${size.name}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

/** Search for the seeded Engineer and return their row once the directory has narrowed to it (the search is debounced). */
async function engineerRow(page: Page) {
  await page.getByRole('searchbox').first().fill('engineer@acme.test');
  const row = page.getByRole('row').filter({ hasText: 'engineer@acme.test' });
  await expect(page.getByRole('row').filter({ hasText: '@' })).toHaveCount(1);
  await expect(row).toBeVisible();
  return row;
}

test('AC-BIR-001: the Edit role form offers 28 roles; a role is given and shown', async ({ page }) => {
  await pinEnglishLocale(page);
  await signIn(page, 'admin@acme.test');
  try {
    // Built-in roles are on for every organisation (#2746): there is no switch to turn on.

    // Give the seeded Engineer the Planner role.
    await page.goto('/administration/users');
    const menu = (await engineerRow(page)).getByRole('button', { name: 'Row actions' });
    await menu.click();
    await page.getByRole('menuitem', { name: 'Change job role' }).click();
    const picker = page.getByRole('combobox', { name: 'Job role' });
    await expect(picker).toBeVisible();
    await expect(picker.locator('option:not([disabled])')).toHaveCount(29); // none + 28
    await picker.selectOption('billing_officer');
    await expect(page.getByText('Access level: Finance (set by the job role)')).toBeVisible();
    await shoot(page, 'edit-role-picker');
    await page.getByRole('button', { name: 'Save job role' }).click();
    await page.getByRole('button', { name: 'Change role' }).click();
    await expect((await engineerRow(page)).getByText('Billing Officer')).toBeVisible();

    // Clear it. Clearing keeps the access level the role had set (Finance); the plain form then puts the seeded Engineer back.
    await (await engineerRow(page)).getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: 'Change job role' }).click();
    await page.getByRole('combobox', { name: 'Job role' }).selectOption('');
    await page.getByRole('button', { name: 'Save job role' }).click();
    await page.getByRole('button', { name: 'Change role' }).click();
    await expect((await engineerRow(page)).getByText('Billing Officer')).toHaveCount(0); // the toast also names it, so look only in the row
    await expect((await engineerRow(page)).getByText('Finance')).toBeVisible();
    await (await engineerRow(page)).getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: 'Change job role' }).click();
    await page.getByRole('combobox', { name: 'Access level' }).selectOption('Engineer');
    await page.getByRole('button', { name: 'Save job role' }).click();
    await page.getByRole('button', { name: 'Change role' }).click();
    await expect((await engineerRow(page)).getByText('Engineer', { exact: true })).toBeVisible();
  } finally {
    // Nothing to switch back: the setting is on for everyone.
  }
});
