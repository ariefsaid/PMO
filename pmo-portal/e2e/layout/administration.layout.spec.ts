// @e2e-isolation: read-only — layout measurements on a seeded route; no writes.
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { registerLayoutSweep } from '../support/layout-sweep';
import {
  ADMINISTRATION_OPERATOR_SECTIONS,
  driveAdministrationSections,
} from '../support/layout-oracles';

registerLayoutSweep({ path: '/administration', label: 'administration', icons: true });

const ADMIN = 'admin@acme.test';
const OPERATOR = 'operator@pmo.test';

/**
 * AC-ADMIA-005 (rendered) — desktop and 390px phone oracle for the Administration shell (Plan Task 9).
 *
 * At desktop and at the 390px phone width, every organization Admin destination link must be
 * reachable (real, clickable, navigable), the selected panel must remain visible, and the page must
 * show no page-level horizontal overflow or clipped element running off the right edge. This is the
 * rendered counterpart to the shell's unit-level responsive/semantic assertions (Plan Task 8): a
 * jsdom test cannot measure real layout, so the "no horizontal page overflow" and "no element bleeds
 * past the viewport" properties are proven here in a real browser.
 *
 * The shell renders in both light and dark modes, so at the phone width the sweep repeats in dark
 * theme (the `theme` localStorage key is read at bootstrap).
 */
test('@layout AC-ADMIA-005: Administration destinations stay reachable and overflow-free at desktop, phone, and phone dark mode', async ({ page }) => {
  // Three full passes (desktop, phone, phone dark) of every section's layout checks; the default 30s
  // budget ran out on a loaded CI runner while the page itself was correct.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, ADMIN);
  await page.goto('/administration');

  await driveAdministrationSections(page, 1280, 800);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/administration');
  await driveAdministrationSections(page, 390, 844);

  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.goto('/administration');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await driveAdministrationSections(page, 390, 844);
});

test('@layout AC-ADMIA-005: Operator can reach all six Administration sections on a 390px phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, OPERATOR);
  await page.goto('/administration');
  await driveAdministrationSections(page, 390, 844, ADMINISTRATION_OPERATOR_SECTIONS);
});
