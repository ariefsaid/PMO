/**
 * AC-PR-026 — /procurement/:id named-section shell passes axe-core (WCAG-AA) on EACH section.
 *
 * Given the /procurement/:id page rendered with a full rich-seed showcase case
 * (SP2401-001 "PV Modules — Meridian 4.2 MW" — Paid, full record set + 8 events),
 *
 * When axe-core runs on Review, Items, Documents, Quotes, and Activity,
 *
 * Then there are zero violations on every section.
 *
 * The page is a named-section record shell (`/procurement/:id/:section`). Each section renders
 * different content so axe must be run per-section.
 *
 * Uses @axe-core/playwright (installed as a dev dependency).
 */
// @e2e-isolation: read-only — signIn + procurement named-section axe scan on seeded case; no DB writes.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn } from './helpers';

// SP2401-001: "PV Modules — Meridian 4.2 MW" — Paid, full rich seed (has records in every section)
const CASE_ID = '61000000-0000-0000-0000-000000000001';

// Every named section gets its own rendered accessibility scan.
const SECTIONS: { name: string; section: string }[] = [
  { name: 'Review', section: 'overview' },
  { name: 'Items', section: 'items' },
  { name: 'Documents', section: 'documents' },
  { name: 'Quotes', section: 'quotes' },
  { name: 'Activity', section: 'activity' },
];

for (const { name, section } of SECTIONS) {
  test(`AC-PR-026 /procurement/:id — ${name} section passes axe-core (WCAG-AA)`, async ({ page }) => {
    await signIn(page, 'admin@acme.test');
    // Navigate directly to the section URL so the correct section is active immediately
    await page.goto(`/procurement/${CASE_ID}/${section}`);

    // Wait for full content to render (not in loading state)
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
    // Wait for data to settle so axe tests the rendered state, not a partial load
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);

    // Verify the page has key content before running axe (so we aren't testing a blank page)
    await expect(page.getByTestId('procurement-status-badge')).toBeVisible({ timeout: 5_000 });

    // Section-specific content guard
    if (section === 'overview') {
      await expect(page.getByRole('heading', { name: 'Purchase amounts' })).toBeVisible({ timeout: 5_000 });
    } else if (section === 'activity') {
      await expect(page.getByRole('list', { name: 'Purchase activity' })).toBeVisible({ timeout: 5_000 });
    } else if (section === 'documents') {
      await expect(page.getByTestId('procurement-ledger')).toBeVisible({ timeout: 5_000 });
    }

    // Run axe-core WCAG-AA scan
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(
      results.violations,
      `Expected zero axe-core WCAG-AA violations on /procurement/:id (${name} section)\n` +
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
