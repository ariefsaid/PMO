// @e2e-isolation: read-only — pure nav/assert; viewport resize + nav rail visibility; no DB writes.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

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
  const drawerNavCount = await page.evaluate(() => {
    const navs = Array.from(
      document.querySelectorAll('nav[aria-label="Primary navigation"]')
    );
    const drawer = navs.find((n) => !n.closest('.rail-persistent'));
    return drawer ? drawer.querySelectorAll('a').length : 0;
  });
  expect(drawerNavCount).toBeGreaterThan(0);
});
