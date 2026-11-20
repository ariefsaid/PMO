// @e2e-isolation: read-only — signs in, fires a link-copied notice (no DB writes) and measures geometry.
import { test, expect } from '@playwright/test';
import { signIn, visibleToast, waitForFonts } from './helpers';

/**
 * AC-TM-018 — at phone width (390) a toast must never be painted over the navigation drawer's
 * header (brand row + close button). The notice that was already showing when the drawer opens
 * is the case: the drawer header must stay uncovered and its close button clickable.
 */
test('AC-TM-018 phone: a toast does not cover the navigation drawer header', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/projects');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('projects-table-container').getByRole('link', { name: 'Innovate Corp HQ Fit-Out', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/i, { timeout: 15_000 });
  await waitForFonts(page);

  const base = new URL(page.url()).pathname.replace(/\/$/, '');
  await page.goto(`${base}/procurement`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Row actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Copy link' }).click();
  const toast = visibleToast(page, /link cop|copy link/i);
  await expect(toast).toBeVisible({ timeout: 15_000 });

  await page.getByRole('navigation').filter({ has: page.getByRole('button', { name: /^more$/i }) }).getByRole('button', { name: /^more$/i }).click();
  const drawer = page.getByRole('dialog', { name: /navigation menu/i });
  await expect(drawer).toBeVisible();
  await waitForFonts(page);
  await page.waitForTimeout(600); // let the stack settle after the drawer opens

  const close = drawer.getByRole('button', { name: /close navigation menu/i });
  const headerBox = await close.evaluate((el) => {
    const header = el.parentElement!;
    const r = header.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const toastBox = await toast.boundingBox();
  expect(toastBox, 'the notice is still showing').toBeTruthy();
  const overlaps = toastBox!.x < headerBox.x + headerBox.width && headerBox.x < toastBox!.x + toastBox!.width
    && toastBox!.y < headerBox.y + headerBox.height && headerBox.y < toastBox!.y + toastBox!.height;
  expect(overlaps, `toast ${JSON.stringify(toastBox)} covers drawer header ${JSON.stringify(headerBox)}`).toBe(false);
  // The topmost element at the close button's centre is the button itself, not the toast.
  const hit = await close.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === el || el.contains(top);
  });
  expect(hit, 'the close button is reachable').toBe(true);
});
