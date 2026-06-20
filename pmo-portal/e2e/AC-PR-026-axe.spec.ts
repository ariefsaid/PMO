/**
 * AC-PR-026 — /procurement/:id tabbed shell passes axe-core (WCAG-AA) on EACH tab.
 *
 * Given the /procurement/:id page rendered with a full rich-seed showcase case
 * (SP2401-001 "PV Modules — Meridian 4.2 MW" — Paid, full record set + 8 events),
 *
 * When axe-core runs on each of the four tabs (Overview · Line items · Documents ·
 * Vendor quotes),
 *
 * Then there are zero violations on every tab.
 *
 * The page is a tabbed record shell (`/procurement/:id/:tab`). Each tab renders
 * different content so axe must be run per-tab.
 *
 * Uses @axe-core/playwright (installed as a dev dependency).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn } from './helpers';

// SP2401-001: "PV Modules — Meridian 4.2 MW" — Paid, full rich seed (has records on every tab)
const CASE_ID = '61000000-0000-0000-0000-000000000001';

// The four tabs to audit. Overview is the default; the others require navigation.
const TABS: { name: string; tab: string }[] = [
  { name: 'Overview', tab: 'overview' },
  { name: 'Line items', tab: 'items' },
  { name: 'Documents', tab: 'documents' },
  { name: 'Vendor quotes', tab: 'quotes' },
];

for (const { name, tab } of TABS) {
  test(`AC-PR-026 /procurement/:id — ${name} tab passes axe-core (WCAG-AA)`, async ({ page }) => {
    await signIn(page, 'admin@acme.test');
    // Navigate directly to the tab URL so the correct tab is active immediately
    await page.goto(`/procurement/${CASE_ID}/${tab}`);

    // Wait for full content to render (not in loading state)
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
    // Wait for data to settle so axe tests the rendered state, not a partial load
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);

    // Verify the page has key content before running axe (so we aren't testing a blank page)
    await expect(page.getByTestId('procurement-status-badge')).toBeVisible({ timeout: 5_000 });

    // Tab-specific content guard
    if (tab === 'overview') {
      await expect(page.getByRole('list', { name: 'Progression history' })).toBeVisible({ timeout: 5_000 });
    } else if (tab === 'documents') {
      await expect(page.getByTestId('procurement-ledger')).toBeVisible({ timeout: 5_000 });
    }

    // Run axe-core WCAG-AA scan
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(
      results.violations,
      `Expected zero axe-core WCAG-AA violations on /procurement/:id (${name} tab)\n` +
        results.violations
          .map(
            (v) =>
              `  [${v.impact}] ${v.id}: ${v.description}\n` +
              v.nodes.map((n) => `    → ${n.target.join(', ')}`).join('\n'),
          )
          .join('\n'),
    ).toEqual([]);
  });
}
