// @e2e-isolation: read-only — reads the seeded procurement list at a phone viewport and switches the
// URL-owned view; no writes.
/**
 * AC-PVT-001 (#715) — a phone user can reach the Procurement Table/Board switch and it works.
 *
 * ORACLE: at 390px the "Procurement view" tablist has a real (non-zero) box inside the viewport,
 * and choosing Board then Table changes what the page renders (the board's stage columns appear,
 * then the list rows replace them). Projects and Sales already keep a usable switch at this width.
 * Supersedes the A-MIN-1 rule that hid this toggle below md.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.describe('AC-PVT-001 procurement view toggle on a phone @mobile', () => {
  test('AC-PVT-001: the Procurement view switch is visible at 390px and switching Table/Board changes the view', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/procurement');

    const toggle = page.getByRole('tablist', { name: 'Procurement view' });
    await expect(toggle).toBeVisible({ timeout: 60_000 });
    const box = await toggle.boundingBox();
    expect(box, 'the view tablist has a rendered box').not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1);

    const boardStage = page.locator('[data-testid^="prstage-"]').first();
    const tableTab = toggle.getByRole('tab', { name: 'Table' });
    const boardTab = toggle.getByRole('tab', { name: 'Board' });

    await expect(tableTab).toHaveAttribute('aria-selected', 'true');
    await expect(boardStage).toHaveCount(0);

    await boardTab.click();
    await expect(boardTab).toHaveAttribute('aria-selected', 'true');
    await expect(boardStage).toBeVisible();

    await tableTab.click();
    await expect(tableTab).toHaveAttribute('aria-selected', 'true');
    await expect(boardStage).toHaveCount(0);
  });
});
