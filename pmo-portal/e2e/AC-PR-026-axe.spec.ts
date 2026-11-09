/**
 * AC-PR-026 — /procurement/:id tabbed shell passes axe-core (WCAG-AA) on EACH tab.
 *
 * Given the /procurement/:id page rendered with a full rich-seed showcase case
 * (SP2401-001 "PV Modules — Meridian 4.2 MW" — Paid, full record set + 8 events),
 *
 * When axe-core runs on each of the five tabs (Timeline · Line items · Quotations · Files · Details),
 *
 * Then there are zero violations on every tab.
 *
 * The page is a tabbed record shell (`/procurement/:id/:tab`). Each tab renders
 * different content so axe must be run per-tab.
 *
 * Uses @axe-core/playwright (installed as a dev dependency).
 */
// @e2e-isolation: read-only — signIn + procurement tabbed page axe scan on seeded case; no DB writes.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn } from './helpers';
// SP2401-001: "PV Modules — Meridian 4.2 MW" — Paid, full rich seed (has records on every tab)
const CASE_ID = '61000000-0000-0000-0000-000000000001';

// Audit each canonical tab route so its distinct content is covered.
const TABS: { name: string; tab: string }[] = [
  { name: 'Timeline', tab: 'timeline' },
  { name: 'Line items', tab: 'items' },
  { name: 'Quotations', tab: 'quotes' },
  { name: 'Files', tab: 'files' },
  { name: 'Details', tab: 'details' },
];

for (const { name, tab } of TABS) {
  test(`AC-PR-026 /procurement/:id — ${name} tab passes axe-core (WCAG-AA)`, async ({ page }) => {
    await signIn(page, 'admin@acme.test');
    // Navigate directly to the tab URL so the correct tab is active immediately
    await page.goto(`/procurement/${CASE_ID}/${tab}`);

    // Wait for full content to render (not in loading state)
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
    // Wait for data to settle so axe tests the rendered state, not a partial load
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(800);

    // Verify the page has key content before running axe (so we aren't testing a blank page)
    await expect(page.getByTestId('procurement-status-badge')).toBeVisible({ timeout: 5_000 });

    // Tab-specific content guard
    if (tab === 'timeline') {
      await expect(page.getByTestId('procurement-timeline')).toBeVisible({ timeout: 5_000 });
    } else if (tab === 'files') {
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

// #1453 — the procurement LIST in the dark theme. The primary-text link token
// (`text-primary-text` → `--primary-text`) paints the row-level links here (ProcurementBlock's
// open-procurement / for-you / next-milestone text, ErpOrphans links), and the dark-theme value
// historically measured sub-AA against the dark surfaces. This scan runs the same journey in the
// DARK theme (forced before first paint, exactly as the app's own no-flash bootstrap reads it)
// and asserts axe-core's color-contrast rule finds nothing — no allowlist entry, no exemption.
test('AC-PR-026 /procurement (list) — dark theme passes axe-core color-contrast (#1453)', async ({ page }) => {
  // Force dark BEFORE first paint (matches index.html's no-flash bootstrap, which reads this key).
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'dark');
  });
  await signIn(page, 'admin@acme.test');
  await page.goto('/procurement');
  // Oracle guard: prove dark is actually applied, or this would silently scan the light theme.
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);

  // Wait for real rows so axe measures the populated list, not a loading or empty state.
  await expect(page.getByText(/PROC-/).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

  const results = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .analyze();

  expect(
    results.violations,
    'Expected zero axe color-contrast violations on /procurement in the dark theme\n' +
      results.violations
        .map(
          (v) =>
            `  [${v.impact}] ${v.id}: ${v.description}\n` +
            v.nodes
              .map(
                (n) =>
                  `    → ${n.target.join(', ')}\n` +
                  `      ${n.failureSummary ?? ''}`,
              )
              .join('\n'),
        )
        .join('\n'),
  ).toEqual([]);
});
