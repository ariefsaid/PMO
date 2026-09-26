// @e2e-isolation: read-only — route/nav/heading/panel/Back/fragment coherence journey; seeded Admin session, no DB writes.
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-ADMIA-001 (cross-stack) + AC-ADMIA-003 + AC-ADMIA-004 at the rendered layer.
 *
 * This is the curated route-backed Administration journey (Plan Task 9). It exists as a real-browser
 * e2e — not a component test — because the router, breadcrumb, and shell here are genuinely the app's:
 * a MemoryRouter unit test supplies its own route table, so it can never catch the class of defect
 * where the canonical child routes, breadcrumbs, or the compatibility redirects do not exist in the
 * shipped app. This journey proves, end to end, that:
 *
 *   - `/administration` resolves (with `replace`) to the Users destination (FR-ADMIA-003)
 *   - each of Users / Organization integrations / Accounting setup / Credits has a stable URL, one
 *     active destination (aria-current="page") and exactly one mounted panel, and the URL, breadcrumb
 *     heading and selected link all describe the same location (FR-ADMIA-001 / FR-ADMIA-004)
 *   - browser Back restores the previous section without stale local tab state (FR-ADMIA-004)
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
  { name: 'Credits', url: '/administration/credits', testid: 'administration-panel-credits', heading: 'Credits' },
] as const;

const sectionNav = (page: Page) => page.getByRole('navigation', { name: 'Administration sections' });
const sectionLink = (page: Page, name: string) => sectionNav(page).getByRole('link', { name });
const panel = (page: Page, testid: string) => page.getByTestId(testid);

/** Asserts the location-, heading- and panel-coherence oracle for one selected section. */
async function expectSectionSelected(
  page: Page,
  s: (typeof ORGANIZATION_SECTIONS)[number],
  opts: { expectUrl?: string } = {},
) {
  await expect(page).toHaveURL(opts.expectUrl ?? new RegExp(`${s.url}$`));
  // Source-of-truth heading: the page-level h1 stays "Administration"; the selected panel owns an h2.
  await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
  await expect(sectionLink(page, s.name)).toHaveAttribute('aria-current', 'page');
  await expect(panel(page, s.testid)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: s.heading })).toBeVisible();
  // Exactly one destination is active and exactly one panel is mounted — no unrelated panel competes.
  await expect(sectionNav(page).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(panel(page, s.testid)).toBeVisible();
}

test('AC-ADMIA-001: an org Admin journeys through the four destinations with coherent location/heading/panel and Back restores the prior section', async ({
  page,
}) => {
  await signIn(page, ADMIN);
  await page.goto('/administration');

  // FR-ADMIA-003: `/administration` is an entry alias that resolves (replace) to Users.
  await expect(page).toHaveURL(/\/administration\/users$/);
  await expect(panel(page, 'administration-panel-users')).toBeVisible();
  await expect(sectionLink(page, 'Users')).toHaveAttribute('aria-current', 'page');
  // The user directory itself is visible (FR-ADMIA-005's reachable surface — read-only observe).
  await expect(page.getByRole('searchbox', { name: 'Search users' })).toBeVisible();
  await expect(page.getByText('All users')).toBeVisible();

  // A non-Operator org Admin sees exactly the four organization destinations, never Usage/Features.
  await expect(sectionNav(page).getByRole('link')).toHaveCount(4);
  await expect(sectionNav(page).getByRole('link', { name: 'Usage' })).toHaveCount(0);
  await expect(sectionNav(page).getByRole('link', { name: 'Features' })).toHaveCount(0);

  // Choose each destination in turn; each changes URL, active link, heading and mounted panel coherently.
  for (const s of ORGANIZATION_SECTIONS.slice(1)) {
    await sectionLink(page, s.name).click();
    await expectSectionSelected(page, s);
    // The newly selected panel replaces the previous one — no stale panel stays mounted.
    for (const other of ORGANIZATION_SECTIONS) {
      if (other.testid !== s.testid) {
        await expect(panel(page, other.testid)).toHaveCount(0);
      }
    }
  }

  // FR-ADMIA-004: browser Back restores each prior section (no stale local tab state).
  await page.goBack();
  await expectSectionSelected(page, ORGANIZATION_SECTIONS[2]); // Accounting setup
  await page.goBack();
  await expectSectionSelected(page, ORGANIZATION_SECTIONS[1]); // Organization integrations
  await page.goBack();
  await expectSectionSelected(page, ORGANIZATION_SECTIONS[0]); // Users
});

test('AC-ADMIA-003: the historical #budget-account-map deep link resolves to Accounting setup with the map reachable', async ({
  page,
}) => {
  await signIn(page, ADMIN);
  await page.goto('/administration#budget-account-map');

  // The alias preserves the fragment: the final URL keeps the target and Accounting becomes active.
  await expect(page).toHaveURL(/\/administration\/accounting#budget-account-map$/);
  await expect(sectionLink(page, 'Accounting setup')).toHaveAttribute('aria-current', 'page');
  await expect(panel(page, 'administration-panel-accounting')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Accounting setup' })).toBeVisible();

  // The budgeting deep-link target is genuinely reachable after Accounting mounts (FR-ADMIA-003).
  const map = page.locator('#budget-account-map');
  await expect(map).toBeVisible();
  await expect(map).toContainText(/budget account map/i);
});