/**
 * AC-PR-026 — /procurement/:id with records and history passes axe-core (WCAG-AA).
 *
 * Given the /procurement/:id page rendered with a full rich-seed showcase case
 * (SP2401-001 "PV Modules — Meridian 4.2 MW" — Paid, full record set + 8 events),
 *
 * When axe-core runs,
 *
 * Then there are zero violations.
 *
 * Uses @axe-core/playwright (installed as a dev dependency).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn } from './helpers';

// SP2401-001: "PV Modules — Meridian 4.2 MW" — Paid, full rich seed
const CASE_ID = '61000000-0000-0000-0000-000000000001';
const CASE_URL = `/procurement/${CASE_ID}`;

test('AC-PR-026 /procurement/:id with records and history passes axe-core (WCAG-AA)', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto(CASE_URL);

  // Wait for full content to render (not in loading state)
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  // Wait for data to settle so axe tests the rendered state, not a partial load
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);

  // Verify the page has key content before running axe (so we aren't testing a blank page)
  await expect(page.getByTestId('procurement-status-badge')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('list', { name: 'Progression history' })).toBeVisible({ timeout: 5_000 });

  // Run axe-core WCAG-AA scan
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(
    results.violations,
    'Expected zero axe-core WCAG-AA violations on /procurement/:id\n' +
      results.violations
        .map(
          (v) =>
            `  [${v.impact}] ${v.id}: ${v.description}\n` +
            v.nodes.map((n) => `    → ${n.target.join(', ')}`).join('\n'),
        )
        .join('\n'),
  ).toEqual([]);
});
