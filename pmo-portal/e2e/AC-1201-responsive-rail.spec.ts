// @e2e-isolation: read-only — pure nav/assert; viewport resize + nav rail visibility; no DB writes.
import { test, expect } from '@playwright/test';
import { login, waitForFonts } from './helpers';

// AC-1201 — Responsive rail collapse (single source of truth at the 920px
// breakpoint). Durable regression guard for the C1 bugs that slipped jsdom
// twice: jsdom never applies CSS media queries, so the persistent-rail hide,
// the --rail-w collapse, and the hamburger/drawer swap can only be proven in a
// real browser. Runs in CI's integration (Playwright) job.

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 560, height: 800 };

test('AC-1201 desktop shows the persistent rail; mobile hides it and the drawer carries nav', async ({
  page,
}) => {
  // The DOM landmark labels below are English; avoid dependence on a persisted seed locale.
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(url)) return route.fallback();
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      return route.fulfill({ response, json: { ...body, locale: 'en', number_locale: 'en-US' } });
    }
    return route.fulfill({ response, json: body });
  });
  await page.setViewportSize(DESKTOP);
  await login(page, 'exec@acme.test');
  await page.goto('/');

  // --- Desktop: persistent grid-area rail is visible, no hamburger. ---
  const persistent = page.locator('.rail-persistent');
  await expect(persistent).toBeVisible();
  // The persistent rail's nav is present with real items (anchors now that Rail uses NavLink).
  const desktopNavCount = await persistent.locator('nav a').count();
  expect(desktopNavCount).toBeGreaterThan(0);
  // Hamburger is hidden at desktop widths.
  await expect(page.locator('.mobile-rail-toggle')).toBeHidden();

  // --- Mobile: persistent rail collapses, hamburger appears. ---
  await page.setViewportSize(MOBILE);
  // .rail-persistent is display:none ≤920px → not visible.
  await expect(persistent).toBeHidden();
  const hamburger = page.locator('.mobile-rail-toggle');
  await expect(hamburger).toBeVisible();

  // Opening the hamburger reveals a drawer copy of the rail WITH nav links.
  await hamburger.click();
  // The drawer rail is the Primary-navigation <nav> NOT under .rail-persistent.
  const drawerNav = page.locator('nav[aria-label="Primary navigation"]').nth(1);
  await expect(drawerNav.getByRole('link', { name: /Approvals/ })).toBeVisible();
  const drawerNavCount = await page.evaluate(() => {
    const navs = Array.from(
      document.querySelectorAll('nav[aria-label="Primary navigation"]')
    );
    const drawer = navs.find((n) => !n.closest('.rail-persistent'));
    return drawer ? drawer.querySelectorAll('a').length : 0;
  });
  expect(drawerNavCount).toBeGreaterThan(0);
});

test('UX-001 Approvals stays within the 800px rail viewport while Sales remains in navigation', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await login(page, 'admin@acme.test');
  await page.goto('/projects');

  const nav = page.locator('.rail-persistent nav[aria-label="Primary navigation"]');
  const approvals = nav.getByRole('link', { name: /Approvals/ });
  const sales = nav.getByRole('link', { name: 'Sales Pipeline' });
  await expect(approvals).toBeVisible();
  await expect(sales).toBeAttached();
  await waitForFonts(page);

  const railBox = await nav.boundingBox();
  const approvalsBox = await approvals.boundingBox();
  expect(railBox).not.toBeNull();
  expect(approvalsBox).not.toBeNull();
  expect(approvalsBox!.y).toBeGreaterThanOrEqual(railBox!.y);
  expect(approvalsBox!.y + approvalsBox!.height).toBeLessThanOrEqual(railBox!.y + railBox!.height);
  expect(approvalsBox!.y + approvalsBox!.height).toBeLessThanOrEqual(DESKTOP.height);
});
