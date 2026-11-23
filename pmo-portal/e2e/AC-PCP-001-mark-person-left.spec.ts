// @e2e-isolation: self-isolated — creates its own uniquely-named person, marks them as left, and finds them under Former staff; no seed coupling.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-PCP-001 — job 1 of fix/walk-people: "Mark as left" with a day.
 *
 * An Admin adds a person, marks them as having left, and the person moves out of the Active list into Former staff,
 * still on record. Goal oracle: after the confirm the name is NOT in Active and IS under Former staff.
 */
test.setTimeout(90_000);

test('AC-PCP-001: an Admin marks a person as left; they leave Active and appear under Former staff', async ({ page }) => {
  const name = `E2E Leaver ${Date.now()}`;
  await login(page, 'admin@acme.test');
  await page.goto('/administration/people');

  await page.getByRole('button', { name: 'Add person' }).first().click();
  const add = page.getByRole('dialog');
  await add.getByLabel('Name').fill(name);
  await add.getByRole('button', { name: 'Save person' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: `Mark ${name} as left` }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('First day off crew roster');
  await confirm.getByRole('button', { name: 'Mark as left' }).click();

  await expect(page.getByRole('link', { name })).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Former staff' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible({ timeout: 15_000 });
});
