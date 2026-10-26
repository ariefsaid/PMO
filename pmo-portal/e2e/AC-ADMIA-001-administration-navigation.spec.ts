// @e2e-isolation: read-only — route/nav/heading/panel/Back/fragment coherence journey; seeded Admin session, no DB writes.
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-ADMIA-001 (cross-stack) + AC-ADMIA-003 + AC-ADMIA-004 at the rendered layer.
 *
 * These are the curated route-backed Administration journeys (Plan Task 9). They remain real-browser
 * e2e tests — not component tests — because the router, breadcrumb, and shell here are the app's:
 * a MemoryRouter unit test supplies its own route table, so it can never catch a missing canonical
 * child route, breadcrumb, or compatibility redirect in the shipped app. Together they prove that:
 *
 *   - `/administration` resolves (with `replace`) to the Users destination (FR-ADMIA-003)
 *   - each of Users / Organization integrations / Accounting setup / Project setup / Credits / Exchange
 *     rates has a stable URL, one active destination (aria-current="page") and exactly one mounted
 *     panel, with the URL, breadcrumb heading and selected link describing the same location
 *     (FR-ADMIA-001 / FR-ADMIA-004)
 *   - each browser Back edge restores the exact prior section without stale local tab state
 *     (FR-ADMIA-004)
 *   - the historical `#budget-account-map` deep link resolves to Accounting setup with the map
 *     reachable and the fragment preserved (FR-ADMIA-003 / AC-ADMIA-003)
 *
 * A seeded org Admin (admin@acme.test) drives the whole journey. It never writes a DB row, mutates an
 * integration, or invokes an edge function, so it qualifies as `read-only`.
 */

const ADMIN = 'admin@acme.test';

const ORGANIZATION_SECTIONS = [
  { name: 'Users', url: '/administration/users', testid: 'administration-panel-users', heading: 'Users' },
  {
    name: 'Organization integrations',
    url: '/administration/integrations',
    testid: 'administration-panel-integrations',
    heading: 'Organization integrations',
  },
  {
    name: 'Accounting setup',
    url: '/administration/accounting',
    testid: 'administration-panel-accounting',
    heading: 'Accounting setup',
  },
  // #770 added Project setup (the org's project classification options) as a fifth destination.
  { name: 'Project setup', url: '/administration/projects', testid: 'administration-panel-projects', heading: 'Project setup' },
  { name: 'Credits', url: '/administration/credits', testid: 'administration-panel-credits', heading: 'Credits' },
  // #1026 deliberately exposes JISDOR administration to org Admins.
  { name: 'Exchange rates', url: '/administration/exchange-rates', testid: 'administration-panel-exchange-rates', heading: 'Exchange rates' },
] as const;

const sectionNav = (page: Page) => page.getByRole('navigation', { name: 'Administration sections' });
const sectionLink = (page: Page, name: string) => sectionNav(page).getByRole('link', { name });
const panel = (page: Page, testid: string) => page.getByTestId(testid);

/** Asserts route-job heading, selected destination, breadcrumb and panel coherence. */
async function expectSectionSelected(
  page: Page,
  s: (typeof ORGANIZATION_SECTIONS)[number],
  opts: { expectUrl?: string } = {},
) {
  await expect(page).toHaveURL(opts.expectUrl ?? new RegExp(`${s.url}$`));
  // The selected route job owns the sole page h1; the area name remains in the breadcrumb.
  await expect(page.getByRole('heading', { level: 1, name: s.heading })).toBeVisible();
  await expect(page.locator('[data-page-frame]')).toBeVisible();
  await expect(page.locator('[data-shell-area-name]')).toHaveText('Administration');
  await expect(sectionLink(page, s.name)).toHaveAttribute('aria-current', 'page');
  await expect(panel(page, s.testid)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]'))
    .toHaveText(s.heading);
  // Exactly one destination is active and exactly one panel is mounted — no unrelated panel competes.
  await expect(sectionNav(page).locator('[aria-current="page"]')).toHaveCount(1);
}

async function expectOnlySelectedPanel(page: Page, selected: (typeof ORGANIZATION_SECTIONS)[number]) {
  for (const other of ORGANIZATION_SECTIONS) {
    if (other.testid !== selected.testid) {
      await expect(panel(page, other.testid)).toHaveCount(0);
    }
  }
}

