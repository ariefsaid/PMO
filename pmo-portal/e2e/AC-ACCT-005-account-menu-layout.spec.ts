// @e2e-isolation: read-only — signed-in shell rendering and menu interaction only; no database write.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-ACCT-005 — the ONE account menu fits desktop and short 390px phone viewports: every
 * action stays visible or scrollable into view inside the popup (which scrolls internally)
 * and no visible menu element bleeds past the viewport edge. Preserves the session;
 * never activates Sign out.
 */
test.describe('AC-ACCT-005 account-menu responsive layout', () => {
  test('AC-ACCT-005: desktop shows every action with no page overflow', async ({ page }) => {
    await signIn(page, 'pm@acme.test');
    await page.goto('/');
    await page.getByRole('button', { name: /account menu/i }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const desktopBox = await menu.boundingBox();
    expect(desktopBox).not.toBeNull();
    expect(desktopBox!.x).toBeGreaterThanOrEqual(-1);
    expect(desktopBox!.x + desktopBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

    for (const item of await menu.locator('[role="menuitem"], [role="menuitemradio"]').all()) {
      await expect(item).toBeVisible();
      const itemBox = await item.boundingBox();
      expect(itemBox).not.toBeNull();
      expect(itemBox!.x + itemBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
    await page.keyboard.press('Shift+Tab');
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('button', { name: /notifications/i })).toBeFocused();
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('main :focus')).toHaveCount(1);
  });

  test('AC-ACCT-005: the short 390px phone menu scrolls internally with no page overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 360 });
    // The sample demo Admin adds the View-as-role section, guaranteeing content taller than
    // the viewport-bounded popup so the internal scroll behaviour is actually exercised.
    await signIn(page, 'admin@acme.test');
    await page.goto('/');
    await page.getByRole('button', { name: /account menu/i }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(-1);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(391);
    expect(menuBox!.y).toBeGreaterThanOrEqual(-1);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(361);

    // Eligibility is an org-scoped async read; wait for its real resolved state.
    await expect(menu.getByText('View as role')).toBeVisible({ timeout: 15_000 });

    // The popup scrolls internally when height-constrained (scrollHeight > clientHeight).
    const overflow = await menu.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);

    // Every action, including conditional Help and all preview roles, is reachable.
    const actions = await menu.locator('[role="menuitem"], [role="menuitemradio"]').all();
    expect(actions.length).toBeGreaterThan(8);
    for (const item of actions) {
      await item.scrollIntoViewIfNeeded();
      await expect(item).toBeVisible();
      const itemBox = await item.boundingBox();
      expect(itemBox).not.toBeNull();
      expect(itemBox!.x).toBeGreaterThanOrEqual(menuBox!.x - 1);
      expect(itemBox!.x + itemBox!.width).toBeLessThanOrEqual(menuBox!.x + menuBox!.width + 1);
    }
  });
});