/** Exercise one real section-link edge and its browser-Back inverse in an independent browser test. */
async function navigateAndRestore(
  page: Page,
  from: (typeof ORGANIZATION_SECTIONS)[number],
  to: (typeof ORGANIZATION_SECTIONS)[number],
) {
  await signIn(page, ADMIN);
  await page.goto(from.url);
  await expectSectionSelected(page, from);

  await sectionLink(page, to.name).click();
  await expectSectionSelected(page, to);
  await expectOnlySelectedPanel(page, to);

  await page.goBack();
  await expectSectionSelected(page, from);
}

test('AC-ADMIA-001: /administration resolves to the Users job and leaves Operator tools out of organization navigation', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/administration');

  // FR-ADMIA-003: `/administration` is an entry alias that resolves (replace) to Users.
  await expectSectionSelected(page, ORGANIZATION_SECTIONS[0]);
  await expectOnlySelectedPanel(page, ORGANIZATION_SECTIONS[0]);
  // The user directory itself is visible (FR-ADMIA-005's reachable surface — read-only observe).
  await expect(page.getByRole('searchbox', { name: 'Search users' })).toBeVisible();
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0);
  await expect(page.getByRole('table')).toBeVisible();

  // A non-Operator org Admin can reach every organization destination, never Usage/Features.
  for (const section of ORGANIZATION_SECTIONS) {
    await expect(sectionLink(page, section.name)).toHaveAttribute('href', section.url);
  }
  await expect(sectionNav(page).getByRole('link', { name: 'Usage' })).toHaveCount(0);
  await expect(sectionNav(page).getByRole('link', { name: 'Features' })).toHaveCount(0);
});

test('AC-ADMIA-001: Users → Organization integrations; browser Back restores Users', async ({ page }) => {
  await navigateAndRestore(page, ORGANIZATION_SECTIONS[0], ORGANIZATION_SECTIONS[1]);
});

test('AC-ADMIA-001: Organization integrations → Accounting setup; browser Back restores Organization integrations', async ({ page }) => {
  await navigateAndRestore(page, ORGANIZATION_SECTIONS[1], ORGANIZATION_SECTIONS[2]);
});

test('AC-ADMIA-001: Accounting setup → Project setup; browser Back restores Accounting setup', async ({ page }) => {
  await navigateAndRestore(page, ORGANIZATION_SECTIONS[2], ORGANIZATION_SECTIONS[3]);
});

test('AC-ADMIA-001: Project setup → Credits; browser Back restores Project setup', async ({ page }) => {
  await navigateAndRestore(page, ORGANIZATION_SECTIONS[3], ORGANIZATION_SECTIONS[4]);
});

test('AC-ADMIA-001: Credits → Exchange rates; browser Back restores Credits', async ({ page }) => {
  await navigateAndRestore(page, ORGANIZATION_SECTIONS[4], ORGANIZATION_SECTIONS[5]);
});

test('Shell frame: My integrations uses the shared page frame and personal shell label', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/integrations');

  await expect(page.locator('[data-page-frame]')).toBeVisible();
  await expect(page.locator('[data-shell-area-name]')).toHaveText('My integrations');
  await expect(page.getByRole('heading', { level: 1, name: 'My integrations' })).toBeVisible();
});

test('AC-ADMIA-001/003: the historical budget map bookmark resolves to Accounting setup with the fragment intact', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/administration#budget-account-map');

  // The alias preserves the fragment: the final URL keeps the target and Accounting becomes active.
  await expect(page).toHaveURL(/\/administration\/accounting#budget-account-map$/);
  await expect(sectionLink(page, 'Accounting setup')).toHaveAttribute('aria-current', 'page');
  await expect(panel(page, 'administration-panel-accounting')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Accounting setup' })).toBeVisible();

  // The budgeting deep-link target is genuinely reachable after Accounting mounts (FR-ADMIA-003).
  const map = page.locator('#budget-account-map');
  await expect(map).toBeVisible();
  await expect(map).toContainText(/budget account map/i);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]'))
    .toHaveText('Accounting setup');
});
